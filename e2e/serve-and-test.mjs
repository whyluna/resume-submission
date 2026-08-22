/** 起 fixture 静态服务 → 跑 Playwright E2E → 关服务 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const server = spawn('python3', ['-m', 'http.server', '8000'], { cwd: fixtures, stdio: 'ignore' })
const test = spawn('node', ['e2e/run-e2e.mjs'], { stdio: 'inherit' })
test.on('exit', (code) => {
  server.kill()
  process.exit(code ?? 1)
})
