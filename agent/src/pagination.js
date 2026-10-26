// 有界读取完整集合；截断、重复或总数漂移时停步，不把首批当成全量。
export async function collectList(client, path, filters = {}) {
  const list = [], ids = new Set();
  let total = null, summary = null;
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ ...filters, page: String(page), pageSize: '100' });
    const data = await client.get(`${path}?${query}`);
    const rows = Array.isArray(data) ? data : data?.list;
    if (!Array.isArray(rows)) throw new Error('列表接口未返回可核对的明细，已停下');
    if (page === 1) { total = data?.pagination?.total ?? null; summary = data?.summary ?? null; }
    else if (data?.pagination?.total != null && Number(data.pagination.total) !== Number(total)) throw new Error('查询期间记录数量变化，请重新查询');
    for (const row of rows) {
      const id = row.id ?? `${row.productId}@${row.warehouseId}`;
      if (ids.has(String(id))) throw new Error('查询结果出现重复记录，请重新查询');
      ids.add(String(id)); list.push(row);
    }
    if (total != null ? list.length >= Number(total) : rows.length < 100) {
      if (total != null && list.length !== Number(total)) throw new Error('记录数量不完整，已停下');
      return { list, summary };
    }
    if (!rows.length) throw new Error('记录读取不完整，已停下');
  }
  throw new Error('记录超过本次可核对范围，请缩小范围后到原页面办理');
}
