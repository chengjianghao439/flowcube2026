const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-ssh-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir }
test('trusted host setup refuses missing, wrong-host and malformed keys; pins exact host and port', t => {
  const dir = temp(t), key = path.join(dir, 'key')
  assert.equal(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]).status, 0)
  const pub = fs.readFileSync(key + '.pub', 'utf8').trim()
  const env = { ...process.env, FLOWCUBE_SSH_HOST: 'fixture.example', FLOWCUBE_SSH_PORT: '2222' }
  const run = (known, suffix) => spawnSync('bash', [path.join(root, 'scripts/setup-ci-ssh-trust.sh'), path.join(dir, suffix)], { env: { ...env, FLOWCUBE_SSH_KNOWN_HOSTS: known }, encoding: 'utf8' })
  for (const [known, suffix] of [['', 'empty'], [`other.example ${pub}`, 'wrong'], ['[fixture.example]:2222 ssh-ed25519 invalid', 'invalid']]) {
    assert.notEqual(run(known, suffix).status, 0)
    assert.equal(fs.existsSync(path.join(dir, suffix, 'flowcube_known_hosts')), false)
  }
  assert.equal(run(`[fixture.example]:2222 ${pub}`, 'ok').status, 0)
  const ssh = spawnSync('ssh', ['-G', '-F', path.join(dir, 'ok/config'), '-p', '2222', 'fixture.example'], { encoding: 'utf8' })
  assert.equal(ssh.status, 0)
  assert.match(ssh.stdout, /stricthostkeychecking true/)
  assert.match(ssh.stdout, /globalknownhostsfile \/dev\/null/)
  assert.match(ssh.stdout, /userknownhostsfile .*flowcube_known_hosts/)
  assert.match(ssh.stdout, /updatehostkeys false/)
})
test('smoke credentials travel through stdin and never occur in SSH argv; incomplete headers fail closed', t => {
  const dir = temp(t), argvFile = path.join(dir, 'argv')
  fs.writeFileSync(path.join(dir, 'ssh'), `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\0' "$@" > "$ARGV_CAPTURE"\nexec env -u SMOKE_USERNAME -u SMOKE_PASSWORD -u SMOKE_LIMITED_USERNAME -u SMOKE_LIMITED_PASSWORD bash -c "\${@: -1}"\n`, { mode: 0o700 })
  const secrets = { SMOKE_USERNAME: 'test-user-special', SMOKE_PASSWORD: 'pass $() `no` \' "\n第二行', SMOKE_LIMITED_USERNAME: 'limited-special', SMOKE_LIMITED_PASSWORD: 'limited $secret \n !' }
  const input = `node -e 'process.stdout.write(JSON.stringify(Object.fromEntries(["SMOKE_USERNAME","SMOKE_PASSWORD","SMOKE_LIMITED_USERNAME","SMOKE_LIMITED_PASSWORD"].map(k=>[k,process.env[k]]))))'\n`
  const result = spawnSync('bash', [path.join(root, 'scripts/ssh-smoke-stdin.sh'), '-p', '2222', 'user@fixture.example', 'env NON_SECRET=ok bash -s'], { input, encoding: 'utf8', env: { ...process.env, ...secrets, PATH: dir + path.delimiter + process.env.PATH, ARGV_CAPTURE: argvFile } })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), secrets)
  const argv = fs.readFileSync(argvFile, 'utf8')
  for (const secret of Object.values(secrets)) assert.equal(argv.includes(secret), false)
  const remote = argv.split('\0').filter(Boolean).at(-1)
  const incomplete = spawnSync('bash', ['-c', remote], { input: 'one\0two\0', encoding: 'utf8' })
  assert.notEqual(incomplete.status, 0)
  assert.equal(incomplete.stdout, '')
})
