'use strict'

// Deployment-only snapshot gate. No daily-backup lookup, retention deletion or restore.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { pipeline } = require('node:stream/promises')
const { Writable } = require('node:stream')
const { createGzip, createGunzip } = require('node:zlib')
const execute = promisify(execFile)
const digest = value => crypto.createHash('sha256').update(value).digest('hex')

function requireProof(ok, message) {
  if (!ok) throw Object.assign(new Error(message), { publicMessage: message })
}

async function command(bin, args, signal) {
  try {
    return (await execute(bin, args, { signal, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 })).stdout.trim()
  } catch {
    // Config/SQL client output can contain credentials. Never print it, including parse errors.
    requireProof(false, `${bin === 'df' ? '备份目录容量检查' : '数据库来源核验'}命令失败或超时`)
  }
}

function json(value) {
  try { return JSON.parse(value) } catch { requireProof(false, '来源或回执 JSON 无效') }
}

async function sourceState(container, signal) {
  const identity = json(await command('docker', ['inspect', '-f', '{"containerId":{{json .Id}},"imageId":{{json .Image}}}', container], signal))
  requireProof(/^[a-f0-9]{64}$/.test(identity.containerId) && /^sha256:[a-f0-9]{64}$/.test(identity.imageId), '实际 MySQL 容器或镜像身份不明')
  const query = sql => command('docker', ['exec', container, 'sh', '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --no-defaults --protocol=TCP -h127.0.0.1 -P3306 --connect-timeout=2 -uroot --database="$MYSQL_DATABASE" --batch --raw --skip-column-names -e "$1"', 'sh', sql], signal)
  const state = json(await query("SELECT JSON_OBJECT('serverUuid',@@server_uuid,'version',@@version,'database',DATABASE(),'tableCount',(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'),'migrationTableExists',(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='db_migrations')) AS flowcube_pre_migration_state"))
  requireProof(/^[a-f0-9-]{36}$/i.test(state.serverUuid) && typeof state.version === 'string' && /^[0-9][a-zA-Z0-9.+_-]{1,63}$/.test(state.version), '数据库 UUID/版本无效')
  requireProof(typeof state.database === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}$/.test(state.database), '数据库名称无效')
  requireProof(Number.isSafeInteger(state.tableCount) && state.tableCount >= 0 && [0, 1].includes(state.migrationTableExists), '迁移前表状态无效')
  let migrations = []
  if (state.migrationTableExists) {
    const rows = await query("SELECT JSON_OBJECT('id',id,'filename',filename,'executedAt',CAST(executed_at AS CHAR)) AS flowcube_pre_migration_row FROM db_migrations ORDER BY id")
    migrations = rows ? rows.split('\n').map(json) : []
    requireProof(migrations.every((r, i) => Number.isSafeInteger(r.id) && r.id > (i ? migrations[i - 1].id : 0) && typeof r.filename === 'string' && /^[a-zA-Z0-9_.-]{1,200}$/.test(r.filename) && typeof r.executedAt === 'string' && /^[0-9 :.-]{10,32}$/.test(r.executedAt)), '迁移前记录格式无效')
  }
  const config = json(await command('docker', ['compose', 'config', '--format', 'json'], signal))
  const env = config.services?.backend?.environment
  requireProof(env?.DB_HOST === 'mysql' && String(env.DB_PORT || '3306') === '3306' && env.DB_NAME === state.database, '迁移目标与备份数据库来源不一致；拒绝猜测外部数据库')
  return { requestedContainer: container, ...identity, ...state, migrations }
}

function privateFile(file) {
  const stat = fs.lstatSync(file)
  requireProof(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid(), '备份或回执不是本进程所有的 0600 普通文件')
  return stat
}

async function inspectDump(file, tableCount, signal) {
  privateFile(file)
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), new Writable({ write(chunk, encoding, next) { hash.update(chunk); next() } }), { signal })
  let line = '', tableDefinitions = 0, header = false, completed = false
  function endLine() {
    if (line.startsWith('-- MySQL dump')) header = true
    if (line.startsWith('-- Dump completed on ')) completed = true
    if (line.startsWith('CREATE TABLE ')) tableDefinitions++
    line = ''
  }
  await pipeline(fs.createReadStream(file), createGunzip(), new Writable({
    write(chunk, encoding, next) {
      const parts = chunk.toString('utf8').split('\n')
      for (let i = 0; i < parts.length; i++) {
        // Inspect only line prefixes; large INSERT values are never accumulated or logged.
        line = (line + parts[i]).slice(0, 256)
        if (i < parts.length - 1) endLine()
      }
      next()
    },
  }), { signal })
  if (line) endLine()
  requireProof(header && completed && tableDefinitions >= tableCount && (tableCount > 0 || tableDefinitions === 0), '转储不完整或建表数量不足；未证明备份可恢复')
  return { filename: 'database.sql.gz', bytes: fs.statSync(file).size, sha256: hash.digest('hex'), tableDefinitions }
}

function syncPath(file) {
  const fd = fs.openSync(file, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

async function createBackup(sha, container, dir, signal) {
  requireProof(fs.readdirSync(dir).length === 0, '本次备份目录必须全新且为空，旧备份不能代替')
  const capacity = await command('df', ['-Pm', dir], signal)
  const available = capacity.split('\n').at(-1).trim().split(/\s+/)[3]
  requireProof(/^\d+$/.test(available) && Number(available) >= 4096, `备份目录可用空间不足 4096 MB（${/^\d+$/.test(available) ? available : '未知'} MB），拒绝迁移且不清理历史`)
  const startedAt = new Date().toISOString()
  const before = await sourceState(container, signal)
  const part = path.join(dir, 'database.sql.gz.part')
  const file = path.join(dir, 'database.sql.gz')
  const child = spawn('docker', ['exec', container, 'sh', '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --no-defaults --protocol=TCP -h127.0.0.1 -P3306 -uroot --single-transaction --routines --triggers --events --set-gtid-purged=OFF --comments --dump-date --add-drop-table -- "$MYSQL_DATABASE"'],
  { stdio: ['ignore', 'pipe', 'ignore'], signal, killSignal: 'SIGKILL' })
  const exited = new Promise((resolve, reject) => {
    child.once('error', () => reject(Object.assign(new Error(), { publicMessage: '转储进程无法完成' })))
    child.once('close', code => code === 0 ? resolve() : reject(Object.assign(new Error(), { publicMessage: 'mysqldump 失败，旧备份不能代替本次结果' })))
  })
  let completed = false
  try {
    await Promise.all([pipeline(child.stdout, createGzip(), fs.createWriteStream(part, { flags: 'wx', mode: 0o600 }), { signal }), exited])
    fs.renameSync(part, file)
    syncPath(file)
    const backup = await inspectDump(file, before.tableCount, signal)
    const after = await sourceState(container, signal)
    requireProof(JSON.stringify(before) === JSON.stringify(after), '转储前后数据库身份或迁移状态变化，拒绝迁移')
    requireProof(before.tableCount > 0 || (before.migrationTableExists === 0 && before.migrations.length === 0), '无法证明首次空库状态')
    const receipt = { schemaVersion: 1, status: 'snapshot-validated', candidateSha: sha, runId: path.basename(dir), startedAt,
      completedAt: new Date().toISOString(), migrationStarted: false, restorationVerified: false,
      source: before, preMigrationStateSha256: digest(JSON.stringify(before)), backup }
    const temporaryReceipt = path.join(dir, 'receipt.json.part')
    fs.writeFileSync(temporaryReceipt, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    syncPath(temporaryReceipt)
    fs.renameSync(temporaryReceipt, path.join(dir, 'receipt.json'))
    // Persist both renames and the newly created run/backup directory entries.
    syncPath(dir)
    syncPath(path.dirname(dir))
    syncPath(path.dirname(path.dirname(dir)))
    completed = true
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    // Only this invocation's unfinished files; never daily or older deployment backups.
    for (const name of ['database.sql.gz.part', 'receipt.json.part']) fs.rmSync(path.join(dir, name), { force: true })
    if (!completed) fs.rmSync(path.join(dir, 'receipt.json'), { force: true })
  }
}

async function verifyBackup(sha, container, dir, signal) {
  const file = path.join(dir, 'receipt.json')
  privateFile(file)
  const receipt = json(fs.readFileSync(file, 'utf8'))
  requireProof(receipt.schemaVersion === 1 && receipt.status === 'snapshot-validated' && receipt.candidateSha === sha && receipt.runId === path.basename(dir) && receipt.migrationStarted === false && receipt.restorationVerified === false, '备份回执不属于本次候选/运行或状态不明')
  requireProof(Number.isFinite(Date.parse(receipt.startedAt)) && Date.parse(receipt.completedAt) >= Date.parse(receipt.startedAt), '备份回执时间无效')
  requireProof(receipt.source?.requestedContainer === container && receipt.preMigrationStateSha256 === digest(JSON.stringify(receipt.source)), '备份回执来源摘要无效')
  const actual = await inspectDump(path.join(dir, 'database.sql.gz'), receipt.source.tableCount, signal)
  requireProof(JSON.stringify(actual) === JSON.stringify(receipt.backup), '备份字节或校验摘要变化，拒绝使用旧回执')
  const current = await sourceState(container, signal)
  requireProof(JSON.stringify(current) === JSON.stringify(receipt.source), '备份后数据库身份或迁移状态变化，回执失效')
}

async function main() {
  const [operation, sha, container, directory] = process.argv.slice(2)
  const dir = path.resolve(directory || '.')
  const controller = new AbortController()
  let interruption = ''
  const interrupt = reason => { interruption = reason; controller.abort() }
  const onSignal = () => interrupt('收到中断信号')
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  process.once('SIGHUP', onSignal)
  const timer = setTimeout(() => interrupt('超过本次备份时限'), operation === 'create' ? 240000 : 20000)
  try {
    requireProof(['create', 'verify'].includes(operation) && /^[a-f0-9]{40}$/.test(sha) && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container), '备份参数无效')
    const stat = fs.lstatSync(dir)
    requireProof(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(dir) === dir && (stat.mode & 0o777) === 0o700 && stat.uid === process.getuid() && path.basename(dir).startsWith(`pre-migrate-${sha}-`), '本次备份必须使用所属进程新建的 0700 独立目录')
    if (operation === 'create') await createBackup(sha, container, dir, controller.signal)
    else await verifyBackup(sha, container, dir, controller.signal)
    requireProof(!controller.signal.aborted, '本次备份已中断')
    console.log(`==> 迁移前备份 ${operation} 完成：${path.basename(dir)}；未执行恢复演练`)
  } catch (error) {
    controller.abort()
    const code = /^[A-Z0-9_]+$/.test(error.code || '') ? ` (${error.code})` : ''
    console.error(`!! 迁移前备份/备份回执失败：${interruption || error.publicMessage || '文件或转储校验失败'}${code}；不得迁移，未证明可恢复`)
    process.exitCode = 1
  } finally {
    clearTimeout(timer)
    for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.removeListener(name, onSignal)
  }
}

if (require.main === module) main()
