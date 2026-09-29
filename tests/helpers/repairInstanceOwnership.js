'use strict'

/**
 * 修复专项 smoke 的「本批临时实例」归属门（2026-09-29 越界写入事故后新增）。
 *
 * 背景：`tests/legacy-purchase-repair.smoke.test.js`、`tests/legacy-receivable-repair.smoke.test.js`
 * 与复合命令内的 `tests/audit-business-consistency.smoke.test.js` 会对 16 张表做（部分）无 `WHERE`
 * 的全表清理与写入，而它们的 `cleanup()` 在 **try 之外或 try 首行**执行。库名硬断言
 * （`config.database === 'flowcube_repair20260908_test'`）只能证明「库名对」，**证明不了「这个库
 * 归本批所有」**：同一库名在本机回环 3307 的既有实例上同样成立，2026-09-29 因此误清了旧库。
 *
 * 归属证据（经两轮独立审查收紧，只认机械可判定的那些）：
 *   1. 连接端口不是本机共享 / 长期实例端口（3307 开发实例、3306 旧实例）；
 *   2. 存在 runner 以 `O_EXCL` 落盘的 0600 归属文件（`FLOWCUBE_REPAIR_INSTANCE_FILE`，属主当前用户）；
 *   3. 文件记录的 host / hostPort / database 与实际连接完全一致；
 *   4. 对文件记录的容器 ID 只读 `docker inspect`：容器**存在且在运行**、`Id` 与文件一致、
 *      `Created` 与文件记录一致、名字一致、带本批 label（`flowcube.repair.batch` 与
 *      `flowcube.repair.role=ephemeral-smoke`）、挂载本批数据卷到 `/var/lib/mysql`、
 *      `3306/tcp` 的实时回环端口映射等于本次连接端口；
 *   5. 对文件记录的卷名只读 `docker volume inspect`：卷存在、名字一致、`CreatedAt` 与文件一致、
 *      且卷**自身**带同一本批 label（防止「新容器挂旧卷」）；
 *   6. 容器、卷、归属文件的创建时间都落在**同一次运行的时间窗**内（防止复用上次运行留下的
 *      旧容器 + 旧证明文件「旧同批放行」）；
 *   7. **本轮活跃归属**：文件记录的 runner PID 进程必须**实时存活**，且其 `ps -o lstart=` 启动
 *      身份与文件记录一致——时间窗挡不住「runner 刚退出/异常中止后留下的残留文件」，而进程存活
 *      + 启动身份既排除「runner 已不在」，也排除「PID 被复用成另一个进程」；
 *   8. 实例实时 `@@server_uuid` 与文件一致。
 *
 * 明确**不作为**证据：库名以 `_test` 结尾、`CREATE DATABASE IF NOT EXISTS`、单独一个可自填的
 * 环境变量、「表当前为空」（事故文档 §3：不能由「现在 0 行」反推「执行前也为 0」）。
 *
 * 威胁边界（如实登记，不夸大）：本门针对**误用与残留**——把 smoke 指向既有库、复用上次运行的
 * 容器/卷/证明文件、runner 中止后残留的证明。**不要求**抵抗同机 root 的蓄意篡改（那种攻击能改
 * docker 状态、进程表与文件系统，单机无法机械区分），也不为此引入任何持久化框架。
 */

const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

/** 本机共享 / 长期实例端口。3307 见 `scripts/mysql8-dev.sh`（flowcube-dev-mysql8）；3306 为迁移前旧实例。 */
const SHARED_INSTANCE_PORTS = Object.freeze([3306, 3307])

/** 归属文件的路径变量名。runner 以 `O_EXCL` 创建，测试只读。 */
const OWNERSHIP_FILE_ENV = 'FLOWCUBE_REPAIR_INSTANCE_FILE'
/** docker context 名（不是证据，只是「去哪找 docker」；与本批 runner 保持一致）。 */
const DOCKER_CONTEXT_ENV = 'FLOWCUBE_REPAIR_DOCKER_CONTEXT'
const DEFAULT_DOCKER_CONTEXT = 'colima-flowcube'

/** 本批容器/卷必须携带的 label；runner 在创建时写入。 */
const BATCH_LABEL = 'flowcube.repair.batch'
const ROLE_LABEL = 'flowcube.repair.role'
const ROLE_VALUE = 'ephemeral-smoke'

/**
 * 「同一次运行」的允许跨度：容器、卷、归属文件的创建时间两两之差、以及归属文件到现在的间隔
 * 都必须在此之内。取值只影响「能否跨运行复用残留」，不影响正常运行（本批从建容器到跑完
 * 只有数分钟）。残留的旧容器通常是数小时/数天前创建的，会被明确拒绝。
 */
const OWNERSHIP_WINDOW_MS = 2 * 60 * 60 * 1000
/** 归属文件允许比容器/卷稍晚落盘，但不得早于它们（容忍容器内时钟与宿主机的秒级偏差）。 */
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000

/** 归属文件必须记录的字段；缺任一即拒绝。 */
const REQUIRED_EVIDENCE_KEYS = Object.freeze([
  'batchId', 'containerId', 'containerName', 'containerCreatedAt',
  'volumeName', 'volumeCreatedAt', 'host', 'hostPort', 'serverUuid', 'database', 'createdAt',
  'runnerPid', 'runnerStarted',
])

const GUARD_TAG = '[repair-instance-guard]'

function describe(value) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

function parseTime(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** 把 `docker inspect` 的原始 JSON 归一化成判定所需的最小结构。 */
function normalizeInspect(info) {
  if (!info || typeof info !== 'object') return null
  const ports = []
  for (const [key, bindings] of Object.entries(info.NetworkSettings?.Ports || {})) {
    const containerPort = Number(String(key).split('/')[0])
    for (const b of bindings || []) ports.push({ containerPort, hostIp: b.HostIp, hostPort: b.HostPort })
  }
  return {
    id: info.Id,
    name: String(info.Name || '').replace(/^\//, ''),
    running: info.State?.Running === true,
    labels: info.Config?.Labels || {},
    mounts: (info.Mounts || []).map((m) => ({ name: m.Name, destination: m.Destination })),
    ports,
    created: info.Created,
  }
}

/** 把 `docker volume inspect` 的原始 JSON 归一化成判定所需的最小结构。 */
function normalizeVolumeInspect(info) {
  if (!info || typeof info !== 'object') return null
  return { name: info.Name, labels: info.Labels || {}, createdAt: info.CreatedAt, driver: info.Driver }
}

/** 默认探针：只读 `docker inspect`。失败（无 docker / 容器不存在 / 超时）即抛错，由调用方判为拒绝。 */
function dockerInspect(containerId, { context = DEFAULT_DOCKER_CONTEXT } = {}) {
  const raw = execFileSync(
    'docker',
    ['--context', context, 'inspect', containerId],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 },
  )
  const parsed = JSON.parse(raw)
  return normalizeInspect(Array.isArray(parsed) ? parsed[0] : parsed)
}

/** 默认探针：只读 `docker volume inspect`。 */
function dockerVolumeInspect(volumeName, { context = DEFAULT_DOCKER_CONTEXT } = {}) {
  const raw = execFileSync(
    'docker',
    ['--context', context, 'volume', 'inspect', volumeName],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 },
  )
  const parsed = JSON.parse(raw)
  return normalizeVolumeInspect(Array.isArray(parsed) ? parsed[0] : parsed)
}

/** 进程启动身份的规范化：只去首尾与压缩内部空白，两侧用同一口径即可逐字比较。 */
function normalizePsStart(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ')
  return normalized || null
}

/**
 * 默认探针：`ps -o lstart=` 读取某 PID 的**启动身份**。
 * 进程不存在（或 `ps` 不可用）即返回 `{ alive: false }` —— fail-loud，绝不当成「通过」。
 */
function probeRunnerProcess(pid) {
  try {
    const out = execFileSync(
      'ps',
      ['-p', String(pid), '-o', 'lstart='],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 },
    )
    const startedAt = normalizePsStart(out)
    if (!startedAt) return { alive: false, startedAt: null }
    return { alive: true, startedAt }
  } catch {
    return { alive: false, startedAt: null }
  }
}

/**
 * 纯判定（不做任何 I/O，便于离线契约测试与反向验证）。返回 `{ ok: true }` 或 `{ ok: false, reason }`。
 *
 * @param {object} input
 * @param {{host:string, port:number|string, database:string}} input.config 实际连接配置
 * @param {string|undefined} input.evidenceFile 归属文件路径（来自 env）
 * @param {object|null} input.evidence 归属文件解析结果
 * @param {{mode:number, uid:number}|null} input.fileStat 归属文件 stat
 * @param {{serverUuid:string}|null} input.instance 实例实时只读探测结果
 * @param {object|null} input.container `docker inspect` 归一化结果
 * @param {object|null} input.volume `docker volume inspect` 归一化结果
 * @param {string|null} input.containerProbeError 容器探针失败原因
 * @param {string|null} input.volumeProbeError 卷探针失败原因
 * @param {{alive:boolean, startedAt:string|null}|null} input.runner runner 进程实时探测结果
 * @param {number|null} input.uid 当前进程 uid（Windows 为 null，此时跳过属主校验）
 * @param {number} [input.now] 判定时刻（毫秒）；默认 `Date.now()`，测试可注入固定值
 */
function evaluateOwnership(input) {
  const {
    config, evidenceFile, evidence, fileStat, instance, container, volume,
    containerProbeError, volumeProbeError, runner, uid, now = Date.now(),
  } = input || {}
  const deny = (reason) => ({ ok: false, reason })
  const allow = () => ({ ok: true })

  if (!config || typeof config !== 'object') return deny('缺少连接配置')
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
    return deny(`DB_HOST 必须是本机回环地址，实际为 ${describe(config.host)}`)
  }

  const port = Number(config.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return deny(`DB_PORT 非法：${describe(config.port)}`)
  if (SHARED_INSTANCE_PORTS.includes(port)) {
    return deny(`DB_PORT=${port} 是本机共享/长期实例端口；修复专项 smoke 含全表清理，禁止在其上运行`)
  }

  if (!evidenceFile || typeof evidenceFile !== 'string') {
    return deny(`未提供归属文件路径（须由本批 runner 通过 ${OWNERSHIP_FILE_ENV} 指定）`)
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return deny('归属文件缺失、无法解析或不是 JSON 对象')
  }
  if (!fileStat || typeof fileStat !== 'object') return deny('无法读取归属文件状态')

  const missing = REQUIRED_EVIDENCE_KEYS.filter((k) => evidence[k] === undefined || evidence[k] === null || evidence[k] === '')
  if (missing.length) return deny(`归属文件缺少字段：${missing.join(', ')}`)

  if ((fileStat.mode & 0o077) !== 0) return deny('归属文件权限过宽（必须 0600，仅当前用户可读）')
  if (uid !== null && uid !== undefined && fileStat.uid !== uid) {
    return deny('归属文件属主不是当前用户')
  }

  if (evidence.host !== config.host) {
    return deny(`归属文件 host=${describe(evidence.host)} 与实际连接 ${describe(config.host)} 不一致`)
  }
  if (Number(evidence.hostPort) !== port) {
    return deny(`归属文件 hostPort=${describe(evidence.hostPort)} 与实际连接端口 ${port} 不一致`)
  }
  if (evidence.database !== config.database) {
    return deny(`归属文件 database=${describe(evidence.database)} 与实际连接 ${describe(config.database)} 不一致`)
  }

  // —— 时间窗：拒绝「上次运行残留的旧容器 + 旧证明文件」——
  const evidenceMs = parseTime(evidence.createdAt)
  if (evidenceMs === null) return deny(`归属文件 createdAt 非法：${describe(evidence.createdAt)}`)
  if (!Number.isFinite(now)) return deny('判定时刻非法')
  if (evidenceMs - now > CLOCK_TOLERANCE_MS) return deny('归属文件 createdAt 晚于当前时间（时钟异常）')
  if (now - evidenceMs > OWNERSHIP_WINDOW_MS) {
    return deny('归属文件超出本次运行时间窗（疑似上次运行残留的旧证明）')
  }

  // —— 本轮活跃归属：runner 进程必须仍然存活，且启动身份与文件一致 ——
  // 时间窗只能挡住「很久以前的残留」；runner 刚退出/异常中止留下的文件仍在窗内，
  // 只有「进程实时存活 + 启动身份匹配」才能证明这是**本轮**仍在进行的那次运行。
  const runnerPid = Number(evidence.runnerPid)
  if (!Number.isInteger(runnerPid) || runnerPid <= 0) {
    return deny(`归属文件 runnerPid 非法：${describe(evidence.runnerPid)}`)
  }
  if (!runner || typeof runner !== 'object' || runner.alive !== true) {
    return deny('runner 进程不存活——归属证明疑似本轮运行终止后残留')
  }
  if (!runner.startedAt) return deny('无法读取 runner 进程启动身份')
  if (runner.startedAt !== evidence.runnerStarted) {
    return deny(`runner 启动身份不匹配（PID ${runnerPid} 可能已被复用）`)
  }

  // —— 容器交叉核验 ——
  if (containerProbeError) return deny(`无法核验容器归属：${containerProbeError}`)
  if (!container || typeof container !== 'object') {
    return deny('未取得容器信息（拒绝：无法证明目标为本批新建的容器）')
  }
  if (container.id !== evidence.containerId) {
    return deny(`容器 Id=${describe(container.id)} 与归属文件 ${describe(evidence.containerId)} 不一致`)
  }
  if (container.running !== true) return deny('本批容器未在运行')
  if (container.name !== evidence.containerName) {
    return deny(`容器名 ${describe(container.name)} 与归属文件 ${describe(evidence.containerName)} 不一致`)
  }
  const containerMs = parseTime(container.created)
  if (containerMs === null) return deny('容器创建时间缺失或非法')
  if (Math.abs(containerMs - evidenceMs) > OWNERSHIP_WINDOW_MS) {
    return deny('容器创建时间与归属文件不在同一次运行内（疑似残留旧容器）')
  }
  if (containerMs - evidenceMs > CLOCK_TOLERANCE_MS) {
    return deny('容器创建时间晚于归属文件落盘时间（时钟或换容器异常）')
  }
  if (parseTime(evidence.containerCreatedAt) === null || containerMs !== parseTime(evidence.containerCreatedAt)) {
    return deny(`容器 Created=${describe(container.created)} 与归属文件 ${describe(evidence.containerCreatedAt)} 不一致`)
  }
  if (container.labels?.[BATCH_LABEL] !== evidence.batchId) {
    return deny(`容器缺少本批 label（${BATCH_LABEL}=${describe(evidence.batchId)}）`)
  }
  if (container.labels?.[ROLE_LABEL] !== ROLE_VALUE) {
    return deny(`容器缺少本批角色 label（${ROLE_LABEL}=${ROLE_VALUE}）`)
  }
  const mounted = (container.mounts || []).some((m) => m.name === evidence.volumeName && m.destination === '/var/lib/mysql')
  if (!mounted) {
    return deny(`容器未挂载本批数据卷 ${describe(evidence.volumeName)} 到 /var/lib/mysql`)
  }
  const mapped = (container.ports || []).some(
    (p) => p.containerPort === 3306 && p.hostIp === '127.0.0.1' && String(p.hostPort) === String(evidence.hostPort),
  )
  if (!mapped) {
    return deny(`容器 3306/tcp 未映射到回环 ${describe(evidence.hostPort)}——端口映射与归属文件不符`)
  }

  // —— 数据卷交叉核验：防止「新容器挂旧数据」——
  if (volumeProbeError) return deny(`无法核验数据卷归属：${volumeProbeError}`)
  if (!volume || typeof volume !== 'object') {
    return deny('未取得数据卷信息（拒绝：无法证明本批数据卷归属）')
  }
  if (volume.name !== evidence.volumeName) {
    return deny(`数据卷名 ${describe(volume.name)} 与归属文件 ${describe(evidence.volumeName)} 不一致`)
  }
  if (volume.labels?.[BATCH_LABEL] !== evidence.batchId) {
    return deny(`数据卷缺少本批 label（${BATCH_LABEL}=${describe(evidence.batchId)}）`)
  }
  if (volume.labels?.[ROLE_LABEL] !== ROLE_VALUE) {
    return deny(`数据卷缺少本批角色 label（${ROLE_LABEL}=${ROLE_VALUE}）`)
  }
  const volumeMs = parseTime(volume.createdAt)
  if (volumeMs === null) return deny('数据卷创建时间缺失或非法')
  if (Math.abs(volumeMs - evidenceMs) > OWNERSHIP_WINDOW_MS) {
    return deny('数据卷创建时间与归属文件不在同一次运行内（疑似复用旧卷）')
  }
  if (parseTime(evidence.volumeCreatedAt) === null || volumeMs !== parseTime(evidence.volumeCreatedAt)) {
    return deny(`数据卷 CreatedAt=${describe(volume.createdAt)} 与归属文件 ${describe(evidence.volumeCreatedAt)} 不一致`)
  }

  // —— 实例实时身份 ——
  if (!instance || typeof instance !== 'object' || !instance.serverUuid) {
    return deny('无法读取实例身份（连接失败或 @@server_uuid 查询失败）')
  }
  if (instance.serverUuid !== evidence.serverUuid) {
    return deny(
      `实例 server_uuid=${describe(instance.serverUuid)} 与归属文件记录的 ${describe(evidence.serverUuid)} 不一致`,
    )
  }

  return allow()
}

/**
 * 写入前归属门：读取归属文件、只读探测实例身份与容器/卷归属、判定；不通过即抛出。
 * **必须在任何写入之前调用**——抛出后调用方不得进入 cleanup / 种子 / 迁移（只关闭连接）。
 *
 * @param {{query: Function}|null} conn 已建立的 mysql2 连接（仅执行 `SELECT @@server_uuid`）
 * @param {{env?: object, config: object, inspectContainer?: Function, inspectVolume?: Function,
 *          uid?: number|null, now?: number}} options
 */
async function assertOwnedRepairInstance(conn, options = {}) {
  const env = options.env || process.env
  const config = options.config
  const inspectContainer = options.inspectContainer || dockerInspect
  const inspectVolume = options.inspectVolume || dockerVolumeInspect
  const probeRunner = options.probeRunner || probeRunnerProcess
  const context = env[DOCKER_CONTEXT_ENV] || DEFAULT_DOCKER_CONTEXT
  const evidenceFile = env[OWNERSHIP_FILE_ENV]
  const uid = options.uid !== undefined
    ? options.uid
    : (typeof process.getuid === 'function' ? process.getuid() : null)

  let evidence = null
  let fileStat = null
  if (evidenceFile && typeof evidenceFile === 'string') {
    try {
      fileStat = fs.statSync(evidenceFile)
      evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'))
    } catch {
      // 交由判定统一拒绝：文件缺失、不可读或非法 JSON 都必须表现为「不通过」。
      evidence = null
      fileStat = null
    }
  }

  let container = null
  let containerProbeError = null
  if (evidence && evidence.containerId) {
    try {
      container = await inspectContainer(evidence.containerId, { context })
      if (!container) containerProbeError = 'docker inspect 未返回容器信息'
    } catch (err) {
      containerProbeError = err && err.message ? err.message : String(err)
    }
  }

  let volume = null
  let volumeProbeError = null
  if (evidence && evidence.volumeName) {
    try {
      volume = await inspectVolume(evidence.volumeName, { context })
      if (!volume) volumeProbeError = 'docker volume inspect 未返回卷信息'
    } catch (err) {
      volumeProbeError = err && err.message ? err.message : String(err)
    }
  }

  let instance = null
  if (conn && evidence) {
    try {
      const [rows] = await conn.query('SELECT @@server_uuid AS serverUuid')
      const row = Array.isArray(rows) ? rows[0] : rows
      instance = { serverUuid: row && row.serverUuid }
    } catch {
      instance = null
    }
  }

  let runner = null
  if (evidence && evidence.runnerPid) {
    try {
      runner = await probeRunner(Number(evidence.runnerPid))
    } catch {
      runner = { alive: false, startedAt: null }
    }
  }

  const verdict = evaluateOwnership({
    config, evidenceFile, evidence, fileStat, instance, container, volume,
    containerProbeError, volumeProbeError, runner, uid, now: options.now,
  })
  if (!verdict.ok) {
    throw new Error(`${GUARD_TAG} 拒绝写入（未证明目标为本批新建的临时容器）：${verdict.reason}`)
  }
  return {
    batchId: evidence.batchId,
    containerId: evidence.containerId,
    volumeName: evidence.volumeName,
    serverUuid: evidence.serverUuid,
    port: Number(evidence.hostPort),
    database: evidence.database,
  }
}

module.exports = {
  SHARED_INSTANCE_PORTS,
  OWNERSHIP_FILE_ENV,
  DOCKER_CONTEXT_ENV,
  DEFAULT_DOCKER_CONTEXT,
  BATCH_LABEL,
  ROLE_LABEL,
  ROLE_VALUE,
  OWNERSHIP_WINDOW_MS,
  REQUIRED_EVIDENCE_KEYS,
  normalizeInspect,
  normalizeVolumeInspect,
  normalizePsStart,
  dockerInspect,
  dockerVolumeInspect,
  probeRunnerProcess,
  evaluateOwnership,
  assertOwnedRepairInstance,
}
