'use strict'
function fixture() {
  return {
    orders: [
      { id: 1, order_no: 'SO20260315001', customer_name: '甲', warehouse_id: 1, status: 4, total_amount: '358.4300', discount_amount: 0, deleted_at: null },
      { id: 2, order_no: 'SO20260326001', customer_name: '乙', warehouse_id: 1, status: 5, total_amount: '190.4800', discount_amount: 0, deleted_at: '2026-03-26 16:36:34' },
    ],
    items: [
      { id: 1, order_id: 1, warehouse_id: 1, product_id: 11, quantity: '1', shipped_qty: '0', unit_price: '164.62', amount: '164.62' },
      { id: 2, order_id: 1, warehouse_id: 1, product_id: 14, quantity: '1', shipped_qty: '0', unit_price: '193.81', amount: '193.81' },
      { id: 3, order_id: 2, warehouse_id: 1, product_id: 1, quantity: '1', shipped_qty: '0', unit_price: '190.48', amount: '190.48' },
    ],
    tasks: [{ id: 1, task_no: 'WT20260315001', task_type: 'sale_out', sale_order_id: 1, sale_order_no: 'SO20260315001', warehouse_id: 1, status: 7, shipped_at: '2026-03-15 17:01:43', deleted_at: null }],
    taskItems: [
      { id: 1, task_id: 1, product_id: 11, required_qty: 1, picked_qty: 1, checked_qty: 1 },
      { id: 2, task_id: 1, product_id: 14, required_qty: 1, picked_qty: 1, checked_qty: 1 },
    ],
    payments: [
      { id: 1, type: 2, order_id: 1, order_no: 'SO20260315001', party_name: '甲', total_amount: '379.80', paid_amount: 0, balance: '379.80', status: 1, confirm_status: 1, settlement_type: 2 },
      { id: 2, type: 2, order_id: 2, order_no: 'SO20260326001', party_name: '乙', total_amount: '122.27', paid_amount: 0, balance: '122.27', status: 1, confirm_status: 1, settlement_type: 2 },
    ],
    paymentEvents: [], saleEvents: [],
    dependencies: { entries: [], statements: [], refunds: [], returns: [], invoices: [], vouchers: [], periods: [] },
  }
}

module.exports = { fixture }
