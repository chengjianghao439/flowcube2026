const svc = require('./printers.service')
const { pool } = require('../../config/db')
const { getTenantId } = require('../../utils/tenantScope')

const list   = async (req, res, next) => { try { res.json({ success:true, data: await svc.findAll({ type: req.query.type ? +req.query.type : undefined, tenantId: getTenantId(req) }) }) } catch(e) { next(e) } }
const detail = async (req, res, next) => { try { res.json({ success:true, data: await svc.findById(+req.params.id, getTenantId(req)) }) } catch(e) { next(e) } }
const create = async (req, res, next) => { try { res.status(201).json({ success:true, data: await svc.create(req.body, getTenantId(req)) }) } catch(e) { next(e) } }
const update = async (req, res, next) => { try { res.json({ success:true, data: await svc.update(+req.params.id, req.body, getTenantId(req)) }) } catch(e) { next(e) } }
const remove = async (req, res, next) => { try { await svc.remove(+req.params.id, getTenantId(req)); res.json({ success:true, data:null }) } catch(e) { next(e) } }

const updateClientAlias = async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { aliasName } = req.body
    const [r] = await pool.query(
      'UPDATE print_clients SET alias_name=? WHERE client_id=?',
      [aliasName || null, clientId]
    )
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: '客户端不存在' })
    const [[row]] = await pool.query('SELECT * FROM print_clients WHERE client_id=?', [clientId])
    res.json({ success: true, data: row })
  } catch (e) { next(e) }
}

async function markOfflineClients() {
  await pool.query(
    `UPDATE print_clients
     SET status=0
     WHERE status=1 AND last_seen < DATE_SUB(NOW(), INTERVAL 30 SECOND)`
  )
}

// 获取在线客户端列表（数据库，status=online 或 30秒内有心跳）
const listOnlineClients = async (req, res, next) => {
  try {
    const tid = getTenantId(req)
    await markOfflineClients()
    const [clients] = await pool.query(
      `SELECT client_id, hostname, alias_name, ip_address, last_seen
       FROM print_clients
       WHERE status=1 OR last_seen >= DATE_SUB(NOW(), INTERVAL 30 SECOND)
       ORDER BY last_seen DESC`
    )

    const data = []
    for (const c of clients) {
      const [printers] = await pool.query(
        'SELECT name, code FROM printers WHERE client_id=? AND status=1 AND (tenant_id=? OR tenant_id=0) ORDER BY id ASC',
        [c.client_id, tid],
      )
      data.push({
        clientId: c.client_id,
        hostname: c.hostname,
        aliasName: c.alias_name,
        displayName: c.alias_name || c.hostname,
        printers,
        registeredAt: c.last_seen,
        lastSeen: new Date(c.last_seen).getTime(),
      })
    }

    res.json({ success: true, data })
  } catch (e) { next(e) }
}

// 获取所有客户端（含离线，完整历史）
const listAllClients = async (req, res, next) => {
  try {
    await markOfflineClients()
    const [rows] = await pool.query('SELECT * FROM print_clients ORDER BY last_seen DESC')
    res.json({ success: true, data: rows })
  } catch (e) { next(e) }
}

module.exports = { list, detail, create, update, remove, listOnlineClients, listAllClients, updateClientAlias }
