/**
 * Заполнение словаря моделью: что уходит в запрос и что принимается из ответа.
 *
 * Проверяются обещания, на которых держится кнопка «Заполнить ИИ». Первое: в запрос
 * уходит ровно то, что просили перевести, — английские строки набора, без ключей и без
 * выдумок. Второе: из ответа берётся только то, что можно положить в словарь: строки
 * вне запроса, пустой перевод и перевод, повторяющий английский текст, отбрасываются —
 * иначе «перевода нет» перестало бы отличаться от «уже переведено». Третье: партия
 * ограничена по размеру, потому что ответ на сотни терминов не проверить на полноту.
 *
 * Термины берутся из настоящих наборов: словарь ключуется английской строкой, и
 * выдуманная строка проверяла бы не тот механизм, который работает в жизни.
 */
import { describe, expect, it } from 'vitest'
import { fillBatch, fillPrompt, parseFillAnswer } from '../src/i18n/dictionary-ai.ts'
import { FILL_REQUEST_MAX } from '../src/i18n/dictionary-limits.ts'
import { messageVocabulary } from '../src/i18n/messages.ts'

/** Настоящие английские строки набора сообщений: короткие и однострочные — их читать. */
const TERMS = messageVocabulary().filter(term => term.length > 3 && term.length < 40 && !term.includes('\n')).slice(0, 3)
const FIRST = TERMS[0] ?? ''
const SECOND = TERMS[1] ?? ''

describe('запрос на перевод партии', () => {
  it('термины уходят как JSON, а язык — словом, а не кодом', () => {
    const prompt = fillPrompt(TERMS, 'ru')
    // Модель должна видеть сами строки: по ним она и отвечает парами.
    for (const term of TERMS) expect(prompt.userText).toContain(JSON.stringify(term).slice(1, -1))
    expect(prompt.system).toContain('Russian')
    expect(prompt.system).not.toContain('{language}')
  })

  it('подстановки в инструкции остаются подстановками', () => {
    // {name} в тексте инструкции — пример подстановки, которую модель обязана сохранить
    // в переводе. Подставься он сам (как {language}) — требование исчезло бы из запроса.
    const prompt = fillPrompt(TERMS, 'zh')
    expect(prompt.system).toContain('{name}')
    expect(prompt.system).toContain('Chinese')
  })
})

describe('ответ модели принимается только пригодным для словаря', () => {
  it('пары берутся, чужие строки и пустое — нет', () => {
    const answer = JSON.stringify([
      [FIRST, 'Первый перевод'],
      ['Строка которой нет в коде', 'Не наше'],
      [SECOND, '   '],
      [FIRST, 'Повтор'],
    ])
    expect(parseFillAnswer(answer, [FIRST, SECOND])).toEqual([[FIRST, 'Первый перевод']])
  })

  it('перевод, повторяющий английский текст, не записывается', () => {
    // Это ответ «перевести не удалось»: записать его как перевод значит потерять
    // отличие «уже переведено» от «перевода нет».
    expect(parseFillAnswer(JSON.stringify([[FIRST, FIRST]]), [FIRST])).toEqual([])
  })

  it('ответ-карта принимается наравне с ответом-массивом', () => {
    // Модель отвечает то списком пар, то объектом; терять из-за формы весь ответ незачем.
    const answer = `\`\`\`json\n{${JSON.stringify(FIRST)}: "Из карты"}\n\`\`\``
    expect(parseFillAnswer(answer, [FIRST])).toEqual([[FIRST, 'Из карты']])
  })

  it('ответ без JSON не приносит пар, а не падает', () => {
    expect(parseFillAnswer('Извините, не могу перевести.', [FIRST])).toEqual([])
  })
})

describe('партия ограничена и очищена', () => {
  it('пустое и повтор убираются, порядок сохраняется', () => {
    expect(fillBatch(['A', ' ', 'B', 'A', ' C '])).toEqual(['A', 'B', 'C'])
  })

  it('слишком большая партия отклоняется до запроса', () => {
    const many = Array.from({ length: FILL_REQUEST_MAX + 1 }, (_item, index) => `term ${String(index)}`)
    // Текст ошибки зависит от языка процесса, поэтому проверяется код, а не формулировка.
    let caught: unknown
    try {
      fillBatch(many)
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string } | undefined)?.code).toBe('DICTIONARY_FILL_TOO_MANY')
  })
})
