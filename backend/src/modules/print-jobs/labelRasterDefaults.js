/** Fallback only when no stored template exists. Stored layouts always take precedence. */
function defaultLabelLayout(type) {
  const barcodeKey = { 5: 'rack_barcode', 6: 'container_code', 7: 'box_code', 8: 'product_code', 9: 'container_code', 10: 'location_barcode' }[type]
  const fields = {
    5: ['rack_code', 'zone', 'name'], 6: ['product_name', 'qty'],
    7: ['task_no', 'customer_name', 'carrier_name', 'freight_type_name', 'piece_count', 'item_list'],
    8: ['product_name', 'spec', 'unit', 'price'], 9: ['product_name'], 10: ['location_code', 'zone', 'name'],
  }[type]
  if (!fields) throw new Error('未知标签类型')
  const compact = type === 7
  return { canvasWidthMm: 75, canvasHeightMm: 50, dpi: 203, elements: [
    { id: 'barcode', type: 'barcode', fieldKey: barcodeKey, x: 2, y: 2, width: 71, height: 12 },
    ...fields.map((fieldKey, i) => ({ id: fieldKey, type: 'text', fieldKey, x: 2, y: 16 + i * (compact ? 5 : 7), width: 71, height: compact ? 5 : 7, fontHeightMm: compact ? 2.5 : 3.2 })),
  ] }
}
module.exports = { defaultLabelLayout }
