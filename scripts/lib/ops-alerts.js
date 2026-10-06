'use strict'

const fs = require('node:fs')
const path = require('node:path')

function writeState(filename, value) {
  const temp = filename + '.' + process.pid + '.tmp'
  try {
    fs.writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600 })
    fs.renameSync(temp, filename)
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}

function readState(filename) {
  if (!fs.existsSync(filename)) return { version: 2, observed: {}, notified: {}, restarts: {}, lastNotifiedAt: 0 }
  const raw = fs.readFileSync(filename, 'utf8').trim()
  if (/^ok(?: 0)?$/.test(raw)) return { version: 2, observed: {}, notified: {}, restarts: {}, lastNotifiedAt: 0 }
  if (/^bad(?: \d+)?$/.test(raw)) {
    return { version: 2, observed: {}, notified: { legacy: { severity: 'critical', text: '先前监控异常' } }, restarts: {}, lastNotifiedAt: 0 }
  }
  const state = JSON.parse(raw)
  if (state.version !== 2 || !state.observed || !state.notified || !state.restarts) throw new Error('监控状态格式无效')
  return state
}

function encodeMessage(content) {
  const limit = 8000
  if (Buffer.byteLength(content) > limit) {
    const suffix = '\n…消息过长，余下内容请查看监控日志。'
    let prefix = '', bytes = 0
    for (const char of content) {
      bytes += Buffer.byteLength(char)
      if (bytes > limit - Buffer.byteLength(suffix)) break
      prefix += char
    }
    content = prefix + suffix
  }
  return JSON.stringify({ msgtype: 'text', text: { content } })
}

function backupSummary(dir, now) {
  const min = Number(process.env.MIN_BYTES || 1024)
  const files = fs.readdirSync(dir).filter(f => /^flowcube_.*\.sql\.gz$/.test(f))
    .map(name => ({ name, stat: fs.statSync(path.join(dir, name)) }))
    .filter(f => f.stat.isFile() && f.stat.size >= min)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
  if (!files.length) return { missing: true, stale: true, today: false, text: '未找到体积达标的备份文件' }
  const latest = files[0], age = Math.max(0, now - latest.stat.mtimeMs / 1000)
  const today = new Date(now * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '')
  const text = `最近备份文件 ${Math.floor(age / 3600)} 小时前，${Math.ceil(latest.stat.size / 1024)} KiB（文件信息，恢复能力另验）`
  return { text, today: files.some(f => f.name.startsWith('flowcube_' + today + '_')),
    stale: age > Number(process.env.BACKUP_STALE_HOURS || 30) * 3600 }
}

function restoreSummary(dir, now) {
  const file = path.join(dir, '.restore-check.status.json')
  if (!fs.existsSync(file)) return { text: '恢复演练：未记录', issue: '' }
  const result = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!['passed', 'failed'].includes(result.status) || !Number.isFinite(result.checkedAt)) throw new Error('恢复演练记录无效')
  const date = new Date(result.checkedAt * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const issue = result.status === 'failed' ? '最近自动恢复演练失败' :
    now - result.checkedAt > 8 * 86400 ? '自动恢复演练记录超过8天' : ''
  return { text: `恢复演练：${result.status === 'passed' ? '通过' : '失败'}（${date}）`, issue }
}

function rowsToMetrics(input) {
  return Object.fromEntries(input.trim().split('\n').filter(Boolean).map(line => line.split('\t')).filter(r => r[0] === 'metric').map(r => [r[1], r.slice(2).join('\t')]))
}

function prepareMonitor(filename, input, now, remindHours, restartWarn, backupDir) {
  const state = readState(filename), observed = {}, metrics = rowsToMetrics(input)
  for (const line of input.trim().split('\n').filter(Boolean)) {
    const [type, key, value, ...rest] = line.split('\t')
    if (type === 'alert') {
      if (!/^[a-z0-9-]+$/.test(key) || !['critical', 'warning'].includes(value)) throw new Error('告警标识或等级无效')
      observed[key] = { severity: value, text: rest.join('\t') }
    } else if (type === 'restart') {
      const count = Number(rest[0]), previous = state.restarts[key]
      if (!Number.isSafeInteger(count) || count < 0 || !value) throw new Error('容器重启指标无效')
      const same = previous && previous.id === value && count >= previous.count
      const changes = same ? previous.changes.filter(c => c.at > now - 1800) : []
      if (same && count > previous.count) changes.push({ at: now, count: count - previous.count })
      state.restarts[key] = { id: value, count, changes }
      const recent = changes.reduce((sum, c) => sum + c.count, 0)
      if (recent > restartWarn) observed['restart-' + key] = { severity: 'warning', text: `容器 ${key} 近30分钟采样新增重启 ${recent} 次（阈值${restartWarn}）` }
    }
  }
  const backup = backupSummary(backupDir, now), restore = restoreSummary(backupDir, now)
  if (backup.stale) observed['backup-stale'] = { severity: 'critical', text: backup.missing ? backup.text : '最近备份文件超过新鲜度阈值（默认30小时）' }
  if (restore.issue) observed['restore-check'] = { severity: 'warning', text: restore.issue }
  const notified = state.notified
  const changed = Object.keys(observed).some(key => notified[key]?.severity !== observed[key].severity) ||
    Object.keys(notified).some(key => !observed[key])
  const reminder = Object.keys(observed).length > 0 && remindHours > 0 && now - state.lastNotifiedAt >= remindHours * 3600
  const recovered = Object.keys(notified).filter(key => !observed[key]).map(key => notified[key].text)
  state.observed = observed
  state.metrics = metrics
  state.checkedAt = now
  writeState(filename, state)
  if (!changed && !reminder) return ''
  const critical = Object.values(observed).some(a => a.severity === 'critical')
  const ordered = Object.values(observed).sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical'))
  const title = !ordered.length ? '✅ 极序 Flow｜服务已恢复正常' : critical ? '🔴 极序 Flow｜服务异常' : '⚠️ 极序 Flow｜服务器预警'
  const timestamp = new Date(now * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const impact = critical ? '服务可用性或数据安全异常，请及时核对' : ordered.length ? '服务探针可用，存在待处理预警' : '本轮监控异常已全部解除'
  return [`${title}\n时间：${timestamp}`, `影响：${impact}`,
    `异常：${ordered.length ? '\n' + ordered.map(a => '· ' + a.text).join('\n') : '无'}`,
    ...(recovered.length ? ['恢复项：' + recovered.join('；')] : []),
    `数据安全：${backup.text}；${restore.text}`,
    `服务：公网 HTTP ${metrics.public || '未知'}；后端 HTTP ${metrics.backend || '未知'}`,
    `资源：磁盘使用率 ${metrics.disk || '未知'}%；MySQL连接 ${metrics.connections || '未知'}；近24小时慢查询 ${metrics.slow || '未知'} 条（性能摘要）`,
    '处理位置：服务器监控日志与故障恢复预案；先查日志，再处理异常。',
  ].join('\n')
}

function acknowledgeMonitor(filename, now) {
  const state = readState(filename)
  state.notified = state.observed
  state.lastNotifiedAt = now
  writeState(filename, state)
}

function dailyReport(input, stateFile, backupDir, now) {
  const metrics = rowsToMetrics(input), backup = backupSummary(backupDir, now), restore = restoreSummary(backupDir, now)
  const state = readState(stateFile)
  const fresh = Number.isFinite(state.checkedAt) && now >= state.checkedAt && now - state.checkedAt <= 900
  const issues = []
  if (metrics.up !== metrics.total || metrics.backend !== '200') issues.push('容器或后端检查异常')
  if (backup.missing || !backup.today) issues.push('今日没有体积达标的备份文件')
  if (Number(metrics.disk) >= Number(process.env.DISK_THRESHOLD || 85)) issues.push('磁盘使用率达到预警阈值')
  if (!/^\d+$/.test(metrics.disk || '')) issues.push('磁盘指标未能读取')
  if (restore.issue) issues.push(restore.issue)
  if (!fresh) issues.push('监控采样缺失或已超过15分钟')
  else issues.push(...Object.values(state.observed).map(a => a.text))
  const time = new Date(now * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const slow = fresh ? (state.metrics?.slow || '未知') : '待核实'
  if (!issues.length) return `✅ 极序 Flow｜每日巡检 ${time}｜服务正常｜${backup.text}｜磁盘 ${metrics.disk}%｜近24小时慢查询 ${slow} 条｜${restore.text}`
  return [`⚠️ 极序 Flow｜每日巡检 ${time}`, '影响：存在待核对事项',
    '异常：\n' + [...new Set(issues)].map(i => '· ' + i).join('\n'),
    `数据安全：${backup.text}；${restore.text}`,
    `服务：容器 ${metrics.up}/${metrics.total} 运行；后端 HTTP ${metrics.backend}`,
    `资源：磁盘 ${metrics.disk}%；近24小时慢查询 ${slow} 条（性能摘要）`,
    '本条证明日报任务已执行；监控、备份和服务状态以以上检查结果为准。',
  ].join('\n')
}

if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'encode') process.stdout.write(encodeMessage(fs.readFileSync(0, 'utf8')))
    else if (command === 'accepted') process.exit(JSON.parse(fs.readFileSync(0, 'utf8')).errcode === 0 ? 0 : 1)
    else if (command === 'monitor') process.stdout.write(prepareMonitor(args[0], fs.readFileSync(0, 'utf8'), Number(args[1]), Number(args[2]), Number(args[3]), args[4]))
    else if (command === 'ack') acknowledgeMonitor(args[0], Number(args[1]))
    else if (command === 'daily') process.stdout.write(dailyReport(fs.readFileSync(0, 'utf8'), args[0], args[1], Number(args[2])))
    else if (command === 'restore') writeState(args[0], { status: args[1], checkedAt: Math.floor(Date.now() / 1000) })
    else throw new Error('未知运维消息命令')
  } catch {
    console.error('运维消息编码或状态读写失败，请检查 Node 22、文件权限与状态格式。')
    process.exitCode = 1
  }
}

module.exports = { encodeMessage, prepareMonitor, acknowledgeMonitor, dailyReport }
