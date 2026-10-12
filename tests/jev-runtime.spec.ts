import { statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedJevConfig } from '../src/config.ts'
import type { HostContext } from '../src/jev/host.ts'
import {
  effectiveJevConfig,
  jevConfigView,
  jevOverridePath,
  loadJevOverride,
  parseJevPatch,
  resolveJevField,
  saveJevOverride,
} from '../src/jev/runtime.ts'

/**
 * Заглушка контекста хоста: адрес и ключ разрешаются лениво — при первом вопросе
 * судьи, — поэтому самой сборке судьи достаточно пустого доступа к сервисам.
 */
const hostStub: HostContext = { get: () => undefined }

/** База из cordis.yml: пустое перекрытие отдаёт её как есть, а три порога всегда берутся отсюда. */
const baseConfig: ResolvedJevConfig = {
  enabled: true,
  provider: 'aitunnel',
  model: 'jev-1',
  endpoint: undefined,
  timeoutMs: 3000,
  deferMergeAbove: 0.85,
  deferAcceptBelow: 0.15,
  contradictMinProbability: 0.8,
}

describe('loadJevOverride', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engram-jev-runtime-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('файла перекрытия нет: пустое перекрытие, работает yml', () => {
    expect(loadJevOverride(dir)).toEqual({})
  })

  it('битый JSON: самолечение пустым перекрытием, без исключения', async () => {
    await writeFile(jevOverridePath(dir), '{ not json', 'utf8')
    expect(loadJevOverride(dir)).toEqual({})
  })

  it('валидный JSON, но не объект (число/строка/null): пустое перекрытие', async () => {
    await writeFile(jevOverridePath(dir), '42', 'utf8')
    expect(loadJevOverride(dir)).toEqual({})
    await writeFile(jevOverridePath(dir), '"text"', 'utf8')
    expect(loadJevOverride(dir)).toEqual({})
    await writeFile(jevOverridePath(dir), 'null', 'utf8')
    expect(loadJevOverride(dir)).toEqual({})
  })

  it('негодные по типу и неизвестные поля отбрасываются, годные остаются', async () => {
    await writeFile(
      jevOverridePath(dir),
      JSON.stringify({
        enabled: 'yes',
        provider: 123,
        model: 'panel-model',
        endpoint: 'https://panel.test/v1/systemone',
        timeoutMs: 1.5,
        unknown: 'ignored',
      }),
      'utf8',
    )
    expect(loadJevOverride(dir)).toEqual({
      model: 'panel-model',
      endpoint: 'https://panel.test/v1/systemone',
    })
  })

  it('поля старого формата (apiKey/baseUrl) игнорируются', async () => {
    // Файл прежней версии: ключ и адрес плагин больше не хранит — их место занял выбор провайдера.
    await writeFile(
      jevOverridePath(dir),
      JSON.stringify({ enabled: true, apiKey: 'legacy-key', baseUrl: 'https://api.aitunnel.ru', model: 'jev-1.13' }),
      'utf8',
    )
    expect(loadJevOverride(dir)).toEqual({ enabled: true, model: 'jev-1.13' })
  })
})

describe('saveJevOverride', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engram-jev-runtime-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('после сохранения читается тот же объект, права файла 0600', () => {
    const override = { enabled: false, provider: 'aitunnel', model: 'jev-2' }
    saveJevOverride(dir, override)
    expect(loadJevOverride(dir)).toEqual(override)
    // Права проверяем только на POSIX-системах: Windows не хранит режим файла, и
    // statSync там всегда отдаёт 0666, поэтому заявленные 0600 держит лишь umask.
    if (process.platform !== 'win32') {
      // Берём mode по модулю 0o777: так отсекаются биты типа файла и остаются только права.
      expect(statSync(jevOverridePath(dir)).mode & 0o777).toBe(0o600)
    }
  })
})

describe('parseJevPatch', () => {
  /** База слияния: проверяет сохранение отсутствующих полей и очистку пустой строкой. */
  const current = { enabled: true, provider: 'aitunnel', model: 'old-model', timeoutMs: 3000 }

  it('пустая правка: поверхностная копия current, все поля сохранены', () => {
    expect(parseJevPatch(current, {})).toEqual(current)
  })

  it('enabled не булево: правка отвергается целиком', () => {
    expect(parseJevPatch(current, { enabled: 'yes' })).toBe('invalid: jev.enabled 必须是布尔值')
  })

  it('provider не строка: правка отвергается целиком', () => {
    expect(parseJevPatch(current, { provider: 123 })).toBe('invalid: jev.provider 必须是字符串')
  })

  it('provider — пустая строка или пробелы: выбор снимается (Jev молча уходит в чистые правила)', () => {
    expect(parseJevPatch(current, { provider: '' })).toEqual({ ...current, provider: undefined })
    expect(parseJevPatch(current, { provider: '   ' })).toEqual({ ...current, provider: undefined })
  })

  it('provider непустой: сохраняется без крайних пробелов', () => {
    expect(parseJevPatch(current, { provider: '  aitunnel  ' })).toEqual({ ...current, provider: 'aitunnel' })
  })

  it('endpoint негодный (не URL или не http(s)): правка отвергается целиком', () => {
    expect(parseJevPatch(current, { endpoint: 'not-a-url' })).toBe('invalid: jev.endpoint 必须是 http(s) URL')
    expect(parseJevPatch(current, { endpoint: 'ftp://panel.test' })).toBe('invalid: jev.endpoint 必须是 http(s) URL')
  })

  it('endpoint годный http(s): сохраняется без крайних пробелов', () => {
    expect(parseJevPatch(current, { endpoint: ' http://panel.test/v1/systemone ' }))
      .toEqual({ ...current, endpoint: 'http://panel.test/v1/systemone' })
  })

  it('endpoint — пустая строка: адрес очищается, возвращается шаблон от провайдера', () => {
    const withEndpoint = { ...current, endpoint: 'https://panel.test/v1/systemone' }
    expect(parseJevPatch(withEndpoint, { endpoint: '' })).toEqual({ ...current, endpoint: undefined })
  })

  it('model пустой или не строка: пустая строка снимает выбор, не строка — отказ', () => {
    // Пустая строка означает «модель не выбрана» — так же, как и у провайдера.
    expect(parseJevPatch(current, { model: '   ' })).toEqual({ ...current, model: undefined })
    expect(parseJevPatch(current, { model: 42 })).toBe('invalid: jev.model 不能为空')
    expect(parseJevPatch(current, { model: ' m ' })).toEqual({ ...current, model: 'm' })
  })

  it('timeoutMs не целое или вне границ: правка отвергается; границы 1000/60000 проходят', () => {
    expect(parseJevPatch(current, { timeoutMs: 999 })).toBe('invalid: jev.timeoutMs 必须是 1000-60000 的整数毫秒')
    expect(parseJevPatch(current, { timeoutMs: 60001 })).toBe('invalid: jev.timeoutMs 必须是 1000-60000 的整数毫秒')
    expect(parseJevPatch(current, { timeoutMs: 1.5 })).toBe('invalid: jev.timeoutMs 必须是 1000-60000 的整数毫秒')
    expect(parseJevPatch(current, { timeoutMs: '3000' })).toBe('invalid: jev.timeoutMs 必须是 1000-60000 的整数毫秒')
    expect(parseJevPatch(current, { timeoutMs: 1000 })).toEqual({ ...current, timeoutMs: 1000 })
    expect(parseJevPatch(current, { timeoutMs: 60000 })).toEqual({ ...current, timeoutMs: 60000 })
  })

  it('негодное поле отвергает правку целиком: годные поля тоже не сохраняются', () => {
    const result = parseJevPatch(current, { model: 'good', timeoutMs: 1 })
    expect(result).toBe('invalid: jev.timeoutMs 必须是 1000-60000 的整数毫秒')
  })
})

describe('effectiveJevConfig', () => {
  it('пустое перекрытие: база отдаётся как есть', () => {
    expect(effectiveJevConfig(baseConfig, {})).toEqual(baseConfig)
  })

  it('поля панели перекрывают базу, три порога всегда из базы', () => {
    const merged = effectiveJevConfig(baseConfig, {
      enabled: true,
      provider: 'panel-provider',
      model: 'panel-model',
      endpoint: 'https://panel.test/v1/systemone',
      timeoutMs: 5000,
    })
    expect(merged.provider).toBe('panel-provider')
    expect(merged.model).toBe('panel-model')
    expect(merged.endpoint).toBe('https://panel.test/v1/systemone')
    expect(merged.timeoutMs).toBe(5000)
    expect(merged.deferMergeAbove).toBe(0.85)
    expect(merged.deferAcceptBelow).toBe(0.15)
    expect(merged.contradictMinProbability).toBe(0.8)
  })

  it('нет провайдера или модели: enabled принудительно снимается', () => {
    const noProvider = effectiveJevConfig({ ...baseConfig, provider: undefined }, { enabled: true })
    expect(noProvider.enabled).toBe(false)
    expect(noProvider.provider).toBeUndefined()
    const noModel = effectiveJevConfig({ ...baseConfig, model: undefined }, { enabled: true })
    expect(noModel.enabled).toBe(false)
  })

  it('панель снимает выбор провайдера: Jev выключается, даже если yml его задавал', () => {
    const merged = effectiveJevConfig(baseConfig, { enabled: true, provider: '' })
    expect(merged.enabled).toBe(false)
  })

  it('панель выключает тумблер: Jev выключен', () => {
    const merged = effectiveJevConfig(baseConfig, { enabled: false })
    expect(merged.enabled).toBe(false)
  })
})

describe('jevConfigView', () => {
  it('выбор провайдера и модели отдаётся как есть, ключа и адреса в виде нет', () => {
    const view = jevConfigView(baseConfig, {})
    expect(view.enabled).toBe(true)
    expect(view.provider).toBe('aitunnel')
    expect(view.model).toBe('jev-1')
    expect(view.endpoint).toBeUndefined()
    expect(view.timeoutMs).toBe(3000)
    expect(view.deferMergeAbove).toBe(0.85)
    expect(view.deferAcceptBelow).toBe(0.15)
    expect(view.contradictMinProbability).toBe(0.8)
  })

  it('пустой выбор провайдера: enabled=false в виде', () => {
    const view = jevConfigView({ ...baseConfig, provider: undefined }, {})
    expect(view.enabled).toBe(false)
    expect(view.provider).toBeUndefined()
  })
})

describe('resolveJevField', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engram-jev-runtime-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('yml включён, выбор сделан, файла перекрытия нет: судья собирается', () => {
    const field = resolveJevField(hostStub, baseConfig, dir)
    expect(typeof field.judge?.ask).toBe('function')
  })

  it('yml выключен: пустой объект, судья не собирается', () => {
    expect(resolveJevField(hostStub, { ...baseConfig, enabled: false }, dir)).toEqual({})
  })

  it('провайдер не выбран: пустой объект, судья не собирается', () => {
    expect(resolveJevField(hostStub, { ...baseConfig, provider: undefined }, dir)).toEqual({})
  })

  it('панель выключает тумблер: перекрытие перечитывается сразу, судья исчезает', async () => {
    expect(typeof resolveJevField(hostStub, baseConfig, dir).judge?.ask).toBe('function')
    saveJevOverride(dir, { enabled: false })
    expect(resolveJevField(hostStub, baseConfig, dir)).toEqual({})
  })

  it('панель добавляет выбор: без провайдера в yml судья всё равно собирается', async () => {
    saveJevOverride(dir, { enabled: true, provider: 'aitunnel', model: 'jev-1' })
    const field = resolveJevField(hostStub, { ...baseConfig, provider: undefined }, dir)
    expect(typeof field.judge?.ask).toBe('function')
  })
})
