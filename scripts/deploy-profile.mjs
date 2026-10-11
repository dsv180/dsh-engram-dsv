#!/usr/bin/env node
/**
 * Развёртывание собранного форка в профиль DSH.
 *
 * В профиле плагин лежит обычным каталогом (в pnpm-workspace.yaml стоит
 * nodeLinker: hoisted), поэтому подмена сводится к копированию lib/.
 * Прежняя сборка уезжает в резервную копию рядом с форком — откат делается
 * возвратом каталога на место.
 *
 * Запуск: node scripts/deploy-profile.mjs [--profile desktop]
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const profileIndex = process.argv.indexOf('--profile')
const profile = profileIndex === -1 ? 'desktop' : process.argv[profileIndex + 1]

const target = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', '@kenz1117', 'dsh-engram')
const built = join(REPO, 'lib')

if (!existsSync(target)) {
  console.error(`профиль не найден: ${target}`)
  process.exit(1)
}
if (!existsSync(join(built, 'index.js'))) {
  console.error('нет собранного lib/index.js — сначала выполните сборку (tsdown)')
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = join(REPO, '..', '_deploy-backup', stamp)
mkdirSync(backup, { recursive: true })

// Копирование, а не перемещение: профиль лежит на другом томе, и rename через
// границу дисков не проходит (EXDEV). Прежняя сборка сохраняется целиком.
if (existsSync(join(target, 'lib'))) {
  cpSync(join(target, 'lib'), join(backup, 'lib'), { recursive: true })
  rmSync(join(target, 'lib'), { recursive: true, force: true })
}
mkdirSync(join(target, 'lib'), { recursive: true })
for (const name of readdirSync(built)) {
  copyFileSync(join(built, name), join(target, 'lib', name))
}

console.log(`развёрнуто в: ${target}\\lib`)
console.log(`файлы: ${readdirSync(join(target, 'lib')).join(', ')}`)
console.log(`прежняя сборка: ${join(backup, 'lib')}`)
