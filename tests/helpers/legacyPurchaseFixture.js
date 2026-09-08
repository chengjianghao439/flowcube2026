'use strict'
function fixture() {
  const suffixes = ['20260324001', '20260324002', '20260325001', '20260328001']
  return {
    tasks: suffixes.map((n, i) => ({ id: i + 1, task_no: 'IT' + n, purchase_order_id: i + 1, purchase_order_no: 'PO' + n, warehouse_id: 1, status: 3, audit_status: 0, deleted_at: null })),
    purchases: suffixes.map((n, i) => ({ id: i + 1, order_no: 'PO' + n, warehouse_id: 1, supplier_name: '测试供应商', total_amount: '33.13', status: i === 0 ? 3 : 4, deleted_at: null })),
    purchaseItems: suffixes.map((n, i) => ({ id: i + 1, order_id: i + 1, product_id: 1, quantity: 1, unit_price: '33.13', amount: '33.13' })),
    items: suffixes.map((n, i) => ({ id: i + 1, task_id: i + 1, purchase_order_id: null, purchase_order_no: null, purchase_item_id: null, product_id: 1, ordered_qty: 1, received_qty: 1, putaway_qty: 0 })),
    stock: [{ id: 1, product_id: 1, warehouse_id: 1, quantity: 100, reserved: 0 }],
    containers: ['CNT001001', 'CNT010011', 'CNT100111', 'CNT1001111', 'CNT10011111'].map((barcode, i) => ({
      id: 101 + i, barcode, product_id: 1, warehouse_id: 1, parent_id: null, locked_by_task_id: null, location_id: null,
      initial_qty: 1, remaining_qty: 1, status: i === 0 ? 1 : 4, deleted_at: null,
      inbound_task_id: i === 0 ? null : (i === 4 ? 1 : i + 1), inbound_task_item_id: i === 0 ? null : (i === 4 ? 1 : i + 1),
      source_ref_type: i === 0 ? 'purchase_order' : 'inbound_task', source_ref_id: i === 4 ? 1 : i + 1,
      source_ref_no: (i === 0 ? 'PO' : 'IT') + suffixes[i === 4 ? 0 : i], source_type: i === 0 ? 'manual' : 'inbound_task',
    })),
    logs: [{ id: 108, ref_type: 'purchase_order', ref_id: 1, ref_no: 'PO20260324001', product_id: 1, warehouse_id: 1, quantity: 1, unit_price: '33.13', move_type: 1, type: 1 }],
    payments: [{ id: 6, type: 1, order_id: 1, order_no: 'PO20260324001', party_name: '测试供应商', total_amount: '33.13', paid_amount: 0, balance: '33.13', status: 1, confirm_status: 1, settlement_type: 2 }],
    events: [], paymentEvents: [],
    dependencies: { returns: [], entries: [], refunds: [], statements: [], invoices: [], vouchers: [], bindings: [], printJobs: [] },
  }
}
module.exports = { fixture }
