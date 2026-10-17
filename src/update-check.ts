/**
 * 构建身份与更新检查：本机构建从何而来、上游与我们的分支各自走到了哪里。
 *
 * 三条硬性约束决定了这里的形状：
 * 1. **不启动子进程**。DSH 沙箱禁止子进程的管道 stdio（`stdio: 'pipe'` 直接 EPERM），
 *    所以「当前版本」只能从文件读：插件自己的 package.json、自己 lib/index.js 的 mtime。
 * 2. **网络失败一律降级成一段 error 文本**，绝不把异常抛出路由——面板宁可显示
 *    「检查失败」也不能变白板。三个来源（npm / 上游标签 / 我们的分支）各自独立失败，
 *    能拿到的照常返回。
 * 3. **缓存不是可选项**。GitHub 未认证限额 60 次/小时，一次检查最多 11 个请求
 *    （1 分支清单 + ≤8 分支头提交 + npm + 标签），所以 6 小时内只联网一次。
 *    插件加载时**不做任何网络动作**：首次联网发生在第一次 `collectUpdateCheck`。
 *
 * @module @kenz1117/dsh-engram/update-check
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { message } from './i18n/messages.ts'

/** 本仓库的工作基线在上游的哪个版本上——**手工维护**：每次把我们的改动重基到新的上游发布时改这一行。 */
export const UPSTREAM_BASE = '0.8.12'
/** 我们的仓库（fork）。 */
export const FORK_REPO = 'dsv180/dsh-engram-dsv'
/** 上游仓库。 */
export const UPSTREAM_REPO = 'kenz1117/dsh-engram'
/** npm 包名（与 package.json 的 name 一致；注册表路径要把它转义成 `@kenz1117%2Fdsh-engram`）。 */
const NPM_PACKAGE = '@kenz1117/dsh-engram'
/** 缓存有效期：6 小时。 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
/** 失败结果的缓存有效期：5 分钟。Ошибка (особенно лимит GitHub) почти всегда временная —
 *  держать её 6 часов значит показывать красную плашку по уже несуществующей причине. */
const FAILURE_TTL_MS = 5 * 60 * 1000
/** 分支上限：每次检查最多看 8 个分支（每个分支一次 commits 请求，保护 GitHub 限额）。 */
const MAX_BRANCHES = 8
/** 单次请求超时。GitHub/npm 正常都在 1 秒内，8 秒足够，也不会把面板拖死。 */
const REQUEST_TIMEOUT_MS = 8000
/** package.json 读不到时的兜底版本：宁可显示 0.0.0，也不要空串。 */
const FALLBACK_VERSION = '0.0.0'

/** 一个分支的最新提交（日期为毫秒时间戳，取自 commit.committer.date）。 */
export interface UpdateRef {
  readonly ref: string
  readonly sha: string
  readonly date: number
  readonly subject: string
}

/** 构建身份：全部来自本机文件系统，不联网、不起进程。 */
export interface UpdateBuildInfo {
  readonly version: string
  readonly upstreamBase: string
  /** 本插件 lib/index.js 的 mtime；文件不在（未构建）时为 null。 */
  readonly builtAt: number | null
  /** 插件包目录（repo 根，或 profile 下的 node_modules/@kenz1117/dsh-engram）。 */
  readonly installPath: string
  /** 从安装路径认出的 profile 名；认不出为 null。 */
  readonly profile: string | null
}

/** 上游（npm 与 GitHub 标签）与我们的基线之比。 */
export interface UpdateUpstreamView {
  readonly npmLatest: string | null
  readonly latestTag: string | null
  readonly ahead: boolean
}

/** 我们的分支：最新提交一览，以及其中晚于本机构建的那些。 */
export interface UpdateForkView {
  readonly refs: readonly UpdateRef[]
  readonly newerThanBuild: readonly string[]
}

/** 面板要用的外链（全部是 https 直链，客户端只负责渲染）。 */
export interface UpdateLinks {
  readonly forkRepo: string
  readonly forkCommits: string
  readonly forkReleases: string
  readonly forkIssues: string
  readonly upstreamRepo: string
  readonly upstreamReleases: string
  readonly upstreamNpm: string
}

/** 手动安装说明：面板装不了任何东西（安装要宿主侧跑 dsh plugin），所以只给一条可复制的命令。 */
export interface UpdateInstallView {
  readonly command: string
  readonly profile: string | null
}

/** `GET /api/engram/update-check` 的返回体（客户端依赖这个形状，字段名不可改）。 */
export interface UpdateCheckPayload {
  /** 产出 upstream/fork 那次联网的时刻；缓存命中时保持原值（不是本刻）。 */
  readonly checkedAt: number
  readonly fromCache: boolean
  /** 已本地化、可直接显示的失败说明：только когда **ни один** источник не ответил. */
  readonly error: string | null
  /** 部分失败（源码级注释见 performCollection）：источники, которые не ответили, но данные есть.
   *  Плашку не красят — она показывает статус обновления, а не качество связи с GitHub. */
  readonly notes: readonly string[]
  readonly build: UpdateBuildInfo
  readonly upstream: UpdateUpstreamView
  readonly fork: UpdateForkView
  readonly links: UpdateLinks
  readonly install: UpdateInstallView
}

/** collectUpdateCheck 的入参。 */
export interface UpdateCheckOptions {
  /** true = 忽略缓存强制联网（面板「检查更新」按钮）。 */
  readonly refresh?: boolean
}

/** 已解析的语义化版本。 */
interface Semver {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: string | null
}

/**
 * 解析语义化版本（可选前缀 `v`、可选预发布段、忽略构建元数据）。
 * 认不出来返回 null——网络来的字符串不能假定合法。
 */
export function parseSemver(value: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return null
  return {
    major: Number(match[1] ?? '0'),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
    prerelease: match[4] ?? null,
  }
}

/**
 * 比较两个版本：a > b 返 1，相等返 0，a < b 返 -1；任一侧不是合法版本时返 null。
 * 规则同 semver：预发布段小于同号正式版（0.8.13-dsv.1 < 0.8.13），两边都有预发布段时按字符串比。
 */
export function compareSemver(a: string, b: string): number | null {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (left === null || right === null) return null
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  if (left.prerelease === null && right.prerelease === null) return 0
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1
  if (left.prerelease === right.prerelease) return 0
  return left.prerelease < right.prerelease ? -1 : 1
}

/** 一组标签里最新的合法版本（忽略 `v` 前缀与非法名）；没有合法的返回 null。 */
export function maxSemver(values: readonly string[]): string | null {
  let best: string | null = null
  for (const value of values) {
    if (parseSemver(value) === null) continue
    if (best === null || (compareSemver(value, best) ?? 0) > 0) best = value
  }
  return best
}

/** 候选版本是否比我们的基线更新（候选不合法则不算「超前」）。 */
function isAhead(candidate: string | null): boolean {
  if (candidate === null) return false
  const compared = compareSemver(candidate, UPSTREAM_BASE)
  return compared !== null && compared > 0
}

/**
 * 从安装路径认出 profile 名：`.../profiles/<name>/node_modules/@kenz1117/dsh-engram`。
 * Windows 的分隔符先归一成 `/`；形状对不上（例如 repo 内直接运行）返回 null。
 */
export function profileFromPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const match = /\/profiles\/([^/]+)\/node_modules\/@kenz1117\/dsh-engram$/.exec(normalized)
  return match?.[1] ?? null
}

/**
 * 手动安装命令（面板只能显示，不能执行）：profile 认不出时写占位符 `<профиль>`，
 * tgz 路径前缀 `<путь к tgz>` 同样是占位符——这两处是有意为之的俄文占位文本，不参与 i18n。
 */
export function installCommand(profile: string | null, version: string): string {
  return `dsh plugin --profile ${profile ?? '<профиль>'} add <путь к tgz>\\kenz1117-dsh-engram-${version}.tgz --ignore-scripts`
}

/** 面板外链（写死在这里，客户端不做拼接）。 */
export function buildLinks(): UpdateLinks {
  return {
    forkRepo: `https://github.com/${FORK_REPO}`,
    forkCommits: `https://github.com/${FORK_REPO}/commits`,
    forkReleases: `https://github.com/${FORK_REPO}/releases`,
    forkIssues: `https://github.com/${FORK_REPO}/issues`,
    upstreamRepo: `https://github.com/${UPSTREAM_REPO}`,
    upstreamReleases: `https://github.com/${UPSTREAM_REPO}/releases`,
    upstreamNpm: `https://www.npmjs.com/package/${NPM_PACKAGE}`,
  }
}

/** 比本机构建更新的分支（提交时间晚于 lib/index.js 的 mtime）；构建时间未知时一律算「不比它新」。 */
export function pickNewerRefs(refs: readonly UpdateRef[], builtAt: number | null): string[] {
  if (builtAt === null) return []
  return refs.filter(ref => ref.date > builtAt).map(ref => ref.ref)
}

/**
 * 本插件包目录。编译产物是 lib/index.js，源码是 src/update-check.ts，两种形态都在包根的下一层，
 * 所以从本模块的 import.meta.url 往上走一级即可：repo 内与 profile 安装后都成立。
 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 读 package.json 的 version（读不到给兜底值，不抛错）。 */
async function readVersion(root: string): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : FALLBACK_VERSION
  } catch {
    return FALLBACK_VERSION
  }
}

/** 文件的 mtime（毫秒）；不存在返回 null。 */
async function readMtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

/**
 * 构建身份（纯文件读取）。`root` 只在测试里传（假的包目录），运行时用本模块所在的包。
 * builtAt 取 lib/index.js 的 mtime：这是「这份构建是什么时候出现的」最诚实的来源，
 * 打包与安装都不会改写它（tgz 里保留原 mtime）。
 */
export async function readBuildInfo(root: string = PACKAGE_ROOT): Promise<UpdateBuildInfo> {
  return {
    version: await readVersion(root),
    upstreamBase: UPSTREAM_BASE,
    builtAt: await readMtime(join(root, 'lib', 'index.js')),
    installPath: root,
    profile: profileFromPath(root),
  }
}

/** 网络错误的可读文本。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Токен GitHub из окружения (необязательный). Без него api.github.com даёт 60 запросов в час
 * на IP, и один неудачный заход закрывает проверку обновлений на весь час; с токеном — 5000.
 * Токен никуда не пишется: читается из process.env в момент запроса.
 */
function githubToken(): string {
  return (process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '').trim()
}

/** Заголовки запроса: токен подставляется только для api.github.com, чтобы не утёк на npm. */
function requestHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'dsh-engram-update-check' }
  const token = githubToken()
  if (token !== '' && url.startsWith('https://api.github.com/')) headers['authorization'] = `Bearer ${token}`
  return headers
}

/** 带超时与 JSON 解析的 GET：非 2xx 抛错，由调用方降级成 error 文本。 */
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: requestHeaders(url),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} ${url}`)
  return (await response.json()) as T
}

/** npm 注册表返回的包文档（只关心 dist-tags.latest）。 */
interface NpmPackument {
  readonly 'dist-tags'?: { readonly latest?: unknown }
}

/** GitHub 标签项（只关心 name）。 */
interface GithubTag {
  readonly name?: unknown
}

/** GitHub 分支项（只关心 name）。 */
interface GithubBranch {
  readonly name?: unknown
}

/** GitHub 提交项（只关心 sha 与 commit.{message,committer.date}）。 */
interface GithubCommit {
  readonly sha?: unknown
  readonly commit?: {
    readonly message?: unknown
    readonly committer?: { readonly date?: unknown }
  }
}

/** 解析 ISO 日期；坏值返回 null。 */
function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 上游：npm `dist-tags.latest` + GitHub 最新合法标签。两个来源各自独立失败。 */
async function collectUpstream(): Promise<{ view: UpdateUpstreamView; failures: string[] }> {
  const failures: string[] = []
  let npmLatest: string | null = null
  try {
    // 注册表路径里的 `/` 要转义（`%2F`）；`@` 原样保留是实测可用的形状。
    const packument = await fetchJson<NpmPackument>(`https://registry.npmjs.org/${NPM_PACKAGE.replace('/', '%2F')}`)
    const latest = packument['dist-tags']?.latest
    npmLatest = typeof latest === 'string' && latest !== '' ? latest : null
  } catch (error) {
    failures.push(message('misc.updateCheckSourceFailed', {
      source: message('misc.updateSourceNpm'),
      message: reasonOf(error),
    }))
  }
  let latestTag: string | null = null
  try {
    const tags = await fetchJson<readonly GithubTag[]>(`https://api.github.com/repos/${UPSTREAM_REPO}/tags?per_page=100`)
    latestTag = maxSemver(tags.map(tag => (typeof tag.name === 'string' ? tag.name : '')).filter(name => name !== ''))
  } catch (error) {
    failures.push(message('misc.updateCheckSourceFailed', {
      source: message('misc.updateSourceTags'),
      message: reasonOf(error),
    }))
  }
  return { view: { npmLatest, latestTag, ahead: isAhead(npmLatest) || isAhead(latestTag) }, failures }
}

/** 单个分支的最新提交；数据不完整（无 sha / 无日期）返回 null。 */
async function fetchHead(ref: string): Promise<UpdateRef | null> {
  const commits = await fetchJson<readonly GithubCommit[]>(
    `https://api.github.com/repos/${FORK_REPO}/commits?sha=${encodeURIComponent(ref)}&per_page=1`,
  )
  const head = commits[0]
  if (head === undefined) return null
  const sha = typeof head.sha === 'string' ? head.sha : ''
  const date = parseDate(head.commit?.committer?.date)
  if (sha === '' || date === null) return null
  const raw = head.commit?.message
  return { ref, sha, date, subject: typeof raw === 'string' ? (raw.split('\n')[0] ?? '') : '' }
}

/** 我们的分支：清单 → 最多 8 个（跳过 dependabot 分支）→ 并行取各自头提交 → 新到旧排序。 */
async function collectFork(builtAt: number | null): Promise<{ view: UpdateForkView; failures: string[] }> {
  const failures: string[] = []
  const refs: UpdateRef[] = []
  try {
    const branches = await fetchJson<readonly GithubBranch[]>(`https://api.github.com/repos/${FORK_REPO}/branches?per_page=100`)
    const picked = branches
      .map(branch => (typeof branch.name === 'string' ? branch.name : ''))
      .filter(name => name !== '' && !name.startsWith('dependabot/'))
      .slice(0, MAX_BRANCHES)
    const settled = await Promise.allSettled(picked.map(async name => await fetchHead(name)))
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        if (result.value !== null) refs.push(result.value)
        continue
      }
      failures.push(message('misc.updateCheckSourceFailed', {
        source: message('misc.updateSourceFork'),
        message: reasonOf(result.reason),
      }))
    }
    refs.sort((a, b) => b.date - a.date)
  } catch (error) {
    failures.push(message('misc.updateCheckSourceFailed', {
      source: message('misc.updateSourceFork'),
      message: reasonOf(error),
    }))
  }
  return { view: { refs, newerThanBuild: pickNewerRefs(refs, builtAt) }, failures }
}

/** 结果缓存（进程内一份）。面板与「检查更新」按钮共用；`refresh=1` 绕过它。 */
let cache: UpdateCheckPayload | null = null

/** 清空缓存（测试用；运行时不需要——缓存自会过期）。 */
export function resetUpdateCheckCache(): void {
  cache = null
}

/** 联网收集一次（无缓存逻辑）。 */
async function performCollection(): Promise<UpdateCheckPayload> {
  const build = await readBuildInfo()
  const upstream = await collectUpstream()
  const fork = await collectFork(build.builtAt)
  // 同一原因重复出现（8 个分支同时被限流）只留一行，避免面板刷屏。
  const failures = [...new Set([...upstream.failures, ...fork.failures])]
  // Частичный сбой ≠ сбой проверки. npm отдаёт «есть ли новее» и без GitHub, поэтому
  // краснеть из-за лимита api.github.com нельзя: иначе плашка врёт о состоянии обновлений.
  const useful = upstream.view.npmLatest !== null
    || upstream.view.latestTag !== null
    || fork.view.refs.length > 0
  return {
    checkedAt: Date.now(),
    fromCache: false,
    error: useful || failures.length === 0 ? null : failures.join('; '),
    notes: failures,
    build,
    upstream: upstream.view,
    fork: fork.view,
    links: buildLinks(),
    install: { command: installCommand(build.profile, build.version), profile: build.profile },
  }
}

/**
 * 收集构建与更新信息（唯一的对外入口）。
 * 缓存新鲜且未要求强刷时直接返回缓存（`fromCache: true`，`checkedAt` 保持原值）；
 * 首次调用、缓存过期或 `refresh` 时联网——**插件加载阶段永远不会走到这里**。
 * 本函数不抛错：任何网络故障都变成 `error` 文本，其余字段照常返回。
 */
export async function collectUpdateCheck(options: UpdateCheckOptions = {}): Promise<UpdateCheckPayload> {
  const refresh = options.refresh === true
  // Неудачный результат живёт в кэше недолго: причина (лимит GitHub, обрыв) обычно проходит.
  const ttl = cache !== null && cache.error !== null ? FAILURE_TTL_MS : CACHE_TTL_MS
  if (!refresh && cache !== null && Date.now() - cache.checkedAt < ttl) {
    return { ...cache, fromCache: true }
  }
  const payload = await performCollection()
  cache = payload
  return payload
}
