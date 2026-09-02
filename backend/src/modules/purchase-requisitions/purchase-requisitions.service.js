const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { normalizePagination } = require('../../utils/pagination')
const approvalEngine = require('../../engine/approvalEngine')
const { assertNotSelfApproval } = require('../../utils/selfApprove')

/**
 * 采购请购单（PR → 审批 → 转生成采购单）。
 *
 * 审批范式：有匹配多级审批流时走 engine/approvalEngine（可配置节点序列、金额分级）；
 * 无匹配流程时退回单级审批（transition 骨架，照 expenseClaim）。纯需求单据：不碰库存、不进
 * payment_records；实际供应商与价格在转单(convert)时定。
 * 状态：1草稿 2待审批 3已批准 4已驳回 5已取消 6已转采购；一律走 assertStatusAction + compareAndSetStatus。
 */

const STATUS = { DRAFT: 1, PENDING: 2, APPROVED: 3, REJECTED: 4, CANCELLED: 5, CONVERTED: 6 }
const STATUS_NAME = { 1: '草稿', 2: '待审批', 3: '已批准', 4: '已驳回', 5: '已取消', 6: '已转采购' }
const STATUS_TONE = { 1: 'draft', 2: 'warning', 3: 'active', 4: 'danger', 5: 'draft', 6: 'success' }

const genOrderNo = conn => generateDailyCode(conn, 'PO', 'purchase_orders', 'order_no')

function fmtRequisition(row) {
  return {
    id: Number(row.id),
    requisitionNo: row.requisition_no,
    title: row.title,
    warehouseId: Number(row.warehouse_id),
    warehouseName: row.warehouse_name,
    applicantId: Number(row.applicant_id),
    applicantName: row.applicant_name,
    estimatedAmount: Number(row.estimated_amount),
    status: Number(row.status),
    statusName: STATUS_NAME[Number(row.status)],
    statusTone: STATUS_TONE[Number(row.status)],
    source: row.source,
    itemCount: row.item_count != null ? Number(row.item_count) : undefined,
    submittedAt: row.submitted_at,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    rejectReason: row.reject_reason,
    expectedDate: row.expected_date,
    remark: row.remark,
    createdAt: row.created_at,
  }
}

/** 预估金额之和写回单头（估算，仅参考）。明细变动后调用，调用方已在事务内。 */
async function refreshTotal(conn, requisitionId) {
  const [[agg]] = await conn.query(
    'SELECT COALESCE(SUM(quantity * COALESCE(estimated_price,0)),0) AS total FROM purchase_requisition_items WHERE requisition_id=?',
    [requisitionId],
  )
  await conn.query('UPDATE purchase_requisitions SET estimated_amount=? WHERE id=?', [Number(agg.total), requisitionId])
  return Number(agg.total)
}

/** 明细整体替换（草稿态才允许，由调用方先校验状态）。从 product_items 取商品快照。 */
async function replaceItems(conn, requisitionId, items) {
  await conn.query('DELETE FROM purchase_requisition_items WHERE requisition_id=?', [requisitionId])
  for (const it of items) {
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) throw new AppError('请购数量必须大于 0', 400)
    const [[p]] = await conn.query(
      'SELECT id,code,name,unit,spec FROM product_items WHERE id=? AND deleted_at IS NULL',
      [Number(it.productId)],
    )
    if (!p) throw new AppError(`商品 ${it.productId} 不存在`, 404)
    let supplierName = null
    if (it.suggestedSupplierId) {
      const [[s]] = await conn.query('SELECT name FROM supply_suppliers WHERE id=? AND deleted_at IS NULL', [Number(it.suggestedSupplierId)])
      supplierName = s?.name || null
    }
    const price = it.estimatedPrice == null || it.estimatedPrice === '' ? null : Number(it.estimatedPrice)
    await conn.query(
      `INSERT INTO purchase_requisition_items
        (requisition_id,product_id,product_code,product_name,unit,spec,quantity,estimated_price,suggested_supplier_id,suggested_supplier_name,remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [requisitionId, p.id, p.code, p.name, p.unit, p.spec || null, qty, price, it.suggestedSupplierId || null, supplierName, it.remark || null],
    )
  }
  return refreshTotal(conn, requisitionId)
}

async function create({ title, warehouseId, expectedDate, source = 'manual', items = [], remark }, operator) {
  if (!items.length) throw new AppError('请至少填写一条请购明细', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[wh]] = await conn.query('SELECT id,name FROM inventory_warehouses WHERE id=? AND deleted_at IS NULL', [Number(warehouseId)])
    if (!wh) throw new AppError('期望入库仓不存在', 400)
    assertInScope(operator?.warehouseIds ?? null, wh.id, '请购单')
    const requisitionNo = await generateDailyCode(conn, 'PR', 'purchase_requisitions', 'requisition_no')
    const [r] = await conn.query(
      `INSERT INTO purchase_requisitions
        (requisition_no,title,warehouse_id,warehouse_name,applicant_id,applicant_name,status,source,expected_date,remark)
       VALUES (?,?,?,?,?,?,1,?,?,?)`,
      [requisitionNo, title || null, wh.id, wh.name, operator.operatorId, operator.operatorName, source, expectedDate || null, remark || null],
    )
    const total = await replaceItems(conn, r.insertId, items)
    await conn.commit()
    return { id: r.insertId, requisitionNo, estimatedAmount: total }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function update(id, { title, warehouseId, expectedDate, items, remark }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'purchase_requisitions', id, columns: 'id, status, applicant_id, warehouse_id', entityName: '请购单' })
    if (Number(operator?.roleId) !== 1 && Number(row.applicant_id) !== Number(operator?.operatorId)) {
      throw new AppError('只能编辑本人提交的请购单', 403)
    }
    assertStatusAction('purchaseRequisition', 'edit', row.status)
    let wh = null
    if (warehouseId) {
      const [[w]] = await conn.query('SELECT id,name FROM inventory_warehouses WHERE id=? AND deleted_at IS NULL', [Number(warehouseId)])
      if (!w) throw new AppError('期望入库仓不存在', 400)
      assertInScope(operator?.warehouseIds ?? null, w.id, '请购单')
      wh = w
    }
    await conn.query(
      'UPDATE purchase_requisitions SET title=?, expected_date=?, remark=?' + (wh ? ', warehouse_id=?, warehouse_name=?' : '') + ' WHERE id=?',
      wh ? [title || null, expectedDate || null, remark || null, wh.id, wh.name, id] : [title || null, expectedDate || null, remark || null, id],
    )
    if (Array.isArray(items)) {
      if (!items.length) throw new AppError('请至少填写一条请购明细', 400)
      await replaceItems(conn, id, items)
    }
    await conn.commit()
    return { id: Number(id) }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function assertOwner(id, operator) {
  const [[row]] = await pool.query('SELECT applicant_id FROM purchase_requisitions WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('请购单不存在', 404)
  if (Number(operator?.roleId) === 1) return
  if (Number(row.applicant_id) !== Number(operator?.operatorId)) throw new AppError('只能操作本人提交的请购单', 403)
}

/**
 * 提交审批：草稿 → 待审批。
 * 若配置了匹配金额区间的多级审批流 → 同事务建审批实例（请购保持待审批2，后续 approve/reject 走引擎）；
 * 无匹配流程 → 原单级审批（行为不变）。
 */
async function submit(id, operator) {
  await assertOwner(id, operator)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'purchase_requisitions', id,
      columns: 'id, requisition_no, status, applicant_id, applicant_name, estimated_amount, warehouse_id',
      entityName: '请购单',
    })
    assertInScope(operator?.warehouseIds ?? null, row.warehouse_id, '请购单')
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM purchase_requisition_items WHERE requisition_id=?', [id])
    if (Number(n) === 0) throw new AppError('请购单无明细，请先填写请购商品', 400)
    const rule = assertStatusAction('purchaseRequisition', 'submit', row.status)
    await compareAndSetStatus(conn, { table: 'purchase_requisitions', id, fromStatus: rule.from, toStatus: rule.to, entityName: '请购单' })
    await conn.query('UPDATE purchase_requisitions SET submitted_at=NOW() WHERE id=?', [id])

    const inst = await approvalEngine.startApproval(conn, {
      bizType: 'purchase_requisition',
      bizId: id,
      amount: Number(row.estimated_amount),
      applicantId: Number(row.applicant_id),
      applicantName: row.applicant_name,
    })
    await conn.commit()
    return { id: Number(id), status: rule.to, requisitionNo: row.requisition_no, multiLevel: !!inst, instanceId: inst?.instanceId ?? null, flowName: inst?.flowName ?? null, totalSteps: inst?.totalSteps ?? null }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function withdraw(id, operator) {
  await assertOwner(id, operator)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'purchase_requisitions', id, columns: 'id, status, applicant_id, warehouse_id', entityName: '请购单',
    })
    assertInScope(operator?.warehouseIds ?? null, row.warehouse_id, '请购单')
    // 有活跃审批实例 → 撤销实例（同事务）
    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'purchase_requisition', bizId: id })
    if (active) await approvalEngine.cancelInstance(conn, { instanceId: active.instance.id, operator })
    const rule = assertStatusAction('purchaseRequisition', 'withdraw', row.status)
    await compareAndSetStatus(conn, { table: 'purchase_requisitions', id, fromStatus: rule.from, toStatus: rule.to, entityName: '请购单' })
    await conn.query('UPDATE purchase_requisitions SET submitted_at=NULL WHERE id=?', [id])
    await conn.commit()
    return { id: Number(id), status: rule.to, requisitionNo: row.requisition_no }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function cancel(id, operator) {
  await assertOwner(id, operator)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'purchase_requisitions', id, columns: 'id, status, applicant_id, warehouse_id', entityName: '请购单',
    })
    assertInScope(operator?.warehouseIds ?? null, row.warehouse_id, '请购单')
    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'purchase_requisition', bizId: id })
    if (active) await approvalEngine.cancelInstance(conn, { instanceId: active.instance.id, operator })
    const rule = assertStatusAction('purchaseRequisition', 'cancel', row.status)
    await compareAndSetStatus(conn, { table: 'purchase_requisitions', id, fromStatus: rule.from, toStatus: rule.to, entityName: '请购单' })
    await conn.commit()
    return { id: Number(id), status: rule.to, requisitionNo: row.requisition_no }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/**
 * 审批通过。
 * 多级路径：有活跃审批实例 → approveStep 推进当前节点；实例最终通过时才把请购 2→3 已批准；
 *          实例仍在审批中 → 请购保持待审批2（下一级审批继续调本接口推进）。
 * 单级路径：无实例 → 原逻辑直接 2→3。
 * 两种路径都校验「审批人不能是申请人本人」（引擎内另有节点审批人硬校验）。
 */
async function approve(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'purchase_requisitions', id,
      columns: 'id, status, applicant_id, warehouse_id, estimated_amount', entityName: '请购单',
    })
    assertInScope(operator?.warehouseIds ?? null, row.warehouse_id, '请购单')
    await assertNotSelfApproval(row.applicant_id, operator.operatorId, '不能审批自己提交的请购单，请由他人审批')
    const rule = assertStatusAction('purchaseRequisition', 'approve', row.status)

    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'purchase_requisition', bizId: id })
    if (active) {
      // 多级路径：推进当前节点
      const r = await approvalEngine.approveStep(conn, { instanceId: active.instance.id, operator, comment: null })
      // 实例最终通过 → 请购 2→3；仍在审批中 → 请购保持 2
      if (Number(r.status) === approvalEngine.INSTANCE_STATUS.APPROVED) {
        await compareAndSetStatus(conn, { table: 'purchase_requisitions', id, fromStatus: rule.from, toStatus: rule.to, entityName: '请购单' })
        await conn.query(
          'UPDATE purchase_requisitions SET approved_by=?,approved_by_name=?,approved_at=NOW(),reject_reason=NULL WHERE id=?',
          [operator.operatorId, operator.operatorName, id],
        )
      }
      await conn.commit()
      return { id: Number(id), status: Number(r.status) === approvalEngine.INSTANCE_STATUS.APPROVED ? rule.to : row.status, requisitionNo: row.requisition_no, multiLevel: true, approvalStatus: r.status, currentStep: r.currentStep, totalSteps: r.totalSteps }
    }

    // 单级路径（原逻辑）
    await compareAndSetStatus(conn, { table: 'purchase_requisitions', id, fromStatus: rule.from, toStatus: rule.to, entityName: '请购单' })
    await conn.query(
      'UPDATE purchase_requisitions SET approved_by=?,approved_by_name=?,approved_at=NOW(),reject_reason=NULL WHERE id=?',
      [operator.operatorId, operator.operatorName, id],
    )
    await conn.commit()
    return { id: Number(id), status: rule.to, requisitionNo: row.requisition_no, multiLevel: false }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function reject(id, { reason }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'purchase_requisitions', id, columns: 'id, status, applicant_id, warehouse_id', entityName: '请购单',
    })
    assertInScope(operator?.warehouseIds ?? null, row.warehouse_id, '请购单')
    await assertNotSelfApproval(row.applicant_id, operator.operatorId, '不能驳回自己提交的请购单')
    if (!String(reason || '').trim()) throw new AppError('请填写驳回原因', 400)
    const rule = assertStatusAction('purchaseRequisition', 'reject', row.status)

    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'purchase_requisition', bizId: id })
    if (active) {
      await approvalEngine.rejectStep(conn, { instanceId: active.instance.id, operator, comment: reason })
    }
    await compareAndSetStatus(conn, { table: 'purchase_requisitions', id, fromStatus: rule.from, toStatus: rule.to, entityName: '请购单' })
    await conn.query(
      'UPDATE purchase_requisitions SET approved_by=?,approved_by_name=?,approved_at=NOW(),reject_reason=? WHERE id=?',
      [operator.operatorId, operator.operatorName, String(reason).trim(), id],
    )
    await conn.commit()
    return { id: Number(id), status: rule.to, requisitionNo: row.requisition_no, multiLevel: !!active }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/**
 * 转采购单（请购特有，最高危）。要点：
 * ① 幂等（beginOperationRequest，连点两次/断网重试不生成重复 PO）
 * ② 事务 + 请购头行锁 + 校验已批准(3) + 数据权限
 * ③ 逐行锁请购明细，校验 本次转量 ≤ (quantity - converted_qty)、供应商必填
 * ④ 按供应商分组，每组建一张 PO 草稿（status=1，待采购再 confirm），回填 source_requisition_id
 * ⑤ 回写 converted_qty + 写 conversions 追溯；全部明细转完 CAS 3→6 结案
 * 不做任何库存/账款副作用；不 HTTP 调采购模块（同事务内直接建 PO SQL）。
 * body: { lines: [{ requisitionItemId, quantity, supplierId, supplierName, unitPrice }], requestKey }
 */
async function convert(id, { lines, requestKey }, operator) {
  if (!Array.isArray(lines) || !lines.length) throw new AppError('请至少选择一行转采购', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const st = await beginOperationRequest(conn, { requestKey, action: 'purchase.requisition.convert', userId: operator?.userId ?? null })
    if (st.replay) { await conn.rollback(); return st.responseData }

    const head = await lockStatusRow(conn, {
      table: 'purchase_requisitions', id,
      columns: 'id, requisition_no, status, warehouse_id, warehouse_name, expected_date', entityName: '请购单',
    })
    assertInScope(operator?.warehouseIds ?? null, head.warehouse_id, '请购单')
    assertStatusAction('purchaseRequisition', 'convert', head.status)   // from[3]

    // 逐行锁请购明细并校验
    const itemMap = new Map()
    for (const ln of lines) {
      const itemId = Number(ln.requisitionItemId)
      const qty = Number(ln.quantity)
      const supplierId = Number(ln.supplierId)
      const unitPrice = Number(ln.unitPrice)
      if (!Number.isInteger(itemId) || itemId <= 0) throw new AppError('请购明细行无效', 400)
      if (!Number.isFinite(qty) || qty <= 0) throw new AppError('转采购数量必须大于 0', 400)
      if (!Number.isInteger(supplierId) || supplierId <= 0) throw new AppError('每一行转采购都必须指定供应商', 400)
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new AppError('采购单价不能为负', 400)
      const [[item]] = await conn.query(
        'SELECT id,product_id,product_code,product_name,unit,spec,quantity,converted_qty FROM purchase_requisition_items WHERE id=? AND requisition_id=? FOR UPDATE',
        [itemId, id],
      )
      if (!item) throw new AppError(`请购明细 ${itemId} 不属于本请购单`, 400)
      const remaining = Number(item.quantity) - Number(item.converted_qty)
      if (qty > remaining + 1e-9) throw new AppError(`商品「${item.product_name}」本次转采购 ${qty} 超过可转余量 ${remaining}`, 400)
      itemMap.set(itemId, { item, qty, supplierId, supplierName: ln.supplierName || null, unitPrice })
    }

    // 校验供应商启用（照 purchase.create），并按 supplierId 分组
    const groups = new Map()
    for (const [, v] of itemMap) {
      const [[s]] = await conn.query('SELECT id,name,is_active FROM supply_suppliers WHERE id=? AND deleted_at IS NULL', [v.supplierId])
      if (!s) throw new AppError(`供应商 ${v.supplierId} 不存在`, 404)
      if (!s.is_active) throw new AppError(`供应商「${s.name}」已停用，无法转采购`, 400)
      v.supplierName = s.name
      if (!groups.has(v.supplierId)) groups.set(v.supplierId, { supplierId: v.supplierId, supplierName: s.name, lines: [] })
      groups.get(v.supplierId).lines.push(v)
    }

    // 每组建一张 PO 草稿
    const createdOrders = []
    for (const [, g] of groups) {
      const orderNo = await genOrderNo(conn)
      const total = g.lines.reduce((sum, x) => sum + x.qty * x.unitPrice, 0)
      const [r] = await conn.query(
        `INSERT INTO purchase_orders
          (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,expected_date,total_amount,remark,operator_id,operator_name,source_requisition_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [orderNo, g.supplierId, g.supplierName, head.warehouse_id, head.warehouse_name, head.expected_date || null, total,
          `由请购单 ${head.requisition_no} 转入`, operator.userId, operator.realName, id],
      )
      const orderId = r.insertId
      for (const x of g.lines) {
        await conn.query(
          `INSERT INTO purchase_order_items
            (order_id,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [orderId, x.item.product_id, x.item.product_code, x.item.product_name, x.item.unit, null, x.item.spec || null, null,
            x.qty, x.unitPrice, x.qty * x.unitPrice, null],
        )
        await conn.query(
          'INSERT INTO purchase_requisition_conversions (requisition_id,requisition_item_id,purchase_order_id,quantity) VALUES (?,?,?,?)',
          [id, x.item.id, orderId, x.qty],
        )
        await conn.query(
          'UPDATE purchase_requisition_items SET converted_qty = converted_qty + ? WHERE id=?',
          [x.qty, x.item.id],
        )
      }
      createdOrders.push({ id: orderId, orderNo, supplierName: g.supplierName, itemCount: g.lines.length })
    }

    // 全部明细转完 → 结案 3→6
    const [[{ pending }]] = await conn.query(
      'SELECT COUNT(*) AS pending FROM purchase_requisition_items WHERE requisition_id=? AND converted_qty < quantity - 1e-9', [id],
    )
    let completed = false
    if (Number(pending) === 0) {
      const rule = assertStatusAction('purchaseRequisition', 'complete', head.status)
      await compareAndSetStatus(conn, { table: 'purchase_requisitions', id, fromStatus: rule.from, toStatus: rule.to, entityName: '请购单' })
      completed = true
    }

    const result = { requisitionId: Number(id), createdOrders, completed }
    await completeOperationRequest(conn, st, { data: result, message: '转采购单成功', resourceType: 'purchase_requisition', resourceId: Number(id) })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function findAll({ page = 1, pageSize = 20, status = '', keyword = '', warehouseId = '', applicantId = '', startDate = '', endDate = '' } = {}, scopeWarehouseIds = null) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['r.deleted_at IS NULL']
  const params = []
  if (status) { conds.push('r.status=?'); params.push(Number(status)) }
  if (warehouseId) { conds.push('r.warehouse_id=?'); params.push(Number(warehouseId)) }
  if (applicantId) { conds.push('r.applicant_id=?'); params.push(Number(applicantId)) }
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(r.requisition_no LIKE ? OR r.title LIKE ? OR r.applicant_name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`) }
  if (startDate) { conds.push('r.created_at >= ?'); params.push(`${startDate} 00:00:00`) }
  if (endDate) { conds.push('r.created_at <= ?'); params.push(`${endDate} 23:59:59`) }
  const scope = scopeFilter(scopeWarehouseIds, 'r.warehouse_id')
  const where = `WHERE ${conds.join(' AND ')}${scope.sql}`
  const allParams = [...params, ...scope.params]

  const [rows] = await pool.query(
    `SELECT r.*, (SELECT COUNT(*) FROM purchase_requisition_items i WHERE i.requisition_id=r.id) AS item_count
       FROM purchase_requisitions r ${where}
      ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [...allParams, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM purchase_requisitions r ${where}`, allParams)
  return { list: rows.map(fmtRequisition), pagination: { page: p, pageSize: ps, total } }
}

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query('SELECT * FROM purchase_requisitions WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('请购单不存在', 404)
  assertInScope(scopeWarehouseIds, row.warehouse_id, '请购单')
  const [items] = await pool.query(
    `SELECT pri.*, p.article_number, p.color
       FROM purchase_requisition_items pri
       JOIN product_items p ON p.id = pri.product_id
      WHERE pri.requisition_id=? ORDER BY pri.id ASC`, [id])

  // 审批进度（多级审批流实例；无则 null，前端走单级展示）
  const conn = await pool.getConnection()
  let approval = null
  try {
    const got = await approvalEngine.getLatestInstanceByBiz(conn, { bizType: 'purchase_requisition', bizId: id })
    if (got) {
      const { instance, tasks } = got
      approval = {
        instanceId: Number(instance.id),
        status: Number(instance.status),
        applicantId: Number(instance.applicant_id),
        applicantName: instance.applicant_name,
        amount: Number(instance.amount),
        currentStep: Number(instance.current_step),
        rejectReason: instance.reject_reason,
        finishedAt: instance.finished_at,
        createdAt: instance.created_at,
        tasks: tasks.map(t => ({
          stepOrder: Number(t.step_order),
          status: Number(t.status),
          approverName: t.approver_name,
          comment: t.comment,
          actionAt: t.action_at,
        })),
      }
    }
  } finally { conn.release() }

  return {
    ...fmtRequisition(row),
    items: items.map(i => ({
      id: Number(i.id),
      productId: Number(i.product_id),
      productCode: i.product_code,
      productName: i.product_name,
      unit: i.unit,
      articleNumber: i.article_number || null,
      spec: i.spec,
      color: i.color || null,
      quantity: Number(i.quantity),
      estimatedPrice: i.estimated_price == null ? null : Number(i.estimated_price),
      suggestedSupplierId: i.suggested_supplier_id != null ? Number(i.suggested_supplier_id) : null,
      suggestedSupplierName: i.suggested_supplier_name,
      convertedQty: Number(i.converted_qty),
      remark: i.remark,
    })),
    approval,
  }
}

module.exports = {
  STATUS, STATUS_NAME,
  create, update, submit, withdraw, cancel, approve, reject, convert, findAll, findById,
}
