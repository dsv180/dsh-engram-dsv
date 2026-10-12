#!/usr/bin/env node
/**
 * Развёртывание собранного форка в профиль DSH.
 *
 * В профиле плагин лежит обычным каталогом (в pnpm-workspace.yaml стоит
 * nodeLinker: hoisted), поэтому подмена сводится к копированию lib/.
 * Прежняя сборка уезжает в резервную копию рядом с форком — откат делается
 * возвратом каталога на место.
 *
 * Прежний вариант сначала удалял каталог lib целиком; на работающем DSH это
 * падает с EPERM, потому что файлы держит загруженный процесс. Поэтому новые
 * файлы копируются поверх существующих, а лишние удаляются по возможности.
 * Новый код подхватывается при следующем монтировании плагина.
 *
 * Запуск: node scripts/deploy-profile.mjs [--profile desktop]
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const profileIndex = process.argv.indexOf('--profile')
const profile = profileIndex === -1 ? 'desktop' : process.argv[profileIndex + 1]

const profilesDir = join(homedir(), '.dsh', 'profiles', profile)
const packageDir = join(profilesDir, 'node_modules', '@kenz1117', 'dsh-engram')
const target = join(packageDir, 'lib')
const built = join(REPO, 'lib')

if (!existsSync(profilesDir)) {
  console.error(`профиль DSH не найден: ${profilesDir}`)
  process.exit(1)
}
if (!existsSync(packageDir)) {
  console.error(`в профиле «${profile}» нет плагина: ${packageDir}`)
  console.error(`поставьте его сначала: dsh plugin --profile ${profile} add <файл.tgz>`)
  process.exit(1)
}
if (!existsSync(join(built, 'index.js'))) {
  console.error('нет собранного lib/index.js — сначала выполните сборку (bundle)')
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = join(REPO, '..', '_deploy-backup', stamp)
mkdirSync(backup, { recursive: true })

// Копирование, а не перемещение: профиль лежит на другом томе, и rename через
// границу дисков не проходит (EXDEV). Прежняя сборка сохраняется целиком.
if (existsSync(target)) {
  cpSync(target, join(backup, 'lib'), { recursive: true })
}
mkdirSync(target, { recursive: true })

const sourceNames = readdirSync(built)
const locked = []
for (const name of sourceNames) {
  try {
    copyFileSync(join(built, name), join(target, name))
  } catch (error) {
    locked.push(`${name} (${error instanceof Error ? (error.code ?? error.message) : 'ошибка'})`)
  }
}

// Лишние файлы (например карты от прежней сборки) убираем, если не заняты.
const kept = []
for (const name of readdirSync(target).filter(name => !sourceNames.includes(name))) {
  try {
    rmSync(join(target, name), { force: true })
  } catch {
    kept.push(name)
  }
}

console.log(`развёрнуто в: ${target}`)
console.log(`файлы: ${readdirSync(target).join(', ')}`)
console.log(`прежняя сборка: ${join(backup, 'lib')}`)
if (kept.length > 0) console.log(`лишние файлы оставлены (заняты): ${kept.join(', ')}`)
if (locked.length > 0) {
  console.error(`не удалось заменить: ${locked.join(', ')}`)
  console.error('файл держит работающий DSH — закройте его и повторите развёртывание')
  process.exit(2)
}
console.log('новый код подхватится при следующем монтировании плагина')
