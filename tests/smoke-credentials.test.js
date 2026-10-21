'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'scripts/smoke-pages.node.js'), 'utf8')
const credentials = {
  SMOKE_USERNAME: 'fixture-main', SMOKE_PASSWORD: 'fixture-main-password',
  SMOKE_LIMITED_USERNAME: 'fixture-limited', SMOKE_LIMITED_PASSWORD: 'fixture-limited-password',
}

// Run the real entry point, but stop at the first browser runtime boundary. No
// browser, dependency install, network, or local credentials can be touched.
function start(env) {
  let childCalls = 0
  const boundary = new Error('child-process-boundary')
  const context = vm.createContext({
    process: { env, pid: 123, cwd: () => root },
    require: name => name === './lib/browser-smoke-runtime'
      ? { createRuntime: () => { childCalls++; throw boundary } }
      : require(name),
  })
  let error
  try { vm.runInContext(source, context, { filename: 'smoke-pages.node.js' }) } catch (caught) { error = caught }
  return { context, error, boundary, childCalls }
}

for (const key of Object.keys(credentials)) {
  for (const value of [undefined, '', '   ']) {
    test(`页面烟雾缺少 ${key} (${JSON.stringify(value)}) 时在启动子进程前拒绝`, () => {
      const env = { ...credentials, [key]: value }
      if (value === undefined) delete env[key]
      const result = start(env)
      assert.match(result.error?.message || '', new RegExp(key))
      assert.equal(result.childCalls, 0)
      assert.doesNotMatch(result.error.message, /fixture-main-password|fixture-limited-password/)
    })
  }
}

test('两组凭据完整时使用显式值，保留受限账号的 403 与授权页面检查', () => {
  const result = start(credentials)
  assert.equal(result.error, result.boundary)
  assert.equal(result.childCalls, 1)
  for (const [name, value] of Object.entries(credentials)) assert.equal(vm.runInContext(name, result.context), value)
  assert.match(source, /loginAs\(SMOKE_LIMITED_USERNAME, SMOKE_LIMITED_PASSWORD,/)
  assert.match(source, /await assertForbidden\('\/picking-waves'\)/)
  assert.match(source, /await setHashAndConfirm\('\/inbound-tasks\/new'\)/)
})

// Real executor prefix only, ending before load/stop/migrate. Synthetic private
// configuration stays on the server side of the protocol; no SSH or Docker call.
// The lock boundary is synthetic here; actual flock concurrency has its own receiver test.
const os=require('node:os')
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'"
function executorPrefix(t,values) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flowcube-private-smoke-'))
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const file=path.join(dir,'smoke.env')
 fs.writeFileSync(file,Object.entries(values).map(([key,value])=>key+'='+quote(value)).join('\n')+'\n',{mode:0o600})
 const prefix=fs.readFileSync(path.join(root,'scripts/server-update.sh'),'utf8').split('WRITE_WINDOW=0')[0]
 const env={PATH:process.env.PATH,RELEASE_TOOLS_DIR:path.join(root,'scripts'),PROJECT_DIR:dir,
  RELEASE_STATE_DIR:dir,COMPOSE_FILE:path.join(dir,'fixture.yml'),COMPOSE_PROJECT_NAME:'fixture',
  COMPOSE_ENV_FILES:path.join(dir,'fixture.env'),MYSQL_EXPECTED_VERSION:'synthetic',MYSQL_EXPECTED_IMAGE_ID:'synthetic',
  EXPECTED_COMMIT:'a'.repeat(40),EXPECTED_BACKEND_ID:'sha256:'+'b'.repeat(64),EXPECTED_FRONTEND_ID:'sha256:'+'c'.repeat(64),
  RELEASE_GATE_ENV_FILE:file}
 return {prefix:'flock() { return 0; }\n'+prefix,env}
}
test('两组smoke凭据由预装私有文件读取，特殊字符不进入SSH或GitHub产物',t=>{
 const yaml=require('../frontend/node_modules/js-yaml')
 const workflow=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/deploy-browser.yml'),'utf8'))
 for(const name of Object.keys(credentials))assert.doesNotMatch(JSON.stringify(workflow),new RegExp(name))
 const values=Object.fromEntries(Object.keys(credentials).map(name=>[name,`fixture ' \" $() \` ; spaces ${name}`]))
 const {prefix,env}=executorPrefix(t,values)
 const probe=quote(process.execPath)+' -e '+quote('process.stdout.write(JSON.stringify(Object.fromEntries('+JSON.stringify(Object.keys(credentials))+'.map(k=>[k,process.env[k]]))))')
 const result=spawnSync('bash',['-c',prefix+'\n'+probe],{env,encoding:'utf8',timeout:5000})
 assert.equal(result.status,0,result.stderr)
 assert.deepEqual(JSON.parse(result.stdout),values)
})
test('任一私有smoke凭据缺失时，真实执行器在load/停写/迁移前拒绝',t=>{
 for(const name of Object.keys(credentials)){
  const {prefix,env}=executorPrefix(t,{...credentials,[name]:''})
  const result=spawnSync('bash',['-c',prefix+'\necho SHOULD_NOT_REACH'],{env,encoding:'utf8',timeout:5000})
  assert.notEqual(result.status,0,`${name}缺失须拒绝`)
  assert.match(result.stderr,new RegExp(name));assert.doesNotMatch(result.stdout,/SHOULD_NOT_REACH/)
  assert.doesNotMatch(result.stderr,/fixture-main-password|fixture-limited-password/)
 }
})
