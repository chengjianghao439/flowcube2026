#!/usr/bin/env node
'use strict'

const path = require('path')

const XLSX = require(path.resolve(__dirname, '../backend/node_modules/xlsx'))
const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  createPurchaseOrder,
  confirmPurchaseOrder,
  createInboundTaskFromPurchase,
  randomRef,
} = require('./helpers/smokeTestKit')
const inboundService = require('../backend/src/modules/inbound-tasks/inbound-tasks.service')
const printJobsService = require('../backend/src/modules/print-jobs/print-jobs.service')
const reportsService = require('../backend/src/modules/reports/reports.service')

function createImportWorkbook(rows) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['商品编码*', '商品名称*', '单位*', '规格', '条码', '成本价', '备注'],
    ...rows,
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, '商品导入')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

async function expectJsonSuccess(log, response, label) {
  log.assert(
    label,
    response.status >= 200 && response.status < 300 && response.data && response.data.success === true,
    `status=${response.status} body=${JSON.stringify(response.data).slice(0, 300)}`,
  )
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { http, pool, warehouse, location, product, supplier, printer } = ctx

  try {
    log.section('service contract')
    log.assert('inbound service 导出 findById', typeof inboundService.findById === 'function')
    log.assert('inbound service 导出 putaway', typeof inboundService.putaway === 'function')
    log.assert('print service 导出 create', typeof printJobsService.create === 'function')
    log.assert('print service 导出 claimClientJobs', typeof printJobsService.claimClientJobs === 'function')
    log.assert('reports service 导出 purchaseStats', typeof reportsService.purchaseStats === 'function')
    log.assert('reports service 导出 reconciliationReport', typeof reportsService.reconciliationReport === 'function')

    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    log.assert('登录成功（smoke_admin）', !!adminLogin.token, `status=${adminLogin.response.status}`)
    const limitedLogin = await login(http, 'smoke_limited', 'SmokeLimited123!')
    log.assert('登录成功（smoke_limited）', !!limitedLogin.token, `status=${limitedLogin.response.status}`)

    const adminToken = adminLogin.token
    const limitedToken = limitedLogin.token

    log.section('auth / permission')
    const meResponse = await http.get('/api/auth/me', { token: adminToken })
    await expectJsonSuccess(log, meResponse, '已登录访问 /api/auth/me 成功')

    const noAuthUsers = await http.get('/api/users')
    log.assert('未登录访问受保护接口被拒绝', noAuthUsers.status === 401, `status=${noAuthUsers.status}`)

    const limitedUsers = await http.get('/api/users', { token: limitedToken })
    log.assert('已登录但无权限访问被拒绝', limitedUsers.status === 403, `status=${limitedUsers.status}`)

    const limitedInbound = await http.get('/api/inbound-tasks', { token: limitedToken })
    log.assert('已登录且有权限访问成功', limitedInbound.status === 200 && limitedInbound.data?.success === true, `status=${limitedInbound.status}`)

    log.section('inbound mainline')
    const purchaseCreate = await createPurchaseOrder(http, adminToken, {
      supplier,
      warehouse,
      product,
      quantity: 3,
    })
    await expectJsonSuccess(log, purchaseCreate, '创建采购单成功')
    const purchaseId = purchaseCreate.data?.data?.id

    const purchaseConfirm = await confirmPurchaseOrder(http, adminToken, purchaseId)
    await expectJsonSuccess(log, purchaseConfirm, '确认采购单成功')

    const inboundCreate = await createInboundTaskFromPurchase(http, adminToken, purchaseId)
    await expectJsonSuccess(log, inboundCreate, '创建入库任务成功')
    const inboundTaskId = inboundCreate.data?.data?.taskId

    const inboundList = await http.get('/api/inbound-tasks', { token: adminToken })
    log.assert('入库任务查询返回 list/pagination', Array.isArray(inboundList.data?.data?.list) && !!inboundList.data?.data?.pagination)

    const receiveBeforeSubmit = await http.post(`/api/inbound-tasks/${inboundTaskId}/receive`, {
      token: adminToken,
      json: { productId: Number(product.id), qty: 1 },
    })
    log.assert('非法状态下收货被拒绝', receiveBeforeSubmit.status === 400, `status=${receiveBeforeSubmit.status}`)

    const inboundSubmit = await http.post(`/api/inbound-tasks/${inboundTaskId}/submit`, { token: adminToken })
    await expectJsonSuccess(log, inboundSubmit, '入库任务提交到 PDA 成功')

    const inboundReceive = await http.post(`/api/inbound-tasks/${inboundTaskId}/receive`, {
      token: adminToken,
      json: {
        productId: Number(product.id),
        packages: [{ qty: 3 }],
      },
    })
    await expectJsonSuccess(log, inboundReceive, '收货动作可执行')

    const inboundDetail = await http.get(`/api/inbound-tasks/${inboundTaskId}`, { token: adminToken })
    log.assert(
      '入库任务详情结构保持兼容',
      inboundDetail.status === 200
        && inboundDetail.data?.success === true
        && Array.isArray(inboundDetail.data?.data?.items)
        && Object.prototype.hasOwnProperty.call(inboundDetail.data?.data || {}, 'timeline'),
      `status=${inboundDetail.status}`,
    )

    const inboundContainers = await http.get(`/api/inbound-tasks/${inboundTaskId}/containers`, { token: adminToken })
    const pendingContainer = inboundContainers.data?.data?.waiting?.[0] || inboundContainers.data?.data?.list?.[0]
    log.assert('收货后存在待上架容器', !!pendingContainer, JSON.stringify(inboundContainers.data).slice(0, 400))

    const inboundPutaway = await http.post(`/api/inbound-tasks/${inboundTaskId}/putaway`, {
      token: adminToken,
      headers: { 'X-Client': 'pda' },
      json: {
        containerId: Number(pendingContainer.id),
        locationId: Number(location.id),
      },
    })
    await expectJsonSuccess(log, inboundPutaway, '上架动作可执行')

    const duplicatePutaway = await http.post(`/api/inbound-tasks/${inboundTaskId}/putaway`, {
      token: adminToken,
      headers: { 'X-Client': 'pda' },
      json: {
        containerId: Number(pendingContainer.id),
        locationId: Number(location.id),
      },
    })
    log.assert('非法状态下上架被拒绝', duplicatePutaway.status === 400, `status=${duplicatePutaway.status}`)

    log.section('print mainline')
    const printCreate = await http.post('/api/print-jobs', {
      token: adminToken,
      json: {
        printerId: Number(printer.id),
        warehouseId: Number(warehouse.id),
        title: randomRef('Smoke Print'),
        contentType: 'html',
        content: '<html><body>smoke</body></html>',
        jobType: 'label',
      },
    })
    await expectJsonSuccess(log, printCreate, '打印任务创建成功')
    const printJobId = Number(printCreate.data?.data?.id)

    const claim = await http.post('/api/print-jobs/claim-client', {
      token: adminToken,
      json: { clientId: printer.clientId, limit: 5 },
    })
    await expectJsonSuccess(log, claim, '打印任务 claim 成功')
    const claimedJob = (claim.data?.data || []).find((job) => Number(job.id) === printJobId)
    log.assert('claim 返回目标任务与 ackToken', !!claimedJob?.ackToken, JSON.stringify(claim.data).slice(0, 400))

    const completeLocalWhilePrinting = await http.post(`/api/print-jobs/${printJobId}/complete-local`, {
      token: adminToken,
      json: {},
    })
    log.assert('打印中任务禁止本机核销', completeLocalWhilePrinting.status === 409, `status=${completeLocalWhilePrinting.status}`)

    const completeWrongPrinter = await http.post(`/api/print-jobs/${printJobId}/complete`, {
      token: adminToken,
      headers: { 'X-Printer-Code': 'WRONG_PRINTER' },
      json: { ackToken: claimedJob.ackToken },
    })
    log.assert('打印任务非法完成请求被拒绝', completeWrongPrinter.status === 403 || completeWrongPrinter.status === 400, `status=${completeWrongPrinter.status}`)

    const completeOk = await http.post(`/api/print-jobs/${printJobId}/complete`, {
      token: adminToken,
      headers: { 'X-Client-Id': printer.clientId },
      json: { ackToken: claimedJob.ackToken },
    })
    await expectJsonSuccess(log, completeOk, '打印任务 complete 成功')

    const printCreate2 = await http.post('/api/print-jobs', {
      token: adminToken,
      json: {
        printerId: Number(printer.id),
        warehouseId: Number(warehouse.id),
        title: randomRef('Smoke Print Retry'),
        contentType: 'html',
        content: '<html><body>retry</body></html>',
        jobType: 'label',
      },
    })
    await expectJsonSuccess(log, printCreate2, '第二个打印任务创建成功')
    const printJobId2 = Number(printCreate2.data?.data?.id)

    const claim2 = await http.post('/api/print-jobs/claim-client', {
      token: adminToken,
      json: { clientId: printer.clientId, limit: 5 },
    })
    const claimedJob2 = (claim2.data?.data || []).find((job) => Number(job.id) === printJobId2)
    log.assert('第二个打印任务 claim 成功', !!claimedJob2?.id, JSON.stringify(claim2.data).slice(0, 400))

    const failOk = await http.post(`/api/print-jobs/${printJobId2}/fail`, {
      token: adminToken,
      headers: { 'X-Client-Id': printer.clientId },
      json: { errorMessage: 'smoke fail' },
    })
    await expectJsonSuccess(log, failOk, '打印任务 fail 成功')

    const retryOk = await http.post(`/api/print-jobs/${printJobId2}/retry`, {
      token: adminToken,
      json: {},
    })
    await expectJsonSuccess(log, retryOk, '打印任务 retry 成功')

    log.section('reports mainline')
    const reportPurchase = await http.get('/api/reports/purchase', { token: adminToken })
    log.assert(
      '采购报表结构存在 byMonth / bySupplier / byProduct',
      reportPurchase.status === 200
        && reportPurchase.data?.success === true
        && reportPurchase.data?.data
        && Array.isArray(reportPurchase.data.data.byMonth)
        && Array.isArray(reportPurchase.data.data.bySupplier)
        && Array.isArray(reportPurchase.data.data.byProduct),
      `status=${reportPurchase.status}`,
    )

    const reportInventory = await http.get('/api/reports/inventory', { token: adminToken })
    log.assert(
      '库存报表结构存在 turnover / byWarehouse',
      reportInventory.status === 200
        && reportInventory.data?.success === true
        && reportInventory.data?.data
        && Array.isArray(reportInventory.data.data.turnover)
        && Object.prototype.hasOwnProperty.call(reportInventory.data.data, 'byWarehouse'),
      `status=${reportInventory.status}`,
    )

    const reportRoleWorkbench = await http.get('/api/reports/role-workbench', { token: adminToken })
    log.assert(
      '角色工作台返回 summary / sections / topAlert',
      reportRoleWorkbench.status === 200
        && reportRoleWorkbench.data?.success === true
        && reportRoleWorkbench.data?.data
        && Object.prototype.hasOwnProperty.call(reportRoleWorkbench.data.data, 'summary')
        && Object.prototype.hasOwnProperty.call(reportRoleWorkbench.data.data, 'sections')
        && Object.prototype.hasOwnProperty.call(reportRoleWorkbench.data.data, 'topAlert'),
      `status=${reportRoleWorkbench.status}`,
    )

    const reportReconciliation = await http.get('/api/reports/reconciliation?type=1', { token: adminToken })
    log.assert(
      '对账报表返回 summary / list / pagination',
      reportReconciliation.status === 200
        && reportReconciliation.data?.success === true
        && reportReconciliation.data?.data
        && Object.prototype.hasOwnProperty.call(reportReconciliation.data.data, 'summary')
        && Array.isArray(reportReconciliation.data.data.list)
        && Object.prototype.hasOwnProperty.call(reportReconciliation.data.data, 'pagination'),
      `status=${reportReconciliation.status}`,
    )

    log.section('import / export / search / admin')
    const importTemplate = await http.get('/api/import/products/template', { token: adminToken, expectBinary: true })
    log.assert('商品导入模板可下载', importTemplate.status === 200 && importTemplate.data.length > 0, `status=${importTemplate.status}`)

    const stockTemplate = await http.get('/api/import/stock/template', { token: adminToken, expectBinary: true })
    log.assert('库存导入模板可下载', stockTemplate.status === 200 && stockTemplate.data.length > 0, `status=${stockTemplate.status}`)

    const importCode = `SMOKE-IMP-${Date.now()}`
    const importBuffer = createImportWorkbook([[importCode, 'Smoke导入商品', '个', '', '', '9.99', 'smoke import']])
    const formData = new FormData()
    formData.append('file', new Blob([importBuffer]), 'smoke-products.xlsx')
    const importProducts = await http.post('/api/import/products', {
      token: adminToken,
      formData,
    })
    log.assert(
      '商品导入接口可执行',
      importProducts.status === 200
        && importProducts.data?.success === true
        && importProducts.data?.data
        && typeof importProducts.data.data.success === 'number',
      `status=${importProducts.status} body=${JSON.stringify(importProducts.data).slice(0, 300)}`,
    )

    const exportPurchase = await http.get('/api/export/purchase', { token: adminToken, expectBinary: true })
    log.assert('采购导出接口可执行', exportPurchase.status === 200 && exportPurchase.data.length > 0, `status=${exportPurchase.status}`)

    const exportStock = await http.get('/api/export/stock', { token: adminToken, expectBinary: true })
    log.assert('库存导出接口可执行', exportStock.status === 200 && exportStock.data.length > 0, `status=${exportStock.status}`)

    const searchResponse = await http.get(`/api/search?q=${encodeURIComponent(product.code)}`, { token: limitedToken })
    log.assert(
      '全局搜索接口兼容返回数组',
      searchResponse.status === 200
        && searchResponse.data?.success === true
        && Array.isArray(searchResponse.data?.data),
      `status=${searchResponse.status}`,
    )

    const purchaseCreate2 = await createPurchaseOrder(http, adminToken, {
      supplier,
      warehouse,
      product,
      quantity: 2,
    })
    const purchaseId2 = purchaseCreate2.data?.data?.id
    await confirmPurchaseOrder(http, adminToken, purchaseId2)
    const inboundCreate2 = await createInboundTaskFromPurchase(http, adminToken, purchaseId2)
    const inboundTaskId2 = inboundCreate2.data?.data?.taskId
    await http.post(`/api/inbound-tasks/${inboundTaskId2}/submit`, { token: adminToken })
    await http.post(`/api/inbound-tasks/${inboundTaskId2}/receive`, {
      token: adminToken,
      json: {
        productId: Number(product.id),
        packages: [{ qty: 2 }],
      },
    })
    const inboundContainers2 = await http.get(`/api/inbound-tasks/${inboundTaskId2}/containers`, { token: adminToken })
    const adminContainer = inboundContainers2.data?.data?.waiting?.[0] || inboundContainers2.data?.data?.list?.[0]
    log.assert('管理员补录前存在待上架容器', !!adminContainer, JSON.stringify(inboundContainers2.data).slice(0, 400))

    const adminForbidden = await http.post('/api/admin/putaway', {
      token: limitedToken,
      json: {
        taskId: Number(inboundTaskId2),
        containerId: Number(adminContainer.id),
        locationId: Number(location.id),
      },
    })
    log.assert('管理员工具权限点生效', adminForbidden.status === 403, `status=${adminForbidden.status}`)

    const adminPutaway = await http.post('/api/admin/putaway', {
      token: adminToken,
      json: {
        taskId: Number(inboundTaskId2),
        containerId: Number(adminContainer.id),
        locationId: Number(location.id),
      },
    })
    await expectJsonSuccess(log, adminPutaway, '管理员补录上架成功')
  } finally {
    await ctx.close()
  }

  const summary = log.summary()
  if (summary.failed > 0) process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exit(1)
})
