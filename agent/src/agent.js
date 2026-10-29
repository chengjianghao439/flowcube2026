// 编排层：意图 → 任务图 → 试算 → 预览 → 确认 → 执行 → 核验。
// MVP 规划器为规则规划器（确定性、可测试）；LLM 规划器接口见 plannerLLM（未配模型时明确报错，不假装）。
import { getTool } from './tools.js';
import { validateQty, toCents, diffPreview, amountCents } from './guards.js';
import { FlowError } from './flow.js';
import { config } from './config.js';
import { collectList } from './pagination.js';
import { parseIntentLLM } from './llm.js';
import { hasPerm, PermissionDeniedError, denialReply } from './perms.js';
import { assertTaskAccess, ownsTask, rememberOutput } from './task-access.js';
import { briefingReply, stuckReply } from './reports.js';
import { smallTalkReply, knownConceptReply } from './persona.js';
import { classifyMessage, ruleGraphFor, activeTopicText, DISCUSSION_CLOSED_REPLY, guideReply } from './routing.js';
import { assertReceiptAmountCents, assertReceiptPreviewAmount, parseReceiptAmount } from './receipt-amount.js';

// 工具调用统一入口：先验发起人权限（与后端 requirePermission 同码），无权零调用、明确拒绝。
const run = (tool, client, args, actor) => {
  const t = getTool(tool);
  if (t.requires && !hasPerm(actor, t.requires)) throw new PermissionDeniedError(t.requires, t.desc);
  return t.run(client, args);
};

// 图级权限预检：缺任一权限 → 任务落 FAILED_FINAL 并返回拒绝说明（不继续试算/执行）
function denyIfMissing(task, actor, codes) {
  const missing = codes.find(c => !hasPerm(actor, c));
  if (!missing) return null;
  const err = new PermissionDeniedError(missing, task.graph);
  task.error = err.message; task.transition('FAILED_FINAL');
  return { task, reply: denialReply(actor, err) };
}
function denyIfMissingAny(task, actor, codes) {
  if (codes.some(c => hasPerm(actor, c))) return null;
  const err = new PermissionDeniedError(codes[0], task.graph);
  task.error = err.message; task.transition('FAILED_FINAL');
  return { task, reply: denialReply(actor, err) };
}

// ---------- 实体解析 ----------
async function resolveOne(client, keyword, type, actor) {
  const { hits } = await run('search.global', client, { keyword, type }, actor);
  return hits;
}

function approximateHit(hit) {
  return Number.isFinite(Number(hit?.searchRank)) && Number(hit.searchRank) >= 2;
}
function hitOutsideScope(hit, actor) {
  if (!Array.isArray(actor?.warehouseIds)) return false;
  const allowed = actor.warehouseIds.map(Number);
  const ids = [];
  if (hit?.warehouseId != null && hit.warehouseId !== '') ids.push(Number(hit.warehouseId));
  if (Array.isArray(hit?.warehouseIds)) ids.push(...hit.warehouseIds.map(Number));
  return ids.length > 0 && !ids.some(id => allowed.includes(id));
}
async function scopeHits(client, actor, hits, type) {
  const allowed = Array.isArray(actor?.warehouseIds) ? actor.warehouseIds.map(Number) : null;
  let pruned = false;
  let visible = hits.filter(hit => {
    const outside = hitOutsideScope(hit, actor);
    if (outside) pruned = true;
    return !outside;
  });
  if (type === 'product' && allowed && visible.some(approximateHit)) {
    let rows;
    try {
      const data = await collectList(client, '/api/inventory/stock');
      rows = data?.list ?? [];
    } catch {
      throw Object.assign(new Error('暂时对不上这些相近商品是否在你的仓库范围内，没有列出候选，也不会改查其他仓库。'), { code: 'ENTITY_NOT_FOUND' });
    }
    visible = visible.filter(hit => {
      if (!approximateHit(hit)) return true;
      const mine = rows.filter(row => String(row.productId) === String(hit.id));
      if (!mine.length) return true;
      const ok = mine.some(row => allowed.includes(Number(row.warehouseId)));
      if (!ok) pruned = true;
      return ok;
    });
  }
  return { hits: visible, pruned };
}
async function resolveEntity(client, task, actor, keyword, type, slot) {
  const found = await resolveOne(client, keyword, type, actor);
  const { hits, pruned } = await scopeHits(client, actor, found, type);
  const selected = task.selections?.[slot];
  if (selected != null) {
    const hit = hits.find(h => String(h.id) === String(selected));
    if (!hit) throw new Error('原先选择的对象已不可见或不再符合原搜索，请重新发起');
    return hit;
  }
  const name = type === 'customer' ? '客户' : '商品';
  const approximate = type === 'product' && hits.some(approximateHit);
  if (hits.length === 1 && !approximate) return hits[0];
  const message = !hits.length
    ? (pruned ? `「${keyword}」的相近${name}不在你的仓库范围内，已拒绝，不会改用其他仓库。` : `未找到${name}「${keyword}」`)
    : (approximate ? `「${keyword}」有 ${hits.length} 个相近${name}，请选一个后再继续。我不会自动换成某一个。` : `「${keyword}」命中 ${hits.length} 个${name}，请选择一个后继续`);
  throw Object.assign(new Error(message), { code: hits.length ? 'CHOICE_REQUIRED' : 'ENTITY_NOT_FOUND', candidates: hits, selection: { keyword, type, slot } });
}

function entityFailure(store, task, error) {
  task.error = error.message;
  if (error.code === 'CHOICE_REQUIRED') {
    task.selection = error.selection;
    task.candidates = error.candidates.map(({ id, type, title, subtitle, details }) => ({ id, type, title, subtitle, details }));
    store.save();
    return { task, reply: error.message, candidates: task.candidates };
  }
  task.transition('FAILED_FINAL'); store.save();
  return { task, reply: error.message };
}

function clearChoice(task) { task.selection = null; task.candidates = null; task.error = null; }

async function inventoryWarehouses(client, actor, text, warehouseKeyword) {
  const data = await client.get('/api/warehouses?page=1&pageSize=50');
  const all = data?.list ?? (Array.isArray(data) ? data : []);
  const named = warehouseKeyword ? all.filter(w => w.name === warehouseKeyword || w.name.includes(warehouseKeyword))
    : all.filter(w => text.includes(w.name) || (w.name.match(/[一二三四五六七八九十\d]+号?仓(?:库)?$/)?.[0] && text.includes(w.name.match(/[一二三四五六七八九十\d]+号?仓(?:库)?$/)[0])));
  const explicit = Boolean(warehouseKeyword || named.length);
  const unmatchedName = text.match(/(?:只查|只看|查询|查看|查一下|在)([^，。！？?\s]{1,30}?仓(?:库)?)(?:的|里|中|\s|$)/)?.[1];
  if (!explicit && (/[一二三四五六七八九十\d]+号?仓(?:库)?/.test(text) || (unmatchedName && unmatchedName !== '仓库'))) throw new Error('未找到指定仓库或该仓库当前不可访问，请写出完整仓库名称');
  if (warehouseKeyword && !named.length) throw new Error('未找到指定仓库或该仓库当前不可访问，请写出完整仓库名称');
  if (explicit && named.length !== 1) throw new Error('指定仓库不唯一，请写出完整仓库名称');
  const warehouses = explicit ? named : all;
  if (Array.isArray(actor?.warehouseIds) && explicit && !actor.warehouseIds.includes(Number(warehouses[0].id))) throw new Error('指定仓库不在你的仓库范围内，已拒绝');
  const scoped = Array.isArray(actor?.warehouseIds) ? warehouses.filter(w => actor.warehouseIds.includes(Number(w.id))) : warehouses;
  if (!scoped.length) throw new Error('你的账号没有可访问的仓库（仓库范围为空），无法继续');
  return { warehouses: scoped, explicit };
}

async function getCustomer(client, id) {
  try { return await client.get(`/api/customers/${id}`); }
  catch {
    const data = await client.get('/api/customers?page=1&pageSize=100');
    const list = data?.list ?? [];
    return list.find(x => String(x.id) === String(id)) || null;
  }
}

async function defaultWarehouse(client, preferred, actor) {
  const data = await client.get('/api/warehouses?page=1&pageSize=50');
  const list = data?.list ?? data ?? [];
  const scoped = actor && Array.isArray(actor.warehouseIds)
    ? list.filter(w => actor.warehouseIds.includes(Number(w.id)))
    : list;
  if (preferred) {
    if (actor && Array.isArray(actor.warehouseIds) && !actor.warehouseIds.includes(Number(preferred))) {
      throw new Error('指定仓库不在你的仓库范围内，已拒绝');
    }
    return preferred;
  }
  if (!scoped.length) throw new Error('你的账号没有可访问的仓库（仓库范围为空），无法继续');
  return scoped[0]?.id ?? 1;
}

// 图 B 选仓：不能盲取范围内第一个仓——第一个仓可能是空仓（库存图/C 图已各踩过一次同款陷阱），
// 空仓会让预览全是假缺口，且 payload 的商品编码/单位取不到、被后端校验拒绝。
// 口径：范围内第一个「有本单任一商品库存行」的仓；都没有才回退第一个仓（预览如实报缺口）。
async function pickSaleWarehouse(client, actor, productIds) {
  const warehouses = await inScopeWarehouses(client, actor);
  const data = await collectList(client, '/api/inventory/stock');
  const rows = data?.list ?? [];
  for (const w of warehouses) {
    if (rows.some(r => Number(r.warehouseId) === w.id && productIds.includes(Number(r.productId)))) return w.id;
  }
  // TODO(巡检登记 2026-10-26)：图 B「无任何仓有库存行」时以范围内首仓兜底——多仓下
  // 可能并非用户预期仓库。候选改进：预览中明示所选仓并允许对话改仓。本轮只登记不改行为。
  return warehouses[0].id;
}

async function warehouseName(client, warehouseId) {
  const data = await client.get('/api/warehouses?page=1&pageSize=50');
  const list = data?.list ?? data ?? [];
  return list.find(w => String(w.id) === String(warehouseId))?.name || '';
}

async function stockRow(client, productId, warehouseId) {
  const data = await collectList(client, '/api/inventory/stock');
  const list = data?.list ?? [];
  return list.find(x => String(x.productId) === String(productId) && String(x.warehouseId) === String(warehouseId)) || null;
}

// ---------- 图 A：查库存 ----------
async function graphInventory(store, client, actor, text, presetKeyword, options = {}) {
  const task = options.task || store.create({ graph: 'A-inventory', userText: text, actor });
  if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, ['inventory.view', 'dashboard.view', 'product.view', 'warehouse.view']);
  if (denied) { store.save(); return denied; }
  let warehouses, explicit, hit, keyword;
  try {
    ({ warehouses, explicit } = await inventoryWarehouses(client, actor, text, options.warehouseKeyword));
    keyword = presetKeyword ?? text;
    for (const w of warehouses) {
      keyword = keyword.replace(w.name, '');
      const short = w.name.match(/[一二三四五六七八九十\d]+号?仓(?:库)?$/)?.[0];
      if (short) keyword = keyword.replace(short, '');
    }
    keyword = keyword.replace(/帮我查一下|帮我查|查一下|只查|只看|还剩多少|还有多少|有多少|库存|在哪个仓|在哪|？|\?/g, '').replace(/^[的在\s]+|[的\s]+$/g, '').trim();
    task.intent = { graph: 'A-inventory', productKeyword: keyword, warehouseKeyword: explicit ? warehouses[0].name : undefined };
    task.accessWarehouseIds = warehouses.map(w => Number(w.id));
    hit = await resolveEntity(client, task, actor, keyword, 'product', 'product');
  } catch (e) { return entityFailure(store, task, e); }
  clearChoice(task);
  task.transition('DRY_RUNNING');
  const perWarehouse = [];
  for (const warehouse of warehouses) {
    const wid = Number(warehouse.id);
    const inv = await run('inventory.query_by_product', client, { productId: hit.id, warehouseId: wid }, actor);
    const stock = await stockRow(client, hit.id, wid);
    perWarehouse.push({
      warehouseId: wid, warehouseName: warehouse.name,
      onHand: inv.onHand,
      reserved: stock ? Number(stock.reserved) : null,
      available: stock ? Number(stock.available) : null,
      cacheQty: stock ? Number(stock.quantity) : null,
      containers: inv.containers.map(x => ({
        barcode: x.barcode, location: x.locationCode || x.location || null,
        remainingQty: Number(x.remainingQty), lockedByTaskNo: x.lockedByTaskNo || null,
      })),
      basis: inv.basis, asOf: inv.asOf,
    });
  }
  const result = {
    product: hit.title, productId: hit.id,
    warehouseId: perWarehouse.length === 1 ? perWarehouse[0].warehouseId : null,
    warehouses: perWarehouse,
    onHand: perWarehouse.reduce((s, w) => s + w.onHand, 0),
    reserved: perWarehouse.every(w => w.reserved === null) ? null : perWarehouse.reduce((s, w) => s + (w.reserved ?? 0), 0),
    available: perWarehouse.every(w => w.available === null) ? null : perWarehouse.reduce((s, w) => s + (w.available ?? 0), 0),
    containers: perWarehouse.flatMap(w => w.containers.map(c => ({ ...c, warehouseId: w.warehouseId }))),
    basis: perWarehouse[0]?.basis, asOf: perWarehouse[0]?.asOf,
  };
  task.recordStep('query', 'inventory.query_by_product', result);
  task.result = result;
  task.transition('VERIFYING');
  // 核验：逐仓容器合计与缓存现存一致性（缓存 quantity 应等于容器实存合计）
  const mismatch = perWarehouse.find(w => w.cacheQty !== null && w.cacheQty !== w.onHand);
  if (mismatch) {
    task.transition('ESCALATED'); store.save();
    return { task, reply: `注意：${mismatch.warehouseName} 容器实存合计 ${mismatch.onHand} 与库存缓存 ${mismatch.cacheQty} 不一致，已如实上报，请人工核对。`, result };
  }
  task.transition('DONE'); store.save();
  const scopeNote = explicit ? `（仅 ${warehouses[0].name}）` : Array.isArray(actor?.warehouseIds) ? '（按你的仓库范围统计）' : '（全部可访问仓库）';
  let reply = `${result.product}：现存 ${result.onHand}，预占 ${result.reserved ?? '—'}，可用 ${result.available ?? '—'}${scopeNote}（口径：现存以容器实存为准；统计时点 ${new Date(result.asOf).toLocaleString('zh-CN')}）。`;
  if (perWarehouse.length > 1) {
    reply += '分仓：' + perWarehouse.map(w => `${w.warehouseName} 现存 ${w.onHand}/可用 ${w.available ?? '—'}`).join('；') + '。';
  }
  reply += result.containers.length ? '容器分布：' + result.containers.map(x => `${x.barcode}（${x.location || '未上架'}）${x.remainingQty}`).join('；') : '该查询范围没有在库容器。';
  return { task, reply, result };
}

// ---------- 图 B：建销售单（到预览为止） ----------
export async function buildSalePreview(client, { customerHit, lines, warehouseId }, actor) {
  const customer = await getCustomer(client, customerHit.id);
  const outLines = [];
  for (const line of lines) {
    const hits = line.productHit ? [line.productHit] : await resolveOne(client, line.productKeyword, 'product', actor);
    if (hits.length !== 1) {
      throw Object.assign(new Error(hits.length === 0
        ? `未找到商品「${line.productKeyword}」`
        : `商品「${line.productKeyword}」命中 ${hits.length} 个，请在原文中写全规格`), { code: 'DISAMBIGUATION' });
    }
    const product = await client.get(`/api/products/${hits[0].id}`);
    if (typeof product?.allowDecimalQty !== 'boolean') throw new Error(`无法核对商品「${hits[0].title}」当前数量规则，已停下请到商品页核对`);
    const err = validateQty(line.qty, { label: `商品「${hits[0].title}」数量`, allowDecimal: product.allowDecimalQty });
    if (err) throw Object.assign(new Error(err.message), { code: err.code });
    const price = await client.get(`/api/price-lists/customer-price?customerId=${customer.id}&productId=${hits[0].id}`);
    if (!price || price.salePrice == null) {
      throw Object.assign(new Error(`商品「${hits[0].title}」对该客户无定价，需人工填价，我不编价`), { code: 'NO_PRICE' });
    }
    const stock = await stockRow(client, hits[0].id, warehouseId);
    const unitPriceCents = toCents(price.salePrice);
    outLines.push({
      productId: hits[0].id, productName: product.name || hits[0].title, qty: line.qty, unit: product.unit, allowDecimalQty: product.allowDecimalQty,
      unitPrice: Number(price.salePrice), unitPriceCents, priceSource: { level: price.priceLevel, source: price.source },
      available: stock ? Number(stock.available) : 0,
      shortage: Math.max(0, line.qty - (stock ? Number(stock.available) : 0)),
      lineAmountCents: amountCents(price.salePrice, line.qty),
      _stockProduct: stock, // 供组装 payload 时取 code/unit（不进预览展示）
      _productCode: product.code || hits[0].subtitle || null,
      _productUnit: product.unit || (hits[0].details || []).find(d => d.label === '单位')?.value || null,
    });
  }
  const totalCents = outLines.reduce((s, l) => s + l.lineAmountCents, 0);
  return {
    customer: { id: customer.id, name: customer.name, priceLevel: customer.priceLevel, creditLimit: customer.creditLimit },
    warehouseId, lines: outLines, totalCents,
    credit: customer.creditLimit == null
      ? { note: '客户未设授信限额，本单不做授信拦截' }
      : { limitCents: toCents(customer.creditLimit), thisOrderCents: totalCents, overByCents: Math.max(0, totalCents - toCents(customer.creditLimit)) },
  };
}

function salePayload(preview) {
  return {
    customerId: preview.customer.id, customerName: preview.customer.name,
    warehouseId: preview.warehouseId, warehouseName: preview.warehouseName || '',
    items: preview.lines.map(l => ({
      productId: l.productId,
      productCode: l._stockProduct?.productCode || l._productCode || undefined, productName: l.productName,
      unit: l._stockProduct?.unit || l._productUnit || undefined, quantity: l.qty,
      unitPrice: l.unitPrice, priceSource: 'manual',
    })),
  };
}

const SALE_DRAFT_PERMS = ['sale.order.create', 'sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view'];
function splitSaleLines(linesText) {
  const parts = String(linesText || '').split(/[，,、]/).map(seg => seg.trim()).filter(Boolean);
  if (!parts.length) return [];
  const lines = [];
  for (const seg of parts) {
    const forward = seg.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*(?:个|件|条|只|套|箱|把)?$/);
    const reverse = seg.match(/^(\d+(?:\.\d+)?)\s*(?:个|件|条|只|套|箱|把)\s*(.+)$/);
    if (forward?.[1].trim()) lines.push({ productKeyword: forward[1].trim(), qty: Number(forward[2]) });
    else if (reverse?.[2].trim()) lines.push({ productKeyword: reverse[2].trim(), qty: Number(reverse[1]) });
    else return null;
  }
  return lines;
}
function saleIntakeReply(customerKeyword, lines) {
  if (customerKeyword && !lines?.length) return `客户先按「${customerKeyword}」。还差商品和数量，例如「缓冲铰链 10个」。说全了我就试算，还没建单。`;
  if (!customerKeyword && lines?.length) return '商品先记下了。客户是谁？可以说「给某客户开单：商品 数量」。还没建单。';
  return '好，按销售草稿来办。请告诉我客户是谁、要哪些商品、各多少。例如「给华南客户开单：缓冲铰链 10个」。缺了这两样我先问你。还没建单。';
}
function saleDraftFromText(text, prior) {
  const formal = String(text || '').match(/给(.+?)开单[：:](.+)$/);
  if (formal) {
    const lines = splitSaleLines(formal[2]);
    if (!lines) {
      const bad = formal[2].split(/[，,、]/).map(seg => seg.trim()).find(seg => seg && !splitSaleLines(seg));
      return { explicit: true, badSegment: bad || formal[2].trim(), customerKeyword: formal[1].trim(), lines: [] };
    }
    return { explicit: true, customerKeyword: formal[1].trim(), lines };
  }
  const loose = splitSaleLines(text);
  if (loose?.length && prior?.customerKeyword) return { explicit: true, customerKeyword: prior.customerKeyword, lines: loose };
  let customerKeyword = prior?.customerKeyword || null;
  const plain = String(text || '').trim();
  if (!customerKeyword && prior?.intake && plain.length <= 40 && !/[0-9]/.test(plain) && !/库存|简报|卡点|欠款|采购|审批|发货|付款|改价|开单|订单|下一单/.test(plain)) {
    customerKeyword = plain.replace(/^(?:客户(?:是|叫|为)?|给)\s*[:：]?\s*/, '').replace(/[。！!？?]/g, '').trim() || null;
  }
  return { explicit: false, customerKeyword, lines: prior?.lines?.length ? prior.lines : [] };
}
async function graphSaleDraft(store, client, actor, text, preset) {
  let customerKeyword, lines, badSegment = null;
  const prior = preset?.task?.intent?.intake ? preset.task.intent : null;
  if (preset?.customerKeyword && Array.isArray(preset.lines)) {
    customerKeyword = preset.customerKeyword;
    lines = preset.lines;
  } else {
    const parsed = saleDraftFromText(text, prior);
    customerKeyword = parsed.customerKeyword;
    lines = parsed.lines;
    badSegment = parsed.badSegment;
  }
  const task = preset?.task || store.create({ graph: 'B-sale-draft', userText: text, actor });
  if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
  if (badSegment) {
    task.error = `无法解析明细「${badSegment}」，请按「商品名 数量」书写`;
    if (task.state === 'DISAMBIGUATING') task.transition('FAILED_FINAL');
    else { task.transition('DISAMBIGUATING'); task.transition('FAILED_FINAL'); }
    store.save();
    return { task, reply: task.error };
  }
  if (!customerKeyword || !lines?.length) {
    task.intent = { graph: 'B-sale-draft', intake: true, customerKeyword: customerKeyword || undefined, lines: lines || [] };
    task.error = null;
    const denied = denyIfMissing(task, actor, SALE_DRAFT_PERMS);
    if (denied) { store.save(); return denied; }
    store.save();
    return { task, reply: saleIntakeReply(customerKeyword, lines) };
  }
  task.intent = { graph: 'B-sale-draft', customerKeyword, lines: lines.map(({ productKeyword, qty }) => ({ productKeyword, qty })) };
  const denied = denyIfMissing(task, actor, ['sale.order.create', 'sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view']);
  if (denied) { store.save(); return denied; }
  let warehouseId, customerHit, resolvedLines;
  try {
    customerHit = await resolveEntity(client, task, actor, customerKeyword, 'customer', 'customer');
    resolvedLines = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const productHit = await resolveEntity(client, task, actor, line.productKeyword, 'product', `line:${index}`);
      resolvedLines.push({ ...line, productHit });
    }
    warehouseId = await pickSaleWarehouse(client, actor, resolvedLines.map(l => Number(l.productHit.id)));
  }
  catch (e) { return entityFailure(store, task, e); }
  clearChoice(task);
  task.transition('DRY_RUNNING');
  let preview;
  try {
    preview = await buildSalePreview(client, { customerHit, lines: resolvedLines, warehouseId }, actor);
  } catch (e) {
    task.error = e.message; task.transition('FAILED_FINAL'); store.save();
    return { task, reply: e.message };
  }
  preview.warehouseName = await warehouseName(client, warehouseId);
  preview.payload = salePayload(preview);
  task.setPreview(preview);
  task.transition('AWAITING_CONFIRM');
  store.save();
  const shortageLines = preview.lines.filter(l => l.shortage > 0);
  const reply = `销售单草稿已试算（待确认）：客户 ${preview.customer.name}，合计 ¥${(preview.totalCents / 100).toFixed(2)}。` +
    preview.lines.map(l => `${l.productName} ×${l.qty}，单价 ¥${l.unitPrice ?? (l.unitPriceCents / 100).toFixed(2)}（${l.priceSource.level} 档价）`).join('；') + '。' +
    (shortageLines.length ? `注意缺口：${shortageLines.map(l => `${l.productName} 需 ${l.qty}、可用 ${l.available}、缺 ${l.shortage}`).join('；')}。建草稿不受缺口影响，占库时会被拦。` : '库存可用量充足。') +
    `确认请在界面点击确认，预览 10 分钟内有效。`;
  return { task, reply, preview };
}

// ---------- 确认执行：按任务图分发 ----------
export async function confirmTask(store, client, taskId, actor, options = {}) {
  return store.exclusive(taskId, async () => rememberOutput(store, await confirmTaskUnlocked(store, client, taskId, actor, options)));
}

async function confirmTaskUnlocked(store, client, taskId, actor, options) {
  const task = store.get(taskId);
  if (!task) throw new Error('任务不存在');
  if (!ownsTask(task, actor)) throw Object.assign(new Error('只能确认本人发起的任务'), { status: 403 });
  assertTaskAccess(task, actor);
  if (task.state === 'DONE') {
    if (task.graph === 'D-receipt' && task.result?.stage2TaskId) {
      const next = store.get(task.result.stage2TaskId);
      if (next?.state === 'AWAITING_CONFIRM' && !next.previewExpired()) { assertTaskAccess(next, actor); return { task: next, preview: next.preview, reply: '收款已经登记，已恢复原核销预览。请核对分配后确认，不要重复登记收款。' }; }
      return { task, result: task.result, reply: next?.state === 'DONE' ? '原收款与核销任务已完成，无需重复登记。' : '收款已登记，原核销预览已失效或正在核对，请到收付款页处理原收款单，不要重新登记。' };
    }
    return { task, reply: '此任务已经完成，已返回原结果，无需重复确认。', result: task.result };
  }
  if (['EXECUTING', 'RESULT_UNKNOWN', 'CONFIRMED', 'ESCALATED', 'VERIFYING'].includes(task.state)) return recoverTask(store, client, task);
  if (options.revision != null && (!Number.isSafeInteger(Number(options.revision)) || Number(options.revision) !== Number(task.revision))) throw Object.assign(new Error('预览已更新，请核对最新版本后再确认'), { status: 409, code: 'PREVIEW_REVISION_CONFLICT' });
  if (task.state !== 'AWAITING_CONFIRM') throw new Error(`任务不在待确认状态（当前 ${task.state}）`);
  if (task.previewExpired()) {
    task.transition('EXPIRED'); store.save();
    return { task, reply: '预览已过期（超过 10 分钟），数据可能已变，请重新发起，我重新试算。' };
  }
  switch (task.graph) {
    case 'B-sale-draft': return confirmSaleDraft(store, client, task, actor);
    case 'C-purchase-draft': return confirmPurchaseDraft(store, client, task, actor);
    case 'B2-reserve': return confirmReserve(store, client, task, actor);
    case 'D-receipt': return confirmReceiptDraft(store, client, task, actor);
    case 'D-settle': return confirmSettle(store, client, task, actor);
    default: throw new Error('这项内容没有可确认的业务操作');
  }
}

// 重启后只恢复原意图的回执，不重发写请求，不生成新请求键。
async function recoverTask(store, client, task) {
  if (task.state === 'VERIFYING') task.transition('RESULT_UNKNOWN');
  if (task.state === 'ESCALATED') task.transition('RESULT_UNKNOWN');
  if (task.state === 'CONFIRMED') task.transition('EXECUTING');
  if (task.state === 'EXECUTING') task.transition('RESULT_UNKNOWN');
  store.save();
  const p = task.preview;
  if (task.graph === 'C-purchase-draft') {
    const orders = [];
    for (const draft of p.drafts) {
      const key = `${task.requestKey}-S${draft.supplierId}W${draft.warehouseId}`;
      const receipt = await client.requestStatus(key, 'purchase.create').catch(() => null);
      if (!receipt?.resourceId) return { task, reply: `采购执行尚未全部核实，已核实 ${orders.length} 张。请按原任务到采购页核对，不要重新发起整批建单。` };
      const detail = await client.get(`/api/purchase/${receipt.resourceId}`);
      if (toCents(detail.totalAmount) !== draft.totalCents) return { task, reply: '采购原单金额与预览不一致，请人工核对，不重新提交。' };
      orders.push({ orderId: receipt.resourceId, orderNo: detail.orderNo, totalCents: draft.totalCents });
    }
    task.result = { orders, recoveredViaReceipt: true }; task.transition('VERIFYING'); task.transition('DONE'); store.save();
    return { task, reply: `已按原回执恢复 ${orders.length} 张采购草稿，未重新提交。`, result: task.result };
  }
  const action = { 'B-sale-draft': 'sale.create', 'B2-reserve': `sale.reserve:${p?.orderId}`, 'D-receipt': 'payment.receipt.create', 'D-settle': `payment.receipt.settle.${p?.receiptId}` }[task.graph];
  if (!action) return { task, reply: '此任务执行结果尚未核实，请按原任务及请求键到原页面核对，不要重新发起建单。' };
  let receipt;
  try { receipt = await client.requestStatus(task.requestKey, action); }
  catch { return { task, reply: '原请求回执暂时无法读取，请稍后查询原任务，不要重新提交。' }; }
  if (!receipt?.resourceId) return { task, reply: '暂未确认原请求结果，请稍后查询原任务，不要重新提交。' };
  const id = receipt.resourceId;
  if (task.graph === 'B-sale-draft') {
    const detail = await client.get(`/api/sale/${id}`);
    if (toCents(detail.totalAmount) !== p.totalCents) return { task, reply: '原单据金额与预览不一致，请人工核对。' };
    task.result = { orderId: id, orderNo: detail.orderNo, recoveredViaReceipt: true };
  } else if (task.graph === 'D-receipt') {
    const detail = await receiptTool().detail(client, { receiptId: id });
    if (toCents(detail.amount) !== p.amountCents) return { task, reply: '原收款单金额与预览不一致，请人工核对，勿重复登记。' };
    return finishReceiptStage(store, client, task, detail, true);
  } else if (task.graph === 'D-settle') {
    if (Number(id) !== Number(p.receiptId) || !await verifySettled(client, task)) return { task, reply: '原核销尚未核实，请到收付款页核对原收款单，勿重复登记。' };
    task.result = { receiptId: id, receiptNo: p.receiptNo, recoveredViaReceipt: true };
  } else {
    const detail = await client.get(`/api/sale/${p.orderId}`);
    if (!detail?.items?.length || detail.items.some(i => Number(i.quantity) > Number(i.reservedQty))) return { task, reply: '原销售单占库数量尚未核实，请到销售页核对。' };
    task.result = { orderNo: p.orderNo, recoveredViaReceipt: true };
  }
  task.transition('VERIFYING'); task.transition('DONE'); store.save();
  return { task, result: task.result, reply: '已按原请求回执恢复并回查核实，没有重复提交。' };
}

// ---------- 确认执行（图 B 的后半） ----------
async function confirmSaleDraft(store, client, task, actor) {
  // 确认时按确认人当前权限再验一次（权限可能在预览后被收回；也不能替他人确认其无权的操作）
  if (!hasPerm(actor, 'sale.order.create')) {
    const err = new PermissionDeniedError('sale.order.create', task.graph);
    return { task, reply: denialReply(actor, err) + '（任务仍保留在待确认，未执行）' };
  }
  for (const code of ['sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view']) {
    if (!hasPerm(actor, code)) return { task, reply: denialReply(actor, new PermissionDeniedError(code, task.graph)) + '（未执行）' };
  }
  // 新鲜度复核：重跑试算关键项，与预览比对（总体设计 §4 最重要安全规则）
  let fresh;
  try {
    fresh = await buildSalePreview(client, {
      customerHit: { id: task.preview.customer.id },
      lines: task.preview.lines.map(l => ({ productKeyword: l.productName, productHit: { id: l.productId, title: l.productName }, qty: l.qty })),
      warehouseId: task.preview.warehouseId,
    }, actor);
  } catch (error) {
    if (error.kind === 'unknown' || error.status >= 500) return { task, reply: '确认前暂时无法完成复核，尚未建单。请稍后重试这张预览。' };
    task.transition('EXPIRED'); store.save();
    return { task, reply: `原预览已失效，尚未建单：${error.message}。请按当前商品规则重新试算。` };
  }
  const diffs = diffPreview(task.preview, fresh);
  if (diffs.length) {
    task.transition('EXPIRED'); store.save();
    return { task, reply: '确认时发现数据已变化，已拦截执行。变化：' + diffs.map(d => d.field === 'unitPriceCents' ? '商品单价已变化' : `${({ available: '可用量', line: '商品明细' })[d.field] || '业务数据'} ${d.before} → ${d.after}`).join('；') + '。请重新发起生成新预览。', diffs };
  }
  task.transition('CONFIRMED');
  task.transition('EXECUTING');
  store.save();
  try {
    const { created, verified } = await run('sale.create_draft', client, { payload: task.preview.payload, requestKey: task.requestKey }, actor);
    task.recordStep('create', 'sale.create_draft', created);
    task.transition('VERIFYING');
    const orderId = created?.id;
    const verifiedTotalCents = verified ? toCents(verified.totalAmount ?? verified.total_amount ?? 0) : null;
    if (!orderId || !verified || verifiedTotalCents !== task.preview.totalCents) {
      task.transition('ESCALATED'); store.save();
      return { task, reply: `建单返回异常或核验不平（预览合计 ${task.preview.totalCents} 分，回查 ${verifiedTotalCents} 分），已转人工。` };
    }
    task.result = { orderId, orderNo: verified?.orderNo || created?.orderNo || null, totalCents: task.preview.totalCents };
    task.transition('DONE'); store.save();
    return { task, reply: `已建销售单草稿 ${task.result.orderNo || orderId}，合计 ¥${(task.preview.totalCents / 100).toFixed(2)}，回查状态与金额对平。占库请单独发起并再次确认。` };
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save();
      // 先查回执：同键是否已落库
      const receipt = await client.requestStatus(task.requestKey, 'sale.create').catch(() => null);
      const resId = receipt?.resourceId ?? receipt?.data?.resourceId ?? null;
      if (resId) {
        task.transition('VERIFYING');
        const verified = await client.get(`/api/sale/${resId}`);
        task.result = { orderId: resId, orderNo: verified?.orderNo || null, recoveredViaReceipt: true };
        task.transition('DONE'); store.save();
        return { task, reply: `刚才响应丢失，但回执确认已建单 ${task.result.orderNo || resId}（未重复创建），核验完成。` };
      }
      task.transition('ESCALATED'); store.save();
      return { task, reply: `建单结果未知且未查到回执，已转人工核查，请核对原操作，不要重复提交。` };
    }
    task.error = e.message;
    task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `建单被系统拒绝：${e.message}（原样转述，未自动改数重试）` };
  }
}

// ---------- 图 C：补货建议（L1）与采购草稿（L2） ----------
async function replenishmentItems(client, warehouseId, actor) {
  const data = await run('inventory.replenishment', client, { warehouseId }, actor);
  const raw = data?.replenishment;
  const list = raw?.list ?? raw?.items ?? (Array.isArray(raw) ? raw : null);
  if (!Array.isArray(list)) throw new Error('补货建议未完整读到，请稍后重试');
  return list.filter(i => Number(i.suggestedQty ?? i.suggestQty ?? 0) > 0);
}

// 发起人仓库范围内的仓库清单（多仓逐仓处理，不默认挑第一个——挑错仓会答错数）
async function inScopeWarehouses(client, actor) {
  const data = await client.get('/api/warehouses?page=1&pageSize=50');
  const list = data?.list ?? data ?? [];
  const filtered = Array.isArray(actor?.warehouseIds) ? list.filter(w => actor.warehouseIds.includes(Number(w.id))) : list;
  if (!filtered.length) throw new Error('你的账号没有可访问的仓库（仓库范围为空），无法继续');
  return filtered.map(w => ({ id: Number(w.id), name: w.name }));
}

async function graphReplenishment(store, client, actor, text) {
  const task = store.create({ graph: 'C-replenishment', userText: text, actor });
  task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, ['report.view']);
  if (denied) { store.save(); return denied; }
  task.transition('DRY_RUNNING');
  try {
    const warehouses = await inScopeWarehouses(client, actor);
    const items = [];
    for (const w of warehouses) items.push(...(await replenishmentItems(client, w.id, actor)));
    task.result = { items };
    task.transition('DONE'); store.save();
    if (!items.length) return { task, reply: `当前没有补货建议（按系统补货口径，建议量为 0 的商品不列）。`, result: task.result };
    const bySupplier = new Map();
    for (const i of items) {
      const k = i.supplierName || '未指定供应商';
      if (!bySupplier.has(k)) bySupplier.set(k, []);
      bySupplier.get(k).push(`${i.productName}（${i.warehouseName || ''}）：现存 ${i.onHand}、可用 ${i.available}、在途 ${i.inTransit ?? 0}、建议补 ${Number(i.suggestedQty ?? i.suggestQty)}`);
    }
    const reply = `补货建议（系统口径，含在途与安全库存）：` +
      [...bySupplier.entries()].map(([s, lines]) => `【${s}】${lines.join('；')}`).join('。') +
      `。要按建议建采购草稿，说「按补货建议建采购草稿」。`;
    return { task, reply, result: task.result };
  } catch (e) {
    task.error = e.message; task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `补货建议取数失败：${e.message}` };
  }
}

export async function buildPurchasePreview(client, actor) {
  const warehouses = await inScopeWarehouses(client, actor);
  const items = [];
  for (const w of warehouses) items.push(...(await replenishmentItems(client, w.id, actor)));
  if (!items.length) return { empty: true, drafts: [], grandTotalCents: 0 };
  const byKey = new Map();
  for (const i of items) {
    const qty = Number(i.suggestedQty ?? i.suggestQty);
    const product = await client.get(`/api/products/${i.productId}`);
    const err = validateQty(qty, { label: `商品「${i.productName}」建议量`, allowDecimal: product?.allowDecimalQty !== false });
    if (err) throw Object.assign(new Error(err.message), { code: err.code });
    if (!Number.isInteger(qty)) throw Object.assign(new Error(`商品「${i.productName}」建议量 ${qty} 不是整数，采购单要求整数数量，已停下请人工处理`), { code: 'QTY_INT' });
    if (product?.costPrice == null) throw Object.assign(new Error(`商品「${i.productName}」没有成本价，我不编价，请先维护成本价`), { code: 'NO_PRICE' });
    const unitPriceCents = toCents(product.costPrice);
    const line = {
      productId: i.productId, productCode: i.productCode || product.productCode, productName: i.productName,
      unit: i.unit || product.unit, qty,
      unitPrice: Number(product.costPrice), unitPriceCents, lineAmountCents: amountCents(product.costPrice, qty),
      priceSource: { level: '成本价', source: 'product_cost' },
      onHand: i.onHand, available: i.available,
    };
    // TODO(巡检登记 2026-10-26)：图 C 建议行缺 warehouseId 时以首仓兜底——建议接口
    // 正常按仓返回，此兜底理论上不触发；如触发可能把草稿落错仓。本轮只登记不改行为。
    const wid = Number(i.warehouseId ?? warehouses[0].id);
    const key = `${i.supplierId}@${wid}`;
    if (!byKey.has(key)) byKey.set(key, { supplierId: i.supplierId, supplierName: i.supplierName, warehouseId: wid, warehouseName: i.warehouseName || '', lines: [] });
    byKey.get(key).lines.push(line);
  }
  const drafts = [...byKey.values()].map(d => ({
    ...d,
    totalCents: d.lines.reduce((s, l) => s + l.lineAmountCents, 0),
    payload: {
      supplierId: d.supplierId, supplierName: d.supplierName, warehouseId: d.warehouseId, warehouseName: d.warehouseName,
      items: d.lines.map(l => ({ productId: l.productId, productCode: l.productCode, productName: l.productName, unit: l.unit, quantity: l.qty, unitPrice: l.unitPrice })),
    },
  }));
  return {
    empty: false, drafts,
    grandTotalCents: drafts.reduce((s, d) => s + d.totalCents, 0),
    // 抽屉通用展示形状
    title: `采购草稿 · ${drafts.length} 张`,
    confirmLabel: '确认建采购草稿',
    lines: drafts.flatMap(d => d.lines.map(l => ({ ...l, productName: `${l.productName}（${d.supplierName}）` }))),
    totalCents: drafts.reduce((s, d) => s + d.totalCents, 0),
  };
}

function purchaseSignature(preview) {
  return JSON.stringify((preview?.drafts || []).map(d => [d.supplierId, d.warehouseId, d.lines.map(l => [l.productId, l.qty, l.unitPrice])]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])));
}

async function graphPurchaseDraft(store, client, actor, text) {
  const task = store.create({ graph: 'C-purchase-draft', userText: text, actor });
  task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, ['purchase.order.create', 'purchase.order.view', 'report.view', 'product.view', 'warehouse.view']);
  if (denied) { store.save(); return denied; }
  task.transition('DRY_RUNNING');
  let preview;
  try { preview = await buildPurchasePreview(client, actor); }
  catch (e) { task.error = e.message; task.transition('FAILED_FINAL'); store.save(); return { task, reply: e.message }; }
  if (preview.empty) {
    task.result = { empty: true }; task.transition('DONE'); store.save();
    return { task, reply: '当前没有补货建议（建议量全为 0），没有可建的采购草稿。' };
  }
  task.setPreview(preview);
  task.transition('AWAITING_CONFIRM'); store.save();
  const reply = `采购草稿已试算（待确认）：将按供应商建 ${preview.drafts.length} 张草稿，合计 ¥${(preview.grandTotalCents / 100).toFixed(2)}。` +
    preview.drafts.map(d => `【${d.supplierName}】${d.lines.map(l => `${l.productName} ×${l.qty} @成本价 ¥${l.unitPrice ?? (l.unitPriceCents / 100).toFixed(2)}`).join('；')}，小计 ¥${(d.totalCents / 100).toFixed(2)}`).join('。') +
    `。确认请在界面点击确认，预览 10 分钟内有效。`;
  return { task, reply, preview };
}

async function confirmPurchaseDraft(store, client, task, actor) {
  if (!hasPerm(actor, 'purchase.order.create')) {
    const err = new PermissionDeniedError('purchase.order.create', task.graph);
    return { task, reply: denialReply(actor, err) + '（任务仍保留在待确认，未执行）' };
  }
  for (const code of ['purchase.order.view', 'report.view', 'product.view', 'warehouse.view']) {
    if (!hasPerm(actor, code)) return { task, reply: denialReply(actor, new PermissionDeniedError(code, task.graph)) + '（未执行）' };
  }
  // 新鲜度复核：重跑补货建议与成本价，签名不一致即拦截
  const fresh = await buildPurchasePreview(client, actor);
  if (purchaseSignature(fresh) !== purchaseSignature(task.preview)) {
    task.transition('EXPIRED'); store.save();
    return { task, reply: '确认时发现补货建议或成本价已变化（建议量/供应商/价格与预览不一致），已拦截执行。请重新发起生成新预览。' };
  }
  task.transition('CONFIRMED'); task.transition('EXECUTING'); store.save();
  const createdOrders = [];
  try {
    for (const draft of task.preview.drafts) {
      const key = `${task.requestKey}-S${draft.supplierId}W${draft.warehouseId}`;
      const { created, verified } = await run('purchase.create_draft', client, { payload: draft.payload, requestKey: key }, actor);
      const verifiedCents = verified ? toCents(verified.totalAmount ?? verified.total_amount ?? 0) : null;
      if (!created?.id || !verified || verifiedCents !== draft.totalCents) {
        task.transition('ESCALATED'); store.save();
        return { task, reply: `供应商「${draft.supplierName}」建单核验不平（预览 ¥${(draft.totalCents / 100).toFixed(2)}，回查 ${verifiedCents === null ? '无' : '¥' + (verifiedCents / 100).toFixed(2)}），已转人工。已建成的草稿：${createdOrders.map(o => o.orderNo).join('、') || '无'}。` };
      }
      createdOrders.push({ supplierName: draft.supplierName, orderId: created.id, orderNo: verified?.orderNo || created.orderNo || String(created.id), totalCents: draft.totalCents });
      task.recordStep('create', 'purchase.create_draft', createdOrders[createdOrders.length - 1]);
      task.result = { orders: createdOrders }; store.save();
    }
    task.result = { orders: createdOrders };
    task.transition('VERIFYING'); task.transition('DONE'); store.save();
    return { task, reply: `已建采购草稿 ${createdOrders.length} 张：${createdOrders.map(o => `${o.orderNo}（${o.supplierName}，¥${(o.totalCents / 100).toFixed(2)}）`).join('；')}，逐张回查金额对平。草稿还需在采购页确认/审批后才会生效。` };
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save();
      return recoverTask(store, client, task);
    }
    task.error = e.message; task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `建采购草稿被系统拒绝：${e.message}（原样转述）。已建成的草稿：${createdOrders.map(o => o.orderNo).join('、') || '无'}，未建成的没有重试。` };
  }
}

// ---------- 图 B2：销售单占库 ----------
async function findSaleOrderByNo(client, orderNo) {
  const data = await client.get('/api/sale/?page=1&pageSize=100');
  const list = data?.list ?? [];
  return list.find(o => o.orderNo === orderNo) || null;
}

export async function buildReservePreview(client, actor, order) {
  const rp = await run('sale.reserve_preview', client, { saleOrderId: order.id }, actor);
  const lines = (rp.items || []).map(it => {
    const wh = (it.warehouses || []).find(w => Number(w.warehouseId) === Number(rp.warehouseId)) || {};
    const remain = Number(it.remainToReserve || 0);
    const available = Number(wh.available ?? 0);
    return {
      productId: it.productId, productName: it.productName, qty: remain,
      reservedQty: Number(it.reservedQty || 0), remainToReserve: remain,
      available, pickable: Number(wh.pickableQuantity ?? 0),
      shortage: Math.max(0, remain - available),
      unitPriceCents: null, priceSource: { level: '占库', source: 'reserve_preview' },
    };
  });
  return {
    orderId: order.id, orderNo: order.orderNo, warehouseId: rp.warehouseId, warehouseName: rp.warehouseName,
    customer: { name: order.customerName }, lines,
    totalCents: 0, title: `占库 · ${order.orderNo}`, confirmLabel: '确认占库',
    credit: rp.credit ?? null,
    totalRemain: lines.reduce((s, l) => s + l.remainToReserve, 0),
  };
}

async function graphReserve(store, client, actor, text, presetOrderNo) {
  const orderNo = presetOrderNo || (String(text).match(/SL\d{6,}/i)?.[0] || '').toUpperCase();
  const task = store.create({ graph: 'B2-reserve', userText: text, actor });
  task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, ['sale.order.view', 'sale.order.reserve']);
  if (denied) { store.save(); return denied; }
  if (!orderNo) { task.error = '未提供销售单号'; task.transition('FAILED_FINAL'); store.save(); return { task, reply: '占库要带销售单号，例如「给 SL20261026005 占库」。' }; }
  const order = await findSaleOrderByNo(client, orderNo);
  if (!order) { task.error = `未找到销售单 ${orderNo}`; task.transition('FAILED_FINAL'); store.save(); return { task, reply: task.error }; }
  task.transition('DRY_RUNNING');
  let preview;
  try { preview = await buildReservePreview(client, actor, order); }
  catch (e) {
    // 已全部占库的单再调 reserve-preview 会被系统拒（状态不在可占范围）——用单据明细核对区分
    const detail = await client.get(`/api/sale/${order.id}`).catch(() => null);
    const items = detail?.items || [];
    if (items.length && items.every(it => Number(it.reservedQty || 0) >= Number(it.quantity || 0))) {
      task.result = { orderNo, alreadyReserved: true }; task.transition('DONE'); store.save();
      return { task, reply: `销售单 ${orderNo} 已全部占库，无需再占。` };
    }
    task.error = e.message; task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `试占库失败：${e.message}` };
  }
  if (preview.totalRemain === 0) {
    task.result = { orderNo, alreadyReserved: true }; task.transition('DONE'); store.save();
    return { task, reply: `销售单 ${orderNo} 已全部占库，无需再占。` };
  }
  const shortage = preview.lines.filter(l => l.shortage > 0);
  if (shortage.length) {
    task.result = { orderNo, shortage }; task.transition('DONE'); store.save();
    return { task, reply: `销售单 ${orderNo} 现在占不了库：${shortage.map(l => `${l.productName} 还需占 ${l.remainToReserve}、本仓可用 ${l.available}、缺 ${l.shortage}`).join('；')}。我没有部分占库，也没有自动改量；补货或调仓后再来。`, result: task.result };
  }
  task.setPreview(preview);
  task.transition('AWAITING_CONFIRM'); store.save();
  const reply = `占库已试算（待确认）：销售单 ${orderNo}（${preview.customer.name}，${preview.warehouseName}），待占 ${preview.totalRemain} 件：` +
    preview.lines.map(l => `${l.productName} ×${l.remainToReserve}（可用 ${l.available}）`).join('；') +
    `。确认请在界面点击确认，预览 10 分钟内有效。`;
  return { task, reply, preview };
}

async function confirmReserve(store, client, task, actor) {
  if (!hasPerm(actor, 'sale.order.reserve')) {
    const err = new PermissionDeniedError('sale.order.reserve', task.graph);
    return { task, reply: denialReply(actor, err) + '（任务仍保留在待确认，未执行）' };
  }
  const order = await findSaleOrderByNo(client, task.preview.orderNo);
  if (!order) { task.transition('EXPIRED'); store.save(); return { task, reply: '确认时销售单已不存在或不可见，已拦截。' }; }
  const fresh = await buildReservePreview(client, actor, order);
  const sig = p => JSON.stringify(p.lines.map(l => [l.productId, l.remainToReserve, l.available]).sort((a, b) => a[0] - b[0]));
  if (sig(fresh) !== sig(task.preview)) {
    task.transition('EXPIRED'); store.save();
    return { task, reply: '确认时发现待占量或可用量已变化，已拦截执行。请重新发起试占。' };
  }
  task.transition('CONFIRMED'); task.transition('EXECUTING'); store.save();
  try {
    const execution = await run('sale.reserve', client, { saleOrderId: task.preview.orderId, requestKey: task.requestKey }, actor);
    task.recordStep('reserve', 'sale.reserve', execution.result); store.save();
    task.transition('VERIFYING');
    // 核验走单据明细（reservedQty）：占满后 reserve-preview 本身会被系统拒，不能用它核验
    const detail = execution.verified;
    if (!detail) {
      task.transition('ESCALATED'); store.save();
      return { task, reply: '占库已提交，但回查暂未完成。请查询原任务结果，不要重新发起占库。' };
    }
    const items = detail?.items || [];
    const remain = items.reduce((s, it) => s + Math.max(0, Number(it.quantity || 0) - Number(it.reservedQty || 0)), 0);
    if (!items.length || remain !== 0) {
      task.transition('ESCALATED'); store.save();
      return { task, reply: `占库执行后回查仍有待占 ${remain} 件，与预期不符，已转人工核查。` };
    }
    task.result = { orderNo: task.preview.orderNo, reserved: task.preview.totalRemain };
    task.transition('DONE'); store.save();
    return { task, reply: `销售单 ${task.preview.orderNo} 已占库：${task.preview.lines.map(l => `${l.productName} ×${l.remainToReserve}`).join('；')}，回查待占量为 0。下一步拣货/出库请在原系统作业页进行，后续作业请在原页面办理。` };
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save();
      const receipt = await client.requestStatus(task.requestKey, `sale.reserve:${task.preview.orderId}`).catch(() => null);
      const resId = receipt?.resourceId ?? receipt?.data?.resourceId ?? null;
      if (resId) {
        const detail = await client.get(`/api/sale/${task.preview.orderId}`).catch(() => null);
        const items = detail?.items || [];
        const remain = items.reduce((s, it) => s + Math.max(0, Number(it.quantity || 0) - Number(it.reservedQty || 0)), 0);
        if (items.length && remain === 0) {
          task.result = { orderNo: task.preview.orderNo, recoveredViaReceipt: true };
          task.transition('VERIFYING'); task.transition('DONE'); store.save();
          return { task, reply: `刚才响应丢失，但回执确认占库已执行（销售单 ${task.preview.orderNo}），回查待占量为 0，未重复占库。` };
        }
      }
      task.transition('ESCALATED'); store.save();
      return { task, reply: `占库结果未知且未查到回执，已转人工核查，请核对原操作，不要重复提交。` };
    }
    task.error = e.message; task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `占库被系统拒绝：${e.message}（原样转述，未自动改数重试）` };
  }
}

// ---------- 图 D 入口：查往来 ----------
async function graphLedger(store, client, actor, text, presetKeyword, existingTask) {
  const keyword = presetKeyword ?? text.replace(/帮我查一下|帮我查|查一下|的账|应收|结清了吗|结清|欠款|？|\?/g, '').replace(/的\s*$/, '').trim();
  const task = existingTask || store.create({ graph: 'D-ledger', userText: text, actor });
  if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
  task.intent = { graph: 'D-ledger', customerKeyword: keyword };
  const denied = denyIfMissing(task, actor, ['payment.view']);
  if (denied) { store.save(); return denied; }
  let hit;
  try { hit = await resolveEntity(client, task, actor, keyword, 'customer', 'customer'); }
  catch (e) { return entityFailure(store, task, e); }
  clearChoice(task);
  task.transition('DRY_RUNNING');
  const data = await run('payments.party_ledger', client, { partyType: 'customer', partyId: hit.id }, actor);
  task.result = data;
  task.transition('DONE'); store.save();
  const ledger = data.ledger || {};
  const labels = { openingBalance: '期初', increase: '本期增加', decrease: '本期减少', closingBalance: '期末' };
  const amounts = Object.entries(labels).filter(([key]) => ledger.summary?.[key] != null).map(([key, label]) => `${label} ¥${ledger.summary[key]}`);
  const count = ledger.pagination?.total;
  return { task, reply: `${hit.title} · 客户应收侧台账\n${amounts.join('；') || '台账缺少汇总金额，请到客户往来页核对明细'}${count != null ? `\n本次查询口径共 ${count} 条流水。` : ''}\n${ledgerScopeNote(ledger)}`, result: data };
}

function ledgerScopeNote(ledger, unavailable = false) {
  const notes = ['本次只看已关联应收，不按同名并账。'];
  if (unavailable) notes.push('台账暂时未能核对，不能据此认定全部结清。请到收付款页核对。');
  else {
    if (ledger?.historyIncomplete) notes.push(`所选期间历史不完整${ledger.historyStartedAt ? `，记录从 ${ledger.historyStartedAt} 开始` : ''}，请核对历史账款。`);
    const count = Number(ledger?.unassignedCount);
    if (Number.isSafeInteger(count) && count > 0) notes.push(`应收侧另有 ${count} 条尚未归属事件，不能确定属于该客户，也不能据此认定全部结清。请到收付款页核对。`);
    else notes.push('手工或历史未关联账款仍需到收付款页核对。');
  }
  return notes.join('');
}

// ---------- 图 D：收款核销（两段确认：①登记收款 ②核销分配） ----------
// 依据《任务图》图 D 与契约 14：收款与核销是两步写、两张预览卡、各自确认。
// 第一段只登记收款单（不带 allocations，先挂账），核验收款单存在且金额一致后，
// 生成第二段任务（核销分配预览）；第二段确认时复核逐笔余额，执行 settle 后回查逐笔对平。
const receiptTool = () => getTool('payments.receipt_suggest');

function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 未结应收候选：按建单时间从早到晚（账龄最老优先，与系统对账单展开的「先清老账」口径一致）
async function unsettledReceivables(client, customerId) {
  const list = await receiptTool().candidates(client, { customerId });
  return list
    .map(r => ({
      recordId: Number(r.id), orderNo: r.orderNo,
      totalCents: toCents(r.totalAmount), paidCents: toCents(r.paidAmount), balanceCents: toCents(r.balance),
      status: Number(r.status), dueDate: r.dueDate || null, createdAt: r.createdAt || '',
    }))
    .filter(r => r.balanceCents > 0)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.recordId - b.recordId);
}

function receiptSignature(records, amountCents, accountId) {
  return JSON.stringify({ amt: amountCents, acct: accountId, recs: records.map(r => [r.recordId, r.balanceCents]) });
}

export async function buildReceiptPreview(client, actor, { customerHit, amountCents }) {
  if (amountCents != null) assertReceiptAmountCents(amountCents);
  const customer = await getCustomer(client, customerHit.id);
  const records = await unsettledReceivables(client, customer.id);
  let ledger = null;
  try { ledger = (await run('payments.party_ledger', client, { partyType: 'customer', partyId: customer.id }, actor)).ledger; }
  catch { /* 只报本次来源关联口径；台账失败时不推断已全清。 */ }
  const coverage = { basis: '来源订单关联客户 ID 的未结应收', unassignedCount: ledger?.unassignedCount ?? null, historyIncomplete: ledger?.historyIncomplete ?? null, ledgerAvailable: ledger != null };
  const scopeNote = ledgerScopeNote(ledger, ledger == null);
  if (!records.length) {
    const value = ledger?.summary?.closingBalance;
    const closingCents = value != null && Number.isFinite(Number(value)) ? toCents(value) : null;
    return { empty: true, customer: { id: customer.id, name: customer.name }, closingCents, coverage, scopeNote };
  }
  const accounts = (await receiptTool().accounts(client)).map(a => ({ id: Number(a.id), name: a.name }));
  if (!accounts.length) {
    return { noAccount: true, customer: { id: customer.id, name: customer.name }, unsettledCount: records.length };
  }
  const unsettledTotalCents = records.reduce((s, r) => s + r.balanceCents, 0);
  const receiptCents = amountCents ?? unsettledTotalCents;
  assertReceiptAmountCents(receiptCents);
  if (receiptCents > unsettledTotalCents) {
    throw Object.assign(new Error(`到账金额 ¥${(receiptCents / 100).toFixed(2)} 超过该客户未结总额 ¥${(unsettledTotalCents / 100).toFixed(2)}，已停步请人核对（不自动截断、不挂预收）`), { code: 'AMOUNT_EXCEEDS_UNSETTLED' });
  }
  // 分配建议：账龄最老优先逐笔填满，最后一笔可部分（依据随预览展示）
  let remain = receiptCents;
  const allocations = [];
  for (const r of records) {
    if (remain <= 0) break;
    const amt = Math.min(remain, r.balanceCents);
    allocations.push({
      recordId: r.recordId, orderNo: r.orderNo, amountCents: amt,
      totalCents: r.totalCents, balanceBeforeCents: r.balanceCents, settledAfter: amt === r.balanceCents,
    });
    remain -= amt;
  }
  const paymentDate = beijingToday();
  // 多账户：不默认第一个——预览先挂「待选账户」，用户在对话里按序号/名称选定后
  // 才补齐 account/payload/signature 并放行确认（确认端对未选状态硬拦截）。
  // 单账户行为不变（直接选定，与旧版一致）。
  const multi = accounts.length > 1;
  const account = multi ? null : accounts[0];
  return {
    customer: { id: customer.id, name: customer.name }, coverage, scopeNote,
    accounts, account, accountOptions: accounts.length,
    needsAccountChoice: multi,
    // 签名原料（未结记录 id+余额对）：选户时据此重算签名，确认端仍走同一新鲜度口径。
    // 内部字段，server 出参会剥离（sanitizePreview）。
    sigRecs: records.map(r => [r.recordId, r.balanceCents]),
    paymentDate, amountCents: receiptCents, unsettledTotalCents,
    unsettledCount: records.length, allocations,
    signature: multi ? null : receiptSignature(records, receiptCents, account.id),
    payload: { type: 2, partyId: customer.id, partyName: customer.name, amount: receiptCents / 100, paymentDate, accountId: account?.id ?? null },
    title: `登记收款 · ${customer.name}`,
    confirmLabel: '确认登记收款',
    lines: [{ productName: multi ? '收款入账 · 待选账户' : `收款入账 · ${account.name}`, qty: 1, unitPriceCents: receiptCents, priceSource: { level: '资金账户' } }],
    totalCents: receiptCents,
  };
}

async function graphReceipt(store, client, actor, text, preset) {
  const task = preset?.task || store.create({ graph: 'D-receipt', userText: text, actor });
  if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, ['payment.view', 'payment.execute', 'finance.account.view', 'customer.view']);
  if (denied) { store.save(); return denied; }
  let amountCents = null;
  let customerKeyword;
  try {
    const parsed = parseReceiptAmount(text);
    // 两条意图路径共用原文金额边界；模型不能把负数改成正数，或补出省略的金额。
    if (preset?.amountCents != null) {
      assertReceiptAmountCents(preset.amountCents);
      if (parsed.amountCents == null || parsed.amountCents !== preset.amountCents) throw new Error('到账金额未能由原文核对，或与原文不一致，请用数字重述后重新试算。');
    }
    amountCents = parsed.amountCents;
    customerKeyword = preset ? preset.customerKeyword : parsed.customerText
      .replace(/核销|收款|到账|收到|帮我|请|把|给|了/g, '')
      .replace(/[，,。:：、\s]+/g, ' ')
      .trim();
  } catch (error) {
    task.error = error.message; task.transition('FAILED_FINAL'); store.save();
    return { task, reply: error.message };
  }
  task.intent = { graph: 'D-receipt', customerKeyword, amountCents };
  let hit;
  try { hit = await resolveEntity(client, task, actor, customerKeyword, 'customer', 'customer'); }
  catch (e) { return entityFailure(store, task, e); }
  clearChoice(task);
  task.transition('DRY_RUNNING');
  let preview;
  try {
    preview = await buildReceiptPreview(client, actor, { customerHit: hit, amountCents });
  } catch (e) {
    task.error = e.message; task.transition('FAILED_FINAL'); store.save();
    return { task, reply: e.message };
  }
  if (preview.empty) {
    task.result = { alreadySettled: false, knownRecordsEmpty: true, closingCents: preview.closingCents, coverage: preview.coverage };
    task.transition('DONE'); store.save();
    return { task, reply: `${preview.customer.name}：当前关联应收里没查到未结账款，这笔收款先不登记。${preview.closingCents != null ? `关联余额 ¥${(preview.closingCents / 100).toFixed(2)}。` : ''}${preview.scopeNote}`, result: task.result };
  }
  if (preview.noAccount) {
    task.error = '无可用资金账户';
    task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `登记收款必须选资金账户，但系统里没有可用的资金账户。请先到财务页建一个资金账户再回来，我不代建账户。（${preview.customer.name} 的 ${preview.unsettledCount} 笔未结应收未动）` };
  }
  task.setPreview(preview);
  task.transition('AWAITING_CONFIRM');
  store.save();
  if (preview.needsAccountChoice) {
    const list = preview.accounts.map((a, i) => `${i + 1}）${a.name}`).join('；');
    const reply = `收款登记已试算（待选账户 · 第 1 段）：客户 ${preview.customer.name}，未结 ${preview.unsettledCount} 笔共 ¥${(preview.unsettledTotalCents / 100).toFixed(2)}；本次到账 ¥${(preview.amountCents / 100).toFixed(2)}，日期 ${preview.paymentDate}。可用资金账户 ${preview.accounts.length} 个：${list}。请回复序号或账户名选定入账账户，选定后我再请你确认登记，预览 10 分钟内有效。${preview.scopeNote}`;
    return { task, reply, preview };
  }
  const reply = `收款登记已试算（待确认 · 第 1 段）：客户 ${preview.customer.name}，未结 ${preview.unsettledCount} 笔共 ¥${(preview.unsettledTotalCents / 100).toFixed(2)}；本次到账 ¥${(preview.amountCents / 100).toFixed(2)}，入账账户「${preview.account.name}」，日期 ${preview.paymentDate}。确认登记后，下一张卡再逐笔确认核销分配（账龄最老优先）。确认请在界面点击确认，预览 10 分钟内有效。${preview.scopeNote}`;
  return { task, reply, preview };
}

// 图 D 多账户选户：对话回复（序号或账户名）→ 补齐预览的 account/payload/signature。
// 只接管「本人有待选户的 D-receipt 任务」时的消息；选错/没认出时回列清单，不落规划器。
function actorNameOf(a) { return typeof a === 'string' ? a : a?.username; }
function pendingAccountTask(store, actor) {
  return [...store.tasks.values()]
    .filter(task => task.graph === 'D-receipt' && task.state === 'AWAITING_CONFIRM'
      && task.preview?.needsAccountChoice && !task.previewExpired()
      && ownsTask(task, actor))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}
export async function tryAccountSelection(store, actor, text, client, task, choiceId) {
  const pending = task || pendingAccountTask(store, actor);
  if (!pending) return null;
  assertTaskAccess(pending, actor);
  if (pending.state !== 'AWAITING_CONFIRM' || !pending.preview?.needsAccountChoice || pending.previewExpired()) throw Object.assign(new Error('该收款任务当前不能选择账户，请核对原任务状态'), { status: 409 });
  assertReceiptPreviewAmount(pending.preview, pending.userText);
  const accounts = pending.preview.accounts || [];
  const list = accounts.map((a, i) => `${i + 1}）${a.name}`).join('；');
  let chosen = null;
  const num = /^(\d+)$/.exec(String(text).trim());
  if (choiceId != null) chosen = accounts.find(a => String(a.id) === String(choiceId)) || null;
  else if (num) chosen = accounts[Number(num[1]) - 1] || null;
  if (!chosen) chosen = accounts.find(a => String(text).includes(a.name)) || null;
  if (!chosen) {
    if (choiceId != null) throw Object.assign(new Error('请选择原预览中的资金账户'), { status: 400 });
    return { task: pending, reply: `还没选入账账户。可用账户：${list}。回复序号或账户名选定后，再点确认登记。`, preview: pending.preview };
  }
  if (!hasPerm(actor, 'payment.execute')) throw Object.assign(new Error('当前没有收付款执行权限，未修改账户'), { status: 403 });
  const freshAccounts = await receiptTool().accounts(client);
  const live = freshAccounts.find(a => Number(a.id) === Number(chosen.id));
  if (!live) throw Object.assign(new Error('该资金账户已不可用，请重新试算'), { status: 409 });
  chosen = { id: Number(live.id), name: live.name };
  const p = pending.preview;
  p.account = chosen;
  p.needsAccountChoice = false;
  p.payload = { ...p.payload, accountId: chosen.id };
  p.signature = receiptSignature((p.sigRecs || []).map(([recordId, balanceCents]) => ({ recordId, balanceCents })), p.amountCents, chosen.id);
  p.lines = [{ productName: `收款入账 · ${chosen.name}`, qty: 1, unitPriceCents: p.amountCents, priceSource: { level: '资金账户' } }];
  pending.revision = (Number(pending.revision) || 0) + 1;
  pending.updatedAt = new Date().toISOString();
  store.save();
  return { task: pending, reply: `已选入账账户「${chosen.name}」。请点「确认登记收款」，确认后我再给出核销分配预览。`, preview: p };
}

function buildSettlePreview(stage1Preview, receiptDetail) {
  const allocations = stage1Preview.allocations;
  const allocTotal = allocations.reduce((s, a) => s + a.amountCents, 0);
  return {
    receiptId: receiptDetail.id, receiptNo: receiptDetail.receiptNo,
    customer: stage1Preview.customer, coverage: stage1Preview.coverage, scopeNote: stage1Preview.scopeNote,
    amountCents: stage1Preview.amountCents,
    unsettledTotalCents: stage1Preview.unsettledTotalCents,
    allocations,
    payload: { allocations: allocations.map(a => ({ recordId: a.recordId, amount: a.amountCents / 100 })) },
    title: `核销分配 · ${stage1Preview.customer.name}`,
    confirmLabel: '确认核销',
    lines: allocations.map(a => ({
      productName: `${a.orderNo}（余额 ¥${(a.balanceBeforeCents / 100).toFixed(2)} → 核销后 ¥${((a.balanceBeforeCents - a.amountCents) / 100).toFixed(2)}）`,
      qty: 1, unitPriceCents: a.amountCents,
      priceSource: { level: a.settledAfter ? '核销后结清' : '部分核销' },
    })),
    totalCents: allocTotal,
  };
}

// 第一段收尾：回查收款单 → 生成第二段（核销分配）任务并把它的预览交给界面
async function finishReceiptStage(store, client, task, receipt, recovered) {
  task.transition('VERIFYING');
  const detail = await receiptTool().detail(client, { receiptId: receipt.id }).catch(() => null);
  if (!detail || toCents(detail.amount) !== task.preview.amountCents) {
    task.transition('ESCALATED'); store.save();
    return { task, reply: `收款单已登记但回查核验不平（预览 ¥${(task.preview.amountCents / 100).toFixed(2)}，回查 ${detail ? '¥' + Number(detail.amount).toFixed(2) : '查不到'}），已转人工。收款单 ${receipt.receiptNo || receipt.id} 请勿重复登记。` };
  }
  const settlePreview = buildSettlePreview(task.preview, detail);
  const settleTask = store.create({ graph: 'D-settle', userText: task.userText, actor: task.actor });
  settleTask.transition('DISAMBIGUATING');
  settleTask.transition('DRY_RUNNING');
  settleTask.setPreview(settlePreview);
  settleTask.transition('AWAITING_CONFIRM');
  task.result = { receiptId: detail.id, receiptNo: detail.receiptNo, amountCents: task.preview.amountCents, stage2TaskId: settleTask.id, ...(recovered ? { recoveredViaReceipt: true } : {}) };
  task.transition('DONE');
  store.save();
  const reply = `${recovered ? '刚才响应丢失，但回执确认收款已登记：' : ''}收款单 ${detail.receiptNo} 已登记 ¥${Number(detail.amount).toFixed(2)}（入账「${detail.accountName || task.preview.account.name}」），钱已进账、尚未核销。` +
    `下面是核销分配预览（第 2 段确认）：按账龄最老优先，${settlePreview.allocations.map(a => `${a.orderNo} 核销 ¥${(a.amountCents / 100).toFixed(2)}${a.settledAfter ? '（结清）' : ''}`).join('；')}，合计 ¥${(settlePreview.totalCents / 100).toFixed(2)}。` +
    (settlePreview.unsettledTotalCents > settlePreview.totalCents
      ? `核销后本次来源关联范围还剩未结 ¥${((settlePreview.unsettledTotalCents - settlePreview.totalCents) / 100).toFixed(2)}。`
      : '核销后本次来源关联范围内的未结应收结清。') +
    (settlePreview.scopeNote || '') +
    `请在下一张卡点「确认核销」，预览 10 分钟内有效。`;
  return { task: settleTask, preview: settlePreview, reply };
}

async function confirmReceiptDraft(store, client, task, actor) {
  if (!hasPerm(actor, 'payment.execute')) {
    const err = new PermissionDeniedError('payment.execute', task.graph);
    return { task, reply: denialReply(actor, err) + '（任务仍保留在待确认，未执行）' };
  }
  try { assertReceiptPreviewAmount(task.preview, task.userText); }
  catch (error) {
    task.error = error.message; task.transition('EXPIRED'); store.save();
    return { task, reply: `${error.message}这份预览已失效，未登记收款。` };
  }
  // 多账户未选户：硬拦截，不登记（选户在对话里完成，见 tryAccountSelection）
  if (task.preview?.needsAccountChoice) {
    return { task, reply: '还没选入账账户：请先在对话里回复序号或账户名选定账户，再点确认。任务仍保留在待确认，未执行。' };
  }
  // 新鲜度复核：未结余额构成/到账额/入账账户与预览不一致即拦截（总体设计 §4）
  let freshRecords = null, accountAlive = false;
  try {
    freshRecords = await unsettledReceivables(client, task.preview.customer.id);
    const accounts = await receiptTool().accounts(client);
    accountAlive = accounts.some(a => Number(a.id) === task.preview.account.id);
  } catch (e) {
    return { task, reply: `确认时复核取数失败：${e.message}。未执行，可稍后重试确认。` };
  }
  if (!accountAlive || receiptSignature(freshRecords, task.preview.amountCents, task.preview.account.id) !== task.preview.signature) {
    task.transition('EXPIRED'); store.save();
    return { task, reply: '确认时发现未结账款余额或资金账户已变化（可能已被他人收款/核销），已拦截登记。请重新发起，我按最新余额重新试算。' };
  }
  task.transition('CONFIRMED');
  task.transition('EXECUTING');
  store.save();
  try {
    const { created } = await run('payments.receipt_suggest', client, { payload: task.preview.payload, requestKey: task.requestKey }, actor);
    task.recordStep('create', 'payments.receipt_suggest', created);
    return finishReceiptStage(store, client, task, created, false);
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save();
      // 先查回执：同键是否已落库（永不换键重试）
      const receipt = await client.requestStatus(task.requestKey, 'payment.receipt.create').catch(() => null);
      const resId = receipt?.resourceId ?? receipt?.data?.resourceId ?? null;
      if (resId) {
        const detail = await receiptTool().detail(client, { receiptId: resId }).catch(() => null);
        if (detail && toCents(detail.amount) === task.preview.amountCents) {
          return finishReceiptStage(store, client, task, detail, true);
        }
      }
      task.transition('ESCALATED'); store.save();
      return { task, reply: `登记收款结果未知且未查到回执，已转人工核查，请核对原操作，不要重复提交。` };
    }
    task.error = e.message;
    task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `登记收款被系统拒绝：${e.message}（原样转述，未自动改数重试）` };
  }
}

// 核销后回查：逐笔 paid/balance/status 与预览推演一致 + 收款单 settled/balance 一致
async function verifySettled(client, task) {
  const p = task.preview;
  try {
    const all = await receiptTool().records(client, { customerId: p.customer.id });
    const byId = new Map(all.map(r => [Number(r.id), r]));
    for (const a of p.allocations) {
      const r = byId.get(a.recordId);
      if (!r) return false;
      const balanceAfter = a.balanceBeforeCents - a.amountCents;
      if (toCents(r.balance) !== balanceAfter) return false;
      if (toCents(r.paidAmount) !== a.totalCents - balanceAfter) return false;
      if ((balanceAfter === 0) !== (Number(r.status) === 3)) return false;
    }
    const detail = await receiptTool().detail(client, { receiptId: p.receiptId });
    if (!detail || toCents(detail.settledAmount) !== p.totalCents || toCents(detail.balance) !== p.amountCents - p.totalCents) return false;
    return true;
  } catch { return false; }
}

function settleDoneReply(p, recovered) {
  const remaining = p.unsettledTotalCents - p.totalCents;
  return `${recovered ? '刚才响应丢失，但回执确认核销已执行：' : ''}核销完成（收款单 ${p.receiptNo}）：` +
    p.allocations.map(a => `${a.orderNo} 核销 ¥${(a.amountCents / 100).toFixed(2)}${a.settledAfter ? '，已结清' : `，剩余 ¥${((a.balanceBeforeCents - a.amountCents) / 100).toFixed(2)}`}`).join('；') +
    `。回查逐笔对平。${remaining > 0 ? `本次来源关联范围还剩未结 ¥${(remaining / 100).toFixed(2)}。` : '本次来源关联范围内的未结应收已结清。'}${p.scopeNote || ''}`;
}

async function confirmSettle(store, client, task, actor) {
  if (!hasPerm(actor, 'payment.execute')) {
    const err = new PermissionDeniedError('payment.execute', task.graph);
    return { task, reply: denialReply(actor, err) + '（任务仍保留在待确认，未执行；已登记的收款单不受影响）' };
  }
  const p = task.preview;
  // 新鲜度复核：逐笔余额与收款单剩余可核销额与预览不一致即拦截
  let records = null, detail = null;
  try {
    records = await unsettledReceivables(client, p.customer.id);
    detail = await receiptTool().detail(client, { receiptId: p.receiptId });
  } catch (e) {
    return { task, reply: `确认时复核取数失败：${e.message}。未执行核销，可稍后重试确认。` };
  }
  const byId = new Map(records.map(r => [r.recordId, r]));
  const changed = p.allocations.find(a => !byId.has(a.recordId) || byId.get(a.recordId).balanceCents !== a.balanceBeforeCents);
  if (changed || !detail || toCents(detail.balance) !== p.amountCents || toCents(detail.settledAmount) !== 0) {
    task.transition('EXPIRED'); store.save();
    return { task, reply: `确认时发现状态已变化（${changed ? `账款 ${changed.orderNo} 的余额与预览不一致` : '收款单已被动用或状态变化'}），已拦截核销。收款已经登记，请到收付款页针对原收款单重新分配，不要重复登记收款。` };
  }
  task.transition('CONFIRMED');
  task.transition('EXECUTING');
  store.save();
  try {
    await receiptTool().settle(client, { receiptId: p.receiptId, allocations: p.payload.allocations, requestKey: task.requestKey });
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save();
      const receipt = await client.requestStatus(task.requestKey, `payment.receipt.settle.${p.receiptId}`).catch(() => null);
      const resId = receipt?.resourceId ?? receipt?.data?.resourceId ?? null;
      if (resId && Number(resId) === Number(p.receiptId) && await verifySettled(client, task)) {
        task.result = { receiptId: p.receiptId, receiptNo: p.receiptNo, recoveredViaReceipt: true };
        task.transition('VERIFYING');
        task.transition('DONE'); store.save();
        return { task, reply: settleDoneReply(p, true) };
      }
      task.transition('ESCALATED'); store.save();
      return { task, reply: `核销结果未知且未查到回执，已转人工核查，请核对原操作，不要重复提交。收款单 ${p.receiptNo} 的钱已登记，请勿重复登记收款。` };
    }
    task.error = e.message;
    task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `核销被系统拒绝：${e.message}（原样转述）。收款单 ${p.receiptNo} 仍挂账未核销，可到收付款页人工处理。` };
  }
  task.transition('VERIFYING');
  if (!await verifySettled(client, task)) {
    task.transition('ESCALATED'); store.save();
    return { task, reply: `核销已提交但回查与预览不一致，已转人工核查（收款单 ${p.receiptNo}）。` };
  }
  task.result = { receiptId: p.receiptId, receiptNo: p.receiptNo, allocatedCents: p.totalCents };
  task.transition('DONE'); store.save();
  return { task, reply: settleDoneReply(p, false) };
}

// ---------- 图 E/F ----------
async function graphSimple(store, client, actor, text, graph, tool, buildReply, gate) {
  const task = store.create({ graph, userText: text, actor });
  task.transition('DRY_RUNNING');
  if (gate?.anyOf) {
    const denied = denyIfMissingAny(task, actor, gate.anyOf);
    if (denied) { store.save(); return denied; }
  } else if (gate?.allOf) {
    const denied = denyIfMissing(task, actor, gate.allOf);
    if (denied) { store.save(); return denied; }
  }
  try {
    const data = await run(tool, client, {}, actor);
    task.result = data; task.transition('DONE'); store.save();
    return { task, reply: buildReply(data), result: data };
  } catch (e) {
    if (e instanceof PermissionDeniedError) { task.error = e.message; task.transition('FAILED_FINAL'); store.save(); return { task, reply: denialReply(actor, e) }; }
    task.error = e.message; task.transition('FAILED_FINAL'); store.save();
    return { task, reply: `查询失败：${e.message}` };
  }
}

// ---------- 图 E/F 的事实摘要 ----------
const briefingGraph = (store, client, actor, t) => graphSimple(store, client, actor, t, 'F-briefing', 'dashboard.briefing', briefingReply,
  { allOf: ['dashboard.view'] });
const stuckGraph = (store, client, actor, t) => graphSimple(store, client, actor, t, 'E-stuck', 'tasks.progress', stuckReply,
  { anyOf: ['warehouse.task.view', 'inventory.view'] });

const refusal = (text) => ({ task: null, reply: guideReply(text) });

// ---------- 结构化意图执行（LLM 解析后的唯一入口） ----------
export async function executeIntent(store, client, actor, text, intent, task) {
  switch (intent.graph) {
    case 'A-inventory': return graphInventory(store, client, actor, text, intent.productKeyword, { warehouseKeyword: intent.warehouseKeyword, task });
    case 'B-sale-draft': return graphSaleDraft(store, client, actor, text, { customerKeyword: intent.customerKeyword, lines: intent.lines, task });
    case 'D-ledger': return graphLedger(store, client, actor, text, intent.customerKeyword, task);
    case 'D-receipt': return graphReceipt(store, client, actor, text, { customerKeyword: intent.customerKeyword, amountCents: intent.amountCents ?? null, task });
    case 'C-replenishment': return graphReplenishment(store, client, actor, text);
    case 'C-purchase-draft': return graphPurchaseDraft(store, client, actor, text);
    case 'B2-reserve': return graphReserve(store, client, actor, text, intent.orderNo);
    case 'E-stuck': return stuckGraph(store, client, actor, text);
    case 'F-briefing': return briefingGraph(store, client, actor, text);
    default: return refusal(text);
  }
}

// ---------- 主入口：LLM 意图解析（已配置模型时）→ 回退规则规划器 ----------
// opts.parseIntent 可注入（测试用）；默认 parseIntentLLM，未配置模型时自动跳过。
export async function handleMessage(store, client, actor, text, opts = {}) {
  const t = activeTopicText(text);
  const routing = classifyMessage(text);
  if (routing.kind === 'blocked') return { task: null, reply: routing.reply };
  const operation = async () => rememberOutput(store, await handleMessageUnlocked(store, client, actor, text, opts));
  if (opts.taskId) return store.exclusive(opts.taskId, operation);
  if (smallTalkReply(t)) return operation();
  const accountTask = pendingAccountTask(store, actor);
  const accountAnswer = accountTask && (/^\d+$/.test(t) || /选.{0,8}账户|入账账户/.test(t) || accountTask.preview.accounts?.some(account => t.includes(account.name)));
  if (accountAnswer) return store.exclusive(accountTask.id, async () => rememberOutput(store, await tryAccountSelection(store, actor, t, client, accountTask)));
  return operation();
}

async function continueTask(store, client, actor, text, opts) {
  const task = store.get(opts.taskId);
  if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
  if (!ownsTask(task, actor)) throw Object.assign(new Error('只能查看或处理本人发起的任务'), { status: 403 });
  const quantityEdit = /(?:改成|改为|改到)\s*[\d.零一二两三四五六七八九十百千]+\s*(?:个|件|条|只|套|箱|把)?[。！!]?$/;
  const busy = ['EXECUTING', 'RESULT_UNKNOWN', 'CONFIRMED', 'VERIFYING', 'ESCALATED'].includes(task.state);
  if (busy && (opts.choiceId != null || quantityEdit.test(text) || /开单|草稿|占库|核销|收款|到账|重新试算|重试|重新建|重新生成/.test(text))) throw Object.assign(new Error('此任务正在执行或结果尚未核实，请查询原任务，不能修改或另换请求键'), { status: 409 });
  const accountReply = task.graph === 'D-receipt' && task.state === 'AWAITING_CONFIRM' && task.preview?.needsAccountChoice
    && (opts.choiceId != null || /^\d+$/.test(text) || task.preview.accounts?.some(account => text.includes(account.name)));
  if (accountReply) return tryAccountSelection(store, actor, text, client, task, opts.choiceId);
  if (task.graph === 'B-sale-draft' && task.intent?.intake && task.state === 'DISAMBIGUATING' && !task.candidates?.length && opts.choiceId == null) {
    const nextGraph = ruleGraphFor(text);
    if (!nextGraph || nextGraph === 'B-sale-draft') return graphSaleDraft(store, client, actor, text, { task });
  }
  if (opts.choiceId != null) {
    assertTaskAccess(task, actor);
    if (task.state !== 'DISAMBIGUATING' || !task.selection || !task.candidates?.some(c => String(c.id) === String(opts.choiceId))) throw Object.assign(new Error('请选择本任务原候选列表中的对象'), { status: 400 });
    const { keyword, type, slot } = task.selection;
    const current = await resolveOne(client, keyword, type, actor);
    if (!current.some(c => String(c.id) === String(opts.choiceId))) throw Object.assign(new Error('该候选当前已不可见，请重新发起查询'), { status: 409 });
    task.selections = { ...task.selections, [slot]: opts.choiceId };
    return executeIntent(store, client, actor, task.userText, task.intent, task);
  }
  if (quantityEdit.test(text)) { assertTaskAccess(task, actor); return reviseSalePreview(store, client, actor, task, text); }
  if (task.state === 'DISAMBIGUATING' && /^(?:选|第)?[\d一二两三四五六七八九十]+(?:个|项|号)?[。！!]?$/u.test(text)) {
    assertTaskAccess(task, actor); return { task, reply: task.reply || task.error, candidates: task.candidates };
  }
  // taskId 是当前选中记录的上下文，不把它视为“所有后续消息都修改此任务”。新问题只送新文本。
  return handleMessageUnlocked(store, client, actor, text, { ...opts, taskId: undefined });
}

function quantityNumber(raw) {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, digit = 0;
  for (const char of raw) {
    if (Object.hasOwn(digits, char)) digit = digits[char];
    else if (char === '十' || char === '百' || char === '千') { total += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000 }[char]); digit = 0; }
    else return NaN;
  }
  return total + digit;
}

async function reviseSalePreview(store, client, actor, task, text) {
  if (task.graph !== 'B-sale-draft' || task.state !== 'AWAITING_CONFIRM' || task.previewExpired()) throw Object.assign(new Error('只能修改有效且待确认的销售草稿预览；请核对当前任务或重新试算'), { status: 409 });
  if (!hasPerm(actor, 'sale.order.create')) throw Object.assign(new Error('当前没有销售单新建权限，未修改预览'), { status: 403 });
  const match = text.match(/^(.*?)(?:改成|改为|改到)\s*([\d.零一二两三四五六七八九十百千]+)\s*(?:个|件|条|只|套|箱|把)?[。！!]?$/);
  if (!match || /审批|付款|发货|确认|提交|执行/.test(match[1])) return { task, reply: '小满可以修改这张待确认销售预览的数量。请说明「第几行数量改成多少」，修改后仍需在新预览卡确认。', preview: task.preview };
  const qty = quantityNumber(match[2]);
  const indexMatch = match[1].match(/第([\d零一二两三四五六七八九十百]+)行/);
  let index = indexMatch ? quantityNumber(indexMatch[1]) - 1 : null;
  if (index == null) {
    const named = task.preview.lines.map((line, i) => ({ line, i })).filter(({ line }) => match[1].includes(line.productName));
    if (named.length === 1) index = named[0].i;
    else if (task.preview.lines.length === 1 && /数量|刚才|这单|这张/.test(match[1])) index = 0;
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= task.preview.lines.length) return { task, reply: '有多行或无法确定要改哪一行，请明确「第几行数量改成多少」，我没有猜行或改量。', preview: task.preview };
  const lines = task.preview.lines.map((line, i) => ({ productKeyword: line.productName, productHit: { id: line.productId, title: line.productName }, qty: i === index ? qty : line.qty }));
  let fresh;
  try { fresh = await buildSalePreview(client, { customerHit: { id: task.preview.customer.id }, warehouseId: task.preview.warehouseId, lines }, actor); }
  catch (error) { return { task, reply: `预览未修改：${error.message}`, preview: task.preview }; }
  fresh.warehouseName = await warehouseName(client, fresh.warehouseId);
  fresh.payload = salePayload(fresh);
  task.setPreview(fresh);
  task.error = null;
  store.save();
  return { task, preview: task.preview, reply: `第 ${index + 1} 行「${fresh.lines[index].productName}」数量已改为 ${qty}，已重新读取商品规则、价格和库存试算，合计 ¥${(fresh.totalCents / 100).toFixed(2)}。这是第 ${task.revision} 版预览，请核对后点击确认，尚未建单。` };
}

async function handleMessageUnlocked(store, client, actor, text, opts = {}) {
  const t = activeTopicText(text);
  if (opts.taskId) return continueTask(store, client, actor, t, opts);
  const greeting = smallTalkReply(t);
  if (greeting) return { task: null, reply: greeting };
  const routing = classifyMessage(t);
  if (['blocked', 'outside', 'clarify'].includes(routing.kind)) return { task: null, reply: routing.reply };
  if (routing.kind === 'discussion') {
    const local = knownConceptReply(t);
    if (local) return { task: null, reply: local };
    return { task: null, reply: DISCUSSION_CLOSED_REPLY };
  }
  const parseIntent = opts.parseIntent || (config.model.apiKey ? parseIntentLLM : null);
  if (parseIntent) {
    try {
      const intent = await parseIntent(t);
      if (intent && intent.graph !== 'none') return executeIntent(store, client, actor, t, intent);
      if (intent && intent.graph === 'none' && ruleGraphFor(t) !== 'B-sale-draft') return refusal(t);
    } catch { /* 模型异常 → 回退规则，不中断服务 */ }
  }
  // 规则规划器（确定性回退）
  switch (ruleGraphFor(t)) {
    case 'F-briefing': return briefingGraph(store, client, actor, t);
    case 'E-stuck': return stuckGraph(store, client, actor, t);
    case 'C-purchase-draft': return graphPurchaseDraft(store, client, actor, t);
    case 'C-replenishment': return graphReplenishment(store, client, actor, t);
    case 'B2-reserve': return graphReserve(store, client, actor, t);
    case 'D-receipt': return graphReceipt(store, client, actor, t);
    case 'B-sale-draft': return await graphSaleDraft(store, client, actor, t) || refusal(t);
    case 'D-ledger': return graphLedger(store, client, actor, t);
    case 'A-inventory': return graphInventory(store, client, actor, t);
    default: return refusal(t);
  }
}
