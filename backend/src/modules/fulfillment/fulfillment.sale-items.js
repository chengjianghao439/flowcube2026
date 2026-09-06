// Sales edits replace item IDs. Preserve the delivery contract for retained
// product/warehouse pairs inside the caller's existing order transaction.
async function snapshotItemCommitments(conn, orderId) {
  const [rows] = await conn.query(`SELECT c.*,i.product_id,COALESCE(i.warehouse_id,s.warehouse_id) AS warehouse_id
    FROM order_delivery_commitments c JOIN sale_order_items i ON i.id=c.item_id AND i.order_id=c.document_id
    JOIN sale_orders s ON s.id=i.order_id WHERE c.document_type='sale' AND c.document_id=? AND c.item_id<>0`, [orderId])
  return rows
}
async function restoreItemCommitments(conn, orderId, snapshot) {
  await conn.query("DELETE FROM order_delivery_commitments WHERE document_type='sale' AND document_id=? AND item_id<>0", [orderId])
  for (const row of snapshot) {
    await conn.query(`INSERT INTO order_delivery_commitments
      (document_type,document_id,item_id,promised_date,original_date,processing_days,updated_at)
      SELECT 'sale',i.order_id,i.id,?,?,?,? FROM sale_order_items i JOIN sale_orders s ON s.id=i.order_id
      WHERE i.order_id=? AND i.product_id=? AND COALESCE(i.warehouse_id,s.warehouse_id)=?`,
    [row.promised_date, row.original_date, row.processing_days, row.updated_at, orderId, row.product_id, row.warehouse_id])
  }
}
module.exports = { snapshotItemCommitments, restoreItemCommitments }
