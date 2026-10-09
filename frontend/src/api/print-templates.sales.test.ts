import { readFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import api from './client'
import { getPrintTemplateListApi, getPrintTemplateDetailApi } from './print-templates'
import type { PrintTemplate } from '@/types/print-template'
const original = api.defaults.adapter
const sql = readFileSync(new URL('../../../backend/src/database/079_seed_default_print_templates.sql', import.meta.url), 'utf8')
const legacyLayout = JSON.parse(sql.match(/SELECT '默认销售订单模板', 1, 'A4', '(.*?)', 1/)![1])
const template = (): PrintTemplate => ({ id: 1, name: '默认销售订单模板', type: 1, typeName: '销售订单', paperSize: 'A4', layout: structuredClone(legacyLayout), isDefault: true, createdBy: null, createdAt: '', updatedAt: '' })
function respond(t: PrintTemplate) { api.defaults.adapter = async config => ({ status: 200, statusText: 'OK', config, headers: {}, data: { success: true, data: config.url === '/print-templates' ? [t] : t } }) }
afterEach(() => { api.defaults.adapter = original })
test('exact historical system sale template is upgraded on reads, preserves gross and never writes', async () => {
  const old = template(), snapshot = JSON.stringify(old); respond(old)
  const [list] = await getPrintTemplateListApi({ type: 1 }), detail = await getPrintTemplateDetailApi(1)
  expect(list.layout).toEqual(detail.layout)
  expect('elements' in list.layout && list.layout.elements.map(e => e.fieldKey)).toContain('discountAmount')
  expect('elements' in list.layout && list.layout.elements.map(e => e.fieldKey)).toContain('netAmount')
  expect(JSON.stringify(old)).toBe(snapshot)
  respond(list); const repeated = await getPrintTemplateDetailApi(1); expect(repeated).toEqual(list)
})
test.each(['font', 'width', 'position', 'margins', 'name', 'createdBy', 'purchase', 'element'])('customized %s templates remain byte-equivalent', async kind => {
  const custom = template()
  if (!('elements' in custom.layout)) throw new Error('fixture')
  if (kind === 'font') custom.layout.elements[0].fontSize++
  if (kind === 'width') custom.layout.elements[11].tableColumnWidths = { name: 80 }
  if (kind === 'position') custom.layout.elements[12].y++
  if (kind === 'margins') custom.layout.margins = { top: 8, bottom: 8, left: 0, right: 0 }
  if (kind === 'name') custom.name = '我的默认销售单'
  if (kind === 'createdBy') custom.createdBy = '用户'
  if (kind === 'purchase') custom.type = 2
  if (kind === 'element') custom.layout.elements.pop()
  const snapshot = JSON.stringify(custom); respond(custom)
  expect(JSON.stringify(await getPrintTemplateDetailApi(1))).toBe(snapshot)
})
