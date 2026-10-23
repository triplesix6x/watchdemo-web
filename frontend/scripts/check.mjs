// Runs every src/**/*.check.ts (plain node:assert scripts) and fails if any fails.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const files = fs.readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.check.ts')).sort()
let failed = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(src, f)], { stdio: 'inherit' })
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${f}`)
  if (r.status !== 0) failed++
}
if (!files.length || failed) process.exit(1)
