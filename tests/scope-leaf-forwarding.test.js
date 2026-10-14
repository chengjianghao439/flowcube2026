const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const base = path.join(__dirname, '../backend/src')
function load(relative, deps, transform = source => source) {
  const filename = path.join(base, relative), module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, require: name => Object.hasOwn(deps, name) ? deps[name] : {} }, { filename })
  return module.exports
}
test('信用导出从当前req.user传scope覆盖伪造query；集合继续传列表服务', async () => {
  for (const scope of [[8], [], null]) {
    let actual
    const controller = load('modules/export/export.controller.js', {
      '../../utils/excelExport': { async exportXlsx() {} },
      './export.service': { async getCreditOverridesExportPayload(query) { actual = query; return { columns: [], rows: [] } } },
      '../../constants/permissions': { PERMISSIONS: {} },
    })
    await controller.exportCreditOverrides({ query: { keyword: 'SYNTHETIC', scopeWarehouseIds: [9] }, user: { warehouseIds: scope } }, {}, e => { throw e })
    assert.equal(actual.scopeWarehouseIds, scope); assert.equal(actual.keyword, 'SYNTHETIC')
    const findAll = () => {}, calls = []
    const service = load('modules/export/export.service.js', {
      '../../utils/exportRows': { async collectExportRows(method, query) { assert.equal(method, findAll); calls.push(query); return { list: [] } }, assertExportLimit() {} },
      '../credit-overrides/credit-overrides.service': { findAll },
      '../../utils/backendTime': { beijingTodayYmd: () => '2026-10-13' },
    })
    await service.getCreditOverridesExportPayload({ ...actual, saleOrderId: 21 })
    assert.equal(calls[0].scopeWarehouseIds, scope); assert.equal(calls[0].saleOrderId, 21)
  }
})
test('塑料盒流水先核当前盒scope再向inventory传同一scope，外仓不能读历史', async () => {
  for (const scope of [[8], null, [9], []]) {
    const calls = [], service = load('modules/plastic-boxes/plastic-boxes.service.js', {
      '../../config/db': { pool: { async query() { return [[{ id: 11, warehouse_id: 8, barcode: 'B-SYNTHETIC' }]] } } },
      '../../utils/AppError': AppError,
      '../../utils/warehouseScope': { assertInScope(actual, warehouse) { if (Array.isArray(actual) && !actual.includes(warehouse)) throw new AppError('外仓', 403) } },
      '../inventory/inventory.service': { async getContainerLogs(id, actual) { calls.push({ id, scope: actual }); return [] } },
    })
    if (Array.isArray(scope) && !scope.includes(8)) { await assert.rejects(service.findMovements(11, scope), e => e.statusCode === 403); assert.equal(calls.length, 0) }
    else { await service.findMovements(11, scope); assert.equal(calls[0].id, 11); assert.equal(calls[0].scope, scope) }
  }
})
test('反向验证：删实际信用导出或塑料盒scope参数，既定透传断言自然失败', async () => {
  const scope = [8]
  for (const kind of ['export', 'plastic']) {
    let actual
    const relative = kind === 'export' ? 'modules/export/export.service.js' : 'modules/plastic-boxes/plastic-boxes.service.js'
    const line = kind === 'export' ? '    scopeWarehouseIds: query.scopeWarehouseIds ?? null,' : '.getContainerLogs(id, scopeWarehouseIds)'
    const source = fs.readFileSync(path.join(base, relative), 'utf8')
    // Restrict mutation to the named entry; other exports are never executed.
    const marker = kind === 'export' ? 'async function getCreditOverridesExportPayload' : 'async function findMovements'
    const pos = source.indexOf(marker), target = source.indexOf(line, pos); assert.ok(target > pos)
    const mutant = load(relative, {
      '../../utils/exportRows': { async collectExportRows(_method, query) { actual = query.scopeWarehouseIds; return { list: [] } }, assertExportLimit() {} },
      '../../utils/backendTime': { beijingTodayYmd: () => '2026-10-13' },
      '../../config/db': { pool: { async query() { return [[{ id: 11, warehouse_id: 8, barcode: 'B-SYNTHETIC' }]] } } },
      '../../utils/warehouseScope': { assertInScope() {} },
      '../inventory/inventory.service': { async getContainerLogs(_id, value) { actual = value; return [] } },
    }, text => text.slice(0, target) + text.slice(target).replace(line, kind === 'export' ? '' : '.getContainerLogs(id)'))
    if (kind === 'export') await mutant.getCreditOverridesExportPayload({ scopeWarehouseIds: scope }); else await mutant.findMovements(11, scope)
    assert.throws(() => assert.equal(actual, scope), e => e.code === 'ERR_ASSERTION')
  }
})
