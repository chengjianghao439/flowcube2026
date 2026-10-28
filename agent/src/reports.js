// 仅把本次工具返回的可见事实排成简报；不从数量推断人员、设备或供应商原因。
const rowsOf = value => Array.isArray(value) ? value : Array.isArray(value?.list) ? value.list : [];
const top = rows => rows.slice(0, 5);
const missingValue = value => value == null || (typeof value === 'string' && value.trim() === '');
const money = value => !missingValue(value) && Number.isFinite(Number(value)) ? `¥${Number(value).toFixed(2)}` : '金额未返回';
const identity = row => row.taskNo || row.orderNo || row.bizNo || row.no || row.documentNo || (row.id != null ? `#${row.id}` : '单号未返回');
const sampleNote = (data, rows) => data?.pagination?.total != null ? `共 ${data.pagination.total} 项` : `本次返回 ${rows.length} 项`;
export const replenishmentBasisNote = '低库存按提醒阈值筛选；补货另按各商品、仓库的安全库存与目标、需求及在途试算，两者口径不同。';

export function statisticsTime(value) {
  if (missingValue(value)) return '统计时点未返回';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `北京时间 ${date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` : '统计时点未返回';
}

export function briefingReply(data) {
  const sections = data.sections || {};
  const lines = [`经营简报（当前可访问范围，${statisticsTime(data.asOf)}）`];
  const summary = sections.summary;
  if (summary?.ok) {
    const value = summary.data || {};
    const facts = [];
    if (value.totalSkus != null) facts.push(`有库存商品 ${value.totalSkus} 种`);
    if (value.totalValue != null) facts.push(`库存估值 ${money(value.totalValue)}`);
    if (value.pendingSaleOrders != null) facts.push(`待处理销售 ${value.pendingSaleOrders} 单`);
    if (value.pendingPurchaseOrders != null) facts.push(`待处理采购 ${value.pendingPurchaseOrders} 单`);
    lines.push(facts.join('；') || '经营概况：返回结果缺少可报告的汇总字段，请到经营看板核对');
  } else lines.push('经营概况：取数失败，请到经营看板核对');
  for (const [key, label] of Object.entries({ lowStock: '低库存提醒', creditWarning: '授信预警', incomingPurchases: '待入库采购', pendingApprovals: '待审批' })) {
    const section = sections[key];
    if (!section?.ok) { lines.push(`${label}：本次未取得，当前权限或接口不可用，请到原页面核对`); continue; }
    const value = section.data;
    const rows = rowsOf(value);
    if (key === 'lowStock') {
      lines.push(`${label}：${sampleNote(value, rows)}${rows.length ? '；' + top(rows).map(row => `${row.name || row.productName || row.code || identity(row)}${row.warehouseName ? `（${row.warehouseName}）` : ''} 库存 ${row.quantity ?? '未返回'}${row.unit || ''}`).join('；') : ''}${rows.length > 5 ? '；仅列前 5 项' : ''}`);
      lines.push(replenishmentBasisNote);
    } else if (key === 'creditWarning') {
      const customers = value?.top ?? rows;
      const counts = [value?.overCount != null ? `超限 ${value.overCount} 位` : '', value?.highRiskCount != null ? `高占用 ${value.highRiskCount} 位` : ''].filter(Boolean);
      lines.push(`${label}：${counts.join('，') || sampleNote(value, customers)}${customers.length ? '；' + top(customers).map(row => `${row.customerName || row.name || identity(row)} 已用 ${money(row.used)}${row.creditLimit != null ? ` / 限额 ${money(row.creditLimit)}` : ''}${row.usageRatePct != null ? `（占用 ${row.usageRatePct}%）` : ''}`).join('；') : ''}`);
    } else if (key === 'incomingPurchases' && value && !Array.isArray(value) && ['overdue', 'dueToday', 'dueThisWeek'].some(group => Array.isArray(value[group]))) {
      for (const [group, groupLabel] of Object.entries({ overdue: '逾期待到货', dueToday: '今日待到货', dueThisWeek: '本周后续待到货' })) {
        const purchases = Array.isArray(value[group]) ? value[group] : [];
        lines.push(`${groupLabel}：${purchases.length} 单${purchases.length ? '；' + top(purchases).map(row => `${identity(row)}${row.supplierName ? `（${row.supplierName}）` : ''}${row.expectedDate ? ` 预计 ${row.expectedDate}` : ''}`).join('；') : ''}${purchases.length > 5 ? '；仅列前 5 单' : ''}`);
      }
    } else {
      lines.push(`${label}：${sampleNote(value, rows)}${rows.length ? '；' + top(rows).map(row => [identity(row), row.title || row.supplierName || row.applicantName].filter(Boolean).join(' ')).join('；') : ''}${rows.length > 5 ? '；仅列前 5 项' : ''}`);
    }
  }
  return lines.join('\n');
}

export function stuckReply(data) {
  const labels = { picking: '拣货', sorting: '分拣', checking: '复核', packing: '打包', shipping: '待出库', urgent: '加急' };
  const counts = Object.entries(labels).filter(([key]) => data.warehouseTaskStats?.[key] != null).map(([key, label]) => `${label} ${data.warehouseTaskStats[key]} 单`);
  const lines = ['作业进度（当前可访问范围；只列已返回事实）', counts.join('；') || '仓储作业统计未取得'];
  if (data.sortingBinPending != null) {
    const rows = rowsOf(data.sortingBinPending);
    lines.push(`分拣格待分配：${sampleNote(data.sortingBinPending, rows)}${rows.length ? '；' + top(rows).map(row => `${identity(row)}${row.saleOrderNo ? ` / ${row.saleOrderNo}` : ''}${row.warehouseName ? `（${row.warehouseName}）` : ''} 待分配分拣格`).join('；') : ''}${rows.length > 5 ? '；仅列前 5 项' : ''}`);
  }
  if (data.inboundTasks != null) {
    const rows = rowsOf(data.inboundTasks);
    lines.push(`收货任务：${sampleNote(data.inboundTasks, rows)}${rows.length ? '；' + top(rows).map(row => {
      const facts = [identity(row), row.supplierName, row.warehouseName, row.statusName];
      if (!row.statusName && row.status != null) facts.push(`状态码 ${row.status}`);
      if (row.receivedQty != null) facts.push(`已收 ${row.receivedQty}`);
      if (row.putawayQty != null) facts.push(`已上架 ${row.putawayQty}`);
      if (Number(row.putawaySummary?.overdueContainers) > 0) facts.push(`逾期待上架 ${row.putawaySummary.overdueContainers} 个容器`);
      if (Number(row.printSummary?.failed) > 0) facts.push(`打印失败 ${row.printSummary.failed}`);
      return facts.filter(Boolean).join(' ');
    }).join('；') : ''}${rows.length > 5 ? '；仅列前 5 项' : ''}`);
  }
  if (data.errors?.length) lines.push(`未完成的查询：${data.errors.join('；')}`);
  lines.push('上述统计不能说明卡住原因；原因未由接口提供的，请到对应作业页核对。');
  return lines.join('\n');
}
