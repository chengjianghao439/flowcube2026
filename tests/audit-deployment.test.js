'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..')
function deployment(scenario, transform = source => source) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-deploy-test-')))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
  for (const file of ['server-update.sh', 'lib/ops-common.sh']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(dir, 'scripts', file))
  const updatePath = path.join(dir, 'scripts/server-update.sh')
  fs.writeFileSync(updatePath, transform(fs.readFileSync(updatePath, 'utf8')))
  for (const file of ['lib/runtime-guards.sh']) if (fs.existsSync(path.join(root, 'scripts', file))) fs.copyFileSync(path.join(root, 'scripts', file), path.join(dir, 'scripts', file))
  const backupHelper = path.join(root, 'scripts/lib/pre-migrate-backup.js')
  if (fs.existsSync(backupHelper)) fs.copyFileSync(backupHelper, path.join(dir, 'scripts/lib/pre-migrate-backup.js'))
  fs.mkdirSync(path.join(dir, 'backups'))
  fs.writeFileSync(path.join(dir, 'backups/flowcube_old.sql.gz'), 'old snapshot must never satisfy this deployment')
  fs.writeFileSync(path.join(dir, 'preload.js'), `
const fs = require('node:fs');
if (process.env.DEPLOY_TEST_SCENARIO === 'backup_timeout') {
 const original = global.setTimeout;
 global.setTimeout = (fn, ms, ...args) => original(fn, ms >= 100000 ? 5 : ms, ...args);
}
const write = fs.writeFileSync;
const sync = fs.fsyncSync;
fs.fsyncSync = function(fd) {
 if (process.env.DEPLOY_TEST_SCENARIO === 'backup_directory_sync' && fs.fstatSync(fd).isDirectory()) {
  const e = new Error('synthetic directory sync failure');e.code='EIO';throw e;
 }
 return sync.call(this, fd);
};
const stream = fs.createWriteStream;
fs.createWriteStream = function(file, ...args) {
 if (process.env.DEPLOY_TEST_SCENARIO === 'backup_write_full' && String(file).endsWith('database.sql.gz.part')) {
  return new (require('node:stream').Writable)({write(chunk, encoding, done){const e=new Error('synthetic disk full');e.code='ENOSPC';done(e);}});
 }
 return stream.call(this, file, ...args);
};
fs.writeFileSync = function(file, data, ...args) {
 if (String(file).endsWith('receipt.json.part')) {
  const s = process.env.DEPLOY_TEST_SCENARIO;
  if (s === 'backup_receipt_permission') { const e = new Error('synthetic permission failure'); e.code='EACCES'; throw e; }
  if (s === 'backup_wrong_sha' || s === 'backup_stale_receipt') {
   const r = JSON.parse(data); if(s === 'backup_wrong_sha') r.candidateSha = 'b'.repeat(40); else r.runId = 'previous-deployment';
   data = JSON.stringify(r);
  }
 }
 return write.call(this, file, data, ...args);
};
`)
  fs.copyFileSync(path.join(root, 'docker-compose.yml'), path.join(dir, 'docker-compose.yml'))
  fs.writeFileSync(path.join(dir, 'scripts/release-gate.sh'), '#!/bin/bash\n[[ "$DEPLOY_TEST_SCENARIO" != gate && "$DEPLOY_TEST_SCENARIO" != ledger_gate && "$DEPLOY_TEST_SCENARIO" != ledger_retry && "$DEPLOY_TEST_SCENARIO" != write_contract_gate && "$DEPLOY_TEST_SCENARIO" != rollback_failure && "$DEPLOY_TEST_SCENARIO" != first_deploy && "$DEPLOY_TEST_SCENARIO" != legacy ]]\n')
  if (scenario === 'legacy') {
    fs.mkdirSync(path.join(dir, 'backend/apk'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'backend/apk/version.json'), JSON.stringify({ version: '2.0.0', versionCode: 2 }))
    fs.writeFileSync(path.join(dir, 'backend/apk/published-version.json'), JSON.stringify({ version: '1.0.0', versionCode: 1, filename: 'FlowCubePDA-1-fixture.apk' }))
  }
  if (scenario === 'lowdisk') fs.copyFileSync(path.join(root, 'scripts/release-gate.sh'), path.join(dir, 'scripts/release-gate.sh'))
  fs.writeFileSync(path.join(dir, 'scripts/install-cron.sh'), '#!/bin/bash\nexit 0\n')
  const mock = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const cmd=path.basename(process.argv[1]),rawArgs=process.argv.slice(2),s=process.env.DEPLOY_TEST_SCENARIO;
const args=rawArgs[0]==='compose'&&rawArgs[1]==='--project-directory'?[rawArgs[0],...rawArgs.slice(3)]:rawArgs;
const log=process.env.DEPLOY_TEST_LOG,rolled=log+'.rolled';
const first=s.startsWith('first_'),mysqlStarted=log+'.mysql-started';
fs.appendFileSync(log,JSON.stringify([cmd,...args])+'\\n');
if(cmd==='git') {if(args[0]==='rev-parse')console.log((s==='sha'?'b':'a').repeat(40)); process.exit(0);}
if(cmd==='flock'||cmd==='sleep')process.exit(0);
if(cmd==='node'){
 if(args[0]?.endsWith('pre-migrate-backup.js')) {
  const r=require('node:child_process').spawnSync(process.execPath,['--require',path.join(process.cwd(),'preload.js'),...args],{stdio:'inherit',env:process.env});
  if(s==='backup_tamper' && args[1]==='create' && r.status===0) fs.appendFileSync(path.join(args.at(-1),'database.sql.gz'),'tamper');
  if(s==='backup_bad_mode' && args[1]==='create' && r.status===0) fs.chmodSync(path.join(args.at(-1),'receipt.json'),0o644);
  process.exit(r.status??1);
 }
 process.exit(s==='checks'?1:0);
}
if(cmd==='timeout'){
 let i=0;while(args[i]?.startsWith('-'))i+=args[i]==='-k'?2:1;i++;
 const r=require('node:child_process').spawnSync(args[i],args.slice(i+1),{stdio:'inherit',env:process.env});process.exit(r.status??1);
}
if(cmd==='sha256sum'){console.log(require('node:crypto').createHash('sha256').update(fs.readFileSync(args.at(-1))).digest('hex')+'  '+args.at(-1));process.exit(0);}
if(cmd==='df'){console.log('Filesystem 1M-blocks Used Available Use% Mounted on\\nfixture 20000 1000 '+(s==='lowdisk'||(s==='backup_lowdisk'&&args.at(-1).includes('pre-migrate-'))?100:19000)+' 10% /');process.exit(0);}
if(cmd==='curl'){console.log('<title>极序 Flow</title>');process.exit((s==='health'&&!fs.existsSync(rolled))||(s==='public'&&args.some(a=>a.startsWith('https://')))?22:0);}
if(cmd==='docker') {
 const a=args.join(' ');
 if(a==='compose config --format json') {
  console.log(JSON.stringify({services:{backend:{environment:{DB_HOST:s==='backup_config_mismatch'?'other-host':'mysql',DB_PORT:'3306',DB_NAME:s==='backup_option_name'?'--all-databases':'flowcube_fixture',DB_PASSWORD:'synthetic-secret-must-not-leak'}}}}));process.exit(0);
 }
 if(args[0]==='inspect'&&a.includes('json .Id')) {
  console.log(JSON.stringify({containerId:'2'.repeat(64),imageId:'sha256:'+'3'.repeat(64)}));process.exit(0);
 }
 if(args[0]==='exec'&&a.includes('flowcube_pre_migration_state')) {
  const f=log+'.state-count',n=fs.existsSync(f)?Number(fs.readFileSync(f))+1:1;fs.writeFileSync(f,String(n));
  console.log(JSON.stringify({serverUuid:'12345678-1234-1234-1234-123456789abc',version:s==='backup_state_drift'&&n>1?'8.0.46':'8.0.45',database:s==='backup_option_name'?'--all-databases':'flowcube_fixture',tableCount:s==='backup_empty'?0:1,migrationTableExists:s==='backup_empty'?0:1}));process.exit(0);
 }
 if(args[0]==='exec'&&a.includes('flowcube_pre_migration_row')) {
  console.log(JSON.stringify({id:1,filename:'240_party_ledger_explicit_identity.sql',executedAt:'2026-10-01 00:00:00'}));process.exit(0);
 }
 if(args[0]==='exec'&&a.includes('mysqldump')) {
  if(s==='backup_dump'){console.error('synthetic-secret-must-not-leak');process.exit(2);}
  if(s==='backup_interrupt'){process.kill(process.ppid,'SIGTERM');setInterval(()=>{},1000);return;}
  console.log('-- MySQL dump 10.13');
  if(s!=='backup_empty') {
   console.log('CREATE TABLE fixture (id INT);');
   for(let i=0;i<100;i++)console.log('-- '+require('node:crypto').createHash('sha256').update(String(i)).digest('hex'));
  }
  if(s!=='backup_truncated') console.log('-- Dump completed on 2026-10-17 00:00:00');
  process.exit(0);
 }
 if(a==='compose config --images mysql') {console.log(s==='first_bad_pin'?'mysql:8.0':'mysql:8.0@sha256:'+'7'.repeat(64));process.exit(0);}
 if(a==='compose ps -aq mysql') {if(!first||fs.existsSync(mysqlStarted))console.log(s==='multi_mysql'?'old-mysql-container\\nother-mysql-container':'old-mysql-container');process.exit(0);}
 if(args[0]==='inspect'&&a.includes('.State.Status')) {console.log(s==='mysql_stopped'?'exited healthy':['mysql_unhealthy','first_unhealthy'].includes(s)?'running unhealthy':s==='mysql_no_health'?'running missing':'running healthy');process.exit(0);}
 if(args[0]==='image'&&args[1]==='inspect'&&args.at(-1).startsWith('mysql:')) {process.exit(s==='first_missing_pin'?1:0);}
 if(args[0]==='exec'&&a.includes('SELECT CONCAT')) {
   if(!a.includes('--protocol=TCP')||!a.includes('-h127.0.0.1')||!a.includes('-P3306')||!a.includes('--connect-timeout=2')||!a.includes('MYSQL_PWD="$MYSQL_ROOT_PASSWORD"'))process.exit(1);
   if(['mysql','mysql_auth_fail','first_auth_fail'].includes(s))process.exit(1);
   if(s==='mysql_bad_result') {console.log('0');process.exit(0);}
   if(s==='first_sql_delay') {const p=log+'.sql-count',n=fs.existsSync(p)?Number(fs.readFileSync(p))+1:1;fs.writeFileSync(p,String(n));if(n<3)process.exit(1);}
   console.log('1\\t'+(s==='mysql_wrong_version'?'unexpected-engine':process.env.MYSQL_EXPECTED_VERSION));process.exit(0);
 }
 if(a.startsWith('compose up')&&args.at(-1)==='mysql') {
   if(!args.includes('--pull')||args[args.indexOf('--pull')+1]!=='never'||!args.includes('--no-deps')) {fs.appendFileSync(log,JSON.stringify(['implicit-mysql-reconcile'])+'\\n');process.exit(1);}
   if(s==='first_start_fail')process.exit(1);
   fs.writeFileSync(mysqlStarted,'yes');process.exit(0);
 }
 if(a.startsWith('compose up')&&a.endsWith('backend frontend')&&!args.includes('--no-deps')) {fs.appendFileSync(log,JSON.stringify(['implicit-mysql-reconcile'])+'\\n');process.exit(1);}
 if(a.includes('SELECT @@GLOBAL.log_bin_trust_function_creators')) {if(['ledger_retry_pre_migration','write_contract_retry_pre_migration'].includes(s))process.exit(1);console.log('0');}
 if(a.includes("table_name='db_migrations'"))console.log('1');
 if(a.includes("filename='240_party_ledger_explicit_identity.sql'"))console.log(s==='ledger_gate'?'0':'1');
 if(s==='restore_permission'&&a.includes('SET GLOBAL log_bin_trust_function_creators=0'))process.exit(1);
 if(args[0]==='image'&&args[1]==='inspect') {
   if(a.includes('{{.Id}}')) {console.log('sha256:'+(s==='wrong-image'?'f':args.at(-1).includes('backend')?'a':'b').repeat(64));process.exit(0);}
   if(a.includes('io.flowcube.quantity-return-cash-contract'))console.log(s==='write_contract_missing_target'||(s.startsWith('write_contract')&&args.at(-1).startsWith('sha256:'))?'':'1');
   else console.log(a.includes('io.flowcube.party-ledger-contract')?(s.startsWith('ledger_retry')?'':'1'):(s==='wrong-image'?'b':'a').repeat(40));
 }
 if(s==='load'&&args[0]==='load')process.exit(1);
 if(a.startsWith('compose ps')&&s!=='first_deploy')console.log(args.at(-1)==='backend'?'old-backend-container':'old-frontend-container');
 if(args[0]==='inspect')console.log(args.at(-1).includes('mysql')?'sha256:'+'3'.repeat(64):args.at(-1).includes('backend')?'sha256:'+'a'.repeat(64):'sha256:'+'b'.repeat(64));
 if(args[0]==='tag'&&args[1].startsWith('sha256:'))fs.writeFileSync(rolled,'yes');
 if(s==='rollback_failure'&&args[0]==='tag')process.exit(1);
 if(s==='legacy'&&a.includes('--force-recreate')) {const meta=JSON.parse(fs.readFileSync('backend/apk/version.json'));if(meta.versionCode!==1||meta.filename!=='FlowCubePDA-1-fixture.apk')process.exit(1);}
 if(a.startsWith('compose up')&&args.at(-1)==='frontend'&&args.includes('--pull')&&args[args.indexOf('--pull')+1]!=='never')process.exit(1);
 if(s==='build'&&(a.startsWith('compose build')||a.includes('--build')))process.exit(1);
 if(s==='migration'&&(a.includes('npm run migrate')))process.exit(1);
 if(s==='mysql'&&a.startsWith('compose up')&&a.includes('mysql'))process.exit(1);
 if(s==='start'&&a.startsWith('compose up')&&!a.includes('mysql')&&!a.includes('--force-recreate'))process.exit(1);
 process.exit(0);
}
process.exit(0);
`
  for (const command of ['docker', 'curl', 'git', 'flock', 'sleep', 'node', 'df', 'timeout', 'sha256sum', 'npm']) fs.writeFileSync(path.join(bin, command), mock, { mode: 0o755 })
  const log = path.join(dir, 'commands.jsonl')
  const archive = path.join(dir, 'images.tar.gz')
  fs.writeFileSync(archive, 'fixture archive')
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, DEPLOY_TEST_SCENARIO: scenario, DEPLOY_TEST_LOG: log,
    SKIP_GIT_PULL: '1', EXPECTED_COMMIT: 'a'.repeat(40), SKIP_RELEASE_GATE: '0', DEPLOY_LOCK_FILE: path.join(dir, 'deploy.lock'), DINGTALK_WEBHOOK: '', HEALTH_CHECK_ATTEMPTS: '2', HEALTH_CHECK_DELAY: '0', SMOKE_USERNAME: 'fixture', SMOKE_PASSWORD: 'fixture', SMOKE_LIMITED_USERNAME: 'fixture-limited', SMOKE_LIMITED_PASSWORD: 'fixture-limited' }
  env.DEPLOY_IMAGE_ARCHIVE = scenario === 'missing-archive' ? '' : archive
  env.DEPLOY_IMAGE_SHA256 = scenario === 'corrupt-archive' ? '0'.repeat(64) : createHash('sha256').update('fixture archive').digest('hex')
  if (scenario === 'public') env.DEPLOY_PUBLIC_ORIGIN = 'https://deployment.example.invalid'
  if (scenario === 'nondocker') {
    env.FLOWCUBE_MIGRATION_WRITES_PAUSED = '1'
    fs.mkdirSync(path.join(dir, 'backend'), { recursive: true })
  }
  Object.assign(env,{RELEASE_TOOLS_DIR:path.join(dir,'scripts'),PROJECT_DIR:dir,RELEASE_STATE_DIR:dir,COMPOSE_FILE:path.join(dir,'docker-compose.yml'),COMPOSE_PROJECT_NAME:'fixture',COMPOSE_ENV_FILES:path.join(dir,'fixture.env'),MYSQL_EXPECTED_VERSION:'synthetic-engine-version',MYSQL_EXPECTED_IMAGE_ID:'sha256:'+'3'.repeat(64),EXPECTED_BACKEND_ID:'sha256:'+'a'.repeat(64),EXPECTED_FRONTEND_ID:'sha256:'+'b'.repeat(64),RELEASE_SOURCE_DIR:dir,BACKUP_DIR:path.join(dir,'backups'),PLAYWRIGHT_IMAGE:'synthetic-preinstalled-browser',DEPLOY_PUBLIC_ORIGIN:'https://fixture.invalid'});
  if(scenario==='sha')env.EXPECTED_COMMIT='short';
  delete env.DEPLOY_LOCK_FD
  try {
    const result = spawnSync('bash', ['scripts/server-update.sh'], { cwd: dir, env, encoding: 'utf8', timeout: 20000 })
    const commands = fs.existsSync(log)?fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)):[]
    const legacyPath = path.join(dir, 'backend/apk/version.json')
    const backupReceipts = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('pre-migrate-')).flatMap(f => {
      const receipt = path.join(dir, 'backups', f, 'receipt.json')
      return fs.existsSync(receipt) ? [JSON.parse(fs.readFileSync(receipt))] : []
    })
    return { ...result, commands, backupReceipts, oldBackupRetained: fs.readFileSync(path.join(dir, 'backups/flowcube_old.sql.gz'), 'utf8') === 'old snapshot must never satisfy this deployment', legacyMeta: fs.existsSync(legacyPath) ? JSON.parse(fs.readFileSync(legacyPath)) : null }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}


function forbidden(commands) {
 return commands.filter(c => ['git','npm'].includes(c[0]) || c.includes('--force-recreate') || c[0]==='docker' && ['tag','pull','build'].includes(c[1]) || c.join(' ').includes('SET GLOBAL') || c.includes('mysql') && c.includes('up'))
}
const at=(r,text)=>r.commands.findIndex(c=>c.join(' ').includes(text))
for(const scenario of ['load','mysql','start','health','gate','public','lowdisk','migration','write_contract_missing_target','wrong-image','missing-archive','corrupt-archive','sha','mysql_wrong_version','mysql_stopped','mysql_unhealthy','mysql_no_health','multi_mysql','mysql_auth_fail','mysql_bad_result','first_cached','first_missing_pin']) test(`新执行器 ${scenario} 失败即停，无自动回滚或数据库管理动作`,()=>{
 const r=deployment(scenario);assert.equal(r.status,1,r.stdout+r.stderr);assert.deepEqual(forbidden(r.commands),[])
 if(['migration','start','health','gate','public'].includes(scenario))assert.ok(r.commands.filter(c=>c.join(' ').includes('stop -t 60 backend')).length>=2)
 if(['wrong-image','write_contract_missing_target','mysql_wrong_version','mysql_stopped','mysql_unhealthy','mysql_no_health','multi_mysql','mysql_auth_fail','mysql_bad_result','first_cached','first_missing_pin','sha','corrupt-archive'].includes(scenario))assert.ok(at(r,'npm run migrate')<0)
 if(scenario==='migration')assert.ok(at(r,' up ')<0)
})
test('正常流程保留数据库身份，校验完整镜像后停写、备份、迁移、只切换应用和健康检查',()=>{
 const r=deployment('success');assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(forbidden(r.commands),[])
 assert.ok(at(r,'load -i')<at(r,'io.flowcube.quantity-return-cash-contract'))
 assert.ok(at(r,'io.flowcube.quantity-return-cash-contract')<at(r,'stop -t 60 backend'))
 assert.ok(at(r,'stop -t 60 backend')<at(r,'pre-migrate-backup.js create'))
 assert.ok(at(r,'pre-migrate-backup.js create')<at(r,'pre-migrate-backup.js verify'))
 assert.ok(at(r,'pre-migrate-backup.js verify')<at(r,'npm run migrate'))
 assert.ok(at(r,'npm run migrate')<at(r,' up '));assert.ok(at(r,'/api/ready')>at(r,' up '))
 const up=r.commands.find(c=>c.includes('up'));assert.ok(up.includes('--no-build')&&up.includes('--no-deps')&&up.includes('--pull')&&up[up.indexOf('--pull')+1]==='never')
 const probes=r.commands.filter(c=>c.join(' ').includes('SELECT CONCAT'));assert.ok(probes.length>=3)
 assert.ok(probes.every(c=>c.includes('old-mysql-container')&&c.join(' ').includes('--protocol=TCP')))
 assert.equal(r.backupReceipts.length,1);const receipt=r.backupReceipts[0]
 assert.equal(receipt.candidateSha,'a'.repeat(40));assert.equal(receipt.restorationVerified,false)
 assert.equal(receipt.source.imageId,'sha256:'+'3'.repeat(64));assert.match(receipt.backup.sha256,/^[a-f0-9]{64}$/)
 assert.equal(r.oldBackupRetained,true);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret-must-not-leak/)
})
test('删除目标写入契约检查会被真实 shell 行为反例发现',()=>{
 const r=deployment('write_contract_missing_target',s=>{const x=s.replace('[ "$contract" = 1 ] ||', 'true ||');assert.notEqual(x,s);return x})
 assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(at(r,'npm run migrate')>=0)
})
test('删除健康门会错误放行不健康 MySQL，实际 shell 反证',()=>{
 const r=deployment('mysql_unhealthy',s=>{const x=s.replace("[ \"$state\" = 'running healthy' ]","true");assert.notEqual(x,s);return x})
 assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(at(r,'npm run migrate')>=0)
})
for (const scenario of ['backup_dump', 'backup_truncated', 'backup_lowdisk', 'backup_write_full', 'backup_config_mismatch', 'backup_option_name', 'backup_state_drift', 'backup_receipt_permission', 'backup_directory_sync', 'backup_timeout', 'backup_interrupt', 'backup_wrong_sha', 'backup_stale_receipt', 'backup_tamper', 'backup_bad_mode']) {
  test(`A37 ${scenario} 必须明确失败且不得授权或执行迁移，旧备份不能代替`, () => {
    const r = deployment(scenario)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stderr, /迁移前备份|备份回执/)
    assert.ok(!r.commands.some(c => c.join(' ').includes('SET GLOBAL log_bin_trust_function_creators=1') || c.join(' ').includes('backend npm run migrate')))
    assert.equal(r.oldBackupRetained, true)
    assert.doesNotMatch(r.stdout + r.stderr, /synthetic-secret-must-not-leak|恢复演练已通过/)
  })
}

test('A37 空库只能凭稳定源身份和真实完整空转储证明，回执不冒充恢复成功', () => {
  const r = deployment('backup_empty')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.backupReceipts.length, 1)
  assert.equal(r.backupReceipts[0].source.tableCount, 0)
  assert.equal(r.backupReceipts[0].source.migrationTableExists, 0)
  assert.deepEqual(r.backupReceipts[0].source.migrations, [])
  assert.equal(r.backupReceipts[0].backup.tableDefinitions, 0)
  assert.equal(r.backupReceipts[0].restorationVerified, false)
})

test('A37 转储只用MySQL8支持的参数并固定完整注释格式，时限由进程控制', () => {
  const r = deployment('success')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const dump = r.commands.find(c => c[0] === 'docker' && c[1] === 'exec' && c.join(' ').includes('mysqldump'))
  assert.ok(dump)
  const command = dump.join(' ')
  assert.doesNotMatch(command, /--connect-timeout/)
  assert.match(command, /mysqldump --no-defaults /)
  assert.match(command, / -- "\$MYSQL_DATABASE"$/)
  for (const option of ['--single-transaction', '--routines', '--triggers', '--events', '--comments', '--dump-date', '--set-gtid-purged=OFF']) assert.ok(command.includes(option), option)
})
