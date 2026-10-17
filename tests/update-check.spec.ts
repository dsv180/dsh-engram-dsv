/**
 * 构建身份与更新检查的纯逻辑测试（不发真实网络请求）。
 *
 * 覆盖四件事：版本比较（含 v 前缀与预发布段）、比构建更新的分支判定、
 * 6 小时缓存（第二次调用不再联网）、以及网络失败只降级成 error 文本而不抛异常。
 *
 * fetch 一律用 vi.stubGlobal 顶掉；假包目录用 mkdtemp 建在临时目录里。
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectUpdateCheck,
  compareSemver,
  installCommand,
  maxSemver,
  parseSemver,
  pickNewerRefs,
  profileFromPath,
  readBuildInfo,
  resetUpdateCheckCache,
  UPSTREAM_BASE,
  type UpdateRef,
} from '../src/update-check.ts'

/** JSON 响应桩（与真实 fetch 同形状）。 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

/** 请求地址：编码一律是字符串（update-check 自己拼的 URL），Request/URL 只是保险。 */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/**
 * 顶掉全局 fetch：按地址分派桩数据——npm 给 99.0.0（比任何基线都新），
 * 上游标签给 v99.0.0，我们的分支清单里混一个 dependabot 分支（必须被跳过）。
 */
function stubNetwork(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.startsWith('https://registry.npmjs.org/')) return json({ 'dist-tags': { latest: '99.0.0', next: '99.1.0' } })
    if (url.includes('/tags?')) return json([{ name: 'v99.0.0' }, { name: 'v0.0.1' }, { name: 'nightly' }])
    if (url.includes('/branches?')) {
      return json([{ name: 'main' }, { name: 'install/0.8.12-dsv' }, { name: 'dependabot/npm_and_yarn/x' }])
    }
    if (url.includes('/commits?')) {
      return json([{
        sha: 'deadbeef',
        commit: { message: 'feat: latest subject\n\nbody line', committer: { date: '2026-10-17T03:30:00Z' } },
      }])
    }
    throw new Error(`unexpected url: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  resetUpdateCheckCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetUpdateCheckCache()
})

describe('版本比较', () => {
  it('0.8.12 < 0.9.0，相等返回 0，v 前缀不影响', () => {
    expect(compareSemver('0.8.12', '0.9.0')).toBe(-1)
    expect(compareSemver('0.9.0', '0.8.12')).toBe(1)
    expect(compareSemver('0.8.12', '0.8.12')).toBe(0)
    expect(compareSemver('v0.8.12', '0.8.12')).toBe(0)
    expect(compareSemver('0.8.12', 'v0.8.12')).toBe(0)
  })

  it('逐段比较：major/minor/patch 各自优先', () => {
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1)
    expect(compareSemver('0.9.0', '0.10.0')).toBe(-1)
    expect(compareSemver('0.8.9', '0.8.12')).toBe(-1)
  })

  it('预发布段小于同号正式版', () => {
    expect(compareSemver('0.8.13-dsv.1', '0.8.13')).toBe(-1)
    expect(compareSemver('0.8.13', '0.8.13-dsv.1')).toBe(1)
    expect(parseSemver('0.8.13-dsv.1')?.prerelease).toBe('dsv.1')
  })

  it('认不出的版本返回 null，不抛错', () => {
    expect(parseSemver('nightly')).toBeNull()
    expect(parseSemver('0.8')).toBeNull()
    expect(compareSemver('garbage', '0.8.12')).toBeNull()
    expect(compareSemver('0.8.12', '')).toBeNull()
  })

  it('标签里取最新合法版本，非法名被忽略', () => {
    expect(maxSemver(['0.7.0', 'v0.8.12', 'nightly'])).toBe('v0.8.12')
    expect(maxSemver(['1.0.0', '0.9.9'])).toBe('1.0.0')
    expect(maxSemver(['nightly', 'latest'])).toBeNull()
    expect(maxSemver([])).toBeNull()
  })
})

describe('比构建更新的分支', () => {
  const builtAt = Date.parse('2026-10-17T03:00:00Z')
  const refs: readonly UpdateRef[] = [
    { ref: 'main', sha: 'aaa', date: Date.parse('2026-10-16T10:00:00Z'), subject: 'older' },
    { ref: 'install/0.8.12-dsv', sha: 'bbb', date: Date.parse('2026-10-17T04:00:00Z'), subject: 'newer' },
  ]

  it('只留比 builtAt 晚的分支', () => {
    expect(pickNewerRefs(refs, builtAt)).toEqual(['install/0.8.12-dsv'])
  })

  it('等于 builtAt 不算更新（严格大于）', () => {
    expect(pickNewerRefs([{ ref: 'main', sha: 'aaa', date: builtAt, subject: 'same' }], builtAt)).toEqual([])
  })

  it('构建时间未知时一律不算更新', () => {
    expect(pickNewerRefs(refs, null)).toEqual([])
  })
})

describe('构建身份（只读本地文件）', () => {
  it('从假包目录读出 version / builtAt / installPath', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engram-update-'))
    await mkdir(join(root, 'lib'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@kenz1117/dsh-engram', version: '9.9.9' }))
    await writeFile(join(root, 'lib', 'index.js'), 'export {}\n')
    const info = await readBuildInfo(root)
    expect(info.version).toBe('9.9.9')
    expect(typeof info.builtAt).toBe('number')
    expect(info.installPath).toBe(root)
    expect(info.upstreamBase).toBe(UPSTREAM_BASE)
    // 临时目录不是 profile 安装形态：profile 认不出。
    expect(info.profile).toBeNull()
  })

  it('package.json 缺失时给兜底版本，lib/index.js 缺失时 builtAt 为 null', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engram-update-empty-'))
    const info = await readBuildInfo(root)
    expect(info.version).toBe('0.0.0')
    expect(info.builtAt).toBeNull()
  })

  it('profile 名从安装路径认出（Windows 反斜杠同样认）', () => {
    expect(profileFromPath('/home/u/.dsh/profiles/desktop/node_modules/@kenz1117/dsh-engram')).toBe('desktop')
    expect(profileFromPath('C:\\Users\\dsv\\.dsh\\profiles\\web\\node_modules\\@kenz1117\\dsh-engram')).toBe('web')
    expect(profileFromPath('/repo')).toBeNull()
    expect(profileFromPath('/profiles/desktop/node_modules/@kenz1117/other-pkg')).toBeNull()
  })

  it('手动安装命令单行可复制，认不出 profile 用占位符', () => {
    expect(installCommand('desktop', '0.8.13-dsv.1'))
      .toBe('dsh plugin --profile desktop add <путь к tgz>\\kenz1117-dsh-engram-0.8.13-dsv.1.tgz --ignore-scripts')
    expect(installCommand(null, '0.8.13-dsv.1')).toContain('--profile <профиль>')
    expect(installCommand('desktop', '0.8.13-dsv.1')).not.toContain('\n')
  })
})

describe('collectUpdateCheck', () => {
  it('联网收集：上游超前、分支跳过 dependabot、外链与安装命令齐备', async () => {
    const fetchMock = stubNetwork()
    const payload = await collectUpdateCheck({ refresh: true })
    expect(payload.fromCache).toBe(false)
    expect(payload.error).toBeNull()
    expect(payload.upstream).toEqual({ npmLatest: '99.0.0', latestTag: 'v99.0.0', ahead: true })
    expect(payload.fork.refs.map(ref => ref.ref)).toEqual(['main', 'install/0.8.12-dsv'])
    expect(payload.fork.refs[0]?.subject).toBe('feat: latest subject')
    expect(payload.build.version).not.toBe('')
    expect(payload.links.forkRepo).toBe('https://github.com/dsv180/dsh-engram-dsv')
    expect(payload.links.upstreamNpm).toBe('https://www.npmjs.com/package/@kenz1117/dsh-engram')
    expect(payload.install.command).toBe(installCommand(payload.build.profile, payload.build.version))
    // 1 npm + 1 标签 + 1 分支清单 + 2 个分支头提交（dependabot 分支不请求）。
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('基线自身不算超前', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.startsWith('https://registry.npmjs.org/')) return json({ 'dist-tags': { latest: UPSTREAM_BASE } })
      if (url.includes('/tags?')) return json([{ name: `v${UPSTREAM_BASE}` }])
      if (url.includes('/branches?')) return json([])
      throw new Error(`unexpected url: ${url}`)
    }))
    const payload = await collectUpdateCheck({ refresh: true })
    expect(payload.error).toBeNull()
    expect(payload.upstream.ahead).toBe(false)
    expect(payload.fork.refs).toEqual([])
  })

  it('缓存：TTL 内第二次不带 refresh 不再联网，且标记 fromCache', async () => {
    const fetchMock = stubNetwork()
    const first = await collectUpdateCheck({ refresh: true })
    const callsAfterFirst = fetchMock.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)
    const second = await collectUpdateCheck()
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
    expect(second.fromCache).toBe(true)
    expect(second.checkedAt).toBe(first.checkedAt)
  })

  it('refresh 强制联网，绕过缓存', async () => {
    const fetchMock = stubNetwork()
    await collectUpdateCheck({ refresh: true })
    const callsAfterFirst = fetchMock.mock.calls.length
    const again = await collectUpdateCheck({ refresh: true })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst)
    expect(again.fromCache).toBe(false)
  })

  it('网络失败：error 非空、不抛异常，build 与 links 照常齐备', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const payload = await collectUpdateCheck({ refresh: true })
    expect(payload.error).not.toBeNull()
    expect(payload.error).toContain('network down')
    expect(payload.upstream).toEqual({ npmLatest: null, latestTag: null, ahead: false })
    expect(payload.fork.refs).toEqual([])
    expect(payload.fork.newerThanBuild).toEqual([])
    expect(payload.build.version).not.toBe('')
    expect(payload.links.forkRepo).toContain('https://github.com/')
    expect(payload.links.upstreamRepo).toContain('https://github.com/')
    expect(payload.install.command.length).toBeGreaterThan(0)
  })

  it('单个来源失败不影响另一个（npm 挂、分支照常）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.startsWith('https://registry.npmjs.org/')) throw new Error('npm 503')
      if (url.includes('/tags?')) return json([{ name: 'v99.0.0' }])
      if (url.includes('/branches?')) return json([{ name: 'main' }])
      if (url.includes('/commits?')) return json([{ sha: 'cafe', commit: { message: 'head', committer: { date: '2026-10-17T05:00:00Z' } } }])
      throw new Error(`unexpected url: ${url}`)
    }))
    const payload = await collectUpdateCheck({ refresh: true })
    expect(payload.error).toContain('npm 503')
    expect(payload.upstream.npmLatest).toBeNull()
    expect(payload.upstream.latestTag).toBe('v99.0.0')
    expect(payload.upstream.ahead).toBe(true)
    expect(payload.fork.refs.map(ref => ref.ref)).toEqual(['main'])
  })
})
