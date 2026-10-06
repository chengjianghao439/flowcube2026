const { z } = require('zod')
const AppError = require('../../utils/AppError')
const MAX_DOCUMENT_LAYOUT_BYTES = 64 * 1024
const MAX_DOCUMENT_ELEMENTS = 128
const MAX_DOCUMENT_COLUMNS = 10
const dimension = z.number().finite().min(0).max(2000)
const key = z.string().max(100)
const schema = z.object({
  elements: z.array(z.object({
    id: z.string().min(1).max(100), type: z.enum(['text', 'table', 'divider', 'title', 'barcode', 'image']),
    fieldKey: key, label: z.string().max(1000), x: dimension, y: dimension,
    width: dimension, height: dimension, fontSize: z.number().finite().min(1).max(100),
    fontWeight: z.enum(['normal', 'bold']), textAlign: z.enum(['left', 'center', 'right']), border: z.boolean(),
    tableColumns: z.array(key).max(MAX_DOCUMENT_COLUMNS).optional(), showIndex: z.boolean().optional(),
    nameAttrs: z.array(key).max(10).optional(), tableColumnWidths: z.record(key, dimension).refine(v => Object.keys(v).length <= 10).optional(),
    tableRowWrap: z.boolean().optional(), tableMinRowHeightMm: dimension.optional(),
    fontHeightMm: dimension.optional(), showLabel: z.boolean().optional(),
    barcodeSymbology: z.enum(['code128', 'ean13']).optional(), barcodeHRI: z.boolean().optional(),
  }).strict()).max(MAX_DOCUMENT_ELEMENTS),
  canvasWidthMm: dimension.optional(), canvasHeightMm: dimension.optional(), dpi: z.union([z.literal(203), z.literal(300)]).optional(),
  margins: z.object({ top: dimension, bottom: dimension, left: dimension, right: dimension }).strict().optional(),
}).strict()

function validateDocumentLayout(layout) {
  const invalid = () => new AppError('单据模板格式或大小超限：最多 128 个元素、每表 10 列、64 KiB，请精简模板', 400, 'PRINT_DOCUMENT_LAYOUT_INVALID')
  if (!layout || !Array.isArray(layout.elements) || layout.elements.length > MAX_DOCUMENT_ELEMENTS) throw invalid()
  for (const el of layout.elements) {
    if (!el || (el.tableColumns && (!Array.isArray(el.tableColumns) || el.tableColumns.length > MAX_DOCUMENT_COLUMNS)) || (el.tableColumnWidths && Object.keys(el.tableColumnWidths).length > MAX_DOCUMENT_COLUMNS)) throw invalid()
  }
  const parsed = schema.safeParse(layout)
  if (!parsed.success) throw invalid()
  if (new Set(layout.elements.map(e => e.id)).size !== layout.elements.length || layout.elements.filter(e => e.type === 'table').length > 1) throw invalid()
  if (Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > MAX_DOCUMENT_LAYOUT_BYTES) throw invalid()
  return parsed.data
}
module.exports = { validateDocumentLayout, MAX_DOCUMENT_LAYOUT_BYTES, MAX_DOCUMENT_ELEMENTS, MAX_DOCUMENT_COLUMNS }
