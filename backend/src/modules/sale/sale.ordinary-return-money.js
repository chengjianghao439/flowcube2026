'use strict'

// Ordinary discounted returns only. The source snapshot is immutable money
// evidence; quantities and physical completion still belong to SO/RT/containers.
const AppError = require('../../utils/AppError')
const { decimalUnits, halfUp, centsText } = require('../accounting/voucher-sale-money')
const { moneyUnits, moneyText } = require('../../utils/decimalMoney')

const CASH_POLICY='cash-cents-v1'
const cash=require('../../utils/cashMoney')
function cashBasis(basis){
  const gross=cash.storedCashCents(basis.gross_basis,'原销售合计'),discount=cash.storedCashCents(basis.discount_basis,'原整单折扣'),net=cash.storedCashCents(basis.net_basis,'原净成交额')
  if(gross<0n||discount<0n||discount>gross||net!==gross-discount)review('原分位净成交预算不闭合')
  const budgets=new Map(basis.snapshot.items.map(i=>[i.id,cash.storedCashCents(i.amount,'原行成交预算')]))
  if([...budgets.values()].some(n=>n<0n)||[...budgets.values()].reduce((n,a)=>n+a,0n)!==gross)review('原行分位预算与整单不闭合')
  return {...basis,cashGross:gross,cashNet:net,budgets,cashPolicy:CASH_POLICY}
}
function vector(basis,entries){
  const map=new Map(),byId=new Map(basis.snapshot.items.map(s=>[s.id,s]))
  for(const entry of entries){const id=Number(entry.id),q=decimalUnits(entry.quantity,2);if(map.has(id)||!byId.has(id)||q<0n||q>decimalUnits(byId.get(id).quantity,2))review('执行时原行已发向量无效');map.set(id,q)}
  if(map.size!==byId.size)review('执行时已发向量缺少原行')
  return map
}
function vectorData(basis,values){return basis.snapshot.items.map(s=>({id:s.id,quantity:textAt(values.get(s.id)||0n,2)}))}
function shareFor(basis,values){return basis.snapshot.items.reduce((n,s)=>cash.addFraction(n,cash.lineContribution(basis.budgets.get(s.id),values.get(s.id)||0n,decimalUnits(s.quantity,2))),cash.fraction())}
function cashTarget(basis,values){return cash.netShareCents(basis.cashNet,basis.cashGross,shareFor(basis,values))}
// Read-only accounting adapter. Caller batches original bases and derives this
// cumulative vector from unique real WT7→SOI facts; no financial/stock locks.
function shipmentCashTarget(row,quantities){
  const basis=parseSnapshot(row)
  if(basis.snapshot.version!==2)review('缺少新版出库分预算证明')
  const values=new Map(basis.snapshot.items.map(s=>[s.id,0n])),seen=new Set()
  for(const q of quantities){const id=Number(q.id);if(seen.has(id)||!values.has(id))review('出库累计向量来源不唯一');seen.add(id);values.set(id,decimalUnits(q.quantity,2))}
  return cashTarget(basis,vector(basis,vectorData(basis,values)))
}
function closedMoney(basis){
  const shares=basis.snapshot.items.map(s=>{const f=cash.lineContribution(basis.budgets.get(s.id),basis.shipped.get(s.id)||0n,decimalUnits(s.quantity,2));return {id:s.id,f,amount:f.n/f.d,original:basis.budgets.get(s.id)}})
  const sum=shares.reduce((n,s)=>cash.addFraction(n,s.f),cash.fraction()),gross=halfUp(sum.n,sum.d)
  let remaining=gross-shares.reduce((n,s)=>n+s.amount,0n)
  const candidates=shares.filter(s=>s.f.n%s.f.d>0n&&s.amount<s.original).sort((a,b)=>{const diff=(b.f.n%b.f.d)*a.f.d-(a.f.n%a.f.d)*b.f.d;return diff<0n?-1:diff>0n?1:a.id-b.id})
  for(const item of candidates){if(!remaining)break;item.amount++;remaining--}
  if(remaining||shares.some(s=>s.amount>s.original))review('关闭剩余的行金额无法有界闭合原分预算')
  return {gross:cash.cashNumber(gross),discount:cash.cashNumber(gross-cashTarget(basis,basis.shipped)),lines:new Map(shares.map(s=>[s.id,cash.cashNumber(s.amount)]))}
}
function projectCash(basis,previous,pieces,shipped){
  const used=new Map(previous.usedQty),batch=new Map(),projected=pieces.map(piece=>{
    const source=sourceFor(basis,piece.item||piece),q=decimalUnits(piece.quantity,2)
    if(q<0n)review('合格退货量不能为负')
    const next=(used.get(source.id)||0n)+q;if(next>(shipped.get(source.id)||0n))review('原行累计合格退货超过执行时实际已发量')
    used.set(source.id,next);batch.set(source.id,(batch.get(source.id)||0n)+q)
    const contribution=cash.lineContribution(basis.budgets.get(source.id),q,decimalUnits(source.quantity,2))
    return {...piece,gross:q*decimalUnits(source.unitPrice,8),financial:cash.netShareCents(basis.cashNet,basis.cashGross,contribution,{floor:true})}
  })
  const final=basis.snapshot.items.filter(s=>basis.budgets.get(s.id)>0n).every(s=>(used.get(s.id)||0n)===(shipped.get(s.id)||0n))
  const batchShare=shareFor(basis,batch)
  const target=batchShare.n===0n?0n:final?cashTarget(basis,shipped)-previous.financial:cash.netShareCents(basis.cashNet,basis.cashGross,batchShare,{floor:true})
  if(target<0n||previous.financial+target>cashTarget(basis,shipped)||previous.financial+target>basis.cashNet)review('本次实际净冲减超出已发或原净额分预算')
  const allocated=projected.reduce((n,p)=>n+p.financial,0n),last=[...projected].reverse().find(p=>decimalUnits(p.quantity,2)>0n&&basis.budgets.get(sourceFor(basis,p.item||p).id)>0n)
  if(!last&&target!==0n)review('不得以零数量回执承接资金尾额')
  if(last)last.financial+=target-allocated
  if(projected.some(p=>p.financial<0n))review('分位分配产生负金额')
  return {projected,used,final,target}
}

const REVIEW = 'SALE_RETURN_NET_BASIS_REQUIRED'
const CONTEXT_CONNECTION = Symbol('ordinaryReturnConnection')
function review(reason) { throw new AppError(`原销售净成交额需核对：${reason}`, 409, REVIEW) }
function textAt(units, scale) {
  return `${units / (10n ** BigInt(scale))}.${String(units % (10n ** BigInt(scale))).padStart(scale, '0')}`
}
function parseSnapshot(row) {
  let snapshot
  try { snapshot = typeof row.source_snapshot === 'string' ? JSON.parse(row.source_snapshot) : row.source_snapshot }
  catch { review('原成交快照损坏') }
  if (!snapshot || ![1,2].includes(snapshot.version) || !Array.isArray(snapshot.items) || !snapshot.items.length
    || !['first_real_ship', 'legacy_complete_proven'].includes(row.basis_origin)) review('缺少原明细及依据来源')
  const gross = moneyUnits(row.gross_basis), discount = moneyUnits(row.discount_basis), net = moneyUnits(row.net_basis)
  if (gross < 0n || discount < 0n || discount > gross || net !== gross - discount) review('原整单净额依据不完整')
  const seen = new Set()
  let originalGross = 0n
  for (const item of snapshot.items) {
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || seen.has(item.id)
      || !Number.isSafeInteger(item.productId) || item.productId <= 0
      || !Number.isSafeInteger(item.warehouseId) || item.warehouseId <= 0) review('原销售明细身份不唯一')
    seen.add(item.id)
    const qty = decimalUnits(item.quantity, 2), price = decimalUnits(item.unitPrice, 8)
    if (qty <= 0n || price <= 0n) review('原销售量价无效')
    originalGross += qty * price
  }
  if (snapshot.version===1&&originalGross !== gross * 1000000n) review('原行量价与整单金额不闭合')
  const basis={ ...row, orderId: Number(row.order_id), snapshot, gross, net, originalGross }
  return snapshot.version===2?cashBasis(basis):basis
}
function deriveBasis(order, rows, origin) {
  const gross = cash.storedCashCents(order.total_amount,'原订单总额')*100n, discount = cash.storedCashCents(order.discount_amount,'原订单折扣')*100n
  const source = { version: 2, items: rows.map(r => ({ id: Number(r.id), productId: Number(r.product_id),
    warehouseId: Number(r.warehouse_id ?? order.warehouse_id), quantity: String(r.quantity),
    unitPrice: String(r.unit_price), amount: String(r.amount), unit: r.unit })) }
  const row = { order_id: Number(order.id), gross_basis: moneyText(gross), discount_basis: moneyText(discount),
    net_basis: moneyText(gross - discount), source_snapshot: source, basis_origin: origin }
  // A historical unit conversion / head rounding mismatch is a real policy
  // question, not permission to replace .8999 with .9000 or rewrite AR.
  const basis = parseSnapshot(row)
  if (rows.reduce((sum, r) => sum + moneyUnits(r.amount), 0n) !== gross) review('原行金额与单头不闭合')
  return basis
}
async function readBasis(conn, orderId, lock = '') {
  const [[row]] = await conn.query(`SELECT * FROM sale_ordinary_return_bases WHERE order_id=?${lock}`, [orderId])
  return row ? parseSnapshot(row) : null
}
async function assertLegacyProof(conn, orderId) {
  const [closed] = await conn.query("SELECT id FROM sale_order_events WHERE sale_order_id=? AND event_type='partial_ship_closed' LIMIT 1 FOR SHARE", [orderId])
  if (closed.length) review('旧单已关闭剩余，缺少关闭前的冻结成交依据')
  await assertTrackedReturns(conn,orderId)
}
async function initialize(conn, order, origin) {
  // Caller holds SO S/X; legacy callers lock complete SOI before this source.
  // No absent-row locking read: concurrent different orders must not acquire
  // compatible gap locks and then deadlock while inserting their own basis.
  const [rows] = await conn.query('SELECT id,product_id,warehouse_id,quantity,shipped_qty,unit_price,amount,unit FROM sale_order_items WHERE order_id=? ORDER BY id FOR SHARE', [order.id])
  await assertLegacyProof(conn, order.id)
  if(rows.some(r=>decimalUnits(r.shipped_qty||0,2)>0n))origin='legacy_complete_proven'
  const candidate = deriveBasis(order, rows, origin)
  if(origin==='legacy_complete_proven'){
    const shippedVector=new Map(rows.map(r=>[Number(r.id),decimalUnits(r.shipped_qty||0,2)]))
    const expected=cashTarget(candidate,shippedVector)*100n
    const [[ar]]=await conn.query('SELECT total_amount,paid_amount,balance FROM payment_records WHERE type=2 AND order_id=? FOR SHARE',[order.id])
    if(ar)for(const field of ['total_amount','paid_amount','balance'])cash.storedCashCents(ar[field],`旧应收${field}`)
    if((!ar&&expected!==0n)||(ar&&moneyUnits(ar.total_amount)!==expected))review('旧已发应收与净额累计投影不一致，保留原金额待核')
  }
  try {
    await conn.query('INSERT INTO sale_ordinary_return_bases (order_id,gross_basis,discount_basis,net_basis,source_snapshot,basis_origin) VALUES (?,?,?,?,?,?)',
      [order.id, candidate.gross_basis, candidate.discount_basis, candidate.net_basis, JSON.stringify(candidate.snapshot), origin])
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error
    // Same-order initialization is serialized by SO/complete SOI. This is only
    // a stale RR discovery; read the winner, never update/reconstruct its basis.
  }
}
async function initializeOrWinner(conn,order,origin,lock=' FOR SHARE'){
  try{await initialize(conn,order,origin);return null}
  catch(error){
    if(error.code!==REVIEW)throw error
    // An early RR view can miss a basis committed before this SO/SOI lock.
    // Only check for that winner after failed proof; never insert after an
    // absent-row locking read. Invalid stored winners still throw fail-closed.
    const winner=await readBasis(conn,order.id,lock)
    return winner?null:error
  }
}
async function prepareShipment(conn, order) {
  if (order.commercial_model === 'kit-v1') return null
  const current=await currentSourceRows(conn,order.id)
  let basis = await readBasis(conn, order.id)
  if (!basis) {
    const failure=await initializeOrWinner(conn,order,'first_real_ship');if(failure)throw failure
  }
  basis=await readBasis(conn,order.id,' FOR SHARE')
  if(order.cash_policy!==CASH_POLICY&&(basis.snapshot.version===1||basis.basis_origin==='legacy_complete_proven'))review('旧已执行销售续发尚未证明各期间成交分预算一致，保留原账待核')
  // This is called under SO→WT, before any stock/container lock. Return writes
  // take source X first; shipment S is held through its original commit.
  return financialContext(conn,basis,current)
}
async function prepareCreate(conn, order, items) {
  if (!order || order.commercial_model === 'kit-v1') return null
  let basis = await readBasis(conn, order.id)
  if (!basis) {const failure=await initializeOrWinner(conn,order,'legacy_complete_proven');if(failure)throw failure}
  const current=await currentSourceRows(conn,order.id)
  basis = await readBasis(conn, order.id, ' FOR SHARE')
  basis=withEndpoint(cashBasis(basis),order,current)
  await assertTrackedReturns(conn,basis.orderId)
  const result=await estimate(conn,basis,items)
  if(basis.snapshot.version===1)await assertCurrentReceivable(conn,{...basis,previous:await receipts(conn,basis)})
  return result
}
async function lockReturn(conn, { returnId = null, taskId = null, initializeLegacy = false }) {
  const [[ref]] = await conn.query(taskId
    ? `SELECT sr.id,sr.sale_order_id,sr.ordinary_net_basis_order_id FROM return_tasks rt JOIN sale_returns sr ON sr.id=rt.return_id WHERE rt.id=? AND rt.return_type='sale'`
    : 'SELECT id,sale_order_id,ordinary_net_basis_order_id FROM sale_returns WHERE id=?', [taskId || returnId])
  if (!ref?.sale_order_id) return null
  if(ref.ordinary_net_basis_order_id!=null&&Number(ref.ordinary_net_basis_order_id)!==Number(ref.sale_order_id))review('退货标记与原销售单不一致')
  const [[kind]]=await conn.query('SELECT commercial_model FROM sale_orders WHERE id=?',[ref.sale_order_id])
  if(kind?.commercial_model==='kit-v1'){
    if(ref.ordinary_net_basis_order_id!=null)review('成套单不应带普通净额标记')
    return null
  }
  // Current SO/complete SOI locks precede source, SR, RT and all stock locks.
  // This freezes a terminal shipped endpoint without ever reversing stock→SO.
  const [[order]]=await conn.query('SELECT * FROM sale_orders WHERE id=? FOR SHARE',[ref.sale_order_id])
  if(!order)review('原销售单不存在')
  if(order.commercial_model==='kit-v1'){
    if(ref.ordinary_net_basis_order_id!=null)review('成套单不应带普通净额标记')
    return null
  }
  let current=await currentSourceRows(conn,order.id,initializeLegacy?' FOR UPDATE':' FOR SHARE')
  let basis = await readBasis(conn, ref.sale_order_id)
  if (!basis && initializeLegacy) {
    // Same order creators/legacy confirmation serialize on SOI, before source.
    const failure=await initializeOrWinner(conn,order,'legacy_complete_proven',' FOR UPDATE');if(failure)throw failure
    basis = await readBasis(conn, order.id)
  }
  basis=await readBasis(conn,ref.sale_order_id,' FOR UPDATE')
  if (!basis) {
    if(ref.ordinary_net_basis_order_id!=null)review('退货标记缺少准确冻结来源')
    if (order?.commercial_model !== 'kit-v1' && Number(order?.discount_amount) > 0) review('执行前缺少已核对的原成交依据')
    return null
  }
  basis=withEndpoint(cashBasis(basis),order,current)
  basis=await financialContext(conn,basis,current)
  const [[currentReturn]]=await conn.query('SELECT id,sale_order_id,ordinary_net_basis_order_id,cash_policy FROM sale_returns WHERE id=? FOR UPDATE',[ref.id])
  if(!currentReturn||Number(currentReturn.sale_order_id)!==basis.orderId||(currentReturn.ordinary_net_basis_order_id!=null&&Number(currentReturn.ordinary_net_basis_order_id)!==basis.orderId))review('退货当前来源与冻结依据不一致')
  if(taskId&&(currentReturn.ordinary_net_basis_order_id==null||currentReturn.cash_policy!==CASH_POLICY))review('旧已确认退货未冻结净额意图，请先核对')
  return {...basis,returnRef:currentReturn}
}
function sourceFor(basis, item) {
  const source = basis.snapshot.items.find(r => r.id === Number(item.sourceItemId ?? item.sale_item_id))
  if (!source || source.productId !== Number(item.productId ?? item.product_id)
    || (item.unit_price != null && decimalUnits(item.unit_price, 8) !== decimalUnits(source.unitPrice, 8))) review('退货行与冻结原成交行不一致')
  return source
}
function cumulativeNet(basis, gross) {
  if (gross < 0n || gross > basis.originalGross) review('累计合格退货原值超出原成交额')
  return halfUp(basis.net * gross, basis.originalGross)
}
async function currentSourceRows(conn,orderId,lock=true){
  return (await conn.query(`SELECT id,product_id,warehouse_id,quantity,shipped_qty,unit_price FROM sale_order_items WHERE order_id=? ORDER BY id${typeof lock==='string'?lock:lock?' FOR SHARE':''}`,[orderId]))[0]
}
function withEndpoint(basis,order,rows){
  let shippedGross=0n
  for(const row of rows){
    const source=sourceFor(basis,{sale_item_id:row.id,product_id:row.product_id,unit_price:row.unit_price}),qty=decimalUnits(row.shipped_qty||0,2)
    if(Number(row.warehouse_id??source.warehouseId)!==source.warehouseId||qty>decimalUnits(source.quantity,2))review('实际已发明细与原成交依据不符')
    shippedGross+=qty*decimalUnits(source.unitPrice,8)
  }
  if(shippedGross>basis.originalGross)review('实际已发原值超出原成交额')
  const shipped=new Map(basis.snapshot.items.map(s=>[s.id,0n]));for(const row of rows)shipped.set(Number(row.id),decimalUnits(row.shipped_qty||0,2))
  return {...basis,shipped,terminalGross:Number(order.status)===4?shippedGross:basis.originalGross}
}
function receivableTotal(basis, shippedGross, returnedFinancial) {
  if(basis.cashPolicy===CASH_POLICY){
    const total=cashTarget(basis,vector(basis,shippedGross.vector))-cash.storedCashCents(returnedFinancial,'已退实际净额')
    if(total<0n)review('已退实际净额超出已发净额');return cash.cashNumber(total)
  }
  const total=cumulativeNet(basis,decimalUnits(shippedGross,10))-moneyUnits(returnedFinancial)
  if(total<0n)review('已退净额超出原已发净成交额')
  return Number(moneyText(total))
}
function project(basis, beforeGross, pieces, priorFinancial=0n) {
  const projected=pieces.map(piece => {
    const gross = decimalUnits(piece.quantity, 2) * decimalUnits(piece.unitPrice, 8)
    return {...piece,gross,financial:basis.net*gross/basis.originalGross}
  })
  const batchGross=projected.reduce((sum,p)=>sum+p.gross,0n),after=beforeGross+batchGross
  cumulativeNet(basis,after)
  const endpoint=basis.terminalGross??basis.originalGross
  if(after>endpoint)review('累计退货原值超出准确可退终点')
  const target=after===endpoint?cumulativeNet(basis,endpoint)-priorFinancial:basis.net*batchGross/basis.originalGross
  if(target<0n||priorFinancial+target>basis.net)review('实际累计净冲减超出原净成交额')
  const allocated=projected.reduce((sum,p)=>sum+p.financial,0n),last=[...projected].reverse().find(p=>p.gross>0n)
  if(!last&&target!==0n)review('缺少真实合格退货量承接末笔尾额')
  if(last)last.financial+=target-allocated
  if(projected.some(p=>p.financial<0n))review('退货分配出现负净额')
  return projected
}
function validateCashReceipts(basis,rows,byId){
  const groups=[],seen=new Set(),finished=new Set()
  for(const r of rows){
    const p=byId.get(Number(r.return_task_item_id)),q=decimalUnits(r.qualified_qty,2)
    if(Number(r.order_id)!==basis.orderId||seen.has(Number(r.return_task_item_id))||!p||Number(p.return_item_id)!==Number(r.return_item_id)||Number(p.sale_order_id)!==basis.orderId||Number(p.ordinary_net_basis_order_id)!==basis.orderId||Number(p.status)!==3||q<0n||decimalUnits(p.checked_qty,2)-decimalUnits(p.rejected_qty,2)!==q||decimalUnits(p.putaway_qty,2)!==q||q*decimalUnits(sourceFor(basis,p).unitPrice,8)!==decimalUnits(r.gross_amount,10))review('实际回执缺少准确已执行净额意图或真实QA证据')
    seen.add(Number(r.return_task_item_id));const taskId=Number(p.task_id),last=groups.at(-1)
    if(!last||last.taskId!==taskId){if(finished.has(taskId))review('同次退货回执顺序不完整');if(last)finished.add(last.taskId);groups.push({taskId,rows:[]})}
    groups.at(-1).rows.push({...r,...p,id:r.id,quantity:r.qualified_qty,unitPrice:sourceFor(basis,p).unitPrice})
  }
  let gross=0n,financial=0n,legacyFinancial=0n,usedQty=new Map(),newSeen=false
  for(const group of groups){
    let expected
    if(group.rows.every(r=>r.cash_execution_basis==null)){
      if(basis.snapshot.version!==1||newSeen)review('缺少新现金执行回执证明')
      expected=project(basis,gross,group.rows,legacyFinancial)
      for(let i=0;i<group.rows.length;i++)if(moneyUnits(group.rows[i].financial_amount)!==expected[i].financial)review('旧已退金额与当时规则不一致')
      for(const r of group.rows){const id=sourceFor(basis,r).id,q=decimalUnits(r.quantity,2),next=(usedQty.get(id)||0n)+q;if(next>decimalUnits(basis.snapshot.items.find(s=>s.id===id).quantity,2))review('旧原行已退超量');usedQty.set(id,next);financial+=cash.storedCashCents(r.financial_amount,'旧实际退货金额');legacyFinancial+=moneyUnits(r.financial_amount)}
    }else{
      newSeen=true;let proof
      try{proof=typeof group.rows[0].cash_execution_basis==='string'?JSON.parse(group.rows[0].cash_execution_basis):group.rows[0].cash_execution_basis}catch{review('执行分位证明损坏')}
      if(!proof||proof.version!==2||proof.cashPolicy!==CASH_POLICY||!Array.isArray(proof.shipped)||!Array.isArray(proof.priorQualified)||group.rows.some(r=>r.cash_policy!==CASH_POLICY||JSON.stringify(typeof r.cash_execution_basis==='string'?JSON.parse(r.cash_execution_basis):r.cash_execution_basis)!==JSON.stringify(proof)))review('同次实际分位证明缺失或不一致')
      const shipped=vector(basis,proof.shipped),prior=vector(basis,proof.priorQualified)
      if(basis.snapshot.items.some(s=>(prior.get(s.id)||0n)!==(usedQty.get(s.id)||0n))||cash.storedCashCents(proof.priorFinancial,'前序实际净额')!==financial)review('执行前量额与前序已存实际事实不一致')
      if(basis.shipped&&basis.snapshot.items.some(s=>(shipped.get(s.id)||0n)>(basis.shipped.get(s.id)||0n)))review('历史执行向量超过当前真实已发量')
      const result=projectCash(basis,{usedQty,financial},group.rows,shipped);expected=result.projected;usedQty=result.used
      for(let i=0;i<group.rows.length;i++)if(cash.storedCashCents(group.rows[i].financial_amount,'实际净冲减')!==expected[i].financial)review('实际退货金额与原分预算及执行终点不一致')
      financial+=expected.reduce((n,p)=>n+p.financial,0n)
    }
    gross+=expected.reduce((n,p)=>n+p.gross,0n)
    if(financial>basis.cashNet)review('累计实际净额超过原分位净预算')
  }
  if(basis.shipped&&basis.snapshot.items.some(s=>(usedQty.get(s.id)||0n)>(basis.shipped.get(s.id)||0n)))review('累计实际退货超过当前真实已发向量')
  return {rows,gross,financial,usedQty}
}

function validateActualReceipts(basis,rows,byId){
  if(basis.cashPolicy===CASH_POLICY)return validateCashReceipts(basis,rows,byId)
  const groups=[],seen=new Set(),finished=new Set(),usedQty=new Map()
  for(const r of rows){
    const p=byId.get(Number(r.return_task_item_id)),q=decimalUnits(r.qualified_qty,2)
    if(Number(r.order_id)!==basis.orderId||seen.has(Number(r.return_task_item_id))||!p||Number(p.return_item_id)!==Number(r.return_item_id)
      ||Number(p.sale_order_id)!==basis.orderId||Number(p.ordinary_net_basis_order_id)!==basis.orderId||Number(p.status)!==3
      ||decimalUnits(p.checked_qty,2)-decimalUnits(p.rejected_qty,2)!==q||decimalUnits(p.putaway_qty,2)!==q
      ||q*decimalUnits(sourceFor(basis,p).unitPrice,8)!==decimalUnits(r.gross_amount,10))review('实际回执缺少准确已执行净额意图或真实QA证据')
    seen.add(Number(r.return_task_item_id))
    const source=sourceFor(basis,p),used=(usedQty.get(source.id)||0n)+q
    if(used>decimalUnits(source.quantity,2))review('原行累计合格退货量超出原成交量')
    usedQty.set(source.id,used)
    const taskId=Number(p.task_id),last=groups[groups.length-1]
    if(!last||last.taskId!==taskId){if(finished.has(taskId))review('同次退货实际回执顺序不完整');if(last)finished.add(last.taskId);groups.push({taskId,rows:[]})}
    groups[groups.length-1].rows.push({...r,quantity:r.qualified_qty,unitPrice:sourceFor(basis,p).unitPrice})
  }
  let gross=0n,financial=0n
  for(const group of groups){
    const expected=project(basis,gross,group.rows,financial)
    for(let i=0;i<group.rows.length;i++)if(moneyUnits(group.rows[i].financial_amount)!==expected[i].financial)review('已完成退货净额与逐笔/最终尾额规则不一致')
    gross+=expected.reduce((n,r)=>n+r.gross,0n)
    financial+=group.rows.reduce((n,r)=>n+moneyUnits(r.financial_amount),0n)
  }
  return {rows,gross,financial,usedQty}
}
async function receipts(conn, basis) {
  const [rows]=await conn.query('SELECT id,order_id,return_item_id,return_task_item_id,qualified_qty,gross_amount,financial_amount,cash_execution_basis FROM sale_ordinary_return_receipts WHERE order_id=? ORDER BY id FOR SHARE',[basis.orderId])
  const [proof]=rows.length?await conn.query(`SELECT rti.id,rti.task_id,rti.return_item_id,rti.checked_qty,rti.rejected_qty,rti.putaway_qty,
    sri.sale_item_id,sri.product_id,sri.unit_price,sr.sale_order_id,sr.ordinary_net_basis_order_id,sr.status,sr.cash_policy
    FROM return_task_items rti JOIN sale_return_items sri ON sri.id=rti.return_item_id JOIN sale_returns sr ON sr.id=sri.return_id
    WHERE rti.id IN (?) ORDER BY rti.id FOR SHARE`,[rows.map(r=>r.return_task_item_id)]):[[]]
  return validateActualReceipts(basis,rows,new Map(proof.map(p=>[Number(p.id),p])))
}
async function financialContext(conn,basis,current){
  await assertTrackedReturns(conn,basis.orderId)
  basis=withEndpoint(cashBasis(basis),{status:0,warehouse_id:basis.snapshot.items[0].warehouseId},current)
  const previous=await receipts(conn,basis)
  return {...basis,previous,sourceIds:current.map(r=>Number(r.id)),[CONTEXT_CONNECTION]:conn}
}
function assertContext(conn,basis){
  if(!basis||basis[CONTEXT_CONNECTION]!==conn||!Array.isArray(basis.sourceIds))review('缺少本事务库存动作前的原单当前依据')
}
async function currentShippedGross(conn,basis){
  assertContext(conn,basis)
  // These exact SOI rows were already locked before stock. SO S/X prevents a
  // concurrent source edit; closing this transaction may delete its unshipped rows.
  const [rows]=basis.sourceIds.length?await conn.query('SELECT id,product_id,shipped_qty,unit_price FROM sale_order_items WHERE id IN (?) ORDER BY id FOR SHARE',[basis.sourceIds]):[[]]
  let gross=0n
  for(const row of rows){
    const source=sourceFor(basis,{sale_item_id:row.id,product_id:row.product_id,unit_price:row.unit_price}),q=decimalUnits(row.shipped_qty||0,2)
    if(q>decimalUnits(source.quantity,2))review('当前已发量超出冻结原数量')
    gross+=q*decimalUnits(source.unitPrice,8)
  }
  if(basis.cashPolicy===CASH_POLICY){const shipped=new Map(basis.snapshot.items.map(s=>[s.id,0n]));for(const row of rows)shipped.set(Number(row.id),decimalUnits(row.shipped_qty||0,2));return {vector:vectorData(basis,shipped)}}
  return textAt(gross,10)
}
async function estimate(conn, basis, items) {
  const previous = await receipts(conn, basis)
  const pieces=items.map(i=>({...i,unitPrice:sourceFor(basis,i).unitPrice}))
  const {projected}=projectCash(cashBasis(basis),previous,pieces,basis.shipped)
  return {basis,items:projected.map(i=>({...i,amount:cash.cashNumber(i.financial)})),total:cash.cashNumber(projected.reduce((n,i)=>n+i.financial,0n))}
}
async function estimateReturn(conn, basis, returnId) {
  const [items] = await conn.query('SELECT id,sale_item_id,product_id,quantity,unit_price FROM sale_return_items WHERE return_id=? ORDER BY id', [returnId])
  if(basis.snapshot.version===1)await assertCurrentReceivable(conn,basis)
  return estimate(conn, basis, items)
}
async function complete(conn, returnId, taskId, context=null) {
  const basis=context
  if(!basis){
    const [[ref]]=await conn.query('SELECT ordinary_net_basis_order_id FROM sale_returns WHERE id=?',[returnId])
    if(ref?.ordinary_net_basis_order_id!=null)review('净额退货缺少本事务执行前锁定依据')
    return null
  }
  assertContext(conn,basis)
  const ref=basis.returnRef
  if(!ref||Number(ref.id)!==Number(returnId)||Number(ref.sale_order_id)!==basis.orderId
    ||Number(ref.ordinary_net_basis_order_id)!==basis.orderId||ref.cash_policy!==CASH_POLICY)review('退货执行没有准确原净额意图标记')
  // Caller already owns source X→SR→RT→stock. Never reacquire SO/SOI or take
  // payment before the existing helper has acquired statement locks.
  const [qa] = await conn.query('SELECT id,return_item_id,product_id,checked_qty,rejected_qty,putaway_qty FROM return_task_items WHERE task_id=? ORDER BY id FOR UPDATE', [taskId])
  const [items] = await conn.query('SELECT id,sale_item_id,product_id,quantity,unit_price FROM sale_return_items WHERE return_id=? ORDER BY id', [returnId])
  const byItem = new Map(items.map(i => [Number(i.id), i]))
  const previous=basis.previous
  if(!previous)review('缺少库存动作前已核对的实际退货回执')
  const usedQty=new Map(previous.usedQty)
  if (qa.length !== items.length) review('退货任务与退货明细缺少准确对应')
  const pieces = qa.map(q => {
    const item = byItem.get(Number(q.return_item_id)), qty = decimalUnits(q.checked_qty, 2) - decimalUnits(q.rejected_qty, 2)
    if (!item || Number(q.product_id) !== Number(item.product_id) || qty < 0n
      || qty > decimalUnits(item.quantity, 2) || qty !== decimalUnits(q.putaway_qty, 2)) review('合格量尚未准确全部入仓')
    const source=sourceFor(basis,item),used=(usedQty.get(source.id)||0n)+qty
    if(used>decimalUnits(source.quantity,2))review('原行累计合格退货量超出原成交量')
    usedQty.set(source.id,used)
    return { item, taskItemId: Number(q.id), quantity: textAt(qty, 2), unitPrice: source.unitPrice }
  })
  const {projected}=projectCash(basis,previous,pieces,basis.shipped)
  const proof=JSON.stringify({version:2,cashPolicy:CASH_POLICY,shipped:vectorData(basis,basis.shipped),priorQualified:vectorData(basis,previous.usedQty),priorFinancial:cash.cashText(previous.financial)})
  if(projected.length)await conn.query('INSERT INTO sale_ordinary_return_receipts (order_id,return_item_id,return_task_item_id,qualified_qty,gross_amount,financial_amount,cash_execution_basis) VALUES ?',
    [projected.map(p=>[basis.orderId,p.item.id,p.taskItemId,p.quantity,textAt(p.gross,10),cash.cashText(p.financial),proof])])
  const amounts = new Map()
  for (const p of projected) amounts.set(Number(p.item.id), (amounts.get(Number(p.item.id)) || 0n) + p.financial)
  if (amounts.size) await conn.query(`UPDATE sale_return_items SET amount=CASE id ${[...amounts].map(() => 'WHEN ? THEN ?').join(' ')} ELSE amount END WHERE return_id=?`,
    [...amounts].flatMap(([id, amount]) => [id,cash.cashText(amount)]).concat(returnId))
  const total = projected.reduce((sum, p) => sum + p.financial, 0n)
  await conn.query('UPDATE sale_returns SET total_amount=? WHERE id=?', [cash.cashText(total), returnId])
  return cash.cashNumber(total)
}
function priorReceivable(basis){return cash.cashNumber(cashTarget(basis,basis.shipped)-basis.previous.financial)}
function assertReceivableRow(basis,row){
  const expected=cash.storedCashCents(priorReceivable(basis),'原已发净应收')
  if(!row){if(expected!==0n)review('缺少原已发正额应收');return}
  const total=cash.storedCashCents(row.total_amount,'原应收总额'),paid=cash.storedCashCents(row.paid_amount,'原已收金额'),balance=cash.storedCashCents(row.balance,'原应收余额')
  if(total!==expected||balance!==(total>paid?total-paid:0n))review('原应收量额与已发及已退实际分位事实不一致')
}
async function assertCurrentReceivable(conn,basis){
  const [[row]]=await conn.query('SELECT total_amount,paid_amount,balance FROM payment_records WHERE type=2 AND order_id=? FOR SHARE',[basis.orderId])
  assertReceivableRow(basis,row)
}
async function orderMoney(conn, orderId, context=null) {
  let basis = context
  if (!basis) return null
  assertContext(conn,basis)
  if(basis.orderId!==Number(orderId))review('已锁定的成交依据与应收来源不一致')
  const previous=basis.previous
  if(!previous)review('缺少库存动作前已核对的实际退货回执')
  return { basis, returnedFinancial:cash.cashNumber(previous.financial) }
}
async function assertTrackedReturns(conn,orderId){
  // Explicit joined locking reads: a locking outer query with NOT EXISTS
  // subqueries can still mix current SR status with an older RR receipt view.
  const [rows]=await conn.query(`SELECT sr.id,sr.sale_order_id,sr.ordinary_net_basis_order_id,sri.id AS return_item_id,r.id AS receipt_id
    FROM sale_returns sr LEFT JOIN sale_return_items sri ON sri.return_id=sr.id
    LEFT JOIN sale_ordinary_return_receipts r ON r.return_item_id=sri.id
    WHERE sr.sale_order_id=? AND sr.status=3 AND sr.deleted_at IS NULL ORDER BY sr.id,sri.id,r.id FOR SHARE`,[orderId])
  if(rows.some(r=>Number(r.ordinary_net_basis_order_id)!==Number(orderId)||Number(r.sale_order_id)!==Number(orderId)
    ||r.return_item_id==null||r.receipt_id==null))review('旧已执行退货缺少准确净额意图或回执，保留原账款待核')
}
async function assertCloseRemainder(conn,order){
  if(order.commercial_model==='kit-v1'||Number(order.status)!==3)return
  const current=await currentSourceRows(conn,order.id)
  let basis=await readBasis(conn,order.id)
  if(!basis){const failure=await initializeOrWinner(conn,order,'legacy_complete_proven',' FOR UPDATE');if(failure)throw failure}
  basis=await readBasis(conn,order.id,' FOR UPDATE')
  if(!basis)review('关闭剩余缺少当前原成交分预算')
  await assertTrackedReturns(conn,order.id)
  const before=await receipts(conn,withEndpoint(cashBasis(basis),order,current)),closed=withEndpoint(cashBasis(basis),{...order,status:4},current),endpoint=closed.terminalGross
  if(before.gross>endpoint)review('累计退货超出实际已发终点')
  if(before.gross===endpoint&&before.financial!==cashTarget(closed,closed.shipped))review('已发部分已全退，关闭剩余会产生无实物承接的尾额，请先核对')
  return {...closed,previous:before,sourceIds:current.map(r=>Number(r.id)),[CONTEXT_CONNECTION]:conn}
}
async function sourceMetadata(conn,orderId){const basis=await readBasis(conn,orderId);return basis?.snapshot.version===2?{moneyModel:'ordinary-net-v1',moneyPrecision:2,cashPolicy:CASH_POLICY,netAmountStatus:'save_to_determine'}:{}}
async function voucherAmounts(conn) {
  const [missing]=await conn.query(`SELECT sri.id FROM sale_return_items sri JOIN sale_returns sr ON sr.id=sri.return_id
    JOIN sale_ordinary_return_bases b ON b.order_id=sr.ordinary_net_basis_order_id
    WHERE sr.status=3 AND sr.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM sale_ordinary_return_receipts r WHERE r.return_item_id=sri.id) LIMIT 1`)
  if(missing.length)review('已执行普通净额退货缺少实际回执')
  const [invalid]=await conn.query(`SELECT sr.id FROM sale_returns sr LEFT JOIN sale_ordinary_return_bases b ON b.order_id=sr.ordinary_net_basis_order_id WHERE sr.status=3 AND sr.deleted_at IS NULL AND sr.ordinary_net_basis_order_id IS NOT NULL AND (b.order_id IS NULL OR sr.sale_order_id<>sr.ordinary_net_basis_order_id) LIMIT 1`)
  if(invalid.length)review('已执行退货的净额标记与来源不符')
  const [rows]=await conn.query(`SELECT r.*,sri.return_id,sri.sale_item_id,sri.product_id,sri.unit_price,
    sr.sale_order_id,sr.ordinary_net_basis_order_id,sr.status,sr.cash_policy,
    b.gross_basis,b.discount_basis,b.net_basis,b.source_snapshot,b.basis_origin,
    rti.task_id,rti.checked_qty,rti.rejected_qty,rti.putaway_qty,rti.id AS proof_id
    FROM sale_ordinary_return_receipts r JOIN sale_return_items sri ON sri.id=r.return_item_id
    JOIN sale_returns sr ON sr.id=sri.return_id
    JOIN sale_ordinary_return_bases b ON b.order_id=r.order_id AND b.order_id=sr.sale_order_id
    LEFT JOIN return_task_items rti ON rti.id=r.return_task_item_id AND rti.return_item_id=sri.id
    WHERE sr.status=3 AND sr.deleted_at IS NULL ORDER BY r.id`)
  const ids=[...new Set(rows.map(r=>Number(r.order_id)))],orders=ids.length?(await conn.query('SELECT id,status,warehouse_id FROM sale_orders WHERE id IN (?) ORDER BY id',[ids]))[0]:[]
  const physical=ids.length?(await conn.query('SELECT id,order_id,product_id,warehouse_id,quantity,shipped_qty,unit_price FROM sale_order_items WHERE order_id IN (?) ORDER BY id',[ids]))[0]:[]
  const byOrder=new Map(orders.map(o=>[Number(o.id),o])),perOrder=new Map()
  for(const row of rows){const orderId=Number(row.order_id);if(!perOrder.has(orderId))perOrder.set(orderId,[]);perOrder.get(orderId).push(row)}
  for(const [orderId,list] of perOrder){
    const order=byOrder.get(orderId);if(!order)review('退货凭证缺少原销售单')
    let parsed=parseSnapshot(list[0]);if(list.some(r=>r.cash_execution_basis!=null))parsed=cashBasis(parsed)
    const basis=withEndpoint(parsed,order,physical.filter(r=>Number(r.order_id)===orderId))
    const proof=new Map(list.map(r=>[Number(r.proof_id),{...r,id:r.proof_id}]))
    validateActualReceipts(basis,list,proof)
  }
  // Only saved actual four-place financial values are projected into cents.
  const totals=new Map(),amounts=new Map()
  for(const r of rows){
    const before=totals.get(Number(r.order_id))||0n,after=before+moneyUnits(r.financial_amount)
    totals.set(Number(r.order_id),after)
    const id=Number(r.return_id)
    amounts.set(id,(amounts.get(id)||0n)+halfUp(after,100n)-halfUp(before,100n))
  }
  return new Map([...amounts].map(([id,cents])=>[id,centsText(cents)]))
}

module.exports = { CASH_POLICY,validateActualReceipts,shipmentCashTarget,sourceMetadata,closedMoney,priorReceivable,assertReceivableRow,cashBasis,projectCash,cashTarget,vector,vectorData,shareFor,REVIEW, deriveBasis, parseSnapshot, cumulativeNet, receivableTotal, project, prepareShipment, prepareCreate,
  lockReturn, estimateReturn, complete, orderMoney, currentShippedGross, voucherAmounts, assertCloseRemainder }
