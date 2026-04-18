const { pool } = require('../../config/db')

const LABELS = {
  product: '商品',
  supplier: '供应商',
  customer: '客户',
  purchase: '采购单',
  sale: '销售单',
}

const PATHS = {
  product: '/products',
  supplier: '/suppliers',
  customer: '/customers',
  purchase: '/purchase',
  sale: '/sale',
}

async function searchGlobal(rawQuery) {
  const keyword = String(rawQuery || '').trim()
  if (!keyword) {
    return {
      data: [],
      message: '请输入搜索词',
    }
  }

  const like = `%${keyword}%`
  const [products] = await pool.query(
    `SELECT id, code AS subtitle, name AS title, 'product' AS type FROM product_items WHERE deleted_at IS NULL AND (name LIKE ? OR code LIKE ?) LIMIT 5`,
    [like, like],
  )
  const [suppliers] = await pool.query(
    `SELECT id, code AS subtitle, name AS title, 'supplier' AS type FROM supply_suppliers WHERE deleted_at IS NULL AND name LIKE ? LIMIT 5`,
    [like],
  )
  const [customers] = await pool.query(
    `SELECT id, code AS subtitle, name AS title, 'customer' AS type FROM sale_customers WHERE deleted_at IS NULL AND name LIKE ? LIMIT 5`,
    [like],
  )
  const [purchases] = await pool.query(
    `SELECT id, supplier_name AS subtitle, order_no AS title, 'purchase' AS type FROM purchase_orders WHERE deleted_at IS NULL AND order_no LIKE ? LIMIT 5`,
    [like],
  )
  const [sales] = await pool.query(
    `SELECT id, customer_name AS subtitle, order_no AS title, 'sale' AS type FROM sale_orders WHERE deleted_at IS NULL AND order_no LIKE ? LIMIT 5`,
    [like],
  )

  const results = [...products, ...suppliers, ...customers, ...purchases, ...sales].map((row) => ({
    id: row.id,
    type: row.type,
    typeLabel: LABELS[row.type],
    title: row.title,
    subtitle: row.subtitle,
    path: PATHS[row.type],
  }))

  return {
    data: results,
    message: results.length ? '搜索成功' : '未找到相关内容',
  }
}

module.exports = {
  searchGlobal,
}
