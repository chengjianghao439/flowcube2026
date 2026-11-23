import assert from 'node:assert/strict';

export const customer = { id: 7, name: '远山机电2号店', code: 'C110007', priceLevel: 'A' };
const customers = [customer, { id: 8, name: '远山机电3号店', code: 'C110008', priceLevel: 'A' }];
const products = [
  { id: 11, name: '长款铰链', code: 'P110001', unit: '个', costPrice: 2.5, allowDecimalQty: false },
  { id: 12, name: '短款铰链', code: 'P110002', unit: '个', allowDecimalQty: false },
];
const warehouses = [{ id: 1, name: '一仓' }, { id: 2, name: '二仓' }];
export const stock = [
  { productId: 11, warehouseId: 1, quantity: 11, reserved: 3, available: 8 },
  { productId: 11, warehouseId: 2, quantity: 17, reserved: 2, available: 15 },
  { productId: 12, warehouseId: 1, quantity: 0, reserved: 0, available: 0 },
].map(row => {
  const product = products.find(p => p.id === row.productId);
  return { ...row, productName: product.name, productCode: product.code, unit: product.unit };
});
export const order = { id: 41, orderNo: 'SL20261122011', warehouseId: 1, warehouseName: '一仓', customerName: customer.name };
export const pendingTask = 'WT20261122012';
const denied = () => Object.assign(new Error('当前接口无权查看'), { status: 403 });

export function createFixtureFlow(actor) {
  const reads = [];
  const writes = [];
  const visible = id => actor.warehouseIds.includes(id);
  const has = code => actor.isSuper || actor.permissions.includes(code);
  const withPermission = (code, value) => {
    if (!has(code)) throw denied();
    return value;
  };
  const client = {
    async get(path) {
      const { pathname, searchParams: q } = new URL(path, 'http://fixture');
      reads.push({ pathname, query: Object.fromEntries(q) });
      if (pathname === '/api/search/') {
        const keyword = q.get('q');
        return [['customer', customers], ['product', products]].flatMap(([type, entities]) =>
          has(type + '.view') && keyword ? entities.filter(row => row.name.includes(keyword) || row.code === keyword)
            .map(row => ({ id: row.id, type, title: row.name, subtitle: row.code, searchRank: 0 })) : []);
      }
      if (pathname === '/api/warehouses') return withPermission('warehouse.view', { list: warehouses.filter(w => visible(w.id)) });
      if (pathname === '/api/inventory/stock') return withPermission('inventory.view', { list: stock.filter(row => visible(row.warehouseId)) });
      if (pathname === '/api/inventory/replenishment') {
        const warehouseId = Number(q.get('warehouseId'));
        assert.ok(visible(warehouseId));
        return withPermission('report.view', { list: [{
          warehouseId, productId: 11, productName: products[0].name, productCode: products[0].code,
          unit: '个', supplierId: 9, supplierName: '合成五金', onHand: 11, available: 8, inTransit: 0, suggestedQty: 4,
        }] });
      }
      if (pathname === '/api/inventory/query-by-product') {
        assert.ok(visible(Number(q.get('warehouseId'))), '库存请求必须保留当前仓库范围');
        const row = stock.find(r => r.productId === Number(q.get('productId')) && r.warehouseId === Number(q.get('warehouseId')));
        return withPermission('inventory.view', {
          containers: row?.quantity ? [{ barcode: 'I' + row.warehouseId + '000001', remainingQty: row.quantity }] : [],
        });
      }
      const product = products.find(p => pathname === '/api/products/' + p.id);
      if (product) return withPermission('product.view', product);
      const party = customers.find(p => pathname === '/api/customers/' + p.id);
      if (party) return withPermission('customer.view', party);
      if (pathname === '/api/payments/party-ledger') {
        assert.equal(q.get('type'), '2');
        assert.equal(q.get('partyId'), String(customer.id));
        return withPermission('payment.view', { summary: { closingBalance: 18.52 }, list: [] });
      }
      if (pathname === '/api/payments/') return withPermission('payment.view', {
        list: [{ id: 51, orderNo: order.orderNo, totalAmount: 18.52, paidAmount: 0, balance: 18.52, status: 1 }],
      });
      if (pathname === '/api/finance/accounts/active') return withPermission('finance.account.view', [{ id: 9, name: '合成账户' }]);
      if (pathname === '/api/price-lists/customer-price') return withPermission('price.list.view', { salePrice: 3.25, priceLevel: 'A', source: 'price_level' });
      if (pathname === '/api/sale/') return withPermission('sale.order.view', { list: visible(1) ? [order] : [] });
      if (pathname === '/api/sale/41/reserve-preview') {
        return withPermission('sale.order.reserve', { ...order, items: [{
          itemId: 81, productId: 11, productName: products[0].name, unit: '个', remainToReserve: 2, reservedQty: 0,
          warehouses: [{ warehouseId: 1, available: 8, pickableQuantity: 8 }],
        }] });
      }
      if (pathname === '/api/sale/42' && writes.length) return withPermission('sale.order.view', writes[0].created);
      if (pathname === '/api/warehouse-tasks/stats') return withPermission('warehouse.task.view', { picking: 1, packing: 2 });
      if (pathname === '/api/warehouse-tasks/sorting-bin-pending') return withPermission('warehouse.task.assign', [{ taskNo: pendingTask, warehouseId: 1 }]);
      if (pathname === '/api/inbound-tasks/') return withPermission('inbound.order.view', { list: [] });
      if (pathname === '/api/dashboard/summary') return withPermission('dashboard.view', { totalSkus: 1 });
      if (['/api/dashboard/low-stock', '/api/dashboard/incoming-purchases'].includes(pathname)) return withPermission('dashboard.view', []);
      if (pathname === '/api/dashboard/credit-warning') return withPermission('sale.credit.view', []);
      if (pathname === '/api/approvals/pending') throw denied();
      assert.fail('未登记的合成读取 ' + pathname);
    },
    async post(path, payload, { requestKey } = {}) {
      assert.equal(path, '/api/sale/');
      assert.ok(has('sale.order.create') && requestKey);
      const created = { id: 42, orderNo: 'SL20261122012', totalAmount: payload.items[0].quantity * 3.25, status: 1,
        customerId: payload.customerId, warehouseId: payload.warehouseId,
        items: payload.items.map(item => ({ productId: item.productId, warehouseId: item.warehouseId ?? payload.warehouseId, quantity: item.quantity })) };
      writes.push({ path, payload, requestKey, created });
      return created;
    },
  };
  return { reads, writes, client };
}
