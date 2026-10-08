'use strict'
// Recover only this task's synthetic GUI login after a normal logout trial.
// Credentials are captured privately from the proven owned runtime, never printed.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
async function main() {
  const pid = process.env.FLOWCUBE_DESIGN_AUDIT_RUNTIME_PID
  const dir = process.env.FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR
  assert.match(pid || '', /^[1-9]\d*$/)
  assert.ok(dir && path.isAbsolute(dir) && !(fs.statSync(dir).mode & 0o077))
  assert.equal(execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).trim(), 'node scripts/design-audit/runtime.cjs')
  const source = execFileSync('ps', ['eww', '-p', pid, '-o', 'command='], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  assert.equal(source.match(/(?:^| )FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR=([^ ]*)/)?.[1]?.trim(), dir)
  const password = source.match(/(?:^| )FLOWCUBE_GOLIVE_TEST_PASSWORD=([^ ]*)/)?.[1]?.trim()
  assert.ok(password, 'missing synthetic GUI credential')
  const facts = JSON.parse(fs.readFileSync(path.join(dir, 'facts.json')))
  const authFile = path.join(dir, 'auth.json'), previous = JSON.parse(fs.readFileSync(authFile))
  assert.equal(new URL(facts.api).hostname, '127.0.0.1')
  assert.match(previous.state.user.username, /^GL[0-9a-f]+-creator$/)
  const response = await fetch(facts.api + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'design-audit-fixtures' }, body: JSON.stringify({ username: previous.state.user.username, password }) })
  const result = await response.json()
  assert.ok(response.ok && result.success, 'synthetic normal login failed')
  fs.writeFileSync(authFile, JSON.stringify({ state: { ...result.data, isAuthenticated: true }, version: 0 }), { mode: 0o600 })
  console.log('[design-audit] synthetic GUI session renewed')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
