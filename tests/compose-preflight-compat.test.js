'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')

const root = path.resolve(__dirname, '..')
const cli = process.env.FLOWCUBE_COMPAT_COMPOSE_BIN
assert.ok(cli, '必须提供经 SHA256 校验的官方 Compose 2.27.0 CLI；不跳过真实测试')
const context = process.env.FLOWCUBE_COMPAT_DOCKER_CONTEXT || 'default'
const baseImage = process.env.FLOWCUBE_COMPAT_NODE_IMAGE || 'node:22-alpine'
const docker = (args, options = {}) => spawnSync('docker', ['--context', context, ...args], { encoding: 'utf8', timeout: 30000, ...options })
const invoke = args => spawnSync(cli, ['--context', context, ...args], { encoding: 'utf8', timeout: 60000 })
const version = invoke(['version', '--short'])
assert.equal(version.status, 0, version.stderr)
assert.equal(version.stdout.trim().replace(/^v/, ''), '2.27.0')
const source = fs.readFileSync(path.join(root, 'scripts/server-update.sh'), 'utf8')
const condition = source.match(/^assert_migration_conditions\(\) \{[\s\S]*?^\}/m)?.[0]
assert.ok(condition, '执行发布脚本原只读预检函数，而非复制命令')

function probe({ cached = true, reject = false, transform = value => value } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-compose227-'))
  fs.chmodSync(dir, 0o755)
  const id = randomBytes(20).toString('hex')
  const project = `fc-compat-${id.slice(0, 12)}`
  const volume = project + '-fixture'
  const image = `flowcube-backend:${id}`
  const env = { ...process.env, FLOWCUBE_COMPAT_COMPOSE_BIN: cli, FLOWCUBE_COMPAT_DOCKER_CONTEXT: context,
    COMPOSE_PROJECT_NAME: project, COMPAT_ROOT: dir, COMPAT_SHA: id }
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.mkdirSync(path.join(dir, 'build-trap'))
  fs.writeFileSync(path.join(dir, 'build-trap/Dockerfile'), 'FROM scratch\nRUN unexpected-build-must-fail\n')
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), `services:
  backend:
    image: unavailable-base-must-not-run:latest
    build:
      context: ./build-trap
    working_dir: /fixture
    volumes:
      - fixture:/fixture:ro
    entrypoint: [node, -e, "throw Error('application-entrypoint-must-not-run')"]
    environment:
      COMPAT_REJECT: '${reject ? '1' : '0'}'
    depends_on: [dependency]
  dependency:
    image: unavailable-dependency-must-not-start:latest
volumes:
  fixture:
    external: true
    name: ${volume}
`)
  const helper = `
const fs=require('fs');let readOnly=false;try{fs.writeFileSync('/compat-root-write','forbidden')}catch(e){readOnly=e.code==='EROFS'}
console.log('COMPAT_PROOF:'+JSON.stringify({uid:process.getuid(),readOnly,candidate:process.env.COMPAT_REJECT}));
if(!readOnly||process.getuid()!==1000)process.exit(8);if(process.env.COMPAT_REJECT==='1')process.exit(23);
`
  let imageId
  try {
    const create = docker(['volume', 'create', '--label', `io.flowcube.compose-compat=${project}`, volume])
    assert.equal(create.status, 0, create.stderr)
    if (cached) {
      const tag = docker(['tag', baseImage, image]); assert.equal(tag.status, 0, tag.stderr)
      imageId = docker(['image', 'inspect', '-f', '{{.Id}}', image]).stdout.trim()
      // 不依赖Mac/VM路径共享；仅给本批专属卷写入公开合成脚本。
      const prepare = docker(['run', '--rm', '-i', '--pull', 'never', '--user', 'root', '-v', `${volume}:/fixture`, '--entrypoint', 'node', image,
        '-e', "const fs=require('fs');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{fs.mkdirSync('/fixture/scripts',{recursive:true});fs.writeFileSync('/fixture/scripts/migration-preflight.js',s)})"], { input: helper })
      assert.equal(prepare.status, 0, prepare.stderr)
    }
    const script = `set -Eeuo pipefail
ROOT="$COMPAT_ROOT"; expected="$COMPAT_SHA"
docker() { if [ "$1" = compose ]; then shift; "$FLOWCUBE_COMPAT_COMPOSE_BIN" --context "$FLOWCUBE_COMPAT_DOCKER_CONTEXT" "$@"; else command docker --context "$FLOWCUBE_COMPAT_DOCKER_CONTEXT" "$@"; fi; }
fail_deploy() { printf '%s\\n' "$1" >&2; exit 41; }
${transform(condition)}
assert_migration_conditions
`
    const result = spawnSync('bash', ['-c', script], { env, cwd: dir, encoding: 'utf8', timeout: 60000 })
    const containers = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
    assert.equal(containers.stdout.trim(), '', '预检结束不得遗留应用、依赖或一次性容器')
    if (cached) assert.equal(docker(['image', 'inspect', '-f', '{{.Id}}', image]).stdout.trim(), imageId, '必须仍使用原本地候选镜像')
    return result
  } finally {
    const own = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).stdout.trim().split(/\s+/).filter(Boolean)
    if (own.length) docker(['rm', '-f', ...own])
    const networks = docker(['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).stdout.trim().split(/\s+/).filter(Boolean)
    if (networks.length) docker(['network', 'rm', ...networks])
    if (cached) docker(['image', 'rm', image])
    docker(['volume', 'rm', volume])
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('真实2.27.0只读预检使用缓存候选、node用户且不启动应用或依赖', () => {
  const result = probe()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /COMPAT_PROOF:.*"uid":1000.*"readOnly":true/)
  assert.doesNotMatch(result.stdout + result.stderr, /Pulling|Building|unexpected-build|application-entrypoint/)
})

test('缺少候选镜像直接失败，不拉取或构建替代镜像', () => {
  const result = probe({ cached: false })
  assert.equal(result.status, 41, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout + result.stderr, /unknown flag|Pulling|pull access denied|Building|unexpected-build/)
  assert.doesNotMatch(result.stdout, /COMPAT_PROOF:/)
})

test('真实预检拒绝时保留非零结果，不以兼容性降级跳过', () => {
  const result = probe({ reject: true })
  assert.equal(result.status, 41, result.stdout + result.stderr)
  assert.match(result.stdout, /COMPAT_PROOF:.*"readOnly":true/)
  assert.match(result.stderr, /只读预检失败/)
})

test('反向恢复旧run --pull参数时真实2.27.0拒绝，兼容性守卫必红', () => {
  const result = probe({ transform: fn => fn.replace('run --rm', 'run --pull never --rm') })
  assert.equal(result.status, 41)
  assert.match(result.stderr, /unknown flag: --pull/)
  assert.doesNotMatch(result.stdout, /COMPAT_PROOF:/)
})
