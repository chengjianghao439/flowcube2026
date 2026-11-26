import { collectList } from './pagination.js';

// 商品和仓库是库存展示的唯一维度，每批最多 2,000 个相关组合。
export async function readStockRows(client, productIds, { warehouseId, warehouseCount = 1 } = {}) {
  const ids = [...new Set(productIds.map(Number))];
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('库存查询商品编号无效');
  const width = Math.max(1, Math.min(100, Math.floor(2000 / Math.max(1, warehouseCount))));
  const rows = [];
  for (let i = 0; i < ids.length; i += width) {
    const batch = ids.slice(i, i + width);
    const filters = { productIds: batch.join(','), ...(warehouseId != null ? { warehouseId: String(warehouseId) } : {}) };
    const { list } = await collectList(client, '/api/inventory/stock', filters);
    rows.push(...list.filter(row => batch.includes(Number(row.productId))));
  }
  return rows;
}
