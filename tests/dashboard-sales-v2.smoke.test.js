'use strict'

// 仅在公共 helper 校验通过的独立测试库运行；不读取开发库配置。
const assert = require('node:assert/strict')
const {
  prepareSmokeContext,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

async function main() {
  const ctx = await prepareSmokeContext()
  const { pool, http, customer, warehouse, product } = ctx
  try {
    const { token } = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    assert.ok(token, '隔离测试账号登录成功')
    const marker = randomRef('v2')
    const dashboard = require('../backend/src/modules/dashboard/dashboard.service')
    const before = await dashboard.getSummary()
    const ids = []
    for (const status of [1, 6, 2]) {
      const response = await http.post('/api/sale', {
        token,
        json: {
          customerId: customer.id,
          customerName: customer.name,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          remark: marker,
          items: [
            {
              productId: product.id,
              productCode: product.code,
              productName: product.name,
              unit: product.unit,
              quantity: 2,
              unitPrice: 10,
            },
          ],
        },
      })
      assert.ok(response.ok, JSON.stringify(response.data))
      ids.push(response.data.data.id)
      // 只读投影 fixture：不模拟/宣称库存业务动作已完成。
      await pool.query('UPDATE sale_orders SET status=? WHERE id=?', [
        status,
        ids.at(-1),
      ])
    }
    const sale = require('../backend/src/modules/sale/sale.service')
    const list = await sale.findAll({ remark: marker, status: 1, pageSize: 1 })
    assert.equal(list.list.length, 1)
    assert.equal(list.pagination.total, 1)
    assert.deepEqual(
      list.statusCounts,
      { 1: 1, 2: 1, 6: 1 },
      '计数不受分页和当前状态限制',
    )
    assert.equal(list.list[0].quantitySummary[0].ordered, 2)
    const none = await sale.findAll({ remark: marker, scopeWarehouseIds: [] })
    assert.equal(none.pagination.total, 0)
    assert.deepEqual(none.statusCounts, {}, '空仓库范围不泄露计数')
    const summary =
      await require('../backend/src/modules/dashboard/dashboard.service').getSummary()
    assert.equal(
      summary.pendingSaleOrders - before.pendingSaleOrders,
      3,
      '待处理包含部分占库，不包含执行中',
    )
    const noScope =
      await require('../backend/src/modules/dashboard/dashboard.service').getSummary(
        [],
      )
    assert.equal(noScope.pendingSaleOrders, 0)
    const {
      loadSalePresentation,
    } = require('../backend/src/modules/sale/sale.presentation')
    await pool.query(
      'UPDATE sale_order_items SET unit=?, quantity=0.3,reserved_qty=0.2,dispatched_qty=0.1,shipped_qty=0.1 WHERE order_id=?',
      ['米', ids[0]],
    )
    await pool.query(
      `INSERT INTO sale_order_items (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount) VALUES (?,?,?,?,?,2,10,20)`,
      [ids[0], product.id, product.code, product.name, '件'],
    )
    const projection = (await loadSalePresentation(pool, [ids[0]])).get(
      Number(ids[0]),
    )
    assert.equal(projection.quantitySummary.length, 2, '不同单位不能相加')
    assert.equal(
      projection.quantitySummary.find((q) => q.unit === '米').reserved,
      0.2,
    )
    assert.deepEqual(await loadSalePresentation(pool, []), new Map())

    const {
      aging,
    } = require('../backend/src/modules/payments/payment-aging.service')
    const previousAging = await aging()
    // 优先待办采用真实待归还/授信标记；普通订单按创建时间稳定排序。
    await pool.query(
      'UPDATE sale_orders SET created_at=DATE_SUB(NOW(),INTERVAL 30 DAY) WHERE id=?',
      [ids[0]],
    )
    await pool.query('UPDATE sale_orders SET status=4 WHERE id=?', [ids[2]])
    const pending = await sale.findAll({ remark: marker, focus: 'pending' })
    assert.equal(pending.pagination.total, 2)
    assert.equal(pending.list[0].id, ids[0])
    assert.ok(pending.list.every((row) => row.status !== 4))
    await pool.query(
      `INSERT INTO sale_credit_overrides (override_no,sale_order_id,sale_order_no,customer_id,customer_name,credit_limit,this_amount,over_amount,applicant_id,applicant_name,status) VALUES (?,?,?,?,?,1,20,19,2,'测试',2)`,
      [marker, ids[1], String(ids[1]), customer.id, customer.name],
    )
    const approvalFirst = await sale.findAll({
      remark: marker,
      focus: 'pending',
    })
    assert.equal(
      approvalFirst.list[0].id,
      ids[1],
      '较新的待授信审批优先于普通旧订单',
    )
    assert.equal(approvalFirst.list[0].pendingCredit, true)

    await pool.query('UPDATE sale_customers SET credit_limit=1 WHERE id=?', [
      customer.id,
    ])
    const creditPage = await dashboard.getCreditWarning({
      page: 1,
      pageSize: 1,
    })
    assert.ok(creditPage.pagination.total >= 1)
    assert.equal(creditPage.list.length, 1)
    assert.ok(creditPage.list.every((row) => row.over))
    const emptyStock = await dashboard.getLowStock(10, [], {
      page: 1,
      pageSize: 10,
    })
    assert.equal(emptyStock.pagination.total, 0)
    assert.deepEqual(emptyStock.list, [])
    const {
      createContainer,
      syncStockFromContainers,
      SOURCE_TYPE,
      CONTAINER_STATUS,
    } = require('../backend/src/engine/containerEngine')
    for (let n = 0; n < 23; n++) {
      const [productRow] = await pool.query(
        'INSERT INTO product_items (code,name,unit) VALUES (?,?,?)',
        [`${marker}-${n}`, '风险分页商品', '件'],
      )
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        await createContainer(conn, {
          productId: productRow.insertId,
          warehouseId: warehouse.id,
          initialQty: 1,
          unit: '件',
          sourceType: SOURCE_TYPE.TRANSFER,
          sourceRefId: productRow.insertId,
          sourceRefType: 'test_seed',
          sourceRefNo: marker,
          containerStatus: CONTAINER_STATUS.ACTIVE,
          locationId: ctx.location.id,
        })
        await syncStockFromContainers(conn, productRow.insertId, warehouse.id)
        await conn.commit()
      } catch (error) {
        await conn.rollback()
        throw error
      } finally {
        conn.release()
      }
    }
    const risk1 = await dashboard.getLowStock(10, [warehouse.id], {
      page: 1,
      pageSize: 10,
    })
    const risk2 = await dashboard.getLowStock(10, [warehouse.id], {
      page: 2,
      pageSize: 10,
    })
    assert.ok(risk1.pagination.total >= 23)
    assert.equal(risk2.list.length, 10)
    assert.ok(
      risk1.list.every(
        (a) =>
          !risk2.list.some(
            (b) => a.id === b.id && a.warehouseId === b.warehouseId,
          ),
      ),
    )
    assert.equal(
      (await dashboard.getLowStock(10, [warehouse.id])).length,
      20,
      '兼容旧接口上限',
    )
    // 所有日期均在 MySQL 北京时区计算，覆盖昨天、今天、第 1/7/8 天和未知日期。
    for (const [index, offset] of [-1, 0, 1, 7, 8, null].entries()) {
      await pool.query(
        `INSERT INTO payment_records (type,order_no,party_name,total_amount,balance,status,due_date)
        VALUES (2,?,?,100,100,1,${offset === null ? 'NULL' : 'DATE_ADD(CURDATE(), INTERVAL ? DAY)'})`,
        [marker + index, marker, ...(offset === null ? [] : [offset])],
      )
    }
    await pool.query(
      'INSERT INTO payment_records (type,order_no,party_name,total_amount,balance,status,due_date) VALUES (2,?,?,100,0,3,CURDATE()),(1,?,?,100,100,1,CURDATE())',
      [marker + 'paid', marker, marker + 'ap', marker],
    )
    const report = await aging()
    assert.deepEqual(
      report.receivable.dueDistribution.map(
        (b, i) => b.count - previousAging.receivable.dueDistribution[i].count,
      ),
      [1, 1, 2, 1, 1],
    )
    assert.equal(
      report.receivable.dueDistribution.reduce((sum, b) => sum + b.amount, 0),
      report.receivable.total,
    )
    assert.equal(report.receivable.total - previousAging.receivable.total, 600)
    console.log(
      'PASS: 销售状态计数、仓库范围、混合单位、小数、待办优先级、风险分页、应收到期边界与总额守恒',
    )
  } finally {
    await ctx.close()
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
