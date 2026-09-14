'use strict'
// 备份恢复演练对「触发器体残留分号」的兼容与错误透出回归。
//
// 2026-09-14：9/9 起 mysqldump 会把带结尾分号的触发器体导出成
// `... ); */;;`，导入时 1064 报错、演练判失败并把真实原因吞掉，钉钉只看到
// 「备份可能损坏」——而备份其实是完整可恢复的。演练必须在导入前规范化这条语句，
// 并把 MySQL 的真实报错透出，便于区分「备份损坏」与「导入语法问题」。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

// 与真实 dump 一致的片段：触发器被包在可执行注释里，函数体结尾带分号。
const BAD_TRIGGER_DUMP = [
  'CREATE TABLE `fixture` (id INT);',
  'DELIMITER ;;',
  '/*!50003 CREATE*/ /*!50017 DEFINER=`flowcube`@`%`*/ /*!50003 TRIGGER `trg_fixture` AFTER INSERT ON `fixture` FOR EACH ROW INSERT INTO `log`',
  ' (id)',
  'VALUES (NEW.id); */;;',
  'DELIMITER ;',
  '',
].join('\n')

// 故意包含双引号与反斜杠：真实 MySQL 报错常带引号，而 dingtalk_send 直接拼 JSON。
const IMPORT_ERROR_LINE = `ERROR 1064 (42000) at line 2373: near '" */"\\' at line 3`

function runRestore({ importFails = false, notify = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-restore-trigger-'))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  const stdinFile = path.join(dir, 'import.sql')
  const curlFile = path.join(dir, 'curl-args.json')
  const file = path.join(dir, 'flowcube_fixture.sql.gz')
  fs.writeFileSync(file, zlib.gzipSync(BAD_TRIGGER_DUMP))
  const fixtureBytes = fs.readFileSync(file)

  // 只替换外部 Docker / curl；真实运行 restore-check.sh、gzip 与文件逻辑。
  fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'run') { console.log('fixture-container'); process.exit(0); }
if (args[0] === 'rm') process.exit(0);
if (args[0] === 'exec') {
  const joined = args.join(' ');
  if (joined.includes('SELECT 1')) process.exit(0);
  if (args.includes('-i')) {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      fs.writeFileSync(process.env.PROBE_STDIN_FILE, data);
      if (process.env.PROBE_IMPORT_FAILS === '1') {
        process.stderr.write('mysql: [Warning] Using a password on the command line interface can be insecure.\\n');
        process.stderr.write(${JSON.stringify(IMPORT_ERROR_LINE)} + '\\n');
        process.exit(1);
      }
      process.exit(0);
    });
    return;
  }
  if (joined.includes('information_schema.tables')) { console.log('135'); process.exit(0); }
  if (joined.includes('COUNT(*)')) { console.log('7'); process.exit(0); }
  process.exit(0);
}
process.exit(0);
`, { mode: 0o755 })

  // 记录钉钉请求体，验证告警文本能被拼成合法 JSON。
  fs.writeFileSync(path.join(bin, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.PROBE_CURL_FILE, JSON.stringify(process.argv.slice(2)));
process.exit(0);
`, { mode: 0o755 })

  const result = spawnSync('bash', ['scripts/restore-check.sh', file], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      PATH: bin + ':' + process.env.PATH,
      PROJECT_DIR: dir,
      PROBE_STDIN_FILE: stdinFile,
      PROBE_CURL_FILE: curlFile,
      PROBE_IMPORT_FAILS: importFails ? '1' : '0',
      MIN_TABLES: '5',
      MIN_ROWS: '1',
      FLOWCUBE_RESTORE_DEADLINE_ACTIVE: '',
      DINGTALK_WEBHOOK: notify ? 'https://example.invalid/robot/send?access_token=fixture' : '',
    },
  })
  const imported = fs.existsSync(stdinFile) ? fs.readFileSync(stdinFile, 'utf8') : ''
  const fixtureAfter = fs.existsSync(file) ? fs.readFileSync(file) : null
  const curlArgs = fs.existsSync(curlFile) ? JSON.parse(fs.readFileSync(curlFile, 'utf8')) : null
  fs.rmSync(dir, { recursive: true, force: true })
  return { ...result, imported, fixtureBytes, fixtureAfter, curlArgs }
}

test('导入前把触发器体越界的结尾分号移出可执行注释', () => {
  const r = runRestore()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(r.imported.includes('TRIGGER `trg_fixture`'), '应保留触发器定义')
  assert.ok(r.imported.includes(' */;;'), '可执行注释的结束标记应保留')
  assert.ok(
    !r.imported.includes('; */;;'),
    '函数体结尾分号必须移出可执行注释，否则导入会 1064'
  )
})

test('规范化只作用于导入管道，不改写备份文件本身', () => {
  const r = runRestore()
  assert.ok(r.fixtureAfter, '备份文件应仍然存在')
  assert.deepEqual(r.fixtureAfter, r.fixtureBytes, '备份文件必须保持原样，恢复演练是只读的')
})

test('导入失败时透出 MySQL 的真实报错，而不是只说备份可能损坏', () => {
  const r = runRestore({ importFails: true })
  assert.notEqual(r.status, 0)
  const output = r.stdout + r.stderr
  assert.match(output, /1064/, '应透出真实错误码')
  assert.ok(!/恢复演练通过/.test(output))
})

test('告警文本含引号/反斜杠时仍是合法 JSON，不会被钉钉静默丢弃', () => {
  const r = runRestore({ importFails: true, notify: true })
  assert.notEqual(r.status, 0)
  assert.ok(r.curlArgs, '应发出钉钉告警')
  const payload = r.curlArgs[r.curlArgs.indexOf('-d') + 1]
  const parsed = JSON.parse(payload) // 抛错即 JSON 已损坏
  assert.equal(parsed.msgtype, 'text')
  assert.match(parsed.text.content, /1064/)
  assert.ok(!parsed.text.content.includes('" */"'), '危险字符应被净化')
})
