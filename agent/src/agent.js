// 编排层：意图 → 任务图 → 试算 → 预览 → 确认 → 执行 → 核验。
// MVP 规划器为规则规划器（确定性、可测试）；LLM 规划器接口见 plannerLLM（未配模型时明确报错，不假装）。
import { getTool, TASK_PROGRESS_PERMISSIONS } from './tools.js';
import { validateQty, toCents, diffPreview, amountCents } from './guards.js';
import { FlowError } from './flow.js';
import { config } from './config.js';
import { readStockRows } from './stock-rows.js';
import { collectList } from './pagination.js';
import { parseIntentLLM } from './llm.js';
import { customerFromText, groundCustomerIntent, receiptCustomerFromText } from './customer-source.js';
import { workbenchKeys } from './operations-read.js';
import { hasPerm, PermissionDeniedError, denialReply } from './perms.js';
import { assertTaskAccess, ownsTask, rememberOutput } from './task-access.js';
import { briefingReply, stuckReply } from './reports.js';
import { smallTalkReply, knownConceptReply } from './persona.js';
import { classifyMessage, ruleGraphFor, activeTopicText, missingInventoryProduct, DISCUSSION_CLOSED_REPLY, guideReply } from './routing.js';
import { assertReceiptAmountCents, assertReceiptPreviewAmount, parseReceiptAmount } from './receipt-amount.js';
import { SEQUENCE_GRAPH, READ_STEPS, parseStockSaleCondition, resumesOriginal } from './composite-routing.js';
import { createReadSequence, advanceReadSequence } from './read-sequence.js';
import { forwardedMessage, operatorInput, prepareForwardedSale } from './input-source.js';
import { candidateKey, customerReference, referenceMatches, referenceQuestion, referenceRequest, taskDocumentNo } from './conversation-reference.js';
import { findHistoricalTask, historicalQuestion, historicalRequest, isHandoffHistory, RECOVERY_STATES } from './history-resume.js';
import { handoffRequest, HANDOFF_NUMBER_REQUIRED, HANDOFF_PERMISSIONS, previousOrderMention, releaseSupplementAnswer, reservationRelease, SALE_HANDOFF_GRAPH, SALE_STATES } from './sale-handoff.js';
import { saleTraceRequest } from './sale-trace.js';
import { cashUnits, exactReceipt, explicitPlanSignature, explicitPreviewReply, settlementReceiptMatches, explicitSettlementPreview,
  receiptAllocationRequest, receiptEntriesMatch, receiptLedgerFingerprint, receiptOverview, signedCashUnits } from './receipt-allocation.js';
import { captureSettlementEntries, reviewSettlement, settlementReapplyLinks } from './settlement-history.js';
import { batchFollowup, batchProgress, batchReviewHistory, compareBatchCorrection, releaseHasRemaining, reversalHasRemaining,
  batchReconciliationText, releaseBatchText, reversalBatchText, reviewedReceipt, verifiedBatchMovement, withBatchClaims } from './reapply-progress.js';
import { MONTHLY_GRAPH, exactStatement, monthlyOverview, monthlyPreview, monthlyPreviewReply,
  monthlyRequest, statementEvidence } from './monthly-reconciliation.js';
import { RETURN_FINANCE, REFUND_EXECUTE, RETURN_READ, REFUND_PERMISSIONS, returnFinanceRequest, readReturnFinance,
  refundByNumber, refundDetail, saleByReturnNumber, buildRefundPreview, refundPreviewReply, refundReceiptMatches, linkedNo } from './return-finance.js';
import { CROSS_PERIOD, BACKFILL_ACTION, crossPeriodRequest, runCrossPeriod, confirmBackfill, recoverBackfill,
  APPROVE_BACKFILL, APPLY_BACKFILL, refreshBackfill, closedRefundReply } from './cross-period.js';
import { inventoryWords, warehouseOrdinal, inventoryProductCode, productSearchAlternative, branchSearchAlternative } from './inventory-terms.js';
import { intakeSale, groundSaleLines, quantityNumber, forwardedSaleFields, saleCorrection, saleIntakeReply } from './sale-conversation.js';

// 工具调用统一入口：先验发起人权限（与后端 requirePermission 同码），无权零调用、明确拒绝。
const run = (tool, client, args, actor) => {
  const t = getTool(tool);
  if (t.requires && !hasPerm(actor, t.requires)) throw new PermissionDeniedError(t.requires, t.desc);
  return t.run(client, args, actor);
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

async function lookupEntity(client, keyword, type, actor) {
  const hits = await resolveOne(client, keyword, type, actor);
  if (hits.length) return { hits, alternative: false };
  if (type === 'product') {
    const search = productSearchAlternative(keyword);
    if (search) return { hits: await resolveOne(client, search, type, actor), alternative: true };
  }
  if (type === 'customer') {
    const search = branchSearchAlternative(keyword);
    if (search) {
      const related = await resolveOne(client, search.prefix, type, actor);
      return { hits: related.filter(hit => hit.title.startsWith(search.prefix)
        && hit.title.match(/\d+号(?:店|门店|分店)$/)?.[0] === search.branch), alternative: true };
    }
  }
  return { hits, alternative: false };
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
async function scopeHits(client, actor, hits, type, alternative) {
  const allowed = Array.isArray(actor?.warehouseIds) ? actor.warehouseIds.map(Number) : null;
  let pruned = false;
  let visible = hits.filter(hit => {
    const outside = hitOutsideScope(hit, actor);
    if (outside) pruned = true;
    return !outside;
  });
  if (type === 'product' && allowed && (alternative ? visible.length > 0 : visible.some(approximateHit))) {
    let rows;
    try {
      rows = await readStockRows(client, visible.filter(hit => alternative || approximateHit(hit)).map(hit => hit.id), { warehouseCount: allowed.length });
    } catch {
      throw Object.assign(new Error('暂时对不上这些相近商品是否在你的仓库范围内，没有列出候选，也不会改查其他仓库。'), { code: 'ENTITY_NOT_FOUND' });
    }
    visible = visible.filter(hit => {
      if (!alternative && !approximateHit(hit)) return true;
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
  const { hits: found, alternative } = await lookupEntity(client, keyword, type, actor);
  const { hits, pruned } = await scopeHits(client, actor, found, type, alternative);
  const selected = task.selections?.[slot];
  if (selected != null) {
    const hit = hits.find(h => String(h.id) === String(selected));
    if (!hit) throw new Error('原先选择的对象已不可见或不再符合原搜索，请重新发起');
    return hit;
  }
  if (!alternative && type === 'customer') {
    const exact = hits.filter(hit => hit.title === keyword);
    if (exact.length === 1) return exact[0];
  }
  const name = type === 'customer' ? '客户' : '商品';
  if (!alternative && type === 'product' && /^[A-Z]{1,4}\d{2,24}$/i.test(keyword)) {
    const byCode = hits.filter(hit => String(hit.subtitle).toUpperCase() === keyword.toUpperCase());
    if (byCode.length === 1) return byCode[0];
  }
  const approximate = alternative || (type === 'product' && hits.some(approximateHit));
  if (hits.length === 1 && !approximate) return hits[0];
  const message = !hits.length
    ? (pruned ? `「${keyword}」的相近${name}不在你的仓库范围内，已拒绝，不会改用其他仓库。` : `未找到${name}「${keyword}」`)
    : (approximate ? `「${keyword}」有 ${hits.length} 个相近${name}，请选一个后再继续。我不会自动换成某一个。` : `「${keyword}」命中 ${hits.length} 个${name}，请选择一个后继续`);
  throw Object.assign(new Error(message), {
    code: hits.length ? 'CHOICE_REQUIRED' : 'ENTITY_NOT_FOUND', candidates: hits,
    allowProductCorrection: type === 'product' && !pruned && !hits.length,
    allowCustomerCorrection: type === 'customer' && !pruned && !hits.length,
    selection: { keyword, type, slot },
  });
}

function entityFailure(store, task, error) {
  task.error = error.message;
  if (error.code === 'CHOICE_REQUIRED') {
    task.selection = error.selection;
    task.candidates = error.candidates.map(({ id, type, title, subtitle, details }) => ({ id, type, title, subtitle, details }));
    store.save(task);
    return { task, reply: error.message, candidates: task.candidates };
  }
  task.transition('FAILED_FINAL'); store.save(task);
  return { task, reply: error.message };
}

function clearChoice(task) { task.selection = null; task.candidates = null; task.error = null; }

async function inventoryWarehouses(client, actor, text, warehouseKeyword, warehouseOverride) {
  const { list: all } = await collectList(client, '/api/warehouses');
  const { written } = inventoryWords(text);
  const inputHint = warehouseKeyword && text.includes(warehouseKeyword) && !/^[仓倉](?:库|庫)?$/.test(warehouseKeyword) ? warehouseKeyword : null;
  const requested = warehouseOverride || written || inputHint;
  const exact = requested ? all.filter(w => w.name === requested) : [];
  if (warehouseOverride && !exact.length) {
    throw Object.assign(new Error('没有匹配到可访问的完整仓库名称，请核对后再发一次'), { code: 'INVENTORY_WAREHOUSE_AMBIGUOUS' });
  }
  const number = warehouseOrdinal(requested);
  const named = !requested ? all.filter(w => text.includes(w.name))
    : exact.length ? exact
      : Number.isFinite(number) ? all.filter(w => warehouseOrdinal(w.name, true) === number)
        : all.filter(w => w.name.includes(requested));
  const explicit = Boolean(requested || named.length);
  if (explicit && !named.length) throw new Error('未找到指定仓库或该仓库当前不可访问，请写出完整仓库名称');
  if (explicit && named.length !== 1) {
    throw Object.assign(new Error('指定仓库不唯一，请写出完整仓库名称'), { code: 'INVENTORY_WAREHOUSE_AMBIGUOUS', requested });
  }
  const warehouses = explicit ? named : all;
  if (Array.isArray(actor?.warehouseIds) && explicit && !actor.warehouseIds.includes(Number(warehouses[0].id))) throw new Error('指定仓库不在你的仓库范围内，已拒绝');
  const scoped = Array.isArray(actor?.warehouseIds) ? warehouses.filter(w => actor.warehouseIds.includes(Number(w.id))) : warehouses;
  if (!scoped.length) throw new Error('你的账号没有可访问的仓库（仓库范围为空），无法继续');
  return { warehouses: scoped, explicit, warehousePhrase: requested };
}

async function getCustomer(client, id) {
  try { return await client.get(`/api/customers/${id}`); }
  catch {
    const data = await client.get('/api/customers?page=1&pageSize=100');
    const list = data?.list ?? [];
    return list.find(x => String(x.id) === String(id)) || null;
  }
}

// 图 B 选仓：不能盲取范围内第一个仓——第一个仓可能是空仓（库存图/C 图已各踩过一次同款陷阱），
// 空仓会让预览全是假缺口，且 payload 的商品编码/单位取不到、被后端校验拒绝。
// 口径：范围内第一个「有本单任一商品库存行」的仓；都没有才回退第一个仓（预览如实报缺口）。
async function pickSaleWarehouse(client, actor, productIds) {
  const warehouses = await inScopeWarehouses(client, actor);
  const rows = await readStockRows(client, productIds, { warehouseCount: warehouses.length });
  for (const w of warehouses) {
    if (rows.some(r => Number(r.warehouseId) === w.id && productIds.includes(Number(r.productId)))) return w.id;
  }
  // TODO(巡检登记 2026-10-26)：图 B「无任何仓有库存行」时以范围内首仓兜底——多仓下
  // 可能并非用户预期仓库。候选改进：预览中明示所选仓并允许对话改仓。本轮只登记不改行为。
  return warehouses[0].id;
}

async function warehouseName(client, warehouseId) {
  const { list } = await collectList(client, '/api/warehouses');
  return list.find(w => String(w.id) === String(warehouseId))?.name || '';
}

function inventoryItem(text, preset, warehousePhrase, warehouses = []) {
  let keyword = preset ?? inventoryWords(text).withoutHead;
  if (warehousePhrase) keyword = keyword.replace(warehousePhrase, '');
  for (const w of warehouses) keyword = keyword.replace(w.name, '');
  return inventoryProductCode(keyword.replace(/帮我查一下|帮我查|查一下|只查|只看|先查|还剩多少|还有多少|有多少|库存|在哪个仓|在哪|[？?。]/g, '')
    .replace(/^(?:的|在|里|中|[，,:：\s])+|[的\s]+$/g, ''));
}

// ---------- 图 A：查库存 ----------
async function graphInventory(store, client, actor, text, presetKeyword, options = {}) {
  const task = options.task || store.create({ graph: 'A-inventory', userText: text, actor });
  if (['CREATED', 'PAUSED'].includes(task.state)) task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, ['inventory.view', 'dashboard.view', 'product.view', 'warehouse.view']);
  if (denied) { store.save(task); return denied; }
  const incomplete = presetKeyword == null && missingInventoryProduct(text);
  if (incomplete) {
    task.intent = { graph: 'A-inventory', intake: true, warehouseKeyword: incomplete.warehouseKeyword };
    store.save(task);
    return { task, reply: incomplete.warehouseKeyword
      ? `仓库先按「${incomplete.warehouseKeyword}」。请给出要查的商品名称或编号。`
      : '请给出要查的商品名称或编号。指定仓库的话也可以一起告诉我。' };
  }
  let warehouses, explicit, hit, keyword;
  try {
    if (options.stockTarget) {
      const { warehouseId, productId } = options.stockTarget;
      warehouses = (await inScopeWarehouses(client, actor)).filter(w => Number(w.id) === warehouseId);
      if (warehouses.length !== 1) throw new Error('原仓库当前不可访问，请重新核对仓库范围。');
      const product = await client.get(`/api/products/${productId}`);
      if (Number(product?.id) !== productId) throw new Error('原商品当前不可访问，请核对商品编号。');
      hit = { id: productId, title: product.name };
      explicit = true;
    } else {
      let warehousePhrase;
      ({ warehouses, explicit, warehousePhrase } = await inventoryWarehouses(client, actor, text, options.warehouseKeyword, options.warehouseOverride));
      keyword = options.warehouseOverride ? inventoryProductCode(presetKeyword) : inventoryItem(text, presetKeyword, warehousePhrase, warehouses);
      task.intent = { graph: 'A-inventory', productKeyword: keyword, warehouseKeyword: explicit ? warehouses[0].name : undefined,
        ...(options.warehouseOverride ? { warehouseOverride: warehouses[0].name } : {}) };
    }
    task.accessWarehouseIds = warehouses.map(w => Number(w.id));
    if (!hit) hit = await resolveEntity(client, task, actor, keyword, 'product', 'product');
  } catch (e) {
    if (task.stockSale && (e.kind === 'unknown' || e.status >= 500)) return pauseStockRead(store, task);
    if (e.code === 'INVENTORY_WAREHOUSE_AMBIGUOUS' && !task.stockSale && !task.sequenceOwner) {
      const productKeyword = options.warehouseOverride ? presetKeyword : inventoryItem(text, presetKeyword, e.requested);
      task.intent = { graph: 'A-inventory', productKeyword, intake: true, needsWarehouse: true };
      clearChoice(task);
      return { task, reply: e.message + '，商品已保留。' };
    }
    if (e.allowProductCorrection) {
      task.intent.intake = true;
      clearChoice(task);
      return { task, reply: e.message + '。请再给出商品全称或编号，我会沿用这次的仓库范围。' };
    }
    return entityFailure(store, task, e);
  }
  clearChoice(task);
  task.transition('DRY_RUNNING');
  const perWarehouse = [];
  try {
    const stocks = await readStockRows(client, [hit.id], warehouses.length === 1
      ? { warehouseId: warehouses[0].id } : { warehouseCount: warehouses.length });
    for (const warehouse of warehouses) {
      const wid = Number(warehouse.id);
      const inv = await run('inventory.query_by_product', client, { productId: hit.id, warehouseId: wid }, actor);
      const stock = stocks.find(row => Number(row.warehouseId) === wid);
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
  } catch (error) {
    if (task.stockSale && (error.kind === 'unknown' || error.status >= 500)) return pauseStockRead(store, task);
    task.error = '库存取数失败，请稍后重查或到库存管理核对。';
    task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: task.error };
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
    task.transition('ESCALATED'); store.save(task);
    return { task, reply: `注意：${mismatch.warehouseName} 容器实存合计 ${mismatch.onHand} 与库存缓存 ${mismatch.cacheQty} 不一致，已如实上报，请人工核对。`, result };
  }
  task.transition('DONE'); store.save(task);
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
  const resolved = [];
  for (const line of lines) {
    const hits = line.productHit ? [line.productHit] : await resolveOne(client, line.productKeyword, 'product', actor);
    if (hits.length !== 1) {
      throw Object.assign(new Error(hits.length === 0
        ? `未找到商品「${line.productKeyword}」`
        : `商品「${line.productKeyword}」命中 ${hits.length} 个，请在原文中写全规格`), { code: 'DISAMBIGUATION' });
    }
    resolved.push({ line, hit: hits[0] });
  }
  const stocks = await readStockRows(client, resolved.map(row => row.hit.id), { warehouseId });
  const byProduct = new Map(stocks.filter(row => Number(row.warehouseId) === Number(warehouseId)).map(row => [Number(row.productId), row]));
  const outLines = [];
  for (const [index, { line, hit }] of resolved.entries()) {
    const product = await client.get(`/api/products/${hit.id}`);
    if (typeof product?.allowDecimalQty !== 'boolean') throw new Error(`无法核对商品「${hit.title}」当前数量规则，已停下请到商品页核对`);
    if (line.requestedUnit && product.unit !== line.requestedUnit) {
      throw Object.assign(new Error(`商品「${product.name || hit.title}」当前单位为「${product.unit}」，请按该单位说明数量。`),
        { code: 'SALE_UNIT_MISMATCH', index });
    }
    const err = validateQty(line.qty, { label: `商品「${hit.title}」数量`, allowDecimal: product.allowDecimalQty });
    if (err) throw Object.assign(new Error(err.message), { code: err.code });
    const price = await client.get(`/api/price-lists/customer-price?customerId=${customer.id}&productId=${hit.id}`);
    if (!price || price.salePrice == null) {
      throw Object.assign(new Error(`商品「${hit.title}」对该客户无定价，需人工填价，我不编价`), { code: 'NO_PRICE' });
    }
    const stock = byProduct.get(Number(hit.id));
    const unitPriceCents = toCents(price.salePrice);
    outLines.push({
      productId: hit.id, productName: product.name || hit.title, qty: line.qty, unit: product.unit, allowDecimalQty: product.allowDecimalQty,
      unitPrice: Number(price.salePrice), unitPriceCents, priceSource: { level: price.priceLevel, source: price.source },
      available: stock ? Number(stock.available) : 0,
      shortage: Math.max(0, line.qty - (stock ? Number(stock.available) : 0)),
      lineAmountCents: amountCents(price.salePrice, line.qty),
      _stockProduct: stock, // 供组装 payload 时取 code/unit（不进预览展示）
      _productCode: product.code || hit.subtitle || null,
      _productUnit: product.unit || (hit.details || []).find(d => d.label === '单位')?.value || null,
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
function matchesStockCondition(preview, condition) {
  const [line] = preview.lines;
  return preview.warehouseId === condition.warehouseId && preview.lines.length === 1
    && Number(line.productId) === condition.productId && line.unit === condition.unit && line.shortage === 0
    && (condition.minimumAvailable == null || line.available >= condition.minimumAvailable);
}

async function graphSaleDraft(store, client, actor, text, preset) {
  const prior = preset?.task?.intent?.intake ? preset.task.intent : null;
  const stockCondition = preset?.stockCondition ?? preset?.task?.intent?.stockCondition;
  const { customerKeyword, lines, unclearLines } = preset?.lines
    ? preset : intakeSale(text, prior, { keepUnit: true });
  const task = preset?.task || store.create({ graph: 'B-sale-draft', userText: text, actor });
  if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, SALE_DRAFT_PERMS);
  if (denied) { store.save(task); return denied; }
  if (prior && customerKeyword !== prior.customerKeyword && task.selections) {
    delete task.selections.customer;
    clearChoice(task);
  }
  const intake = !customerKeyword || !lines.length || lines.some(line => line.qty == null);
  task.intent = { graph: 'B-sale-draft', customerKeyword, lines,
    ...(intake ? { intake: true } : {}), ...(stockCondition ? { stockCondition } : {}) };
  if (intake) {
    task.error = null;
    store.save(task);
    return { task, reply: saleIntakeReply(customerKeyword, lines, unclearLines) };
  }
  if (stockCondition) task.accessWarehouseIds = [stockCondition.warehouseId];
  let warehouseId, customerHit, resolvedLines;
  try {
    customerHit = await resolveEntity(client, task, actor, customerKeyword, 'customer', 'customer');
    resolvedLines = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const productHit = await resolveEntity(client, task, actor, line.productKeyword, 'product', `line:${index}`);
      resolvedLines.push({ ...line, productHit });
    }
    if (stockCondition && Number(resolvedLines[0].productHit.id) !== stockCondition.productId) throw new Error('商品与刚才查库的对象不一致，请重新查询。');
    warehouseId = stockCondition?.warehouseId ?? task.saleEditWarehouseId ?? await pickSaleWarehouse(client, actor, resolvedLines.map(l => Number(l.productHit.id)));
  }
  catch (e) {
    if (e.allowCustomerCorrection) {
      clearChoice(task);
      task.intent = { ...task.intent, customerKeyword: undefined, intake: true };
      store.save(task);
      return { task, reply: e.message + '。请给出客户全称，商品和数量已保留。' };
    }
    return entityFailure(store, task, e);
  }
  clearChoice(task);
  let preview;
  try {
    preview = await buildSalePreview(client, { customerHit, lines: resolvedLines, warehouseId }, actor);
    if (stockCondition && !matchesStockCondition(preview, stockCondition)) throw new Error('复核时库存条件不再满足，未生成草稿。');
  } catch (e) {
    if (e.code === 'SALE_UNIT_MISMATCH') {
      task.intent.intake = true;
      task.intent.lines = lines.map((line, i) => i === e.index ? { productKeyword: line.productKeyword, qty: null } : line);
      store.save(task);
      return { task, reply: e.message };
    }
    task.error = e.message; task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: e.message };
  }
  task.transition('DRY_RUNNING');
  preview.warehouseName = await warehouseName(client, warehouseId);
  preview.payload = salePayload(preview);
  task.setPreview(preview);
  if (task.saleDraftReselected) task.accessWarehouseIds = [Number(warehouseId)];
  task.transition('AWAITING_CONFIRM');
  store.save(task);
  const shortageLines = preview.lines.filter(l => l.shortage > 0);
  const reply = `销售单草稿已试算（待确认）：客户 ${preview.customer.name}，合计 ¥${(preview.totalCents / 100).toFixed(2)}。` +
    preview.lines.map(l => `${l.productName} ×${l.qty}，单价 ¥${l.unitPrice ?? (l.unitPriceCents / 100).toFixed(2)}（${l.priceSource.level} 档价）`).join('；') + '。' +
    (shortageLines.length ? `注意缺口：${shortageLines.map(l => `${l.productName} 需 ${l.qty}、可用 ${l.available}、缺 ${l.shortage}`).join('；')}。建草稿不受缺口影响，占库时会被拦。` : '库存可用量充足。') +
    `确认请在界面点击确认，预览 10 分钟内有效。`;
  return { task, reply, preview };
}

// ---------- 确认执行：按任务图分发 ----------
export function changeSaleDraft(store, taskId, actor, { action, revision }) {
  return store.exclusive(taskId, () => {
    const task = assertTaskAccess(store.get(taskId), actor);
    const cancel = action === 'cancel';
    if (task.graph !== 'B-sale-draft') throw Object.assign(new Error('这项操作仅适用于小满销售草稿'), { status: 409 });
    if (cancel && task.state === 'CANCELLED') return { task, reply: task.reply };
    if (!cancel && !hasPerm(actor, 'sale.order.create')) throw Object.assign(new Error('当前没有销售单新建权限，无法重选商品'), { status: 403 });
    if (task.state !== 'AWAITING_CONFIRM' && !(cancel && task.state === 'DISAMBIGUATING')) {
      throw Object.assign(new Error('这张草稿当前不能修改，请查看原任务状态'), { status: 409 });
    }
    if (revision !== Number(task.revision)) throw previewConflict();
    if (!cancel && task.intent?.stockCondition) throw previewConflict('这张草稿绑定原查库商品。请用新商品重新查库后再试算。');

    const { customer, warehouseId } = task.preview || {};
    const customerKeyword = task.intent?.customerKeyword || customer?.name;
    if (!cancel && (!customerKeyword || !task.preview || task.previewExpired())) {
      throw Object.assign(new Error('原预览已失效，请重新发起试算'), { status: 409 });
    }
    if (Number.isSafeInteger(Number(warehouseId)) && Number(warehouseId) > 0) task.accessWarehouseIds = [Number(warehouseId)];
    const customerId = customer?.id ?? task.selections?.customer;
    clearChoice(task);
    task.preview = null;
    task.revision = revision + 1;
    if (cancel) {
      task.transition('CANCELLED');
      return rememberOutput(store, { task, reply: '销售草稿已作废。' });
    }

    task.saleDraftReselected = true;
    task.intent = { graph: 'B-sale-draft', intake: true, customerKeyword, lines: [] };
    task.selections = customerId == null ? {} : { customer: customerId };
    task.transition('DISAMBIGUATING');
    return rememberOutput(store, { task, reply: `已保留客户「${customer?.name || customerKeyword}」。请重新输入商品和数量，再试算确认。` });
  });
}

function previewConflict(message = '预览已更新，请核对最新版本后再确认') {
  return Object.assign(new Error(message), { status: 409, code: 'PREVIEW_REVISION_CONFLICT' });
}

export async function confirmTask(store, client, taskId, actor, options = {}) {
  return store.exclusive(taskId, async () => rememberOutput(store, await confirmTaskUnlocked(store, client, taskId, actor, options)));
}

async function confirmTaskUnlocked(store, client, taskId, actor, options) {
  const task = store.get(taskId);
  if (!task) throw new Error('任务不存在');
  if (!ownsTask(task, actor)) throw Object.assign(new Error('只能确认本人发起的任务'), { status: 403 });
  assertTaskAccess(task, actor, store);
  if ([SEQUENCE_GRAPH, SALE_HANDOFF_GRAPH].includes(task.graph) || task.state === 'PAUSED') {
    throw Object.assign(new Error('这项任务请使用续办入口，当前没有可确认的业务写入。'), { status: 409 });
  }
  if (task.state === 'DONE') {
    if (task.graph === 'B2-reserve' || task.graph === 'D-settle') return resumeFromContext(store, client, actor, task);
    if (task.graph === 'D-receipt' && task.result?.stage2TaskId) {
      const next = store.get(task.result.stage2TaskId);
      if (next?.state === 'AWAITING_CONFIRM' && !next.previewExpired()) { assertTaskAccess(next, actor); return { task: next, preview: next.preview, reply: '收款已经登记，已恢复原核销预览。请核对分配后确认，不要重复登记收款。' }; }
      if (next?.state === 'DONE') return resumeFromContext(store, client, actor, task);
      return { task, result: task.result, reply: '收款已登记，原核销预览已失效或正在核对，请到收付款页处理原收款单，不要重新登记。' };
    }
    return { task, reply: '此任务已经完成，已返回原结果，无需重复确认。', result: task.result };
  }
  if (RECOVERY_STATES.has(task.state)) return recoverTask(store, client, task, actor);
  if (task.state === 'CANCELLED') throw previewConflict('草稿已作废，请查看原任务。');
  if (task.state === 'EXPIRED' && task.graph === 'B2-reserve') throw previewConflict('原占库预览已失效，请重新核对原单后再确认。');
  if (task.state === 'EXPIRED' && task.preview?._explicit) throw previewConflict('核销预览已失效，请核对原收款单后重算。');
  if (task.state === 'EXPIRED' && [REFUND_EXECUTE, BACKFILL_ACTION].includes(task.graph)) throw previewConflict('退款预览已失效，请重查原退款单。');
  if (task.reviewRequired) throw previewConflict('请先续办并核对原预览，再确认。');
  if (((task.saleDraftReselected || task.salePreviewRevised || task.requirePreviewRevision || task.handoffOrderNo) && options.revision == null)
    || (options.revision != null && (!Number.isSafeInteger(Number(options.revision)) || Number(options.revision) !== Number(task.revision)))) throw previewConflict();
  if (task.saleDraftReselected && task.state !== 'AWAITING_CONFIRM') throw previewConflict('请补齐商品和数量，再确认新预览。');
  if (task.state !== 'AWAITING_CONFIRM') throw new Error(`任务不在待确认状态（当前 ${task.state}）`);
  if (task.previewExpired()) {
    task.transition('EXPIRED'); store.save(task);
    return { task, reply: '原预览已过期，这次未提交。请先核对原任务，再按当前状态继续。' };
  }
  switch (task.graph) {
    case 'B-sale-draft': return confirmSaleDraft(store, client, task, actor);
    case 'C-purchase-draft': return confirmPurchaseDraft(store, client, task, actor);
    case 'B2-reserve': return confirmReserve(store, client, task, actor);
    case 'D-receipt': return confirmReceiptDraft(store, client, task, actor);
    case 'D-settle': return confirmSettle(store, client, task, actor);
    case REFUND_EXECUTE: return confirmRefund(store, client, task, actor);
    case BACKFILL_ACTION: return confirmBackfill(store, client, task);
    default: throw new Error('这项内容没有可确认的业务操作');
  }
}

function sameRecoveredSale(detail, preview) {
  if (Number(detail.customerId) !== Number(preview?.customer?.id) || Number(detail.warehouseId) !== Number(preview?.warehouseId) ||
      !Array.isArray(detail.items) || detail.items.length !== preview?.lines?.length || !detail.orderNo) return false;
  return preview.lines.every(line => detail.items.some(item => Number(item.productId) === Number(line.productId) &&
    Number(item.warehouseId ?? detail.warehouseId) === Number(preview.warehouseId) && Number(item.quantity) === Number(line.qty)));
}

function sameRecoveredReceipt(detail, preview) {
  return Number(detail.type) === 2 && Number(detail.partyId) === Number(preview?.customer?.id) &&
    Number(detail.accountId) === Number(preview?.account?.id) && Boolean(detail.receiptNo);
}

// 重启后只恢复原意图的回执，不重发写请求，不生成新请求键。
async function recoverTask(store, client, task, actor) {
  if (task.state === 'VERIFYING') task.transition('RESULT_UNKNOWN');
  if (task.state === 'ESCALATED') task.transition('RESULT_UNKNOWN');
  if (task.state === 'CONFIRMED') task.transition('EXECUTING');
  if (task.state === 'EXECUTING') task.transition('RESULT_UNKNOWN');
  store.save(task);
  const p = task.preview;
  if (task.graph === BACKFILL_ACTION) return recoverBackfill(client, task);
  if (task.graph === 'C-purchase-draft') return recoverPurchaseDraft(store, client, task);
  const reserve = task.graph === 'B2-reserve';
  const currentSale = reserve ? await currentReserveOrder(client, p, actor).catch(() => null) : null;
  if (reserve && !currentSale) return { task, reply: '原销售单的身份或当前仓库范围未能核对。请核对原单后查询结果，勿重复提交。' };
  let currentReceipt;
  if (task.graph === 'D-settle') {
    currentReceipt = await receiptTool().detail(client, { receiptId: p.receiptId }).catch(() => null);
    if (p._explicit && (Number(currentReceipt?.id) !== p.receiptId || Number(currentReceipt.type) !== 2
        || !linkedNo(currentReceipt.receiptNo, p.receiptNo) || Number(currentReceipt.partyId) !== p._expectedAllocation.partyId)) {
      return { task, reply: '原收款单的身份或当前权限尚未核对，请查询原收款单，勿重复核销。' };
    }
  }
  if (task.graph === REFUND_EXECUTE) {
    const current = await refundDetail(client, {
      id: p.refundId, refundNo: p.refundNo, saleOrderNo: p.saleOrderNo, saleOrderId: p._expectedRefund.saleOrderId,
    }).catch(() => null);
    if (Number(current?.paymentRecordId) !== p._expectedRefund.paymentRecordId) {
      return { task, reply: '原退款单或关联应收尚未核对，请财务查询原单，勿重复退款。' };
    }
  }
  const action = { 'B-sale-draft': 'sale.create', 'B2-reserve': reserveReceiptAction(p), 'D-receipt': 'payment.receipt.create',
    'D-settle': `payment.receipt.settle.${p?.receiptId}`, [REFUND_EXECUTE]: `refund.execute.${p?.refundId}` }[task.graph];
  if (!action) return { task, reply: '此任务执行结果尚未核实，请按原任务及请求键到原页面核对，不要重新发起建单。' };
  let receipt;
  try { receipt = await client.requestStatus(task.requestKey, action); }
  catch { return { task, reply: '原请求回执暂时无法读取，请稍后查询原任务，不要重新提交。' }; }
  const id = Number(receipt?.resourceId ?? receipt?.data?.resourceId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const current = currentSale && completedReserveProgress(currentSale);
    return { task, reply: (current ? current + '\n' : '') + '暂未确认本人原请求结果，请稍后查询原任务，不要重新提交。' };
  }
  if (task.graph === REFUND_EXECUTE) {
    if (id !== p.refundId || receipt.resourceType !== 'refund_order' || !refundReceiptMatches(receipt.data, p)) {
      return { task, reply: '原退款回执的单据或金额未核实，请财务核对原退款单和出账，不要重复提交。' };
    }
    return finishRefund(task, p, true);
  }
  if (task.graph === 'B-sale-draft' || task.graph === 'D-receipt') {
    const sale = task.graph === 'B-sale-draft';
    if (receipt.resourceType && receipt.resourceType !== (sale ? 'sale_order' : 'payment_receipt')) {
      return { task, reply: '回执的单据类型与原请求不符，请人工核对。' };
    }
    let detail;
    try { detail = await (sale ? client.get(`/api/sale/${id}`) : receiptTool().detail(client, { receiptId: id })); }
    catch { detail = null; }
    if (!detail) return { task, reply: '已读到原请求回执，单据详情暂时无法核对。请稍后继续查询原任务，勿重复提交。' };
    const amount = sale ? detail.totalAmount : detail.amount;
    const cents = typeof amount === 'number' || typeof amount === 'string' ? Number(amount) : NaN;
    if (!Number.isFinite(cents) || toCents(cents) !== (sale ? p?.totalCents : p?.amountCents)
        || Number(detail.id) !== id || !(sale ? sameRecoveredSale(detail, p) : sameRecoveredReceipt(detail, p))) {
      return { task, reply: '回执对应单据的身份或金额与原预览不符，请人工核对。' };
    }
    if (!sale) return finishReceiptStage(store, client, task, detail, true);
    task.result = { orderId: id, orderNo: detail.orderNo, orderStatus: detail.statusName ?? detail.status, recoveredViaReceipt: true };
  } else if (task.graph === 'D-settle') {
    const hasOriginalResult = receipt.resourceType === 'payment_receipt'
      && verifiedSettlementReceipt(receipt, p, currentReceipt);
    const verified = hasOriginalResult || !p._explicit && receipt.data == null && await verifySettled(client, task);
    if (Number(id) !== Number(p.receiptId) || !verified) {
      const entryId = Number(receipt?.data?.applied?.[0]?.entryId);
      return { task, reply: Number(id) === Number(p.receiptId) && p._reversalSource && Number.isSafeInteger(entryId) && entryId > 0
        ? `请财务核对核销分录 #${entryId} 的原成功回执、金额和批次归属。`
        : '原核销尚未核实，请到收付款页核对该次原请求回执。' };
    }
    task.result = { receiptId: id, receiptNo: p.receiptNo, ...statementResult(p), allocatedCents: p.totalCents, recoveredViaReceipt: true };
    captureSettlementEntries(task, receipt.data);
    if (hasOriginalResult) {
      task.transition('VERIFYING'); task.transition('DONE');
      return reviewCompletedSettlement(store, client, task, actor, currentReceipt);
    }
  } else {
    if (!rememberReserveEvent(task, receipt, currentSale)) {
      const movementId = Number(receipt?.data?.reservationEventId);
      return { task, reply: Number.isSafeInteger(movementId) && movementId > 0
        ? `请核对占库事件 #${movementId} 的原成功回执和批次归属。`
        : '原占库回执的单据尚未核实，请到销售页核对，勿重复提交。' };
    }
    task.result = { orderId: id, orderNo: p.orderNo, recoveredViaReceipt: true, ...(p._releaseEventId == null ? {} : { reserved: p.totalRemain }) };
    task.transition('VERIFYING'); task.transition('DONE');
    return renderReserveResult(task, currentSale, actor, true);
  }
  task.transition('VERIFYING'); task.transition('DONE'); store.save(task);
  return { task, result: task.result, reply: task.graph === 'D-settle' ? settleDoneReply(p, true)
    : '已按原请求回执恢复并回查核实，没有重复提交。' };
}

async function salePreviewFacts(client, task, actor) {
  const original = task.preview;
  return buildSalePreview(client, {
    customerHit: { id: original.customer.id },
    lines: original.lines.map((line, i) => ({ productKeyword: line.productName, productHit: { id: line.productId, title: line.productName },
      qty: line.qty, requestedUnit: task.intent?.lines?.[i]?.requestedUnit ?? line.unit })),
    warehouseId: original.warehouseId,
  }, actor);
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
    fresh = await salePreviewFacts(client, task, actor);
  } catch (error) {
    if (error.kind === 'unknown' || error.status >= 500) return { task, reply: '确认前暂时无法完成复核，尚未建单。请稍后重试这张预览。' };
    task.transition('EXPIRED'); store.save(task);
    return { task, reply: `原预览已失效，尚未建单：${error.message}。请按当前商品规则重新试算。` };
  }
  if (task.intent?.stockCondition && !matchesStockCondition(fresh, task.intent.stockCondition)) {
    task.transition('EXPIRED'); store.save(task);
    return { task, reply: '当前商品单位或可用库存不再满足原条件，尚未建单。请重新查库试算。' };
  }
  const diffs = diffPreview(task.preview, fresh);
  if (diffs.length) {
    task.transition('EXPIRED'); store.save(task);
    return { task, reply: '确认时发现数据已变化，已拦截执行。变化：' + diffs.map(d => d.field === 'unitPriceCents' ? '商品单价已变化' : `${({ available: '可用量', line: '商品明细' })[d.field] || '业务数据'} ${d.before} → ${d.after}`).join('；') + '。请重新发起生成新预览。', diffs };
  }
  task.transition('CONFIRMED');
  task.transition('EXECUTING');
  store.save(task);
  try {
    const { created, verified } = await run('sale.create_draft', client, { payload: task.preview.payload, requestKey: task.requestKey }, actor);
    task.recordStep('create', 'sale.create_draft', created);
    task.transition('VERIFYING');
    const orderId = created?.id;
    const verifiedTotalCents = verified ? toCents(verified.totalAmount ?? verified.total_amount ?? 0) : null;
    if (!orderId || !verified || verifiedTotalCents !== task.preview.totalCents) {
      task.transition('ESCALATED'); store.save(task);
      return { task, reply: `建单返回异常或核验不平（预览合计 ${task.preview.totalCents} 分，回查 ${verifiedTotalCents} 分），已转人工。` };
    }
    task.result = { orderId, orderNo: verified?.orderNo || created?.orderNo || null, totalCents: task.preview.totalCents };
    task.transition('DONE'); store.save(task);
    return { task, reply: `已建销售单草稿 ${task.result.orderNo || orderId}，合计 ¥${(task.preview.totalCents / 100).toFixed(2)}，回查状态与金额对平。占库请单独发起并再次确认。` };
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save(task);
      return recoverTask(store, client, task, actor);
    }
    task.error = e.message;
    task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: `建单被系统拒绝：${e.message}（原样转述，未自动改数重试）` };
  }
}

// ---------- 图 C：补货建议（L1）与采购草稿（L2） ----------
async function replenishmentItems(client, warehouse, actor) {
  const data = await run('inventory.replenishment', client, { warehouseId: warehouse.id }, actor);
  const raw = data?.replenishment;
  const list = raw?.list ?? raw?.items ?? (Array.isArray(raw) ? raw : null);
  if (!Array.isArray(list)) throw new Error('补货建议未完整读到，请稍后重试');
  const items = list.filter(i => Number(i.suggestedQty ?? i.suggestQty ?? 0) > 0);
  if (items.some(item => item.warehouseId !== warehouse.id)) {
    throw new Error(`「${warehouse.name}」的补货建议缺少正确的仓库信息，请到补货建议页核对。`);
  }
  return items.map(item => ({ ...item, warehouseName: warehouse.name }));
}

// 发起人仓库范围内的仓库清单（多仓逐仓处理，不默认挑第一个——挑错仓会答错数）
async function inScopeWarehouses(client, actor) {
  const { list } = await collectList(client, '/api/warehouses');
  const filtered = Array.isArray(actor?.warehouseIds) ? list.filter(w => actor.warehouseIds.includes(Number(w.id))) : list;
  if (!filtered.length) throw new Error('你的账号没有可访问的仓库（仓库范围为空），无法继续');
  return filtered.map(w => ({ id: Number(w.id), name: w.name }));
}

async function graphReplenishment(store, client, actor, text) {
  const task = store.create({ graph: 'C-replenishment', userText: text, actor });
  task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, ['report.view', 'warehouse.view']);
  if (denied) { store.save(task); return denied; }
  task.transition('DRY_RUNNING');
  try {
    const warehouses = await inScopeWarehouses(client, actor);
    const items = [];
    for (const w of warehouses) items.push(...(await replenishmentItems(client, w, actor)));
    task.result = { items };
    task.transition('DONE'); store.save(task);
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
    task.error = e.message; task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: `补货建议取数失败：${e.message}` };
  }
}

async function buildPurchasePreview(client, actor) {
  const warehouses = await inScopeWarehouses(client, actor);
  const items = [];
  for (const w of warehouses) items.push(...(await replenishmentItems(client, w, actor)));
  if (!items.length) return { empty: true, drafts: [], grandTotalCents: 0 };
  const missingSupplier = items.find(item => !Number.isSafeInteger(item.supplierId) || item.supplierId <= 0);
  if (missingSupplier) {
    throw new Error(`「${missingSupplier.warehouseName}」的「${missingSupplier.productName}」缺少有效供应商，请先维护供应商再试算。`);
  }
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
    const wid = i.warehouseId;
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

const purchaseDraftKey = (task, draft) => `${task.requestKey}-S${draft.supplierId}W${draft.warehouseId}`;

function verifyPurchaseDraft(draft, id, detail) {
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || orderId !== Number(detail?.id)
      || draft.supplierId !== Number(detail.supplierId) || draft.warehouseId !== Number(detail.warehouseId)
      || typeof detail.orderNo !== 'string' || !detail.orderNo.trim()) return null;
  try {
    if (toCents(detail.totalAmount) !== draft.totalCents) return null;
  } catch {
    return null;
  }
  return { supplierName: draft.supplierName, orderId, orderNo: detail.orderNo, totalCents: draft.totalCents };
}

async function recoverPurchaseDraft(store, client, task) {
  const drafts = task.preview?.drafts;
  if (!drafts?.length) return { task, reply: '无法读取原采购预览，请到采购页核对原任务。' };
  const orders = [];
  for (const draft of drafts) {
    try {
      const receipt = await client.requestStatus(purchaseDraftKey(task, draft), 'purchase.create');
      if (receipt?.resourceType !== 'purchase_order' || !Number.isSafeInteger(receipt.resourceId) || receipt.resourceId <= 0) continue;
      const detail = await client.get(`/api/purchase/${receipt.resourceId}`);
      const order = verifyPurchaseDraft(draft, receipt.resourceId, detail);
      if (order) orders.push(order);
    } catch {
      // 一张回执或详情暂不可读时，继续核对其余原单。
    }
  }
  const unverifiedCount = drafts.length - orders.length;
  task.result = { orders, unverifiedCount, recoveredViaReceipt: true };
  if (unverifiedCount === 0) {
    task.transition('VERIFYING');
    task.transition('DONE');
  }
  store.save(task);
  const verified = orders.map(order => order.orderNo).join('、') || '暂无';
  const reply = unverifiedCount
    ? `已核实采购单 ${orders.length}/${drafts.length} 张（${verified}）。其余 ${unverifiedCount} 张待核对，请继续查询原任务或到采购页核对，避免重复建单。`
    : `已按原回执核实 ${orders.length} 张采购单（${verified}）。`;
  return { task, reply, result: task.result };
}

async function graphPurchaseDraft(store, client, actor, text) {
  const task = store.create({ graph: 'C-purchase-draft', userText: text, actor });
  task.transition('DISAMBIGUATING');
  const denied = denyIfMissing(task, actor, ['purchase.order.create', 'purchase.order.view', 'report.view', 'product.view', 'warehouse.view']);
  if (denied) { store.save(task); return denied; }
  task.transition('DRY_RUNNING');
  let preview;
  try { preview = await buildPurchasePreview(client, actor); }
  catch (e) { task.error = e.message; task.transition('FAILED_FINAL'); store.save(task); return { task, reply: e.message }; }
  if (preview.empty) {
    task.result = { empty: true }; task.transition('DONE'); store.save(task);
    return { task, reply: '当前没有补货建议（建议量全为 0），没有可建的采购草稿。' };
  }
  task.setPreview(preview);
  task.transition('AWAITING_CONFIRM'); store.save(task);
  const reply = `采购草稿已试算（待确认）：将按供应商和仓库建 ${preview.drafts.length} 张草稿，合计 ¥${(preview.grandTotalCents / 100).toFixed(2)}。` +
    preview.drafts.map(d => `【${d.supplierName} · ${d.warehouseName}】${d.lines.map(l => `${l.productName} ×${l.qty} @成本价 ¥${l.unitPrice ?? (l.unitPriceCents / 100).toFixed(2)}`).join('；')}，小计 ¥${(d.totalCents / 100).toFixed(2)}`).join('。') +
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
  let fresh;
  try { fresh = await buildPurchasePreview(client, actor); }
  catch (e) { return { task, reply: `未能复核采购预览，本次未提交采购单。${e.message}`, preview: task.preview }; }
  if (purchaseSignature(fresh) !== purchaseSignature(task.preview)) {
    task.transition('EXPIRED'); store.save(task);
    return { task, reply: '确认时发现补货建议或成本价已变化（建议量/供应商/价格与预览不一致），已拦截执行。请重新发起生成新预览。' };
  }
  task.transition('CONFIRMED'); task.transition('EXECUTING'); store.save(task);
  const createdOrders = [];
  try {
    for (const draft of task.preview.drafts) {
      const key = purchaseDraftKey(task, draft);
      const { created, verified } = await run('purchase.create_draft', client, { payload: draft.payload, requestKey: key }, actor);
      const order = verifyPurchaseDraft(draft, created?.id, verified);
      if (!order) {
        task.transition('ESCALATED'); store.save(task);
        return { task, reply: `供应商「${draft.supplierName}」的原采购单未能核实，请核对仓库、供应商和金额。已核实：${createdOrders.map(o => o.orderNo).join('、') || '暂无'}。` };
      }
      createdOrders.push(order);
      task.recordStep('create', 'purchase.create_draft', order);
      task.result = { orders: createdOrders }; store.save(task);
    }
    task.result = { orders: createdOrders };
    task.transition('VERIFYING'); task.transition('DONE'); store.save(task);
    return { task, reply: `已建采购草稿 ${createdOrders.length} 张：${createdOrders.map(o => `${o.orderNo}（${o.supplierName}，¥${(o.totalCents / 100).toFixed(2)}）`).join('；')}，逐张回查金额对平。草稿还需在采购页确认/审批后才会生效。` };
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save(task);
      return recoverTask(store, client, task, actor);
    }
    task.error = e.message; task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: `建采购草稿被系统拒绝：${e.message}（原样转述）。已建成的草稿：${createdOrders.map(o => o.orderNo).join('、') || '无'}，未建成的没有重试。` };
  }
}

// ---------- 图 B2：销售单占库 ----------
async function findSaleOrderByNo(client, orderNo) {
  const { list } = await collectList(client, '/api/sale/', { keyword: orderNo });
  const matches = list.filter(order => order.orderNo?.toUpperCase() === orderNo.toUpperCase());
  return matches.length === 1 ? matches[0] : null;
}

async function buildReservePreview(client, actor, order) {
  const rp = await run('sale.reserve_preview', client, { saleOrderId: order.id }, actor);
  if (rp.orderId != null && Number(rp.orderId) !== Number(order.id)) throw new Error('占库预览与原销售单不符');
  const remainingAvailability = new Map();
  const lines = (rp.items || []).map(it => {
    const warehouseId = Number(it.currentWarehouseId ?? rp.warehouseId);
    const warehouseName = it.currentWarehouseName || rp.warehouseName;
    const wh = (it.warehouses || []).find(w => Number(w.warehouseId) === warehouseId);
    const dimension = `${it.productId}:${warehouseId}`;
    const remain = Number(it.remainToReserve || 0);
    const available = remainingAvailability.get(dimension) ?? Math.max(0, Number(wh?.available ?? 0));
    remainingAvailability.set(dimension, Math.max(0, Math.round(available * 100) - Math.round(remain * 100)) / 100);
    return {
      itemId: it.itemId, warehouseId, warehouseName,
      productId: it.productId, productName: it.productName, qty: remain, unit: it.unit,
      reservedQty: Number(it.reservedQty || 0), remainToReserve: remain,
      available, pickable: Number(wh?.pickableQuantity ?? 0),
      shortage: Math.max(0, Math.round(remain * 100) - Math.round(available * 100)) / 100,
      unitPriceCents: null, priceSource: { level: '占库', source: 'reserve_preview' },
    };
  });
  return {
    _reserveFingerprint: rp.reserveFingerprint, _commercialModel: rp.commercialModel, _commercialRevision: rp.commercialRevision,
    _reservationEventId: rp.reservationEventId,
    orderId: order.id, orderNo: order.orderNo, warehouseId: rp.warehouseId, warehouseName: rp.warehouseName,
    customer: { name: order.customerName }, lines,
    totalCents: 0, title: `占库 · ${order.orderNo}`, confirmLabel: '确认占库',
    credit: rp.credit ?? null,
    totalRemain: lines.reduce((s, l) => s + l.remainToReserve, 0),
  };
}

function boundReservePreview(preview, batch, requested, previous) {
  const remaining = batch.lines.filter(line => line.remaining > 0);
  if (!remaining.length || batch.issue) return null;
  const targetLine = requested?.line == null ? remaining[0] : batch.lines[requested.line - 1];
  if (requested && (!targetLine?.remaining || requested.hasAmount && (requested.line == null && remaining.length !== 1
      || !requested.qty || requested.qty > targetLine.remaining || requested.unit && requested.unit !== targetLine.unit))) return null;
  const source = previous?.map(line => ({ itemId: line.itemId, warehouseId: line.warehouseId, unit: line.unit, remaining: line.qty }))
    ?? (requested ? [{ ...targetLine, remaining: requested.qty ?? targetLine.remaining }] : remaining);
  const quantities = new Map(source.map(line => [Number(line.itemId), line]));
  const lines = preview.lines.filter(line => quantities.has(Number(line.itemId))).map(line => {
    const target = quantities.get(Number(line.itemId));
    const batchLine = remaining.find(row => Number(row.itemId) === Number(line.itemId));
    if (!batchLine || target.warehouseId !== line.warehouseId || target.unit !== line.unit
        || target.remaining > batchLine.remaining || target.remaining > line.remainToReserve) return null;
    return { ...line, requiredQty: Math.round((line.reservedQty + line.remainToReserve) * 100) / 100,
      qty: target.remaining, remainToReserve: target.remaining,
      shortage: Math.max(0, Math.round(target.remaining * 100) - Math.round(line.available * 100)) / 100 };
  });
  if (lines.length !== quantities.size || lines.some(line => !line)) return null;
  return { ...preview, _releaseEventId: batch.id, _releaseOrdinal: batch.ordinal, _releaseProofVersion: batch.proofVersion, lines, totalRemain: lines.reduce((sum, line) => sum + Math.round(line.qty * 100), 0) / 100 };
}

async function graphReserve(store, client, actor, text, expectedOrderId, releaseId, requested, anotherSupplement) {
  const standard = text.match(/(?<![a-z\d_-])SL[-_]?\d{6,28}(?![a-z\d_-])/gi) ?? [];
  const custom = Array.from(text.matchAll(/销售单号\s*[：:]?\s*[「『“"]?([a-z][a-z\d_-]{0,18}?\d{6,28})(?![a-z\d_-])/gi), match => match[1]);
  const [orderNo, other] = new Set([...standard, ...custom].map(no => no.toUpperCase()));
  if (!orderNo || other) return { task: null, reply: '占库请给出一张销售单的完整单号，例如「给 SL20261026005 占库」。' };
  const missing = ['sale.order.view', 'sale.order.reserve'].find(permission => !hasPerm(actor, permission));
  if (missing) {
    const task = store.create({ graph: 'B2-reserve', userText: text, actor });
    task.transition('DISAMBIGUATING');
    return denyIfMissing(task, actor, [missing]);
  }
  return store.exclusive(`reserve:${actor.id ?? actor.username}:${orderNo}`, async () => {
    const active = reservedHandoffTasks(store, actor, undefined, orderNo, releaseId != null, releaseId);
    if (active.length > 1) return reserveHistoryQuestion();
    const [original] = active;
    if (original && expectedOrderId != null && Number(original.preview.orderId) !== expectedOrderId) {
      return { task: null, detachTask: true, reply: '原销售单的身份已变化。请按原记录核对单号。' };
    }
    if (original && !RECOVERY_STATES.has(original.state) && releaseId != null && original.reapplyReleaseId !== releaseId) {
      return { task: null, reply: '这张原单已有另一批待核对的占库记录，请先打开该记录核对。' };
    }
    if (original) return resumeTask(store, client, original.id, actor);
    const order = await findSaleOrderByNo(client, orderNo).catch(() => null);
    if (!Number.isSafeInteger(Number(order?.id)) || Number(order.id) <= 0) {
      const task = store.create({ graph: 'B2-reserve', userText: text, actor });
      task.transition('DISAMBIGUATING'); task.transition('FAILED_FINAL');
      return { task, reply: `未能核实销售单 ${orderNo}。请核对完整原单号。` };
    }
    if (expectedOrderId != null && Number(order.id) !== expectedOrderId) {
      return { task: null, detachTask: true, reply: '销售单关联已变化，请核对原单后重新交接。' };
    }
    if (expectedOrderId == null) {
      const detail = await currentReserveOrder(client, order, actor).catch(() => null);
      if (detail && reservationRelease(detail)?.open.length) return graphSaleHandoff(store, client, actor, text, { action: 'read', no: orderNo });
    }
    if (releaseId != null && !anotherSupplement) {
      const already = [...matchingReserveTasks(store, actor, Number(order.id), orderNo)].find(task =>
        task.state === 'DONE' && task.preview?._releaseEventId === releaseId
        && task.releaseRequestedQty === requested?.qty && task.releaseRequestedLine === requested?.line && task.result?.reserved > 0);
      if (already) {
        const checked = await resumeTask(store, client, already.id, actor);
        return { ...checked, reply: checked.reply + '\n相同补占已办。确需再补一笔时，请明确本次新数量。' };
      }
    }
    return prepareReserve(store, client, actor, text, order, expectedOrderId != null, releaseId, requested);
  });
}

async function prepareReserve(store, client, actor, text, order, fromHandoff, releaseId, requested) {
  const orderNo = order.orderNo.toUpperCase();
  const task = store.create({ graph: 'B2-reserve', userText: text, actor });
  task.transition('DRY_RUNNING');
  let preview;
  try { preview = await buildReservePreview(client, actor, order); }
  catch (e) {
    // 已全部占库的单再调 reserve-preview 会被系统拒（状态不在可占范围）——用单据明细核对区分
    const detail = await currentReserveOrder(client, order, actor).catch(() => null);
    if (detail && completedReserveProgress(detail)) return finishCurrentReserve(task, detail);
    task.error = e.message; task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: `试占库失败：${e.message}` };
  }
  task.accessWarehouseIds = reserveWarehouseIds(preview.warehouseId, preview.lines);
  let qualifier = '';
  if (releaseId != null) {
    const detail = await currentReserveOrder(client, order, actor).catch(() => null);
    if (Array.isArray(detail?.releaseBatches)) {
      const batch = detail.releaseBatches.find(row => row.id === releaseId);
      const bounded = batch && boundReservePreview(preview, batch, requested);
      if (!bounded) {
        task.transition('FAILED_FINAL');
        return { task, reply: (batch ? releaseBatchText(batch) + '\n' : '') + '请核对本批仍可补占的原行、仓库和数量。' };
      }
      task.accessWarehouseIds = reserveWarehouseIds(bounded.warehouseId, bounded.lines);
      preview = bounded;
      qualifier = `按第 ${batch.ordinal} 次释放补占。\n`;
    } else if (preview._reservationEventId !== releaseId || requested) {
      task.transition('FAILED_FINAL');
      return { task, reply: '该次释放之后已有新操作，请核对原单最新的释放和待占量。' };
    }
  }
  if (preview.totalRemain === 0) {
    return finishCurrentReserve(task, { ...order, warehouseId: preview.warehouseId, items: preview.lines, status: 2, hasUnreservedItems: false });
  }
  const shortage = preview.lines.filter(l => l.shortage > 0);
  if (shortage.length) {
    task.result = { orderNo, shortage }; task.transition('DONE'); store.save(task);
    return { task, reply: `销售单 ${orderNo} 现在占不了库：${shortage.map(l => `${l.productName}（${l.warehouseName}）还需占 ${l.remainToReserve}、可分配 ${l.available}、缺 ${l.shortage}`).join('；')}。我没有部分占库，也没有自动改量；补货或调仓后再来。`, result: task.result };
  }
  task.setPreview(preview);
  task.reviewRequired = false;
  if (fromHandoff) {
    task.handoffOrderNo = orderNo;
    task.requirePreviewRevision = true;
  }
  if (releaseId != null) {
    task.reapplyReleaseId = releaseId;
    task.releaseRequestedQty = requested?.qty;
    task.releaseRequestedLine = requested?.line;
  }
  task.transition('AWAITING_CONFIRM'); store.save(task);
  const reply = qualifier + `占库已试算（待确认）：销售单 ${orderNo}（${preview.customer.name}，${preview.warehouseName}），待占 ${preview.totalRemain} 件：` +
    preview.lines.map(l => `${l.productName} ×${l.remainToReserve}（${l.warehouseName}可分配 ${l.available}）`).join('；') +
    `。确认请在界面点击确认，预览 10 分钟内有效。`;
  return { task, reply, preview };
}

function* matchingReserveTasks(store, actor, orderId, orderNo) {
  for (const page of store.pagesForActor(actor)) for (const task of page) {
    if (task.graph === 'B2-reserve' && task.preview?.orderNo?.toUpperCase() === orderNo
        && (orderId == null || Number(task.preview.orderId) === orderId)) yield task;
  }
}

function reservedHandoffTasks(store, actor, orderId, orderNo, newBatchRequest = false, batchId) {
  const recovery = [];
  const awaiting = [];
  const expired = [];
  for (const task of matchingReserveTasks(store, actor, orderId, orderNo)) {
    if (task.state === 'EXPIRED' && !(newBatchRequest && task.preview?._releaseEventId != null) && expired.length < 2) expired.push(task);
    if (task.state === 'AWAITING_CONFIRM' && awaiting.length < 2) awaiting.push(task);
    if (RECOVERY_STATES.has(task.state) && (batchId == null || task.preview?._releaseEventId == null || task.preview._releaseEventId === batchId)) {
      recovery.push(task);
    }
    if (recovery.length === 2) return recovery;
  }
  return recovery.length ? recovery : awaiting.length ? awaiting : expired;
}

const reserveHistoryQuestion = () => ({ task: null, detachTask: true, reply: '该销售单有多条原占库记录，请从最近记录打开要核对的那一条。' });

async function expireHandoffPreviews(store, actor, orderId, no) {
  const waiting = [...matchingReserveTasks(store, actor, orderId, no)].filter(task => task.state === 'AWAITING_CONFIRM');
  let invalidated = false;
  for (const task of waiting) {
    try {
      await store.exclusive(task.id, async () => {
        if (task.state !== 'AWAITING_CONFIRM') return;
        task.handoffOrderNo = no;
        rememberOutput(store, stopPreviewReview(task, '当前卡点仍待处理或原单阶段已变化，原占库预览已失效。', true));
        invalidated = true;
      });
    } catch (error) {
      // 并行中的确认或恢复持有原任务锁，并自行核对当前卡点。
      if (error.code !== 'TASK_BUSY') throw error;
    }
  }
  return invalidated;
}

async function graphSaleHandoff(store, client, actor, text, request, context) {
  if (!Object.values(HANDOFF_PERMISSIONS).some(permission => hasPerm(actor, permission))) {
    return { task: null, detachTask: true, reply: '当前账号没有可查询这张单据的交接来源权限。请由有权限的岗位在原页面核对。' };
  }
  if (context) assertTaskAccess(context, actor, store);
  const no = request.multiple ? undefined : request.no ?? context?.intent?.orderNo;
  if (request.action === 'read' && !request.correction && context?.state === 'DISAMBIGUATING' && context.intent?.checkOnly && no) {
    request = { ...request, action: 'recover', checkOnly: true, otherOperator: context.intent.otherOperator };
  }
  const trace = request.trace ?? context?.intent?.trace;
  if (request.targetClarification && context?.state === 'DONE') return { task: null, reply: request.question };
  const canReserve = hasPerm(actor, 'sale.order.view') && hasPerm(actor, 'sale.order.reserve');
  let permissionNote = '';
  if (request.action === 'reserve' && no && !canReserve) {
    permissionNote = '当前账号没有该销售单的占库权限。请交由有占库权限的销售岗核对原单。';
    if (!request.partialCorrection) return { task: null, detachTask: true, reply: permissionNote };
    request = { ...request, action: 'read' };
  }
  const boundId = request.orderId ?? context?.intent?.orderId;
  const oldTrace = context?.intent?.trace;
  const refresh = context?.state === 'DONE' && request.action === 'read' && no === context.intent?.orderNo
    && Boolean(trace) === Boolean(oldTrace) && trace?.kind === oldTrace?.kind && trace?.targetNo === oldTrace?.targetNo;
  if (refresh && (!Number.isSafeInteger(boundId) || boundId <= 0)) {
    return { task: null, detachTask: true, reply: '无法核实原交接保存的销售来源。请给出完整销售单号重新核对。' };
  }
  const financeFocus = request.action !== 'reserve' && (request.financeFocus || context?.intent?.financeFocus);
  const read = no && !request.targetClarification ? await run('operations.sale_handoff', client, {
    no, financeFocus, trace: request.action === 'reserve' ? undefined : trace,
  }, actor) : null;
  if (boundId != null && read?.documentId != null && boundId !== read.documentId) {
    return { task: null, detachTask: true, reply: '原单关联已变化，请在销售原单核对完整销售单号，再继续这张单。' };
  }
  if (refresh && !read?.result) {
    return { task: null, detachTask: true, reply: '暂时未能核对原交接。' + (read?.reply ?? HANDOFF_NUMBER_REQUIRED) };
  }
  const previousReview = request.priorReview ?? context?.batchReview;
  const releaseBatches = read?.releaseHistory?.batches;
  const currentBatches = Array.isArray(releaseBatches) ? withBatchClaims(releaseBatches, previousReview, 'sale') : null;
  const correction = request.correction && currentBatches
    ? compareBatchCorrection(releaseBatches, previousReview,
      { ...request, focusBatchId: context?.intent?.focusBatchId ?? request.expectedReleaseId }, 'sale') : null;
  const showReconciliation = correction?.partial || correction?.verified && currentBatches.some(batch => batch.issue);
  const reconciliation = selected => batchReconciliationText(no, currentBatches, 'sale', correction, selected);
  if (correction && !correction.verified && request.action === 'reserve') {
    return { task: null, reply: correction.partial ? reconciliation() : correction.reply };
  }
  if (request.correction && request.action === 'reserve' && !correction) {
    return { task: null, reply: '请核对原销售单上的释放事件和原成功回执。' };
  }
  if (correction?.verified && request.action === 'reserve') {
    const expectedReleaseId = request.followCorrection ? correction.batch.id
      : request.expectedReleaseId ?? context?.intent?.focusBatchId ?? correction.from?.id ?? correction.batch.id;
    request = { ...request, expectedReleaseId };
  }
  const invalidated = canReserve && read?.result?.orderId && !read.reserveReady
    && await expireHandoffPreviews(store, actor, read.result.orderId, no);
  if (canReserve && !request.otherOperator && !financeFocus && (read?.result?.orderId || boundId) && ['reserve', 'recover'].includes(request.action)) {
    const orderId = read?.result?.orderId ?? boundId;
    let existing = reservedHandoffTasks(store, actor, orderId, no, request.reapply);
    if (existing.length > 1 && !request.reapply) return reserveHistoryQuestion();
    let [original] = existing;
    if (original && RECOVERY_STATES.has(original.state) && (!request.reapply || original.preview?._releaseEventId == null)) {
      return resumeTask(store, client, original.id, actor);
    }
    if (request.checkOnly && original) {
      return store.exclusive(original.id, async () => {
        assertTaskAccess(original, actor, store);
        if (RECOVERY_STATES.has(original.state) || original.state === 'DONE') return resumeFromContext(store, client, actor, original);
        return stopPreviewReview(original, `销售单 ${no} 的这条本人占库任务没有已完成的提交。可核对原预览后继续。\n` + (read?.reply ?? ''));
      });
    }
    if (request.checkOnly) {
      const completed = [...matchingReserveTasks(store, actor, orderId, no)].filter(task => task.state === 'DONE' && !task.result?.alreadyReserved);
      if (completed.length > 1) return reserveHistoryQuestion();
      if (completed.length === 1) return resumeTask(store, client, completed[0].id, actor);
    }
    const history = read?.releaseHistory;
    const needBatchInput = (reply, field, batch, choices = history?.batches ?? history?.open ?? []) => {
      const task = context?.state === 'DISAMBIGUATING' ? context : store.create({ graph: SALE_HANDOFF_GRAPH, userText: text, actor });
      if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
      task.intent = { graph: SALE_HANDOFF_GRAPH, orderNo: no, orderId, releaseQuestion: { field, id: batch?.id,
        ordinal: batch?.ordinal, requested: request.requested, relativeBatch: request.relativeBatch,
        choices: choices.map(row => ({ id: row.id, ordinal: row.ordinal })) } };
      task.accessWarehouseIds = read?.warehouseIds;
      return { task, reply };
    };
    if (request.reapply && request.currentRemainder && (request.releaseOrdinal != null || request.requested)) {
      return { task: null, reply: '请明确按某次释放补占，或按原单当前全部待占量重占。' };
    }
    if (request.reapply && request.batchAmbiguous) {
      return needBatchInput('请指定要重办第几次释放，只选择一批。', 'batch');
    }
    const released = Boolean(history?.open.length);
    const shared = Array.isArray(history?.batches);
    const allBatches = currentBatches ?? history?.open ?? [];
    const progress = batchProgress(shared ? allBatches : [], releaseHasRemaining);
    // An aggregate reapply also leaves held release quantities to their own review.
    const hasUnverifiedRelease = shared && (progress.review.length > 0 || history.releaseCount !== allBatches.length);
    const mode = request.currentRemainder && hasUnverifiedRelease ? 'ready' : request.relativeBatch;
    const focusId = request.expectedReleaseId ?? (mode && mode !== 'ready' ? context?.intent?.focusBatchId : undefined);
    const chooseReady = mode === 'remaining' || mode === 'ready';
    const choices = chooseReady ? progress.ready : allBatches;
    if (mode && !shared) {
      return { task: null, reply: '请核对原销售单上的释放事件，目前未能确认原批次。' };
    }
    const selectedRelease = focusId != null ? allBatches.find(row => row.id === focusId)
      : request.releaseOrdinal != null ? allBatches.find(row => row.ordinal === request.releaseOrdinal)
        : (!request.currentRemainder || mode === 'ready') && shared && choices.length === 1 ? choices[0] : null;
    if (focusId != null && !selectedRelease) {
      return { task: null, reply: '原释放批次当前无法核实，请核对原单上的释放事件。' };
    }
    if (mode && focusId == null && request.releaseOrdinal == null && history.releaseCount !== allBatches.length) {
      return needBatchInput('部分释放记录的数量或仓库范围待核对。请指定要补哪一批。', 'batch', null, choices);
    }
    if (mode && !selectedRelease) {
      if (!choices.length) return { task: null, reply: progress.review.length
        ? releaseBatchText(progress.review[0]) : '原销售单各批释放均已补完。' };
      return needBatchInput(choices.map(releaseBatchText).join('\n') + '\n请指定要补哪一批。', 'batch', null, choices);
    }
    const withReview = out => {
      if (!out.preview) return out;
      if (out.task) out.task.batchReview = batchReviewHistory(history?.batches, previousReview, correction);
      if (showReconciliation) return { ...out, reply: out.reply + '\n' + reconciliation(selectedRelease) };
      const notes = [correction?.reply, ...(chooseReady ? progress.review : []).map(releaseBatchText)].filter(Boolean);
      return notes.length ? { ...out, reply: out.reply + '\n' + notes.join('\n') } : out;
    };
    if (request.invalidBatchSelection) return needBatchInput('请从原销售单的可核对释放记录中指定一批。', 'batch', null, choices);
    if (request.reapply && !request.currentRemainder && (request.releaseOrdinal != null || selectedRelease)) {
      if (!selectedRelease || !shared && history.open.length > 1) {
        return { task: null, reply: '这次释放无法单独对应当前待占量。请核对原单的释放记录。' };
      }
      if (shared && (selectedRelease.issue || selectedRelease.lines.every(line => !line.remaining))) {
        return { task: null, reply: showReconciliation ? reconciliation(selectedRelease) : releaseBatchText(selectedRelease) };
      }
      if (request.requested && !shared) return { task: null, reply: '请核对原释放批次和该批的剩余数量。' };
      if (request.requested && shared) {
        const remaining = selectedRelease.lines.filter(line => line.remaining > 0);
        if (remaining.length > 1 && request.requested.line == null) {
          return needBatchInput(releaseBatchText(selectedRelease) + '\n请指定本批第几行。', 'line', selectedRelease);
        }
        const line = request.requested.line == null ? remaining[0] : selectedRelease.lines[request.requested.line - 1];
        if (!line?.remaining) return needBatchInput(releaseBatchText(selectedRelease) + '\n请指定仍有余量的原批次行。', 'line', selectedRelease);
        if (request.requested.hasAmount && (!request.requested.qty || request.requested.qty > line.remaining
            || request.requested.unit && request.requested.unit !== line.unit)) {
          return needBatchInput(releaseBatchText(selectedRelease) + '\n请给出本次要补的数量（原单位，最多两位小数）。', 'qty', selectedRelease);
        }
      }
    }
    if (request.reapply && request.requested && !selectedRelease) {
      return needBatchInput('请指定本次要补占的是第几次释放。', 'batch');
    }
    if (request.reapply && history?.releaseCount > 1 && !request.currentRemainder && !selectedRelease) {
      return needBatchInput('这张单有多次释放。请说明是按当前待占量重占，还是按第几次释放重占。', 'batch');
    }
    if (request.reapply && !released && !selectedRelease && !original && !(request.currentRemainder && history && read?.reserveReady)) {
      return { task: null, detachTask: true, reply: '尚未核实这张原单当前的占库释放记录，请先核对原销售单。' };
    }
    if (!request.checkOnly && read?.reserveReady && (!released || request.reapply)) {
      if (shared && selectedRelease && !selectedRelease.issue) {
        existing = reservedHandoffTasks(store, actor, orderId, no, request.reapply, selectedRelease.id);
        [original] = existing;
      }
      if (existing.length > 1) return reserveHistoryQuestion();
      if (original && RECOVERY_STATES.has(original.state)) return resumeTask(store, client, original.id, actor);
      const reserveText = `给销售单号：${no} 试占库`;
      const anotherSupplement = request.anotherSupplement || correction?.partial;
      if (!original) return withReview(await graphReserve(store, client, actor, reserveText, orderId, selectedRelease?.id, request.requested, anotherSupplement));
      const selectedChanged = selectedRelease && original.reapplyReleaseId !== selectedRelease.id;
      if (selectedChanged && (!shared || original.state !== 'AWAITING_CONFIRM')) {
        return { task: null, reply: '这张原单已有另一批待核对的占库记录，请先核对原结果。' };
      }
      const changedQuantity = selectedRelease && original.preview?._releaseEventId && (request.requested || mode)
        && (request.requested?.qty !== original.releaseRequestedQty || request.requested?.line !== original.releaseRequestedLine);
      if (selectedChanged || changedQuantity) {
        const result = await store.exclusive(original.id, async () => {
          assertTaskAccess(original, actor, store);
          if (RECOVERY_STATES.has(original.state) || original.state === 'DONE') return resumeFromContext(store, client, actor, original);
          if (original.state === 'AWAITING_CONFIRM') {
            rememberOutput(store, stopPreviewReview(original, '原预览已被本次明确的补占范围替换。', true));
          }
          return null;
        });
        return result ?? withReview(await graphReserve(store, client, actor, reserveText, orderId, selectedRelease.id, request.requested, anotherSupplement));
      }
      const refreshed = await store.exclusive(original.id, async () => {
        assertTaskAccess(original, actor, store);
        if (RECOVERY_STATES.has(original.state) || original.state === 'DONE') return resumeFromContext(store, client, actor, original);
        original.handoffOrderNo = no;
        original.requirePreviewRevision = true;
        return resumeFromContext(store, client, actor, original);
      });
      if ((mode || request.reapply) && selectedRelease && refreshed.task?.state === 'EXPIRED') {
        return withReview(await graphReserve(store, client, actor, reserveText, orderId, selectedRelease.id, request.requested, anotherSupplement));
      }
      return withReview(refreshed);
    }
    if (original && request.action === 'recover' && !request.checkOnly) return resumeTask(store, client, original.id, actor);
  }
  const task = refresh || context?.state === 'DISAMBIGUATING' ? context : store.create({ graph: SALE_HANDOFF_GRAPH, userText: text, actor });
  if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
  const focus = request.action === 'read' ? read?.releaseHistory?.batches?.find(row =>
    request.resumeFocus != null ? row.id === request.resumeFocus : row.ordinal === request.releaseOrdinal) : null;
  const receiptFocusId = (request.movementId != null || correction?.partial) && correction?.verified ? correction.batch.id : undefined;
  const focusId = focus?.id ?? request.resumeFocus ?? receiptFocusId ?? (request.correction ? context?.intent?.focusBatchId : undefined);
  task.batchReview = batchReviewHistory(read?.releaseHistory?.batches, previousReview, correction);
  task.intent = { graph: SALE_HANDOFF_GRAPH, orderNo: no, orderId: read?.documentId ?? boundId,
    ...(focusId != null ? { focusBatchId: focusId } : {}),
    financeFocus: Boolean(financeFocus || read?.financeMismatchOnly), ...(trace ? { trace } : {}),
    ...(request.checkOnly && !no ? { checkOnly: true, otherOperator: request.otherOperator } : {}) };
  if (!no || request.targetClarification) return { task, reply: request.question ?? (request.multiple
    ? '请先选要交接的那一张销售单，只给出它的完整销售单号。' : HANDOFF_NUMBER_REQUIRED) };
  if (!refresh) task.transition('DRY_RUNNING');
  const priorSources = task.handoffSources ?? task.result?.sources ?? [];
  task.result = read.result ?? null;
  if (read.result) {
    task.handoffSources = [...new Set([...priorSources, ...(read.result.sources ?? [])])];
    task.accessWarehouseIds = [...new Set([...(task.accessWarehouseIds ?? []), ...(read.warehouseIds ?? [])])];
    task.handoffActionPermissions = [...new Set([...(task.handoffActionPermissions ?? []), ...(read.actionPermissions ?? [])])];
  }
  if (!refresh) task.transition(read.result ? 'DONE' : 'FAILED_FINAL');
  const guide = request.action === 'guide' && read.result
    ? `\n请在对应岗位的正式业务入口，按销售单 ${no} 及原任务号核对后办理。` : '';
  const blocked = request.action === 'reserve' && read.result && !read.result.sale?.reservationReleased
    ? '原销售单当前尚不能按交接阶段试占，或已有占库进展。请核对原单。\n' : '';
  const financeGuide = request.reportedFinance && read.result?.sources.includes('finance')
    ? '\n如果现场仍有差额，请财务对照本单原应收、实际到账和核销明细。' : '';
  const previewNote = invalidated ? '\n原占库预览已失效，核对当前卡点后可按同一张单重新试算。' : '';
  const noReceipt = request.otherOperator ? `销售单 ${no} 的原请求请由原经办人核对回执。以下为你当前可见的原单进度。\n`
    : request.checkOnly ? `销售单 ${no} 未核实到本人原占库请求。请先按原单核对当前可见进度。\n` : '';
  const focusNote = focus ? `\n当前核对的是第 ${focus.ordinal} 次释放（事件 #${focus.id}）。` : '';
  const reply = correction?.partial ? reconciliation(currentBatches.find(batch => batch.id === correction.batch?.id))
    : request.correction && correction
    ? correction.reply + (correction.verified || correction.includeSummary ? '\n' + read.reply : '') : read.reply;
  return { task, reply: noReceipt + blocked + reply + focusNote + guide + financeGuide + previewNote
    + (permissionNote ? '\n' + permissionNote : ''), result: read.result };
}

function reserveWarehouseIds(headWarehouseId, lines) {
  return [...new Set([headWarehouseId, ...lines.map(line => line.warehouseId)].map(Number))]
    .filter(id => Number.isSafeInteger(id) && id > 0);
}

async function currentReserveOrder(client, original, actor) {
  const id = Number(original?.orderId ?? original?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !original.orderNo) return null;
  const detail = await client.get(`/api/sale/${id}`);
  if (Number(detail?.id) !== id || !linkedNo(detail.orderNo, original.orderNo) || !Array.isArray(detail.items)) return null;
  const scope = Array.isArray(actor.warehouseIds) ? actor.warehouseIds.map(Number) : null;
  const warehouses = [detail.warehouseId, ...detail.items.map(line => line.warehouseId ?? detail.warehouseId)].map(Number);
  if (warehouses.some(id => !Number.isSafeInteger(id) || id <= 0 || scope && !scope.includes(id))) return null;
  return detail;
}

const reserveProgress = detail => SALE_STATES[Number(detail.status)];

function rememberReserveEvent(task, receipt, order) {
  const id = Number(receipt?.data?.reservationEventId);
  const preview = task.preview;
  const batches = order?.releaseBatches;
  const attributed = preview?._releaseEventId != null && Array.isArray(batches);
  const current = attributed ? verifiedBatchMovement(batches, id, 'sale') : null;
  const checked = attributed ? current && isReserveReceipt(receipt, { ...preview, _releaseEventId: current.id })
    : isReserveReceipt(receipt, preview);
  if (checked && Number.isSafeInteger(id) && id > 0) task.reserveEventId = id;
  return Boolean(checked);
}

function ownBatchChange(task, batches, movementId, from, domain) {
  if (!Array.isArray(batches)) return null;
  const existing = task.batchReview;
  const last = reviewedReceipt(existing, movementId) ?? { movementId, from };
  const correction = from && movementId && Array.isArray(batches)
    ? compareBatchCorrection(batches, { ...existing, last }, { movementId }, domain) : null;
  task.batchReview = batchReviewHistory(batches, existing, correction);
  if (!correction) return null;
  return correction.verified ? (correction.changed || correction.batch.id !== from.id ? correction : null)
    : correction.reference?.observed?.length ? correction : null;
}

function renderReserveResult(task, order, actor, recovered = false) {
  const state = reserveProgress(order);
  const release = reservationRelease(order, task.reserveEventId, task.preview);
  const fromId = task.preview?._releaseEventId;
  const batch = fromId != null && order.releaseBatches?.find(row => row.id === fromId);
  const correction = ownBatchChange(task, order.releaseBatches, task.reserveEventId,
    fromId != null ? { id: fromId, ordinal: task.preview._releaseOrdinal ?? batch?.ordinal } : null, 'sale');
  task.result = { ...task.result, ...(state ? { orderStatus: state } : {}), reservationReleased: Boolean(release) };
  const first = recovered || task.result.recoveredViaReceipt
    ? `原请求回执确认销售单 ${order.orderNo} 当时已执行占库。`
    : task.result.alreadyReserved ? `已核对原销售单 ${order.orderNo}。` : `原任务曾为销售单 ${order.orderNo} 办理占库。`;
  const correctedBatch = correction?.batch && correction.batch.id !== fromId ? correction.batch : null;
  const current = correction ? [correction.reply, ...(batch ? [releaseBatchText(batch)] : []),
    ...(correctedBatch ? [releaseBatchText(correctedBatch)] : [])].join('\n')
    : batch ? releaseBatchText(batch) : release ? release.reply + (task.reserveEventId ? '' : '请核对释放记录与本次原请求的先后。')
    : completedReserveProgress(order) ?? (state ? `原单当前状态为${state}。` : '');
  const next = release
    ? (release.reordered && completedReserveProgress(order) ? '销售岗按当前原单核对派发和仓库作业。'
      : '下一步由销售岗核对释放原因。' + (hasPerm(actor, 'sale.order.reserve')
        ? '需要恢复占用时，可说「释放后重新占库」，按当前原单试算。' : '由有占库权限的销售岗试算。'))
    : (state === '已出库' || state === '已占库' ? '' : '请按原销售单核对当前待占量及后续作业。');
  return { task, result: task.result, reply: first + '\n' + current + (next ? '\n' + next : '') };
}

async function reviewCompletedReserve(client, actor, task) {
  const order = await currentReserveOrder(client, task.preview ?? task.result, actor).catch(() => null);
  if (!order) return { task: null, detachTask: true, reply: '原销售单当前无法复核。请稍后核对原任务，勿重新提交。' };
  if (!task.reserveEventId && task.preview && !task.result?.alreadyReserved) {
    let receipt;
    try { receipt = await client.requestStatus(task.requestKey, reserveReceiptAction(task.preview)); }
    catch { return { task, reply: '原占库回执暂时无法核对，请稍后核对原任务，勿重新提交。' }; }
    rememberReserveEvent(task, receipt, order);
  }
  return renderReserveResult(task, order, actor);
}

function completedReserveProgress(detail) {
  const status = detail.status == null ? 0 : Number(detail.status);
  if (status === 4) return `销售单 ${detail.orderNo} 已出库。下一步按原单核对签收或后续事项。`;
  if (![0, 2, 3].includes(status)) return null;
  const fullyReserved = detail.hasUnreservedItems === false || (detail.items.length && detail.items.every(item =>
    Number(item.quantity) > 0 && Number(item.reservedQty) >= Number(item.quantity)));
  if (!fullyReserved) return null;
  return `销售单 ${detail.orderNo} 已全部占库，无需再占。下一步由有权限的岗位按原单核对派发及仓库作业。`;
}

function finishCurrentReserve(task, detail) {
  if (task.state === 'AWAITING_CONFIRM') task.transition('EXPIRED');
  if (task.state === 'EXPIRED') task.transition('DRY_RUNNING');
  task.result = { orderId: Number(detail.id), orderNo: detail.orderNo, alreadyReserved: true };
  task.accessWarehouseIds = reserveWarehouseIds(detail.warehouseId, detail.items);
  task.reviewRequired = false;
  task.error = null;
  task.transition('DONE');
  return { task, result: task.result, reply: completedReserveProgress(detail) };
}

function replacePreview(task, fresh) {
  if (task.state === 'AWAITING_CONFIRM') task.transition('EXPIRED');
  task.transition('DRY_RUNNING');
  task.setPreview(fresh);
  task.transition('AWAITING_CONFIRM');
  task.requirePreviewRevision = true;
  task.reviewRequired = false;
  task.error = null;
}

async function resumeReserve(client, actor, task) {
  const original = task.preview;
  const detail = await currentReserveOrder(client, original, actor);
  if (!detail) return stopPreviewReview(task, '原销售单的身份或当前仓库范围未能核对，原占库卡已失效。', true);
  if (completedReserveProgress(detail)) return finishCurrentReserve(task, detail);
  if (task.handoffOrderNo) {
    const verified = await run('operations.sale_handoff', client, { no: task.handoffOrderNo }, actor);
    if (!verified.reserveReady || Number(original.orderId) !== verified.documentId) {
      return stopPreviewReview(task, '原占库预览已失效，请按当前卡点处理后再试算。\n' + verified.reply, true);
    }
  }
  let fresh = await buildReservePreview(client, actor, detail);
  if (original._releaseEventId != null) {
    const batch = detail.releaseBatches?.find(row => row.id === original._releaseEventId);
    const bounded = batch && boundReservePreview(fresh, batch, undefined, original.lines);
    if (!unchangedReservePreview(detail, original, bounded)) {
      return stopPreviewReview(task, '原释放批次的回执或余量有变化。' + (batch ? releaseBatchText(batch) : '请核对原释放批次。'), true);
    }
    fresh = bounded;
  } else if (task.reapplyReleaseId != null && fresh._reservationEventId !== task.reapplyReleaseId) {
    return stopPreviewReview(task, '原释放批次之后已有新操作。请核对最新释放批次再试算。', true);
  }
  if (!fresh._reserveFingerprint) return stopPreviewReview(task, '未取得原销售单当前占库版本，请稍后重新核对。', true);
  const shortage = fresh.lines.filter(line => line.shortage > 0);
  if (shortage.length) return stopPreviewReview(task, '原单当前缺货，销售或客服需先核对供货。'
    + shortage.map(line => `${line.productName}（${line.warehouseName}）缺 ${line.shortage}`).join('；') + '。', true);
  if (!fresh.totalRemain) return stopPreviewReview(task, '原占库余量已变化，请重新核对原销售单当前状态。', true);
  const changed = task.state === 'EXPIRED' || task.previewExpired() || !unchangedReservePreview(detail, original, fresh);
  if (changed) {
    replacePreview(task, fresh);
    task.accessWarehouseIds = reserveWarehouseIds(fresh.warehouseId, fresh.lines);
  }
  task.reviewRequired = false;
  task.requirePreviewRevision = true;
  return { task, preview: task.preview, reply: `销售单 ${original.orderNo}。${changed ? '已按原单当前状态重新试算' : '已按当前状态复核'}，第 ${task.revision} 版待确认。请核对后点击确认占库。` };
}

function reserveReceiptAction(preview) {
  const separator = preview?._commercialModel === 'kit-v1' ? '.' : ':';
  return `sale.reserve${separator}${preview?.orderId}`;
}

function isReserveReceipt(receipt, preview) {
  return receipt?.resourceType === 'sale_order' && (!receipt.status || receipt.status === 'success')
    && Number(receipt.resourceId) === Number(preview.orderId)
    && (preview._releaseEventId == null || (Number(receipt.data?.releaseEventId) === preview._releaseEventId
      && Array.isArray(receipt.data.reserved) && receipt.data.reserved.length === preview.lines.length
      && preview.lines.every(line => receipt.data.reserved.some(row => Number(row.itemId) === Number(line.itemId)
        && Number(row.warehouseId) === line.warehouseId && row.unit === line.unit && Number(row.qty) === line.qty))));
}

function reserveMatchesPreview(detail, preview) {
  if (!detail || Number(detail.id) !== Number(preview.orderId) || detail.orderNo !== preview.orderNo
      || Number(detail.warehouseId) !== Number(preview.warehouseId)
      || !Array.isArray(detail.items) || preview._releaseEventId == null && detail.items.length !== preview.lines.length) return false;
  const items = new Map(detail.items.map(item => [Number(item.id), item]));
  return preview.lines.every(line => {
    const item = items.get(Number(line.itemId));
    const expectedQty = Math.round((line.reservedQty + line.remainToReserve) * 100);
    return item && Number(item.productId) === Number(line.productId)
      && Number(item.warehouseId ?? detail.warehouseId) === line.warehouseId
      && Math.round(Number(item.quantity) * 100) === Math.round((line.requiredQty ?? expectedQty / 100) * 100)
      && Math.round(Number(item.reservedQty) * 100) === expectedQty;
  });
}

function unchangedReservePreview(order, original, fresh) {
  const signature = preview => JSON.stringify(preview.lines.map(line =>
    [line.itemId, line.productId, line.warehouseId, line.remainToReserve, line.available]).sort((a, b) => a[0] - b[0]));
  return fresh && Number(order.id) === Number(original.orderId) && original._reserveFingerprint &&
    fresh._reserveFingerprint === original._reserveFingerprint && fresh._commercialModel === original._commercialModel &&
    fresh._commercialRevision === original._commercialRevision
    && (original._reservationEventId == null || fresh._reservationEventId === original._reservationEventId)
    && fresh._releaseProofVersion === original._releaseProofVersion && signature(fresh) === signature(original);
}

async function confirmReserve(store, client, task, actor) {
  if (!hasPerm(actor, 'sale.order.reserve')) {
    if (task.handoffOrderNo) return stopPreviewReview(task, '当前占库权限已变化，原预览已失效。', true);
    const err = new PermissionDeniedError('sale.order.reserve', task.graph);
    return { task, reply: denialReply(actor, err) + '（任务仍保留在待确认，未执行）' };
  }
  if (task.handoffOrderNo) {
    const verified = await run('operations.sale_handoff', client, { no: task.handoffOrderNo }, actor);
    if (!verified.reserveReady || Number(task.preview.orderId) !== verified.documentId) {
      const current = await currentReserveOrder(client, task.preview, actor).catch(() => null);
      if (current && completedReserveProgress(current)) return finishCurrentReserve(task, current);
      return stopPreviewReview(task, '原占库预览已失效。本次未提交，请处理当前卡点并重新试算。\n' + verified.reply, true);
    }
  }
  const order = await findSaleOrderByNo(client, task.preview.orderNo);
  if (!order || Number(order.id) !== Number(task.preview.orderId)) {
    return stopPreviewReview(task, '确认时无法核实原销售单，原占库预览已失效。', true);
  }
  let fresh;
  try { fresh = await buildReservePreview(client, actor, order); }
  catch {
    const current = await currentReserveOrder(client, task.preview, actor).catch(() => null);
    if (current && completedReserveProgress(current)) return finishCurrentReserve(task, current);
    return stopPreviewReview(task, '未能复核占库预览，本次未提交占库。请核对原单当前状态。', true);
  }
  const original = task.preview;
  if (original._releaseEventId != null) {
    const detail = await currentReserveOrder(client, original, actor).catch(() => null);
    const batch = detail?.releaseBatches?.find(row => row.id === original._releaseEventId);
    fresh = batch && boundReservePreview(fresh, batch, undefined, original.lines);
  }
  if (!unchangedReservePreview(order, original, fresh)) {
    task.transition('EXPIRED'); store.save(task);
    return { task, reply: '确认时发现原销售单、行仓或数量已变化，本次未提交。请重新试占。' };
  }
  task.transition('CONFIRMED'); task.transition('EXECUTING'); store.save(task);
  try {
    const payload = {
      expectedReserveFingerprint: original._reserveFingerprint,
      ...(original._releaseEventId == null ? {} : { releaseEventId: original._releaseEventId, releaseProofVersion: original._releaseProofVersion,
        items: original.lines.map(line => ({ id: line.itemId, warehouseId: line.warehouseId, warehouseName: line.warehouseName, qty: line.qty })) }),
      ...(original._reservationEventId != null ? { expectedReservationEventId: original._reservationEventId } : {}),
      ...(original._commercialModel === 'kit-v1' ? { commercialModel: 'kit-v1', expectedRevision: original._commercialRevision } : {}),
    };
    const execution = await run('sale.reserve', client, { saleOrderId: original.orderId, requestKey: task.requestKey, payload }, actor);
    task.recordStep('reserve', 'sale.reserve', execution.result); store.save(task);
    task.transition('VERIFYING');
    // 核验走单据明细（reservedQty）：占满后 reserve-preview 本身会被系统拒，不能用它核验
    const detail = execution.verified;
    if (!detail) {
      task.transition('ESCALATED'); store.save(task);
      return { task, reply: '占库已提交，但回查暂未完成。请查询原任务结果，不要重新发起占库。' };
    }
    let originalReceipt;
    try { originalReceipt = await client.requestStatus(task.requestKey, reserveReceiptAction(original)); }
    catch {
      task.transition('ESCALATED'); store.save(task);
      return { task, reply: '占库已经提交，原请求回执暂时无法核对。请核对原任务，勿重新提交。' };
    }
    if (original._releaseEventId != null ? !isReserveReceipt(originalReceipt, original) : !reserveMatchesPreview(detail, original)) {
      task.transition('ESCALATED'); store.save(task);
      return { task, reply: original._releaseEventId != null
        ? '分次补占已经提交。请核对这次补占的成功回执，再查看原批次剩余量。'
        : '占库执行后回查的销售单、行仓或数量与预览不一致，已转人工核查。' };
    }
    task.result = { orderId: original.orderId, orderNo: original.orderNo, reserved: original.totalRemain };
    rememberReserveEvent(task, originalReceipt);
    task.transition('DONE'); store.save(task);
    if (original._releaseEventId != null) {
      const batch = detail.releaseBatches?.find(row => row.id === original._releaseEventId);
      const progress = batch && task.batchReview?.clearedMovementId
        ? batchReconciliationText(original.orderNo, withBatchClaims(detail.releaseBatches, task.batchReview, 'sale'), 'sale', null, batch)
        : batch ? releaseBatchText(batch) : '请核对原释放批次的回执。';
      return { task, reply: `销售单 ${original.orderNo} 本次已补占。\n` + progress };
    }
    return { task, reply: `销售单 ${task.preview.orderNo} 已占库：${task.preview.lines.map(l => `${l.productName} ×${l.remainToReserve}`).join('；')}，回查待占量为 0。下一步拣货/出库请在原系统作业页进行，后续作业请在原页面办理。` };
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save(task);
      const out = await recoverTask(store, client, task, actor);
      if (task.state === 'RESULT_UNKNOWN') task.transition('ESCALATED');
      return out;
    }
    if (e.code === 'SALE_RESERVATION_PREVIEW_CONFLICT' || e.code === 'SALE_RESERVATION_EXECUTION_PENDING'
        || e.code === 'SALE_COMMERCIAL_REVISION_CONFLICT' || e.status === 400) {
      const current = await currentReserveOrder(client, original, actor).catch(() => null);
      task.transition('EXPIRED');
      if (current && completedReserveProgress(current)) return finishCurrentReserve(task, current);
      return stopPreviewReview(task, `本次占库未执行。请核对原销售单当前卡点后再试算。${e.message}`);
    }
    task.error = e.message; task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: `占库被系统拒绝：${e.message}（原样转述，未自动改数重试）` };
  }
}

// ---------- 图 D 入口：查往来 ----------
async function graphLedger(store, client, actor, text, presetKeyword, existingTask, boundCustomer) {
  const keyword = boundCustomer?.name ?? customerFromText('D-ledger', text) ?? presetKeyword;
  if (!keyword) return { task: null, reply: '请给出客户全称，例如「查某某公司的应收余额」。' };
  const task = existingTask || store.create({ graph: 'D-ledger', userText: text, actor });
  if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
  task.intent = { graph: 'D-ledger', customerKeyword: keyword };
  const denied = denyIfMissing(task, actor, ['payment.view', 'dashboard.view', 'customer.view']);
  if (denied) {
    if (hasPerm(actor, 'payment.view')) denied.reply += '你可以打开 [[客户往来|/payments/receivable]] 核对相关单据。';
    store.save(task);
    return denied;
  }
  let hit;
  try {
    if (boundCustomer) {
      const id = Number(boundCustomer.id);
      const customer = await client.get(`/api/customers/${id}`);
      if (Number(customer?.id) !== id) throw new Error('原客户当前不可访问，请核对客户全称。');
      hit = { id, title: customer.name };
    } else hit = await resolveEntity(client, task, actor, keyword, 'customer', 'customer');
  }
  catch (e) { return entityFailure(store, task, e); }
  clearChoice(task);
  task.transition('DRY_RUNNING');
  const ledgerData = await run('payments.party_ledger', client, { partyType: 'customer', partyId: hit.id }, actor);
  const data = { ...ledgerData, customer: { id: Number(hit.id), name: hit.title } };
  task.result = data;
  task.transition('DONE'); store.save(task);
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
      orderId: Number.isSafeInteger(r.orderId) && r.orderId > 0 ? r.orderId : undefined,
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
      recordId: r.recordId, orderNo: r.orderNo, orderId: r.orderId, amountCents: amt,
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
  if (denied) { store.save(task); return denied; }
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
    customerKeyword = receiptCustomerFromText(text, parsed);
    if (!customerKeyword) throw new Error('请给出付款客户全称和到账金额，再发起收款试算。');
  } catch (error) {
    task.error = error.message; task.transition('FAILED_FINAL'); store.save(task);
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
    task.error = e.message; task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: e.message };
  }
  if (preview.empty) {
    task.result = { alreadySettled: false, knownRecordsEmpty: true, closingCents: preview.closingCents, coverage: preview.coverage };
    task.transition('DONE'); store.save(task);
    return { task, reply: `${preview.customer.name}：当前关联应收里没查到未结账款，这笔收款先不登记。${preview.closingCents != null ? `关联余额 ¥${(preview.closingCents / 100).toFixed(2)}。` : ''}${preview.scopeNote}`, result: task.result };
  }
  if (preview.noAccount) {
    task.error = '无可用资金账户';
    task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: `登记收款必须选资金账户，但系统里没有可用的资金账户。请先到财务页建一个资金账户再回来，我不代建账户。（${preview.customer.name} 的 ${preview.unsettledCount} 笔未结应收未动）` };
  }
  task.setPreview(preview);
  task.transition('AWAITING_CONFIRM');
  store.save(task);
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
function accountNameFromReply(text) {
  return text.replace(/[。！!？?]+$/, '').replace(/^(?:请)?(?:选(?:择)?|入账到?|入到?|转入|用)\s*/, '').replace(/吧$/, '').trim();
}

function isAccountReply(text, task, route) {
  if (/^\d+$/.test(text)) return true;
  const accounts = task.preview.accounts || [];
  const name = accountNameFromReply(text);
  if (accounts.some(account => account.name === text || account.name === name)) return true;
  if (route.graph || route.kind === 'clarify' || route.kind === 'discussion' || route.explicitOutside) return false;
  return /^(?:请)?(?:选(?:择)?|入账到?|入到?|转入|用)/.test(text)
    && (/账户/.test(text) || accounts.some(account => text.includes(account.name)));
}

function accountSelectionTargets(store, actor, text) {
  const targets = [];
  const route = classifyMessage(text);
  for (const page of store.pagesForActor(actor, { orderBy: 'createdAt' })) {
    for (const task of page) {
      if (task.graph !== 'D-receipt' || task.state !== 'AWAITING_CONFIRM'
          || !task.preview?.needsAccountChoice || task.previewExpired()) continue;
      if (!isAccountReply(text, task, route)) continue;
      targets.push(task);
      if (targets.length === 2) return targets;
    }
  }
  return targets;
}
const ACCOUNT_TASK_REQUIRED = '有多笔收款待选账户。请先打开对应的收款任务，再回复序号或账户名。';

export async function tryAccountSelection(store, actor, text, client, task, choiceId) {
  const targets = task ? [task] : accountSelectionTargets(store, actor, String(text).trim());
  if (targets.length > 1) return { task: null, reply: ACCOUNT_TASK_REQUIRED };
  const [pending] = targets;
  if (!pending) return null;
  assertTaskAccess(pending, actor);
  if (pending.reviewRequired) throw previewConflict('请先核对原收款预览，再选择账户。');
  if (pending.state !== 'AWAITING_CONFIRM' || !pending.preview?.needsAccountChoice || pending.previewExpired()) throw Object.assign(new Error('该收款任务当前不能选择账户，请核对原任务状态'), { status: 409 });
  assertReceiptPreviewAmount(pending.preview, pending.userText);
  const accounts = pending.preview.accounts || [];
  const list = accounts.map((a, i) => `${i + 1}）${a.name}`).join('；');
  let chosen = null;
  const answer = String(text).trim();
  const num = /^(\d+)$/.exec(answer);
  if (choiceId != null) chosen = accounts.find(a => String(a.id) === String(choiceId)) || null;
  else if (num) chosen = accounts[Number(num[1]) - 1] || null;
  else {
    const statedName = accountNameFromReply(answer);
    const exact = accounts.filter(a => a.name === answer);
    const candidates = exact.length ? exact : accounts.filter(a => a.name === statedName);
    if (candidates.length === 1) chosen = candidates[0];
  }
  if (!chosen) {
    if (choiceId != null) throw Object.assign(new Error('请选择原预览中的资金账户'), { status: 400 });
    return { task: pending, reply: `还没选入账账户。可用账户：${list}。请回复一个序号或完整账户名，再点确认登记。`, preview: pending.preview };
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
  store.save(pending);
  return { task: pending, reply: `已选入账账户「${chosen.name}」。请点「确认登记收款」，确认后我再给出核销分配预览。`, preview: p };
}

function buildSettlePreview(stage1Preview, receiptDetail) {
  const allocations = stage1Preview.allocations;
  const allocTotal = allocations.reduce((s, a) => s + a.amountCents, 0);
  return {
    receiptId: receiptDetail.id, receiptNo: receiptDetail.receiptNo,
    _settlementEntryIds: (receiptDetail.settlements ?? []).map(row => Number(row.entryId)),
    receiptBalanceBeforeCents: cashUnits(receiptDetail.balance) ?? undefined,
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
    task.transition('ESCALATED'); store.save(task);
    return { task, reply: `收款单已登记但回查核验不平（预览 ¥${(task.preview.amountCents / 100).toFixed(2)}，回查 ${detail ? '¥' + Number(detail.amount).toFixed(2) : '查不到'}），已转人工。收款单 ${receipt.receiptNo || receipt.id} 请勿重复登记。` };
  }
  if (Number(detail.settledAmount) > 0 || Number(detail.status) === 2 || Number(detail.status) === 3) {
    task.result = { receiptId: detail.id, receiptNo: detail.receiptNo, amountCents: task.preview.amountCents,
      ...(recovered ? { recoveredViaReceipt: true } : {}) };
    task.transition('DONE');
    store.save(task);
    return { task, result: task.result, reply: `原收款单 ${detail.receiptNo} 已登记，当前有核销记录。请到收付款页核对原单和剩余可核销额。` };
  }
  const settlePreview = buildSettlePreview(task.preview, detail);
  const settleTask = store.createRelated(task, { graph: 'D-settle', userText: task.userText, actor: task.actor }, (next, receiptTask) => {
    next.transition('DISAMBIGUATING');
    next.transition('DRY_RUNNING');
    next.setPreview(settlePreview);
    next.transition('AWAITING_CONFIRM');
    receiptTask.result = { receiptId: detail.id, receiptNo: detail.receiptNo, amountCents: receiptTask.preview.amountCents, stage2TaskId: next.id, ...(recovered ? { recoveredViaReceipt: true } : {}) };
    receiptTask.transition('DONE');
  });
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
    task.error = error.message; task.transition('EXPIRED'); store.save(task);
    return { task, reply: `${error.message}这份预览已失效，未登记收款。` };
  }
  // 多账户未选户：硬拦截，不登记（选户在对话里完成，见 tryAccountSelection）
  if (task.preview?.needsAccountChoice) {
    return { task, reply: '还没选入账账户：请先在对话里回复序号或账户名选定账户，再点确认。任务仍保留在待确认，未执行。' };
  }
  // 新鲜度复核：未结余额构成/到账额/入账账户与预览不一致即拦截（总体设计 §4）
  let freshRecords = null, accountAlive = false;
  try {
    const { records, accounts } = await receiptPreviewFacts(client, task.preview);
    freshRecords = records;
    accountAlive = accounts.some(a => Number(a.id) === task.preview.account.id);
  } catch (e) {
    return { task, reply: `确认时复核取数失败：${e.message}。未执行，可稍后重试确认。` };
  }
  if (!accountAlive || receiptSignature(freshRecords, task.preview.amountCents, task.preview.account.id) !== task.preview.signature) {
    task.transition('EXPIRED'); store.save(task);
    return { task, reply: '确认时发现未结账款余额或资金账户已变化（可能已被他人收款/核销），已拦截登记。请重新发起，我按最新余额重新试算。' };
  }
  task.transition('CONFIRMED');
  task.transition('EXECUTING');
  store.save(task);
  try {
    const { created } = await run('payments.receipt_suggest', client, { payload: task.preview.payload, requestKey: task.requestKey }, actor);
    task.recordStep('create', 'payments.receipt_suggest', created);
    return finishReceiptStage(store, client, task, created, false);
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save(task);
      // 先查回执：同键是否已落库（永不换键重试）
      let receipt;
      try { receipt = await client.requestStatus(task.requestKey, 'payment.receipt.create'); }
      catch {
        task.transition('ESCALATED'); store.save(task);
        return { task, reply: '登记收款结果未知，原请求回执暂时无法核对。请核对原操作，不要重复提交。' };
      }
      const resId = receipt?.resourceId ?? receipt?.data?.resourceId ?? null;
      if (resId) {
        const detail = await receiptTool().detail(client, { receiptId: resId }).catch(() => null);
        if (detail && Number(detail.id) === Number(resId) && sameRecoveredReceipt(detail, task.preview) && toCents(detail.amount) === task.preview.amountCents) {
          return finishReceiptStage(store, client, task, detail, true);
        }
      }
      task.transition('ESCALATED'); store.save(task);
      return { task, reply: `登记收款结果未知且未查到回执，已转人工核查，请核对原操作，不要重复提交。` };
    }
    task.error = e.message;
    task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: `登记收款被系统拒绝：${e.message}（原样转述，未自动改数重试）` };
  }
}

async function receiptPreviewFacts(client, preview) {
  const records = await unsettledReceivables(client, preview.customer.id);
  const accounts = await receiptTool().accounts(client);
  return { records, accounts };
}

const settlementIdentity = preview => JSON.stringify(preview._expectedAllocation.targets.map(row =>
  [row.recordId, row.orderId, row.orderNo]).sort((a, b) => a[0] - b[0]));

async function freshExplicitSettlement(client, preview, receipt) {
  if (preview._monthly) {
    const statement = await exactStatement(client, preview.statementNo.toUpperCase());
    if (!statement || Number(statement.id) !== preview.statementId) return null;
    return monthlyPreview(statementEvidence(statement), receipt, preview.totalCents);
  }
  const fresh = await explicitSettlementPreview(client, receipt, preview.allocations.map(row => ({ no: row.orderNo.toUpperCase(), cents: row.amountCents })));
  if (preview._reversalSource) {
    fresh._reversalSource = preview._reversalSource;
    fresh._expectedAllocation.receiptLedgerFingerprint = receiptLedgerFingerprint(receipt);
    if (preview._expectedAllocation.reversalEntryId != null) {
      const batch = receipt.reversalBatches?.find(row => row.id === preview._expectedAllocation.reversalEntryId
        && row.recordId === preview.allocations[0]?.recordId);
      if (!batch || batch.issue || !(batch.open >= preview.totalCents)) return null;
      fresh._expectedAllocation.reversalEntryId = batch.id;
      fresh._expectedAllocation.reversalProofVersion = batch.proofVersion;
    }
  }
  return fresh;
}

async function settlePreviewFacts(client, preview) {
  if (preview._explicit) {
    const same = await exactReceipt(client, preview.receiptNo.toUpperCase());
    if (!same || Number(same.id) !== preview.receiptId) return { usable: false };
    try {
      const fresh = await freshExplicitSettlement(client, preview, same);
      return { usable: Boolean(fresh && (!preview._settlementEntryIds
        || JSON.stringify(fresh._settlementEntryIds) === JSON.stringify(preview._settlementEntryIds))
        && JSON.stringify(fresh._expectedAllocation) === JSON.stringify(preview._expectedAllocation)
        && JSON.stringify(fresh.allocations) === JSON.stringify(preview.allocations)) };
    } catch { return { usable: false }; }
  }
  const records = await unsettledReceivables(client, preview.customer.id);
  const detail = await receiptTool().detail(client, { receiptId: preview.receiptId });
  const balances = new Map(records.map(row => [row.recordId, row.balanceCents]));
  const changed = preview.allocations.find(row => balances.get(row.recordId) !== row.balanceBeforeCents);
  const usable = detail && Number(detail.id) === Number(preview.receiptId) && detail.receiptNo === preview.receiptNo
    && (detail.partyId === undefined || Number(detail.partyId) === Number(preview.customer.id))
    && (detail.type === undefined || Number(detail.type) === 2)
    && toCents(detail.balance) === preview.amountCents && toCents(detail.settledAmount) === 0;
  return { changed, usable };
}

async function resumeExplicitSettlement(client, task) {
  const p = task.preview;
  const receipt = await exactReceipt(client, p.receiptNo.toUpperCase());
  const expected = p._expectedAllocation;
  if (!receipt || Number(receipt.id) !== p.receiptId || Number(receipt.partyId) !== expected.partyId) {
    return stopPreviewReview(task, '原收款单或客户关联未能核对。请核对完整原收款单号。', true);
  }
  const settled = cashUnits(receipt.settledAmount), balance = cashUnits(receipt.balance);
  if (settled == null || balance == null || cashUnits(receipt.amount) !== settled + balance
    || settled + balance !== expected.settledCents + expected.receiptBalanceCents || !receiptEntriesMatch(receipt.settlements, settled)) {
    return stopPreviewReview(task, `原收款单 ${p.receiptNo} 的金额和分录待财务核对。`, true);
  }
  if (expected.reversalEntryId != null) {
    const batch = receipt.reversalBatches?.find(row => row.id === expected.reversalEntryId);
    if (!batch || batch.issue || batch.proofVersion !== expected.reversalProofVersion || !(batch.open >= p.totalCents)) {
      return stopPreviewReview(task, batch ? reversalBatchText(batch) : '请核对原收款单的冲回批次和成功回执。', true);
    }
  }
  if (p._reversalSource && receiptLedgerFingerprint(receipt) !== expected.receiptLedgerFingerprint) {
    return stopPreviewReview(task, `原收款单 ${p.receiptNo} 在这份预览后已有新分录。请从原核销记录重新核对冲回批次。`, true);
  }
  const entries = receipt.settlements ?? [];
  const previous = new Set(p._settlementEntryIds ?? []);
  if (p._settlementEntryIds && (previous.size !== p._settlementEntryIds.length
      || [...previous].some(id => !entries.some(row => Number(row.entryId) === id)))) {
    return stopPreviewReview(task, `原收款单 ${p.receiptNo} 的原核销分录已变化，请财务对照原分录核对。`, true);
  }
  if (!p._settlementEntryIds && settled !== expected.settledCents) {
    return stopPreviewReview(task, `原收款单 ${p.receiptNo} 已有新增核销。请先核对原分录，再说明是否需要另核一笔。`, true);
  }
  const targets = new Map(expected.targets.map(row => [row.recordId, row]));
  const added = p._settlementEntryIds ? entries.filter(row => !previous.has(Number(row.entryId))
    && (targets.has(Number(row.recordId)) || p._monthly && Number(row.statementId) === p.statementId)) : [];
  if (added.length) {
    if (added.some(row => {
      const original = targets.get(Number(row.recordId));
      return !original || !linkedNo(row.orderNo, original.orderNo) || Number(row.orderId) !== original.orderId;
    })) {
      return stopPreviewReview(task, `原收款单 ${p.receiptNo} 的新增分录与销售单关联待财务核对。`, true);
    }
    if (added.some(row => signedCashUnits(row.amount) < 0)) return stopPreviewReview(task,
      `原收款单 ${p.receiptNo} 出现对原目标的负向核销分录。请先核对分录，再明确本次要核销的金额。`, true);
    const details = [...Map.groupBy(added, row => targets.get(Number(row.recordId)).orderNo)].map(([no, rows]) =>
      `${no} 已新增核销 ¥${(rows.reduce((sum, row) => sum + cashUnits(row.amount), 0) / 100).toFixed(2)}`);
    return stopPreviewReview(task, `本收款单 ${p.receiptNo} 对原目标 ${details.join('；')}。原预览已失效。请确认是否还要另核一笔。`, true);
  }
  let fresh;
  try { fresh = await freshExplicitSettlement(client, p, receipt); }
  catch (error) {
    if (error instanceof FlowError) throw error;
    return stopPreviewReview(task, `原收款单 ${p.receiptNo} 当前不能按原金额核销。${error.message}。`, true);
  }
  if (!fresh || settlementIdentity(fresh) !== settlementIdentity(p)) {
    return stopPreviewReview(task, '原对账单或应收目标已变化，请核对原单关联后继续。', true);
  }
  const changed = task.state === 'EXPIRED' || task.previewExpired()
    || JSON.stringify(fresh._expectedAllocation) !== JSON.stringify(expected)
    || JSON.stringify(fresh.allocations) !== JSON.stringify(p.allocations);
  if (changed) replacePreview(task, fresh);
  task.reviewRequired = false;
  task.requirePreviewRevision = true;
  return { task, preview: task.preview, reply: (changed ? `已按原收款单和当前余额重新试算，第 ${task.revision} 版待确认。\n` : '')
    + (p._monthly ? monthlyPreviewReply(task.preview) : explicitPreviewReply(task.preview)) };
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

const statementResult = p => p?._monthly ? { statementId: p.statementId, statementNo: p.statementNo } : {};

function verifiedSettlementReceipt(receipt, preview, detail) {
  const data = receipt?.data;
  const from = preview._expectedAllocation?.reversalEntryId;
  if (from == null || !Array.isArray(detail?.reversalBatches)) return settlementReceiptMatches(data, preview);
  if (receipt.status && receipt.status !== 'success') return false;
  const entryId = Number(data?.applied?.[0]?.entryId);
  const batch = verifiedBatchMovement(detail.reversalBatches, entryId, 'receipt');
  return Boolean(batch && batch.recordId === preview.allocations[0]?.recordId
    && batch.posted.some(row => row.id === entryId && row.cents === preview.totalCents)
    && settlementReceiptMatches(data, { ...preview, _expectedAllocation: { ...preview._expectedAllocation, reversalEntryId: batch.id } }));
}

async function reviewCompletedSettlement(store, client, task, actor, detail) {
  const p = task.preview;
  const current = detail ?? await receiptTool().detail(client, { receiptId: p.receiptId }).catch(() => null);
  if (!current || Number(current.id) !== Number(p.receiptId) || current.receiptNo !== p.receiptNo
      || (p._explicit && (Number(current.type) !== 2 || Number(current.partyId) !== p._expectedAllocation.partyId))) {
    return { task: null, detachTask: true, reply: '原收款单的身份或当前权限未能核实，请从原记录稍后核对。' };
  }
  if (p._explicit && !task.settlementEntryIds) {
    try {
      const receipt = await client.requestStatus(task.requestKey, `payment.receipt.settle.${p.receiptId}`);
      if (receipt?.resourceType === 'payment_receipt' && Number(receipt.resourceId) === p.receiptId
          && verifiedSettlementReceipt(receipt, p, current)) captureSettlementEntries(task, receipt.data);
    } catch { /* 过期或暂不可读的回执保留原记录，当前来源仍须唯一。 */ }
  }
  const correction = ownBatchChange(task, current.reversalBatches, task.settlementEntryIds?.[0], p._reversalSource, 'receipt');
  const { reply, current: facts } = await reviewSettlement(client, task, current, settlementReapplyLinks(store, actor, Number(current.id)));
  const { effectiveAllocationCents, reversedAllocationCents, currentReceiptBalanceCents, ...original } = task.result ?? {};
  task.result = { ...original, ...facts };
  return { task, result: task.result, reply: correction ? correction.reply + '\n' + reply : reply };
}

function settleDoneReply(p, recovered) {
  if (p._explicit) return (recovered ? '已核对原请求回执。' : '') + `收款单 ${p.receiptNo}${p._monthly ? ' 对月结对账单 ' + p.statementNo : ''} 本次已核销 ¥${(p.totalCents / 100).toFixed(2)}。\n`
    + p.allocations.map(row => `${row.orderNo} 核销 ¥${(row.amountCents / 100).toFixed(2)}，办结时欠款 ¥${((row.balanceBeforeCents - row.amountCents) / 100).toFixed(2)}。`).join('\n')
    + (p._monthly ? `\n对账单办结时还欠 ¥${((p._expectedAllocation.statement.balanceCents - p.totalCents) / 100).toFixed(2)}。` : '')
    + `\n本次办结时预收余款 ¥${((p._expectedAllocation.receiptBalanceCents - p.totalCents) / 100).toFixed(2)}。可继续查看原收款单的当前状态。`;
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
  let check;
  try {
    check = await settlePreviewFacts(client, p);
  } catch (e) {
    return { task, reply: `确认时复核取数失败：${e.message}。未执行核销，可稍后重试确认。` };
  }
  const { changed, usable } = check;
  if (changed || !usable) {
    return stopPreviewReview(task, `确认时发现状态已变化（${changed ? `账款 ${changed.orderNo} 的余额与预览不一致` : '收款单已被动用或状态变化'}），本次未核销。收款已经登记，请核对原收款单。不要重复登记收款。`, true);
  }
  task.transition('CONFIRMED');
  task.transition('EXECUTING');
  store.save(task);
  let posted;
  try {
    posted = await receiptTool().settle(client, { receiptId: p.receiptId, allocations: p.payload.allocations,
      requestKey: task.requestKey, expectedAllocation: p._expectedAllocation });
  } catch (e) {
    if (e instanceof FlowError && e.kind === 'unknown') {
      task.transition('RESULT_UNKNOWN'); store.save(task);
      const out = await recoverTask(store, client, task, actor);
      if (task.state === 'RESULT_UNKNOWN') task.transition('ESCALATED');
      return out;
    }
    if (p._explicit && e.code === 'RECEIPT_ALLOCATION_PREVIEW_CONFLICT') {
      task.transition('EXPIRED');
      return stopPreviewReview(task, `原收款单 ${p.receiptNo} 或目标应收已被更新，本次没有核销。请按原单核对。`);
    }
    task.error = e.message;
    task.transition('FAILED_FINAL'); store.save(task);
    if (p._explicit) return { task, reply: `本次核销被系统拦截：${e.message}。请核对原收款单 ${p.receiptNo} 后再准备本次分配。` };
    return { task, reply: `核销被系统拒绝：${e.message}（原样转述）。收款单 ${p.receiptNo} 仍挂账未核销，可到收付款页人工处理。` };
  }
  task.transition('VERIFYING');
  if (!(p._explicit ? settlementReceiptMatches(posted.result, p) : await verifySettled(client, task))) {
    task.transition('ESCALATED'); store.save(task);
    return { task, reply: `核销已提交但回查与预览不一致，已转人工核查（收款单 ${p.receiptNo}）。` };
  }
  task.result = { receiptId: p.receiptId, receiptNo: p.receiptNo, ...statementResult(p), allocatedCents: p.totalCents };
  captureSettlementEntries(task, posted.result);
  task.transition('DONE'); store.save(task);
  let reply = settleDoneReply(p, false);
  if (p._expectedAllocation?.reversalEntryId != null) {
    const detail = await receiptTool().detail(client, { receiptId: p.receiptId }).catch(() => null);
    const batch = Number(detail?.id) === p.receiptId && detail?.receiptNo === p.receiptNo
      && detail.reversalBatches?.find(row => row.id === p._expectedAllocation.reversalEntryId && row.recordId === p.allocations[0]?.recordId);
    const progress = batch && task.batchReview?.clearedMovementId
      ? batchReconciliationText(p.receiptNo, withBatchClaims(detail.reversalBatches, task.batchReview, 'receipt'), 'receipt', null, batch)
      : batch ? reversalBatchText(batch) : '请核对原冲回分录及本批当前余量。';
    reply += '\n' + progress;
  }
  return { task, reply };
}

function findReceiptPlans(store, actor, receiptId, signature) {
  const active = [];
  let completed, expired;
  for (const page of store.pagesForActor(actor)) for (const task of page) {
    if (task.graph !== 'D-settle' || Number(task.preview?.receiptId) !== receiptId) continue;
    if (RECOVERY_STATES.has(task.state) || task.state === 'AWAITING_CONFIRM') active.push(task);
    if (!completed && task.state === 'DONE' && task.intent?.allocationSignature === signature) completed = task;
    if (!expired && task.state === 'EXPIRED' && task.intent?.allocationSignature === signature) expired = task;
  }
  return { active, completed, expired };
}

function checkReceiptPlan(store, client, actor, receiptId, signature, newRound, repeated, options = {}) {
  const { reopenExpired = false, batchVersion, proofVersion, batchId } = options;
  const found = findReceiptPlans(store, actor, receiptId, signature);
  const { completed, expired } = found;
  const active = found.active.filter(task => {
    const originalBatch = task.preview?._expectedAllocation?.reversalEntryId;
    return !RECOVERY_STATES.has(task.state) || batchId == null || originalBatch == null || originalBatch === batchId;
  });
  const unknown = active.filter(task => RECOVERY_STATES.has(task.state));
  if (unknown.length === 1) return { out: resumeTask(store, client, unknown[0].id, actor) };
  if (active.length > 1) return { out: { task: null, detachTask: true, reply: '这张收款单有多条未完成记录，请先打开要核对的原任务。' } };
  const [previous] = active;
  if (previous?.intent?.allocationSignature === signature
      && (!batchVersion || previous.preview?._expectedAllocation?.receiptLedgerFingerprint === batchVersion
        && previous.preview?._expectedAllocation?.reversalProofVersion === proofVersion)) {
    return { out: resumeTask(store, client, previous.id, actor) };
  }
  if (completed && !newRound) return { out: resumeTask(store, client, completed.id, actor).then(out => ({
    ...out, preserveTask: true, reply: out.reply + '\n' + repeated,
  })) };
  if (!previous && expired && !newRound && !reopenExpired) return { out: resumeTask(store, client, expired.id, actor) };
  return { previous };
}

async function newReceiptSettlement(store, actor, text, preview, signature, previous, clarification, reply) {
  if (previous) {
    await store.exclusive(previous.id, async () => {
      if (previous.state !== 'AWAITING_CONFIRM') throw previewConflict('原核销状态已变化，请先查询原任务。');
      rememberOutput(store, stopPreviewReview(previous, '原核销预览已由新的明确分配替换。', true));
    });
  }
  const task = store.create({ graph: 'D-settle', userText: text, actor });
  task.intent = { graph: 'D-settle', receiptNo: preview.receiptNo, receiptId: preview.receiptId, ...statementResult(preview),
    allocationSignature: signature };
  task.transition('DRY_RUNNING');
  task.setPreview(preview);
  task.requirePreviewRevision = true;
  task.transition('AWAITING_CONFIRM');
  if (clarification?.state === 'DISAMBIGUATING') {
    clarification.transition('CANCELLED');
    store.save(clarification);
  }
  return { task, preview, reply };
}

async function graphReceiptAllocation(store, client, actor, text, request, context) {
  const no = request.multiple ? undefined : request.no ?? context?.intent?.receiptNo ?? context?.preview?.receiptNo;
  const previousNo = context?.intent?.receiptNo ?? context?.preview?.receiptNo;
  const sameContext = !request.multiple && (!request.no || request.no === previousNo?.toUpperCase()
    || (!previousNo && context?.state === 'DISAMBIGUATING'));
  const prior = sameContext ? context?.intent : null;
  const required = 'payment.view';
  if (!hasPerm(actor, required)) return { task: null, reply: '当前账号没有查看收款和核销的权限。请由财务核对原收款单。' };
  let action = request.action === 'read' && !request.correction && !request.held && context?.state === 'DISAMBIGUATING' && sameContext && prior?.receiptAction === 'prepare'
    ? 'prepare' : request.action;
  if (action === 'read' && request.reversal && request.reversalOrdinal == null && !request.batchOrderNos?.length
      && sameContext && context?.graph === 'D-settle' && (context.state === 'DONE' || RECOVERY_STATES.has(context.state))) return resumeTask(store, client, context.id, actor);
  if (action === 'confirm') return { task: null, reply: '请在当前核销预览上点击确认核销。' };
  let permissionNote = '';
  if (action === 'prepare' && !hasPerm(actor, 'payment.execute')) {
    permissionNote = '当前账号没有核销办理权限。请由有权限的财务人员核对原收款单。';
    if (!request.partialCorrection) return { task: null, detachTask: true, reply: permissionNote };
    action = 'read';
  }
  const reapply = action === 'prepare' && Boolean(request.reapply || prior?.reapply || prior?.reapplyTaskId);
  const relative = request.relativeBatch ?? prior?.relativeBatch;
  const original = reapply && relative !== 'ready' && sameContext && (context?.graph === 'D-settle'
    ? (!relative || context.state === 'DONE' || RECOVERY_STATES.has(context.state) ? context : null)
    : prior?.reapplyTaskId ? store.get(prior.reapplyTaskId) : null);
  const reversalOrdinal = request.batchAmbiguous || request.relativeBatch === 'ready'
    ? undefined : request.reversalOrdinal ?? prior?.reversalOrdinal;
  const anchorId = request.relativeBatch && request.relativeBatch !== 'ready' && sameContext
    ? (prior?.focusBatchId ?? context?.preview?._reversalSource?.id) : undefined;
  let verifiedReceiptId;
  if (original && (!original.preview?._explicit || original.preview._monthly || original.state !== 'DONE')) {
    if (RECOVERY_STATES.has(original.state)) return resumeTask(store, client, original.id, actor);
    return { task: null, detachTask: true, reply: '请先核对原核销记录是否办结，我会按原收款和销售单继续核对。' };
  }
  if (original) assertTaskAccess(original, actor, store);
  const clarification = (message, rows = [], choices) => {
    const task = sameContext && context?.graph === 'J-receipt-status' && context.state === 'DISAMBIGUATING'
      ? context : store.create({ graph: 'J-receipt-status', userText: text, actor });
    if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
    task.intent = { graph: 'J-receipt-status', receiptNo: no, receiptAction: action,
      receiptId: verifiedReceiptId ?? prior?.receiptId ?? (sameContext ? context?.preview?.receiptId : undefined),
      rows, newRound: request.newRound || prior?.newRound,
      ...(reapply ? { reapply: true, reapplyTaskId: original?.id, reversalOrdinal, relativeBatch: relative,
        focusBatchId: anchorId ?? prior?.focusBatchId,
        batchChoices: choices?.map(row => ({ id: row.id, ordinal: row.ordinal })) ?? prior?.batchChoices,
        reapplyCents: request.amountOnly ?? prior?.reapplyCents } : {}) };
    return { task, reply: message };
  };
  const oldRows = request.relativeBatch === 'ready' ? [] : prior?.rows ?? (original && original.preview.allocations.length === 1
    ? [{ no: original.preview.allocations[0].orderNo.toUpperCase() }] : []);
  let rows = request.rows?.length ? request.rows : oldRows;
  if (context?.state === 'DISAMBIGUATING' && request.rows?.length && !request.replacesPlan
    && new Set(request.rows.map(row => row.no)).size === request.rows.length
    && request.rows.every(row => oldRows.some(old => old.no === row.no))) {
    const corrections = new Map(request.rows.map(row => [row.no, row]));
    rows = oldRows.map(row => corrections.get(row.no) ?? row);
  }
  if (!no) return clarification(request.multiple
    ? '请先选择一张要核对的收款单，只给完整收款单号。'
    : '请给出原收款单的完整收款单号，例如 RC20261122061。', rows);
  const boundId = prior?.receiptId ?? (sameContext ? context?.preview?.receiptId : undefined);
  if (action === 'prepare' && relative !== 'ready' && sameContext && context?.graph === 'D-settle' && RECOVERY_STATES.has(context.state)) {
    return resumeTask(store, client, context.id, actor);
  }
  if (action === 'prepare') {
    if (reapply && rows.length > 1) return clarification('请指定这次重办所对应的一张原销售单及本次金额。', []);
    if (request.invalid || (request.amountOnlyGiven && !request.amountOnly)) {
      return clarification('请逐单给出准确的正数核销金额，最多两位小数。', rows.map(row => ({ no: row.no })));
    }
    if (request.amountOnlyGiven && rows.filter(row => !row.cents).length === 1) {
      rows = rows.map(row => row.cents ? row : { ...row, cents: request.amountOnly });
    }
    if (rows.length > 20 || new Set(rows.map(row => row.no)).size !== rows.length) {
      return clarification('请逐张给出完整销售单号和金额，每张销售单只列一次，一次最多 20 张。');
    }
    const missing = rows.filter(row => !row.cents);
    if (reapply && request.batchAmbiguous) return clarification('请指定要重办第几笔冲回，只选择一笔。', rows);
    if ((!reapply || original && !relative) && (!rows.length || missing.length)) return clarification(missing.length === 1
      ? '请给出 ' + missing[0].no + ' 的本次准确核销金额。'
      : '请给出要核销的完整销售单号和每张的准确金额。', rows);
  }

  let detail;
  try {
    detail = await exactReceipt(client, no);
  } catch (error) {
    return clarification('暂时无法核对原收款单。请稍后重查，或从客户往来核对。', rows);
  }
  if (!detail || (boundId != null && Number(boundId) !== Number(detail.id))) {
    return clarification('未能在原收款单号下核实同一张收款单。请核对完整收款单号。', rows);
  }
  verifiedReceiptId = Number(detail.id);
  const previousReview = sameContext ? context?.batchReview : null;
  if (request.partialCorrection && !Array.isArray(detail.reversalBatches)) {
    return { task: null, reply: '暂未取得原收款单的逐笔冲回回执。请由财务从原收款单核对。' };
  }
  const batches = Array.isArray(detail.reversalBatches) ? withBatchClaims(detail.reversalBatches, previousReview, 'receipt') : [];
  const correction = request.correction
    ? compareBatchCorrection(detail.reversalBatches, previousReview,
      { ...request, focusBatchId: prior?.focusBatchId ?? context?.preview?._reversalSource?.id }, 'receipt') : null;
  const showReconciliation = correction?.partial || correction?.verified && batches.some(batch => batch.issue);
  const reconciliation = selected => batchReconciliationText(no, batches, 'receipt', correction, selected);
  if (correction && !correction.verified && action === 'prepare') {
    return { task: null, reply: correction.partial ? reconciliation() : correction.reply };
  }
  if (action !== 'prepare') {
    const task = sameContext && context?.graph === 'J-receipt-status' && context.state === 'DISAMBIGUATING'
      ? context : store.create({ graph: 'J-receipt-status', userText: text, actor });
    task.transition('DRY_RUNNING');
    const readCandidates = request.reversalOrdinal != null && !request.batchAmbiguous
      ? detail.reversalBatches?.filter(row => row.ordinal === request.reversalOrdinal
        && (!request.batchOrderNos?.length || request.batchOrderNos.includes(row.orderNo.toUpperCase()))) : [];
    const focus = readCandidates?.length === 1 ? readCandidates[0] : null;
    const receiptFocusId = (request.movementId != null || correction?.partial) && correction?.verified ? correction.batch.id : undefined;
    const focusBatchId = focus?.id ?? receiptFocusId ?? (request.correction ? prior?.focusBatchId ?? context?.preview?._reversalSource?.id : undefined);
    task.batchReview = batchReviewHistory(detail.reversalBatches, previousReview, correction);
    task.intent = { graph: 'J-receipt-status', receiptNo: no, receiptId: verifiedReceiptId, ...(focusBatchId != null ? { focusBatchId } : {}) };
    try {
      const outcome = receiptOverview(detail);
      task.result = outcome.result;
      task.transition('DONE');
      const note = focus ? `\n当前核对的是 ${focus.orderNo} 第 ${focus.ordinal} 笔冲回（分录 #${focus.id}）。` : '';
      const reply = correction?.partial ? reconciliation(batches.find(batch => batch.id === correction.batch?.id))
        : correction ? correction.reply + (correction.verified || correction.includeSummary ? '\n' + outcome.reply : '') : outcome.reply;
      return { task, ...outcome, reply: reply + note + (permissionNote ? '\n' + permissionNote : '') };
    } catch (error) {
      task.transition('FAILED_FINAL');
      return { task, reply: error.message };
    }
  }
  let reversalSource, otherReviews = [];
  const useRemaining = relative && !request.amountOnlyGiven && !request.rows?.some(row => row.cents > 0);
  if (reapply) {
    if (original && (Number(detail.id) !== original.preview.receiptId || detail.receiptNo !== original.preview.receiptNo)) {
      return clarification('原收款单身份已变化。请核对原完整收款单号。', rows);
    }
    if (Array.isArray(detail.reversalBatches)) {
      const requestedNo = rows[0]?.no;
      const matches = batches.filter(batch => (!requestedNo || batch.orderNo?.toUpperCase() === requestedNo)
        && (!original || original.preview.allocations.some((row, index) => batch.recordId === row.recordId
          && (original.preview._reversalSource || original.settlementEntryIds?.[index] == null || batch.originalEntryId == null
            || batch.originalEntryId === original.settlementEntryIds[index]))));
      if (!relative && !request.reversalId && new Set(matches.map(batch => batch.recordId)).size > 1 && !requestedNo) {
        return clarification('原收款单涉及多张销售单。请给出要重办的完整原销售单号。', rows);
      }
      const priorChoices = prior?.batchChoices;
      const picked = priorChoices && (request.reversalId != null || request.reversalOrdinal != null)
        ? priorChoices.filter(row => request.reversalId != null ? row.id === request.reversalId : row.ordinal === request.reversalOrdinal) : null;
      const focusedId = request.followCorrection ? correction?.batch.id
        : picked?.length === 1 ? picked[0].id : anchorId ?? correction?.from?.id ?? correction?.batch?.id;
      if (relative && focusedId == null && reversalOrdinal == null
          && detail.settlements?.some(row => row.statementId != null && signedCashUnits(row.amount) < 0)) {
        return clarification('请指定要补办的冲回分录。涉及月结的冲回由财务按原对账单核对。', rows, matches);
      }
      if (picked && picked.length !== 1) return clarification('请给出要补办的冲回分录编号，只选择一批。', rows);
      const progress = batchProgress(matches, reversalHasRemaining);
      const chooseReady = relative === 'remaining' || relative === 'ready';
      const candidates = focusedId != null ? matches.filter(batch => batch.id === focusedId)
        : reversalOrdinal != null ? matches.filter(batch => batch.ordinal === reversalOrdinal)
          : chooseReady ? progress.ready : relative === 'recent' ? matches : [...progress.ready, ...progress.review];
      if (chooseReady) otherReviews = progress.review;
      if (candidates.length > 1) {
        const orderLabel = new Set(candidates.map(batch => batch.ordinal)).size !== candidates.length ? '，同序号请给出分录编号' : '';
        return clarification(candidates.map(reversalBatchText).join('\n') + `\n请指定要重办第几笔冲回${orderLabel}，只选择一批。`, rows, candidates);
      }
      [reversalSource] = candidates;
      if (!reversalSource) {
        if (chooseReady && focusedId == null && reversalOrdinal == null && matches.length) {
          return { task: null, reply: progress.review.length
            ? reversalBatchText(progress.review[0]) : '原收款单各批冲回均已补完。' };
        }
        return clarification('请核对原收款单及销售单上的冲回批次编号。', rows);
      }
      const amount = useRemaining ? reversalSource.open : rows[0]?.cents ?? request.amountOnly ?? prior?.reapplyCents;
      rows = [{ no: reversalSource.orderNo.toUpperCase(), cents: amount }];
      if (reversalSource.issue || reversalSource.open === 0) {
        return { task: null, reply: showReconciliation ? reconciliation(reversalSource) : reversalBatchText(reversalSource) };
      }
      if (!amount || amount > reversalSource.open) {
        return clarification(reversalBatchText(reversalSource) + '\n请给出本次要补核销的金额，不能超过该批剩余金额。', rows.map(row => ({ no: row.no })));
      }
    } else {
      if (!original || relative) return clarification('请核对原核销记录和原冲回分录。', rows);
      const review = await reviewSettlement(client, original, detail, settlementReapplyLinks(store, actor, Number(detail.id)));
      const batches = review.reopen?.get(rows[0].no) ?? [];
      if (reversalOrdinal == null && batches.length > 1) {
        return clarification(review.reply + '\n请指定要重办第几笔冲回，本次金额和原销售单已保留。', rows);
      }
      reversalSource = reversalOrdinal == null ? batches[0] : batches.find(row => row.ordinal === reversalOrdinal);
      if (!reversalSource || rows[0].cents > reversalSource.open) {
        return { task: null, detachTask: true, reply: review.reply + '\n请财务核对尚未重办的原冲回金额。' };
      }
    }
  }

  const planSignature = explicitPlanSignature(rows);
  const signature = reversalSource ? JSON.stringify([planSignature, reversalSource.id]) : planSignature;
  const { out, previous } = checkReceiptPlan(store, client, actor, Number(detail.id), signature, Boolean(useRemaining || request.newRound || prior?.newRound),
    reapply ? '相同批次和金额已补核销。确定要再补一笔时，请明确说明本次新金额。'
      : '本收款单的相同分配已经办过。请从原任务查原回执。确定要另办时，请说「再核一笔」并给出逐单金额。',
    { reopenExpired: reapply, batchVersion: reversalSource ? receiptLedgerFingerprint(detail) : undefined,
      proofVersion: reversalSource?.proofVersion,
      batchId: Array.isArray(detail.reversalBatches) ? reversalSource?.id : undefined });
  if (out) {
    if (!showReconciliation) return out;
    const checked = await out;
    if (checked.preview && checked.task) {
      checked.task.batchReview = batchReviewHistory(detail.reversalBatches, previousReview, correction);
    }
    return { ...checked, reply: checked.reply + '\n' + reconciliation(reversalSource) };
  }
  let preview;
  try {
    preview = await explicitSettlementPreview(client, detail, rows);
  } catch (error) {
    return clarification(error.message + '。', rows);
  }
  if (reversalSource) {
    preview._reversalSource = { id: reversalSource.id, ordinal: reversalSource.ordinal, taskId: original?.id };
    preview._expectedAllocation.receiptLedgerFingerprint = receiptLedgerFingerprint(detail);
    if (Array.isArray(detail.reversalBatches)) {
      if (preview.allocations[0]?.recordId !== reversalSource.recordId) return clarification('请核对原冲回分录所属的应收记录。', rows);
      preview._expectedAllocation.reversalEntryId = reversalSource.id;
      preview._expectedAllocation.reversalProofVersion = reversalSource.proofVersion;
    }
  }
  const qualifier = reversalSource ? `按第 ${reversalSource.ordinal} 笔冲回重办，本次仅使用这笔可重办金额。\n` : '';
  const reviewNote = showReconciliation ? '\n' + reconciliation(reversalSource)
    : otherReviews.length ? '\n' + otherReviews.map(reversalBatchText).join('\n') : '';
  const prepared = await newReceiptSettlement(store, actor, text, preview, signature, previous, sameContext ? context : null,
    (!showReconciliation && correction?.reply ? correction.reply + '\n' : '') + qualifier + explicitPreviewReply(preview) + reviewNote);
  prepared.task.batchReview = batchReviewHistory(detail.reversalBatches, previousReview, correction);
  return prepared;
}

async function graphMonthlyReconciliation(store, client, actor, text, request, context) {
  if (!hasPerm(actor, 'payment.view')) return { task: null, reply: '当前账号没有查看月结对账和收款核销的权限，请由财务核对原单。' };
  const prior = context?.intent;
  const previousStatement = prior?.statementNo?.toUpperCase(), previousReceipt = prior?.receiptNo?.toUpperCase();
  const sameStatement = !request.multiStatement && (!request.statementNo || !previousStatement || request.statementNo === previousStatement);
  const sameReceipt = sameStatement && !request.multiReceipt && (!request.receiptNo || !previousReceipt || request.receiptNo === previousReceipt);
  const no = request.multiStatement ? null : request.statementNo ?? previousStatement;
  const receiptNo = request.multiReceipt ? null : request.receiptNo ?? (sameStatement ? previousReceipt : null);
  const action = request.action === 'read' && request.followup && !request.held && sameStatement && sameReceipt
    && context?.state === 'DISAMBIGUATING' && prior?.monthlyAction === 'prepare' ? 'prepare' : request.action;
  if (action === 'confirm') return { task: null, reply: '请核对原收款单、对账单及逐单金额，在当前预览上点击确认核销。' };
  if (action === 'prepare' && !hasPerm(actor, 'payment.execute')) {
    return { task: null, detachTask: true, reply: '当前账号没有收款核销办理权限，请由有权限的财务人员办理。' };
  }
  if (request.conditional) return { task: null, detachTask: true, reply: '请先由财务核实条件，再说明原对账单号、原收款单号和本次金额。' };
  const sameDraft = sameStatement && sameReceipt && context?.graph === MONTHLY_GRAPH && context.state === 'DISAMBIGUATING';
  let statementId = sameStatement ? prior?.statementId : null;
  let receiptId = sameReceipt ? prior?.receiptId : null;
  let amount = request.invalidAmount ? null : request.amountCents ?? (sameDraft ? prior?.amountCents : null);
  const newRound = request.newRound || (sameDraft && prior?.newRound);
  const clarification = reply => {
    const task = sameDraft ? context : store.create({ graph: MONTHLY_GRAPH, userText: text, actor });
    if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
    task.intent = { graph: MONTHLY_GRAPH, statementNo: no, statementId, receiptNo, receiptId, amountCents: amount, monthlyAction: action, newRound };
    return { task, reply };
  };
  if (!no) return clarification('请给出一张完整月结对账单号，例如 SC20261122024。');
  if (action === 'prepare' && sameStatement && sameReceipt && context?.preview?._monthly
    && (RECOVERY_STATES.has(context.state) || context.state === 'AWAITING_CONFIRM' && !request.amountCents
      && !request.invalidAmount && !request.specifiedSales && !newRound)) return resumeTask(store, client, context.id, actor);
  let statement, evidence;
  try {
    statement = await exactStatement(client, no);
    if (!statement || (statementId != null && Number(statement.id) !== statementId)) return clarification('未能核实唯一的原月结对账单，请核对完整月结对账单号。');
    statementId = Number(statement.id);
    evidence = statementEvidence(statement);
  } catch {
    return clarification('暂时无法读取原月结对账单，请稍后重查。');
  }
  if (action === 'confirm-statement') {
    const state = Number(statement.status) === 1 ? '仍是草稿，请由有对账确认权限的财务人员在月结对账页核对并确认。' : '当前已确认。';
    return { task: null, reply: '原月结对账单 ' + statement.statementNo + ' ' + state };
  }
  if (action === 'prepare') {
    if (Number(statement.status) === 1 || evidence.issues.length || Number(statement.status) === 3) {
      return clarification(monthlyOverview(evidence).reply);
    }
    if (!receiptNo) return clarification('请给出用于本对账单的一张完整原收款单号。');
    if (request.specifiedSales) {
      amount = null;
      return clarification('月结按原对账单的老账顺序核销。请给出按这个顺序办理的本次核销金额。');
    }
    if (!amount) return clarification('请给出本次准确的正数核销金额，最多两位小数。');
  }
  if (request.multiReceipt) return clarification('请给出要核对的一张完整原收款单号。');
  let receipt;
  if (receiptNo) {
    try { receipt = await exactReceipt(client, receiptNo); }
    catch { return clarification('暂时无法核对原收款单，请稍后重查。'); }
    if (!receipt || (receiptId != null && Number(receipt.id) !== receiptId)) return clarification('未能核实唯一的原收款单，请核对完整收款单号。');
    receiptId = Number(receipt.id);
  }
  if (action === 'prepare') {
    const signature = JSON.stringify(['monthly', Number(statement.id), amount]);
    const { out, previous } = checkReceiptPlan(store, client, actor, Number(receipt.id), signature, newRound,
      '原收款单对这张对账单的相同核销已经办过。请从原任务查原回执。确定要另办时，请说「再核一笔」并给出本次金额。');
    if (out) return out;
    let preview;
    try { preview = monthlyPreview(evidence, receipt, amount); }
    catch (error) { return clarification(error.message); }
    return newReceiptSettlement(store, actor, text, preview, signature, previous, sameDraft ? context : null, monthlyPreviewReply(preview));
  }

  const task = sameDraft ? context : store.create({ graph: MONTHLY_GRAPH, userText: text, actor });
  task.transition('DRY_RUNNING');
  task.intent = { graph: MONTHLY_GRAPH, statementNo: no, statementId: Number(statement.id), receiptNo, receiptId: receipt?.id };
  const result = monthlyOverview(evidence, receipt);
  task.result = result.result;
  task.transition('DONE');
  return { task, ...result };
}

async function graphReturnFinance(store, client, actor, text, request, context) {
  if (!RETURN_READ.some(code => hasPerm(actor, code))) {
    return { task: null, reply: '当前账号没有查看退货、退款或客户应收的权限，请销售、仓库和财务核对各自原单。' };
  }
  const prior = context?.intent;
  const sameSale = !request.refs.sale || !prior?.saleNo || linkedNo(prior.saleNo, request.refs.sale);
  const refs = { ...(sameSale ? { sale: prior?.saleNo } : {}), ...request.refs };
  const clarificationTask = context?.graph === RETURN_FINANCE && context.state === 'DISAMBIGUATING' && sameSale ? context : null;
  if (clarificationTask && !request.multiple) {
    for (const [kind, number] of Object.entries(prior?.refs ?? {})) refs[kind] ??= number;
  }
  const prepare = request.action === 'prepare' || Boolean(clarificationTask && prior?.refundPending && request.bareRefund);
  const clarify = reply => {
    const task = clarificationTask ?? store.create({ graph: RETURN_FINANCE, userText: text, actor });
    if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
    task.intent = { saleNo: refs.sale, refs, refundPending: prepare };
    return { task, reply };
  };
  if (request.action === 'confirm') return { task: null, reply: '请核对原退款单、出账账户以及金额，在当前卡片上点击确认退款出账。' };
  if (prepare && !REFUND_PERMISSIONS.every(code => hasPerm(actor, code))) {
    return { task: null, detachTask: true, reply: '当前账号缺少退款执行或原退款单、应收查看权限，请由有权限的财务处理。' };
  }
  if (request.multiple) return clarify('请只给要核对的一张完整' + ({
    sale: '销售单号', return: '退货单号', receipt: '收款单号', statement: '对账单号', refund: '退款单号',
  })[request.multiple] + '。');
  if (prepare && request.uncertain) return { task: null, detachTask: true, reply: '请财务先核实分次退款金额和条件，再给出已确认的完整原退款单号。' };
  if (prepare && !refs.refund && sameSale && context?.graph === REFUND_EXECUTE && context.preview?.refundNo) refs.refund = context.preview.refundNo;
  if (prepare && !refs.refund) return clarify('请给出已确认待退款的完整退款单号，例如 RF20261122016。');
  let refund;
  if (refs.refund && hasPerm(actor, 'refund.order.view')) {
    try { refund = await refundByNumber(client, refs.refund); } catch { refund = null; }
    if (!refund) return clarify('未能核实指定原退款单，请核对完整退款单号及仓库权限。');
    if (refs.sale && !linkedNo(refund.saleOrderNo, refs.sale)) return clarify('指定退款单与原销售单未能核实关联，请核对原单号。');
    refs.sale ??= refund.saleOrderNo.toUpperCase();
  }
  if (refs.refund && !refs.sale && !hasPerm(actor, 'refund.order.view') && !refs.return) {
    return clarify('当前账号没有退款单查看权限。如需核对可见应收或退货，请提供原销售单的完整销售单号。');
  }
  if (refs.return && hasPerm(actor, 'return.order.view') && (!refs.sale || prepare)) {
    let source;
    try { source = await saleByReturnNumber(client, refs.return); } catch { source = null; }
    if (!source || refs.sale && !linkedNo(source, refs.sale)) return clarify('未能核实指定退货单与原销售单的关联。');
    refs.sale ??= source;
  } else if (prepare && refs.return) return clarify('当前权限无法核实指定退货单，请财务先核对原销售及退款单。');
  if (!refs.sale) return clarify('请给出原销售单的完整销售单号，例如 SL20261122011。');

  if (prepare) {
    const existing = [...store.pagesForActor(actor)].flat().find(row => row.graph === REFUND_EXECUTE
      && row.preview?.refundId === Number(refund.id) && (RECOVERY_STATES.has(row.state) || row.state === 'AWAITING_CONFIRM' && !row.previewExpired()));
    if (existing && RECOVERY_STATES.has(existing.state)) return resumeTask(store, client, existing.id, actor);
    if (Number(refund.status) === 3) {
      const hasFund = !refund.trace.fundConflict && refund.trace.outgoing.length === 1
        && Number(refund.trace.outgoing[0]) === Number(refund.amount);
      return { task: null, reply: '原退款单 ' + refund.refundNo + (hasFund ? ' 已退并有出账凭据。' : ' 已完成登记，出账请财务核对。') };
    }
    if (Number(refund.status) !== 2) return clarify('原退款单当前为' + (Number(refund.status) === 1 ? '草稿，请由有权限的财务在原退款单核对并确认。' : '已取消，请由财务核对原退款单。'));
    if (request.amountCents != null && Math.round(Number(refund.amount) * 100) !== request.amountCents) {
      return clarify('你给出的金额与原退款单已确认金额不一致，请核对正确的退款单号。');
    }
    if (refund.trace.periodClosed === true) return { task: null, detachTask: true, reply: closedRefundReply(refund) };
    const newSourceClaim = ['return', 'receipt', 'statement'].some(kind => request.refs[kind]
      && !linkedNo(existing?.intent?.refs?.[kind], request.refs[kind]));
    if (existing && !newSourceClaim) return resumeTask(store, client, existing.id, actor);
    let preview;
    try { preview = await buildRefundPreview(client, refund, refs); }
    catch (error) { return clarify(error instanceof FlowError ? '原账款暂时无法核对，请财务稍后重查。' : error.message); }
    if (existing) {
      await store.exclusive(existing.id, async () => {
        if (existing.state !== 'AWAITING_CONFIRM') throw previewConflict('原退款任务状态已变化，请查询原结果。');
        rememberOutput(store, stopPreviewReview(existing, '原退款预览已由新的来源核对替换。', true));
      });
    }
    const task = store.create({ graph: REFUND_EXECUTE, userText: text, actor });
    task.intent = { saleNo: refs.sale, refs };
    task.accessWarehouseIds = preview._scope;
    task.transition('DRY_RUNNING');
    task.setPreview(preview);
    task.requirePreviewRevision = true;
    task.transition('AWAITING_CONFIRM');
    if (clarificationTask) { clarificationTask.transition('CANCELLED'); store.save(clarificationTask); }
    return { task, preview, reply: refundPreviewReply(preview) };
  }
  const task = clarificationTask ?? store.create({ graph: RETURN_FINANCE, userText: text, actor });
  task.transition('DRY_RUNNING');
  task.intent = { saleNo: refs.sale };
  const result = await readReturnFinance(client, actor, refs.sale, refs, refund);
  task.accessWarehouseIds = result.scope;
  task.returnFinancePermissions = result.permissions;
  task.result = result.result;
  task.transition('DONE');
  return { task, reply: result.reply };
}

function finishRefund(task, preview, recovered = false) {
  task.result = { refundId: preview.refundId, refundNo: preview.refundNo, saleOrderNo: preview.saleOrderNo,
    amountCents: preview.totalCents, ...(recovered ? { recoveredViaReceipt: true } : {}) };
  task.transition('VERIFYING');
  task.transition('DONE');
  return { task, reply: (recovered ? '已按原退款回执恢复。' : '') + '退款单 ' + preview.refundNo + ' 已登记出账 ¥'
    + (preview.totalCents / 100).toFixed(2) + '。可重新核对原销售应收和月结欠款。' };
}

async function refreshRefundPreview(client, task) {
  const p = task.preview;
  const row = await refundDetail(client, { id: p.refundId, refundNo: p.refundNo, saleOrderNo: p.saleOrderNo, saleOrderId: p._expectedRefund.saleOrderId });
  if (row.trace.periodClosed === true) return false;
  const fresh = await buildRefundPreview(client, row, task.intent?.refs);
  return JSON.stringify(fresh._expectedRefund) === JSON.stringify(p._expectedRefund)
    && [...fresh._scope].sort().join(',') === [...p._scope].sort().join(',');
}

async function resumeRefund(client, task) {
  const p = task.preview, expected = p._expectedRefund;
  const row = await refundDetail(client, { id: p.refundId, refundNo: p.refundNo, saleOrderNo: p.saleOrderNo, saleOrderId: expected.saleOrderId });
  if (Number(row.paymentRecordId) !== expected.paymentRecordId) {
    return stopPreviewReview(task, '原退款单的应收关联已变化，请财务先核对原应收。', true);
  }
  if (Number(row.status) === 3) {
    const paid = !row.trace.fundConflict && row.trace.outgoing.length === 1
      && cashUnits(row.trace.outgoing[0]) === p.totalCents && cashUnits(row.amount) === p.totalCents;
    if (!paid) return stopPreviewReview(task, `原退款单 ${p.refundNo} 已完成登记，出账金额待财务核对。`, true);
    if (task.state === 'AWAITING_CONFIRM') task.transition('EXPIRED');
    task.transition('DRY_RUNNING');
    task.result = { refundId: p.refundId, refundNo: p.refundNo, saleOrderNo: p.saleOrderNo, amountCents: p.totalCents };
    task.reviewRequired = false;
    task.transition('DONE');
    return { task, result: task.result, reply: `原退款单 ${p.refundNo} 已退 ¥${(p.totalCents / 100).toFixed(2)}，出账凭据已核对。请按原销售单核对应收及月结。` };
  }
  if (row.trace.periodClosed === true) return stopPreviewReview(task, closedRefundReply(row), true);
  let fresh;
  try { fresh = await buildRefundPreview(client, row, task.intent?.refs); }
  catch (error) {
    if (error instanceof FlowError) throw error;
    return stopPreviewReview(task, error.message, true);
  }
  const next = fresh._expectedRefund;
  if (next.accountId !== expected.accountId || next.effectiveDate !== expected.effectiveDate || next.amountCents !== expected.amountCents
    || next.statement?.id !== expected.statement?.id || next.statement?.no !== expected.statement?.no) {
    return stopPreviewReview(task, '原退款金额、账户、日期或对账归属有变，请财务在原退款单核对。', true);
  }
  if (task.state === 'EXPIRED' || task.previewExpired() || JSON.stringify(next) !== JSON.stringify(expected)
    || [...fresh._scope].sort().join(',') !== [...p._scope].sort().join(',')) {
    replacePreview(task, fresh);
    task.accessWarehouseIds = fresh._scope;
  }
  task.reviewRequired = false;
  task.requirePreviewRevision = true;
  return { task, preview: task.preview, reply: `已复核原退款单，第 ${task.revision} 版待确认。\n` + refundPreviewReply(task.preview) };
}

async function confirmRefund(store, client, task, actor) {
  const p = task.preview;
  let current;
  try { current = await refreshRefundPreview(client, task); }
  catch { current = false; }
  if (!current) return stopPreviewReview(task, '原退款单、应收、月结或仓库范围已变化，请重新核对原单。', true);
  task.transition('CONFIRMED');
  task.transition('EXECUTING');
  store.save(task);
  let result;
  try {
    result = await client.post('/api/refunds/' + p.refundId + '/execute', { expectedPreview: p._expectedRefund }, { requestKey: task.requestKey });
  } catch (error) {
    if (error instanceof FlowError && error.kind === 'unknown') return recoverTask(store, client, task, actor);
    if (error.code === 'REFUND_PREVIEW_CONFLICT') {
      task.transition('EXPIRED');
      return stopPreviewReview(task, '本次退款未执行。原退款单、应收或对账单已变化，请按原单核对。');
    }
    task.transition('FAILED_FINAL');
    return { task, reply: '退款被系统拦截。' + error.message + '。请财务核对原退款单。' };
  }
  if (refundReceiptMatches(result, p)) return finishRefund(task, p);
  task.transition('ESCALATED');
  return { task, reply: '退款提交结果尚未核实，请查询原退款任务和出账记录，勿重复提交。' };
}

// ---------- 图 E/F ----------
async function graphSimple(store, client, actor, text, graph, tool, buildReply, gate) {
  const task = store.create({ graph, userText: text, actor });
  task.transition('DRY_RUNNING');
  if (gate?.anyOf) {
    const denied = denyIfMissingAny(task, actor, gate.anyOf);
    if (denied) { store.save(task); return denied; }
  } else if (gate?.allOf) {
    const denied = denyIfMissing(task, actor, gate.allOf);
    if (denied) { store.save(task); return denied; }
  }
  try {
    const data = await run(tool, client, {}, actor);
    const reply = buildReply(data);
    const hasFacts = graph === 'F-briefing'
      ? Object.values(data.sections).some(section => section.ok && section.data != null)
      : [data.warehouseTaskStats, data.sortingBinPending, data.inboundTasks].some(section => section != null);
    task.result = data;
    if (!hasFacts) task.error = '本次未取得业务数据';
    task.transition(hasFacts ? 'DONE' : 'FAILED_FINAL'); store.save(task);
    return { task, reply, result: data };
  } catch (e) {
    if (e instanceof PermissionDeniedError) { task.error = e.message; task.transition('FAILED_FINAL'); store.save(task); return { task, reply: denialReply(actor, e) }; }
    task.error = e.message; task.transition('FAILED_FINAL'); store.save(task);
    return { task, reply: `查询失败：${e.message}` };
  }
}

// ---------- 图 E/F 的事实摘要 ----------
const briefingGraph = (store, client, actor, t) => graphSimple(store, client, actor, t, 'F-briefing', 'dashboard.briefing', briefingReply,
  { allOf: ['dashboard.view'] });
const stuckGraph = (store, client, actor, t) => graphSimple(store, client, actor, t, 'E-stuck', 'tasks.progress', stuckReply,
  { anyOf: Object.values(TASK_PROGRESS_PERMISSIONS) });

const READ_OPERATIONS = {
  'H-workbench': 'operations.workbench',
  'I-returns': 'operations.returns',
  'J-receipt-status': 'operations.receipt_status',
};

async function graphOperationalRead(store, client, actor, text, { graph, no, stage, returnType }) {
  const tool = READ_OPERATIONS[graph];
  const required = getTool(tool).requires;
  const keys = graph === 'H-workbench' ? workbenchKeys(actor).filter(key => !stage || key === 'warehouse') : [];
  if (!required && !keys.length) return { task: null, reply: stage
    ? '当前账号的可见权限和仓库范围内没有可查询的仓库作业队列。'
    : '当前账号的可见权限范围内没有可供汇总的岗位待办。' };
  const task = store.create({ graph, userText: text, actor });
  task.transition('DRY_RUNNING');
  if (graph === 'I-returns' && no) task.intent = { graph, returnType };
  if (graph === 'J-receipt-status' && no) task.intent = { graph, receiptNo: no };
  const denied = required && denyIfMissing(task, actor, [required]);
  if (denied) { store.save(task); return denied; }

  let outcome;
  try {
    outcome = await run(tool, client, { keys, no, stage, returnType }, actor);
  } catch (e) {
    const reason = e instanceof FlowError ? '业务接口暂未返回可用数据，请稍后重试或到原页面核对。' : e.message;
    outcome = { hasFacts: false, reply: '查询未完成。' + reason };
  }
  task.result = outcome.result ?? null;
  if (!outcome.hasFacts) task.error = '本次未取得可核对的业务数据';
  task.transition(outcome.hasFacts ? 'DONE' : 'FAILED_FINAL');
  store.save(task);
  return { task, reply: outcome.reply, result: outcome.result };
}

function pauseStockRead(store, task) {
  task.error = '查库暂时失败，条件和后续步骤已保留。请说「继续原任务」重查指定仓库，尚未生成草稿。';
  task.transition('PAUSED');
  store.save(task);
  return { task, reply: task.error };
}

async function readForSequence(store, client, actor, parent, step, input) {
  let out;
  const active = step.activeId && store.get(step.activeId);
  if (active && input?.choiceId != null) {
    out = await store.exclusive(active.id, () => continueTask(store, client, actor, input.text, { taskId: active.id, choiceId: input.choiceId }));
  } else if (active?.graph === 'A-inventory' && active.intent?.intake && input?.product) {
    out = await store.exclusive(active.id, () => graphInventory(store, client, actor, active.userText, input.product,
      { task: active, warehouseKeyword: active.intent.warehouseKeyword }));
  } else if (active) {
    return { task: active, reply: active.reply, candidates: active.candidates };
  } else {
    const route = classifyMessage(step.query, { single: true });
    if (route.graph !== step.graph || !Object.hasOwn(READ_STEPS, step.graph)) return { reply: '这一步的查询内容需要重新核对。' };
    if (route.kind === 'operational-read') out = await graphOperationalRead(store, client, actor, step.query, route);
    else if (route.crossPeriod?.action === 'read' && (route.crossPeriod.refs.sale || route.crossPeriod.refs.application))
      out = await runCrossPeriod(store, client, actor, step.query, route.crossPeriod);
    else if (route.returning?.action === 'read' && route.returning.refs.sale) out = await graphReturnFinance(store, client, actor, step.query, route.returning);
    else if (route.monthly?.action === 'read' && route.monthly.statementNo) out = await graphMonthlyReconciliation(store, client, actor, step.query, route.monthly);
    else if (route.receipt?.action === 'read' && route.receipt.no) out = await graphReceiptAllocation(store, client, actor, step.query, route.receipt);
    else if (route.graph === 'A-inventory') out = await graphInventory(store, client, actor, step.query);
    else out = await executeIntent(store, client, actor, step.query, { graph: step.graph });
  }
  if (out.task) {
    out.task.sequenceOwner = parent.id;
    rememberOutput(store, out);
  }
  return out;
}

function runSequence(store, client, actor, task, input) {
  return advanceReadSequence(store, task, (step, next) => readForSequence(store, client, actor, task, step, next), input);
}

async function stockBeforeSale(store, client, actor, text, route) {
  const task = store.create({ graph: 'A-inventory', userText: text, actor });
  task.stockSale = { query: route.query, condition: route.condition };
  return store.exclusive(task.id, async () => finishStockSale(store, client, actor, await graphInventory(store, client, actor, route.query, undefined, { task })));
}

async function finishStockSale(store, client, actor, lookup) {
  const { task } = lookup;
  if (!task?.stockSale || task.state !== 'DONE') return lookup;
  const source = task.stockSale;
  rememberOutput(store, lookup);
  const plan = parseStockSaleCondition(source.condition);
  const { warehouseId, productId, product, available } = lookup.result;
  if (!warehouseId || !task.intent?.warehouseKeyword || !plan) {
    return { ...lookup, reply: lookup.reply + '\n请明确要开单的仓库、客户和数量，我再按条件试算。' };
  }
  let item;
  try { item = await client.get(`/api/products/${productId}`); }
  catch {
    source.pendingProductCheck = true;
    return { ...lookup, reply: lookup.reply + '\n未能核实商品当前单位。可以说「继续原任务」重核，未生成草稿。' };
  }
  source.pendingProductCheck = false;
  const unit = item?.unit;
  if (!unit || (plan.unit && plan.unit !== unit) || (plan.requestedUnit && plan.requestedUnit !== unit)) {
    return { ...lookup, reply: lookup.reply + `\n商品当前单位${unit ? `为「${unit}」` : '未能核实'}，请核对数量和单位。未生成草稿。` };
  }
  if (plan.productKeyword && plan.productKeyword !== product && plan.productKeyword.toUpperCase() !== String(item.code ?? '').toUpperCase()) {
    return { ...lookup, reply: lookup.reply + '\n要开单的商品须和这次查库的商品一致。请核对后重述，未生成草稿。' };
  }
  if (validateQty(plan.minimum, { allowDecimal: item.allowDecimalQty }) || validateQty(plan.qty, { allowDecimal: item.allowDecimalQty })) {
    return { ...lookup, reply: lookup.reply + '\n库存条件或开单数量不符合商品数量规则，请核对后重述，未生成草稿。' };
  }
  if (available == null || available < Math.max(plan.minimum, plan.qty)) {
    return { ...lookup, reply: lookup.reply + '\n当前可用数量不足或未能核实，未生成草稿。' };
  }
  const draft = await graphSaleDraft(store, client, actor, source.condition, {
    customerKeyword: plan.customerKeyword, lines: [{ productKeyword: product, qty: plan.qty }],
    stockCondition: { warehouseId, productId, unit, minimumAvailable: plan.minimum },
  });
  if (['AWAITING_CONFIRM', 'DISAMBIGUATING'].includes(draft.task?.state)) source.draftId = draft.task.id;
  store.save(task);
  return { ...draft, reply: lookup.reply + '\n' + draft.reply };
}

export function resumeTask(store, client, taskId, actor) {
  return store.exclusive(taskId, async () => rememberOutput(store, await resumeFromContext(store, client, actor, store.get(taskId))));
}

const PREVIEW_WRITE_PERMISSIONS = {
  'B-sale-draft': 'sale.order.create',
  'C-purchase-draft': 'purchase.order.create',
  'B2-reserve': 'sale.order.reserve',
  'D-receipt': 'payment.execute',
  'D-settle': 'payment.execute',
  [REFUND_EXECUTE]: 'refund.order.execute',
  [BACKFILL_ACTION]: APPROVE_BACKFILL,
};

function stopPreviewReview(task, reason, invalidate = false) {
  task.reviewRequired = true;
  if (invalidate && task.state === 'AWAITING_CONFIRM') task.transition('EXPIRED');
  return { task, reply: reason };
}

async function resumePreview(client, actor, task) {
  const { graph, preview } = task;
  const permission = graph === BACKFILL_ACTION && task.intent?.action === 'apply' ? APPLY_BACKFILL : PREVIEW_WRITE_PERMISSIONS[graph];
  if (!permission || !preview) return stopPreviewReview(task, '缺少可核对的原预览，请打开原记录查看。', true);
  if (!hasPerm(actor, permission)) {
    const detail = task.handoffOrderNo ? '。原预览已失效。' : '。原预览尚未确认。';
    return stopPreviewReview(task, denialReply(actor, new PermissionDeniedError(permission, graph)) + detail, Boolean(task.handoffOrderNo));
  }
  const expired = task.state === 'EXPIRED' || task.previewExpired();
  const originalReceipt = graph === 'D-settle' ? `收款单 ${preview.receiptNo} 已登记，请到收付款页核对原单及剩余可核销额。` : null;
  if (expired && !['B-sale-draft', 'B2-reserve', REFUND_EXECUTE].includes(graph) && !(graph === 'D-settle' && preview._explicit)) {
    return stopPreviewReview(task, '原预览已过期或失效。' + (originalReceipt || '请核对原单与最新业务状态，再发起试算。'), true);
  }

  try {
    switch (graph) {
      case 'B-sale-draft': {
        const fresh = await salePreviewFacts(client, task, actor);
        if (Number(fresh.customer.id) !== Number(preview.customer.id) || fresh.warehouseId !== preview.warehouseId) {
          return stopPreviewReview(task, '原客户或原仓库无法核对，草稿未提交。', true);
        }
        if (task.intent?.stockCondition && !matchesStockCondition(fresh, task.intent.stockCondition)) {
          return stopPreviewReview(task, '原仓的可用量或商品单位已不满足开单条件。请重新查库，草稿未提交。', true);
        }
        const diffs = diffPreview(preview, fresh);
        fresh.warehouseName = await warehouseName(client, preview.warehouseId);
        if (!fresh.warehouseName) return stopPreviewReview(task, '原仓库当前无法核对，草稿未提交。', true);
        if (expired || diffs.length || fresh.customer.name !== preview.customer.name || fresh.customer.creditLimit !== preview.customer.creditLimit
            || fresh.warehouseName !== preview.warehouseName || fresh.lines.some((line, i) => line.productName !== preview.lines[i]?.productName)) {
          if (task.state === 'AWAITING_CONFIRM') task.transition('EXPIRED');
          task.transition('DRY_RUNNING');
          fresh.payload = salePayload(fresh);
          task.setPreview(fresh);
          task.transition('AWAITING_CONFIRM');
        }
        break;
      }
      case 'B2-reserve': return await resumeReserve(client, actor, task);
      case 'C-purchase-draft':
        if (purchaseSignature(await buildPurchasePreview(client, actor)) !== purchaseSignature(preview)) {
          return stopPreviewReview(task, '原采购草稿的供应商、仓库、补货量或价格已变化。请核对后重新试算。', true);
        }
        break;
      case 'D-receipt': {
        assertReceiptPreviewAmount(preview, task.userText);
        const { records, accounts } = await receiptPreviewFacts(client, preview);
        const current = new Map(accounts.map(account => [Number(account.id), account.name]));
        const unchanged = preview.needsAccountChoice
          ? current.size === preview.accounts.length && preview.accounts.every(account => current.get(account.id) === account.name)
            && JSON.stringify(records.map(row => [row.recordId, row.balanceCents])) === JSON.stringify(preview.sigRecs)
          : Boolean(preview.account) && current.get(preview.account.id) === preview.account.name
            && receiptSignature(records, preview.amountCents, preview.account.id) === preview.signature;
        if (!unchanged) return stopPreviewReview(task, '原收款的未结余额或入账账户已变化，请核对后重新试算。尚未登记。', true);
        break;
      }
      case 'D-settle': {
        if (preview._explicit) return await resumeExplicitSettlement(client, task);
        const { changed, usable } = await settlePreviewFacts(client, preview);
        if (changed || !usable) return stopPreviewReview(task, '原收款单或账款余额已变化。' + originalReceipt, true);
        break;
      }
      case BACKFILL_ACTION:
        if (!await refreshBackfill(client, task)) return stopPreviewReview(task, '原退款或补录审批阶段已变化，请重新核对原单。', true);
        break;
      case REFUND_EXECUTE: return await resumeRefund(client, task);
    }
  } catch (error) {
    const invalid = error.status >= 400 && error.status < 500 || (graph === 'B-sale-draft' && error.code && !error.status);
    return stopPreviewReview(task, invalid
      ? '原预览当前无法通过核对。' + (originalReceipt || '请核对原单、商品规则或权限后再继续。')
      : '暂时无法复核原预览。请稍后继续原任务。', Boolean(invalid));
  }
  task.reviewRequired = false;
  task.requirePreviewRevision = true;
  const label = task.preview?.customer?.name ?? task.preview?.orderNo ?? '原任务';
  const next = task.preview !== preview ? '已用原客户、商品和仓库重新试算' : '已按当前资料复核';
  return { task, preview: task.preview, reply: `${label}。${next}，当前为第 ${task.revision} 版，仍待确认。`
    + (task.preview?.needsAccountChoice ? '请先选择入账账户。' : '请核对预览后，在卡片上点击确认。') };
}

async function resumeFromContext(store, client, actor, task) {
  assertTaskAccess(task, actor, store);
  if (task.graph === SALE_HANDOFF_GRAPH) {
    return graphSaleHandoff(store, client, actor, task.userText, { action: 'read', resumeFocus: task.intent?.focusBatchId }, task);
  }
  if (task.graph === SEQUENCE_GRAPH) return runSequence(store, client, actor, task);
  if (task.stockSale?.draftId && task.state === 'DONE') {
    const draft = store.get(task.stockSale.draftId);
    if (draft?.graph !== 'B-sale-draft') throw Object.assign(new Error('原条件草稿暂时无法核对，请从最近记录打开。'), { status: 409 });
    return store.exclusive(draft.id, () => resumeFromContext(store, client, actor, draft));
  }
  if (task.stockSale && task.state === 'PAUSED') {
    const out = await graphInventory(store, client, actor, task.stockSale.query, task.intent?.productKeyword,
      { task, warehouseKeyword: task.intent?.warehouseKeyword });
    return finishStockSale(store, client, actor, out);
  }
  if (task.stockSale?.pendingProductCheck && task.state === 'DONE') {
    return finishStockSale(store, client, actor, { task, reply: task.reply.split('\n未能核实商品')[0], result: task.result });
  }
  if (RECOVERY_STATES.has(task.state) && Object.hasOwn(PREVIEW_WRITE_PERMISSIONS, task.graph)) {
    const out = await recoverTask(store, client, task, actor);
    if (task.graph === 'D-receipt' && out.task?.graph === 'D-settle') {
      return store.exclusive(out.task.id, async () => {
        const checked = await resumeFromContext(store, client, actor, out.task);
        return { ...checked, reply: `已按原回执核对收款单 ${task.result.receiptNo}。\n${checked.reply}` };
      });
    }
    return out;
  }
  if (task.state === 'DONE' && task.graph === 'D-receipt' && task.result?.stage2TaskId) {
    const next = store.get(task.result.stage2TaskId);
    if (next?.graph !== 'D-settle' || Number(next.preview?.receiptId) !== Number(task.result.receiptId)) {
      return { task, result: task.result, reply: '原收款已登记，暂时无法核对关联的核销任务，请到收付款页核对原单。' };
    }
    return store.exclusive(next.id, () => resumeFromContext(store, client, actor, next));
  }
  if (task.state === 'AWAITING_CONFIRM' || task.state === 'EXPIRED') return resumePreview(client, actor, task);
  if (task.state === 'DISAMBIGUATING') return { task, reply: task.reply || '请补齐原任务需要的信息。', candidates: task.candidates };
  if (task.state === 'DONE' && task.graph === 'D-settle' && task.preview?.receiptId) return reviewCompletedSettlement(store, client, task, actor);
  if (task.state === 'DONE' && task.graph === 'B2-reserve' && task.result?.orderNo) return reviewCompletedReserve(client, actor, task);
  if (task.state === 'DONE' && task.graph === 'B-sale-draft' && task.result?.orderNo) {
    const id = Number(task.result.orderId ?? task.preview?.orderId);
    if (Number.isSafeInteger(id) && id > 0) {
      const order = await client.get(`/api/sale/${id}`).catch(() => null);
      if (Number(order?.id) !== id || order.orderNo !== task.result.orderNo) {
        return { task: null, detachTask: true, reply: '暂时无法复核原销售单，请从原记录稍后查询。原任务已办理，请勿重复提交。' };
      }
      const status = order.statusName ?? order.status;
      return { task, preserveTask: true, result: task.result,
        reply: `原销售单 ${order.orderNo} 已核对${status == null ? '' : `，当前状态 ${status}`}。原任务已办理。` };
    }
  }
  return { task, reply: task.reply || '原任务暂无可继续的步骤。', result: task.result };
}

const refusal = (text) => ({ task: null, reply: guideReply(text) });

// ---------- 结构化意图执行（LLM 解析后的唯一入口） ----------
async function executeIntent(store, client, actor, text, intent, task) {
  switch (intent.graph) {
    case 'A-inventory': {
      const out = await graphInventory(store, client, actor, task?.stockSale?.query ?? text, intent.productKeyword,
        { warehouseKeyword: intent.warehouseKeyword, warehouseOverride: task?.intent?.warehouseOverride, task });
      return finishStockSale(store, client, actor, out);
    }
    case 'B-sale-draft': return graphSaleDraft(store, client, actor, text, { customerKeyword: intent.customerKeyword, lines: intent.lines, task });
    case 'D-ledger': return graphLedger(store, client, actor, text, intent.customerKeyword, task);
    case 'D-receipt': return graphReceipt(store, client, actor, text, { customerKeyword: intent.customerKeyword, amountCents: intent.amountCents ?? null, task });
    case 'C-replenishment': return graphReplenishment(store, client, actor, text);
    case 'C-purchase-draft': return graphPurchaseDraft(store, client, actor, text);
    case 'B2-reserve': return graphReserve(store, client, actor, text);
    case 'E-stuck': return stuckGraph(store, client, actor, text);
    case 'F-briefing': return briefingGraph(store, client, actor, text);
    default: return refusal(text);
  }
}

async function handleForwardedMessage(store, client, actor, source, opts) {
  if (opts.choiceId != null) throw Object.assign(new Error('请在原候选列表中本人选择；转发不能用于选择。'), { status: 400 });
  const ask = { task: null, reply: '这段内容按转发引用处理，未确认或改动任务。请用自己的话说要查什么，或在引用外写「我的要求」。写入仍须本人核对后点击确认。' };
  if (!source.instruction) return ask;
  const { text } = operatorInput(source.instruction);
  if (forwardedMessage(text)) return ask;
  const route = classifyMessage(text);
  if (route.kind === 'blocked') return { task: null, reply: route.reply };
  if (prepareForwardedSale(text)) {
    return rememberOutput(store, await graphSaleDraft(store, client, actor, text, forwardedSaleFields(source.quoted)));
  }
  if (Object.hasOwn(READ_STEPS, route.graph ?? '') || route.kind === 'ordered-read' || route.handoff?.action === 'read') {
    return handleMessage(store, client, actor, source.instruction, { preferInventoryRule: true, parseIntent: async () => null });
  }
  return ask;
}

function openReference(task, ref) {
  const customer = customerReference(task)?.name;
  const preview = task.state === 'AWAITING_CONFIRM' && !task.previewExpired() ? task.preview : undefined;
  if (ref.kind === 'original' && preview && task.revision > 1) {
    return { task: null, detachTask: true, keepReferences: true, reply: `原任务有过更正。你要沿用第 ${task.revision} 版，还是要改哪项？请先打开原记录核对。` };
  }
  if (task.graph === 'B-sale-draft' && task.state === 'DISAMBIGUATING' && /状态|进度|单号/.test(ref.tail ?? '')) {
    return { task: null, reply: '这份草稿仍在补信息。' + referenceQuestion('order') };
  }
  const orderNo = taskDocumentNo(task);
  const object = orderNo ? `单据 ${orderNo}` : customer ? `${customer}的任务` : '原任务';
  const reply = preview ? `${object}第 ${task.revision} 版仍待确认。请核对当前卡片后本人点击确认。`
    : `已回到${object}。${task.reply || '请核对原记录。'}`;
  return { task, preview, reply, preserveTask: true };
}

function unavailableReference(kind) {
  return { task: null, detachTask: true, reply: '当前无法核对所指记录的权限或仓库范围。' + referenceQuestion(kind) };
}

async function readReferencedStock(store, client, actor, text, task, index) {
  const warehouses = task.result?.warehouses ?? [];
  if (index == null && warehouses.length > 1) {
    return { task, preserveTask: true, reply: '原记录有多个仓库。请说第几个仓库，或回复「仓库是」加完整仓名，我会沿用原商品。' };
  }
  const warehouseId = Number(index == null ? task.result?.warehouseId : warehouses[index]?.warehouseId);
  const productId = Number(task.result?.productId);
  if (!Number.isSafeInteger(warehouseId) || warehouseId <= 0 || !Number.isSafeInteger(productId) || productId <= 0) {
    return { task: null, reply: referenceQuestion('stock') };
  }
  return graphInventory(store, client, actor, text, undefined, { stockTarget: { warehouseId, productId } });
}

async function handleReference(store, client, actor, text, ref, opts) {
  const { taskId, previousTaskId, referenceTaskId } = opts;
  if (ref.kind === 'ordinal') {
    const subject = ref.subject;
    const question = { task: null, reply: subject === '仓库' || subject === '仓' ? referenceQuestion('stock')
      : subject === '单' || subject === '单据' ? referenceQuestion('order') : '请打开对应的候选列表，说明「第二个」指哪一项。' };
    if (!taskId) return question;
    return store.exclusive(taskId, async () => {
      const task = store.get(taskId);
      if (!task || !ownsTask(task, actor) || task.sequenceOwner || task.state === 'FAILED_FINAL') return question;
      assertTaskAccess(task, actor, store);
      if ((subject === '仓库' || subject === '仓') && referenceMatches(task, { kind: 'stock' })) {
        if (!Number.isSafeInteger(ref.index) || ref.index < 0) return question;
        return readReferencedStock(store, client, actor, text, task, ref.index);
      }
      const key = candidateKey(task, store);
      if (!subject && !key && task.graph === 'A-inventory' && task.result?.warehouses?.length > 1) {
        return { task: null, reply: '你指的是库存结果里的第二个仓库吗？请说「第二个仓库」或给出完整仓名。' };
      }
      if (!key || ['单', '单据', '仓', '仓库'].includes(subject)) return question;
      if (opts.candidateKey !== key) return { task: null, reply: '候选列表已变化或未核对，请重新打开这条记录查看最新候选。' };
      const selected = task.candidates[ref.index];
      if (!selected || (subject === '客户' && selected.type !== 'customer') || (subject === '商品' && selected.type !== 'product')) {
        return { task: null, reply: '当前候选没有这个序号或类型，请按原候选列表选择。' };
      }
      return continueTask(store, client, actor, text, { ...opts, choiceId: selected.id });
    });
  }

  const current = taskId ?? referenceTaskId;
  const ids = ref.anchor === 'previous' ? [previousTaskId] : ref.anchor === 'current' ? [current] : [current, previousTaskId];
  const matches = [];
  for (const id of new Set(ids.filter(Boolean))) {
    const task = store.get(id);
    if (!task || !ownsTask(task, actor) || task.sequenceOwner) return unavailableReference(ref.kind);
    try { assertTaskAccess(task, actor, store); }
    catch (error) { if (error.status === 403) return unavailableReference(ref.kind); throw error; }
    if (referenceMatches(task, ref)) matches.push(task);
  }
  if (matches.length !== 1) return { task: null, detachTask: true, keepReferences: matches.length > 1, reply: referenceQuestion(ref.kind) };
  const [source] = matches;
  return store.exclusive(source.id, async () => {
    const task = store.get(source.id);
    try { assertTaskAccess(task, actor, store); }
    catch (error) { if (error.status === 403 || error.status === 404) return unavailableReference(ref.kind); throw error; }
    if (!referenceMatches(task, ref)) return unavailableReference(ref.kind);
    if (ref.kind === 'customer') {
      const customer = customerReference(task);
      if (ref.ledger) return graphLedger(store, client, actor, text, undefined, undefined, customer);
      return { task: null, detachTask: true, keepReferences: true, reply: `对应的客户是「${customer.name}」。你想查客户应收，还是准备销售草稿？` };
    }
    if (ref.kind === 'stock') return readReferencedStock(store, client, actor, text, task);
    if (ref.action && task.graph === 'B-sale-draft') {
      const correction = saleCorrection(ref.action);
      if (correction?.kind === 'quantity') {
        if (task.state === 'DISAMBIGUATING' && task.intent?.lines) return correctSaleIntake(store, client, actor, task, text, correction);
        return reviseSalePreview(store, client, actor, task, correction);
      }
    }
    if (task.graph === SALE_HANDOFF_GRAPH || (task.state === 'DONE' && ['B2-reserve', 'D-settle'].includes(task.graph))
      || (ref.resume && ref.kind === 'order')) return resumeFromContext(store, client, actor, task);
    return openReference(task, ref);
  });
}

// ---------- 主入口：LLM 意图解析（已配置模型时）→ 回退规则规划器 ----------
// opts.parseIntent 可注入（测试用）；默认 parseIntentLLM，未配置模型时自动跳过。
export async function handleMessage(store, client, actor, text, opts = {}) {
  const input = operatorInput(text);
  const forwarded = forwardedMessage(text) ?? forwardedMessage(input.text);
  if (forwarded) return handleForwardedMessage(store, client, actor, forwarded, opts);
  text = input.text;
  const t = activeTopicText(text);
  const routing = classifyMessage(text);
  if (routing.kind === 'blocked' && routing.guarded) return { task: null, reply: routing.reply };
  const startsNewTopic = t !== String(text).trim();
  if (startsNewTopic && opts.choiceId != null) throw Object.assign(new Error('换话题后请在新任务中选择候选'), { status: 400 });
  let selected = !startsNewTopic && opts.taskId ? store.get(opts.taskId) : null;
  let detached = false;
  if (selected) {
    if (!ownsTask(selected, actor)) throw Object.assign(new Error('只能查看或处理本人发起的任务'), { status: 403 });
    try { assertTaskAccess(selected, actor, store); }
    catch (error) {
      if (error.status !== 403 || opts.choiceId != null) throw error;
      selected = null;
      detached = true;
    }
  }
  const result = await routeSelectedMessage(store, client, actor, opts, { input, t, routing, startsNewTopic, selected, detached });
  return detached && result.task === null ? { ...result, detachTask: true } : result;
}

async function routeSelectedMessage(store, client, actor, opts, { input, t, routing, startsNewTopic, selected, detached }) {
  const text = input.text;
  const review = selected?.batchReview;
  const taskNo = selected?.intent?.orderNo ?? selected?.intent?.receiptNo ?? selected?.preview?.orderNo ?? selected?.preview?.receiptNo;
  const groupOrderNo = review?.reassignmentGroup ? taskNo?.toUpperCase() : undefined;
  const batch = opts.choiceId == null && !routing.explicitOutside
    && batchFollowup(t, { selectingReceipt: review?.selectionRequired, groupOrderNo });
  if (batch) {
    const saleTask = [SALE_HANDOFF_GRAPH, 'B2-reserve'].includes(selected?.graph);
    const receiptTask = selected?.graph === 'J-receipt-status'
      || selected?.graph === 'D-settle' && selected.preview?._explicit && !selected.preview._monthly;
    const domain = batch.domain ?? (!batch.no || batch.no === taskNo?.toUpperCase() ? saleTask ? 'sale' : receiptTask ? 'receipt' : null : null);
    if (!domain) return { task: null, reply: '请给出原销售单或原收款单的完整单号，我会核对要补办的批次。' };
    const useContext = (domain === 'sale' && saleTask) || (domain === 'receipt' && receiptTask);
    const boundNo = useContext ? taskNo : undefined;
    const current = useContext && (!batch.no || batch.no === boundNo?.toUpperCase()) ? selected : null;
    if (current) assertTaskAccess(current, actor, store);
    const no = batch.no ?? boundNo;
    const lastReview = current?.batchReview?.last;
    const reassignmentGroup = current?.batchReview?.reassignmentGroup;
    const focus = current?.intent?.focusBatchId ?? current?.preview?._releaseEventId ?? current?.preview?._reversalSource?.id;
    const ambiguous = current?.batchReview?.selectionRequired;
    const stillPointsToClaim = lastReview?.state === 'pending'
      && (focus == null || focus === lastReview.from?.id || focus === lastReview.claim?.batchId);
    const useGroup = !batch.correction && reassignmentGroup
      && (batch.mode === 'ready' || reassignmentGroup.selectedMovementId == null);
    const followup = useGroup ? { ...batch, correction: true, partialCorrection: true, groupedReassignment: true,
      followCorrection: true, requireGroupFocus: batch.mode === 'recent' }
      : !batch.correction && (ambiguous || stillPointsToClaim)
        && (batch.mode === 'recent' || batch.mode === 'remaining' && (focus != null || ambiguous))
      ? { ...batch, correction: true, movementId: ambiguous ? undefined : lastReview.movementId } : batch;
    if (domain === 'sale') {
      const anchor = batch.mode !== 'ready' && current?.graph === 'B2-reserve' ? current.preview?._releaseEventId : undefined;
      const task = current?.graph === SALE_HANDOFF_GRAPH ? current : null;
      const request = { ...followup, action: batch.mode === 'read' ? 'read' : 'reserve', no,
        relativeBatch: batch.mode === 'read' ? undefined : batch.mode, reapply: batch.mode !== 'read',
        expectedReleaseId: anchor, priorReview: current?.batchReview,
        orderId: current?.preview?.orderId ?? task?.intent?.orderId };
      const run = () => graphSaleHandoff(store, client, actor, t, request, task);
      return rememberOutput(store, await (task ? store.exclusive(task.id, run) : run()));
    }
    return rememberOutput(store, await graphReceiptAllocation(store, client, actor, t,
      { ...followup, action: batch.mode === 'read' ? 'read' : 'prepare', no,
        relativeBatch: batch.mode === 'read' ? undefined : batch.mode, reapply: batch.mode !== 'read' }, current));
  }
  const crossContext = [CROSS_PERIOD, BACKFILL_ACTION].includes(selected?.graph) ? selected : null;
  const cross = opts.choiceId == null && !routing.explicitOutside && !routing.compound ? crossPeriodRequest(t, crossContext) : null;
  if (cross) {
    if (selected && !ownsTask(selected, actor)) throw Object.assign(new Error('只能查看或处理本人发起的任务'), { status: 403 });
    if (crossContext) assertTaskAccess(crossContext, actor, store);
    const execute = () => runCrossPeriod(store, client, actor, t, cross, crossContext, id => resumeTask(store, client, id, actor));
    return rememberOutput(store, await (crossContext?.state === 'DISAMBIGUATING' ? store.exclusive(crossContext.id, execute) : execute()));
  }
  const returnContext = [RETURN_FINANCE, REFUND_EXECUTE].includes(selected?.graph) ? selected : null;
  const returning = opts.choiceId == null && !routing.explicitOutside ? returnFinanceRequest(t, Boolean(returnContext)) : null;
  if (returning && !routing.compound) {
    if (selected && !ownsTask(selected, actor)) throw Object.assign(new Error('只能查看或处理本人发起的任务'), { status: 403 });
    return rememberOutput(store, await graphReturnFinance(store, client, actor, t, returning, returnContext));
  }
  const monthlyContext = selected?.graph === MONTHLY_GRAPH || selected?.graph === 'D-settle' && selected.preview?._monthly ? selected : null;
  const monthly = opts.choiceId == null && !routing.explicitOutside ? monthlyRequest(t, Boolean(monthlyContext)) : null;
  if (monthly && !routing.compound) {
    if (selected && !ownsTask(selected, actor)) throw Object.assign(new Error('只能查看或处理本人发起的任务'), { status: 403 });
    return rememberOutput(store, await graphMonthlyReconciliation(store, client, actor, t, monthly, monthlyContext));
  }
  const receiptContext = selected && ownsTask(selected, actor) && (selected.graph === 'J-receipt-status'
    || (selected.graph === 'D-settle' && selected.preview?._explicit && !selected.preview?._monthly)) ? selected : null;
  const choosingReversal = receiptContext?.state === 'DISAMBIGUATING' && Boolean(receiptContext.intent?.reapply || receiptContext.intent?.reapplyTaskId);
  const request = opts.choiceId == null && !routing.explicitOutside ? receiptAllocationRequest(t, Boolean(receiptContext), choosingReversal) : null;
  const saleContext = selected?.graph === SALE_HANDOFF_GRAPH && selected.intent?.trace && saleTraceRequest(t, true)?.trace.targetNo;
  if (request && !saleContext && !routing.compound && (routing.kind !== 'sale-handoff' || receiptContext || request.action === 'prepare')) {
    if (selected && !ownsTask(selected, actor)) throw Object.assign(new Error('只能查看或处理本人发起的任务'), { status: 403 });
    return rememberOutput(store, await graphReceiptAllocation(store, client, actor, t, request, receiptContext));
  }
  const history = opts.choiceId == null && !startsNewTopic && !routing.explicitOutside
    && historicalRequest(t, opts.historyLookup, opts.historyQuery);
  const searchingHandoff = history?.qualified && isHandoffHistory(history);
  if (!searchingHandoff && opts.choiceId == null && selected && ownsTask(selected, actor) && !routing.explicitOutside) {
    const pendingRelease = selected.graph === SALE_HANDOFF_GRAPH && selected.state === 'DISAMBIGUATING' && selected.intent?.releaseQuestion;
    const handoff = (pendingRelease && releaseSupplementAnswer(t, pendingRelease))
      || (saleTraceRequest(t, selected.graph === SALE_HANDOFF_GRAPH && Boolean(selected.intent?.trace)) ?? handoffRequest(t, true));
    if (handoff && !handoff.no && !handoff.multiple && opts.previousTaskId && previousOrderMention.test(t)
      && (selected.graph === SALE_HANDOFF_GRAPH || (handoff.action === 'read' && ['B-sale-draft', 'B2-reserve'].includes(selected.graph)))) {
      return rememberOutput(store, await graphSaleHandoff(store, client, actor, t, {
        multiple: true, question: '你是指当前这张还是上一张单？' + HANDOFF_NUMBER_REQUIRED,
      }));
    }
    if (handoff && selected.graph === SALE_HANDOFF_GRAPH
      && (routing.kind !== 'blocked' || handoff.action === 'guide' || (handoff.trace && handoff.action === 'read'))) {
      return store.exclusive(selected.id, async () => {
        const sameOrder = handoff.no && handoff.no === selected.intent?.orderNo;
        const reuseContext = (!handoff.no && !handoff.multiple) || (selected.state === 'DISAMBIGUATING' && (sameOrder || !selected.intent?.orderNo));
        const currentTrace = selected.intent?.trace && /^(?:重查|重新核对|再查)原单/.test(t) ? {} : handoff.trace;
        return rememberOutput(store, await graphSaleHandoff(store, client, actor, t,
          { ...handoff, trace: currentTrace, ...(sameOrder ? { orderId: selected.intent.orderId } : {}) }, reuseContext ? selected : undefined));
      });
    }
    const originalReserveNo = selected.graph === 'B2-reserve' && selected.preview?.orderNo;
    if (['reserve', 'recover'].includes(handoff?.action) && originalReserveNo && (!handoff.no || handoff.no === originalReserveNo)) {
      if (!handoff.otherOperator && !handoff.financeFocus && (RECOVERY_STATES.has(selected.state) || selected.state === 'DONE' && !handoff.reapply)) {
        return resumeTask(store, client, selected.id, actor);
      }
      if (!handoff.checkOnly && !handoff.reapply && !handoff.financeFocus && (handoff.action === 'recover' || !selected.handoffOrderNo)) {
        return resumeTask(store, client, selected.id, actor);
      }
      return rememberOutput(store, await graphSaleHandoff(store, client, actor, t, {
        ...handoff, no: originalReserveNo, orderId: Number(selected.preview?.orderId),
      }));
    }
    if (handoff?.action === 'read' && !handoff.no && ['B-sale-draft', 'B2-reserve'].includes(selected.graph)) {
      const no = taskDocumentNo(selected);
      if (typeof no === 'string' && no) {
        return store.exclusive(selected.id, async () => {
          assertTaskAccess(selected, actor, store);
          const rawId = selected.preview?.orderId ?? selected.result?.orderId;
          return rememberOutput(store, await graphSaleHandoff(store, client, actor, t, {
            ...handoff, no: no.toUpperCase(), ...(rawId ? { orderId: Number(rawId) } : {}),
          }));
        });
      }
    }
  }
  if (routing.kind === 'blocked') return { task: null, reply: routing.reply };
  if (history && (!opts.taskId || detached || history.qualified)) {
    const match = findHistoricalTask(store, actor, history);
    if (match.choices.length === 1 && !match.restricted) return resumeTask(store, client, match.choices[0].id, actor);
    if (isHandoffHistory(history) && history.no && !history.unresolved && !match.choices.length) {
      return rememberOutput(store, await graphSaleHandoff(store, client, actor, t, { action: 'read', no: history.no }));
    }
    return { task: null, detachTask: true, historyLookup: true, historyQuery: history.historyQuery || t, reply: historicalQuestion(match, history) };
  }
  const reference = opts.choiceId == null && !routing.explicitOutside && routing.kind !== 'operational-read' && referenceRequest(t);
  if (reference) {
    const context = startsNewTopic ? {} : { ...opts, taskId: selected?.id };
    return rememberOutput(store, await handleReference(store, client, actor, t, reference, context));
  }
  const operation = async () => {
    const out = rememberOutput(store, await handleMessageUnlocked(store, client, actor, text, { ...opts, taskId: detached ? undefined : opts.taskId, preferInventoryRule: opts.preferInventoryRule || input.normalized }));
    return startsNewTopic && !out.task ? { ...out, detachTask: true } : out;
  };
  if (opts.taskId) return store.exclusive(opts.taskId, operation);
  if (resumesOriginal(t) || ['defer-write', 'stock-before-sale', 'ordered-read', 'operational-read', 'sale-handoff', 'clarify'].includes(routing.kind) || smallTalkReply(t)) return operation();
  const accountTargets = t === String(text).trim() ? accountSelectionTargets(store, actor, t) : [];
  if (accountTargets.length > 1) return { task: null, reply: ACCOUNT_TASK_REQUIRED };
  const [accountTask] = accountTargets;
  if (accountTask) return store.exclusive(accountTask.id, async () => rememberOutput(store, await tryAccountSelection(store, actor, t, client, accountTask)));
  return operation();
}

async function continueTask(store, client, actor, text, opts) {
  const task = store.get(opts.taskId);
  if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
  if (!ownsTask(task, actor)) throw Object.assign(new Error('只能查看或处理本人发起的任务'), { status: 403 });
  const route = classifyMessage(text);
  if (opts.choiceId != null && opts.candidateKey && opts.candidateKey !== candidateKey(task, store)) {
    throw Object.assign(new Error('候选列表已变化，请重新打开这条记录查看最新候选。'), { status: 409 });
  }
  const fresh = () => handleMessageUnlocked(store, client, actor, text, { ...opts, taskId: undefined });
  if (opts.choiceId == null && (opts.startsNewTopic || route.explicitOutside
      || ['defer-write', 'stock-before-sale', 'ordered-read', 'operational-read', 'sale-handoff', 'discussion'].includes(route.kind) || smallTalkReply(text))) return fresh();

  if (opts.choiceId == null && resumesOriginal(text)) return resumeFromContext(store, client, actor, task);
  if (opts.choiceId == null && task.graph === 'A-inventory' && task.state === 'DONE' && task.result?.warehouses?.length > 1) {
    const warehouse = /^仓库(?:是|为|[：:])\s*(.{1,40})$/.exec(text.replace(/[。！!]+$/, ''))?.[1]?.trim();
    if (warehouse) {
      assertTaskAccess(task, actor, store);
      const index = task.result.warehouses.findIndex(row => row.warehouseName === warehouse);
      return readReferencedStock(store, client, actor, text, task, index);
    }
  }
  if (task.graph === SEQUENCE_GRAPH && task.state === 'PAUSED') {
    const activeStep = task.sequence.steps.find(step => !step.completedId);
    const child = activeStep?.activeId && store.get(activeStep.activeId);
    const product = child?.graph === 'A-inventory' && child.intent?.intake && !route.graph ? productReply(text) : null;
    if (product || opts.choiceId != null) {
      assertTaskAccess(task, actor, store);
      if (opts.choiceId != null && !child?.candidates?.length) throw Object.assign(new Error('请从暂停步骤的原候选中选择'), { status: 400 });
      return runSequence(store, client, actor, task, { product, text, choiceId: opts.choiceId });
    }
  }
  let correction = saleCorrection(text);
  const busy = ['EXECUTING', 'RESULT_UNKNOWN', 'CONFIRMED', 'VERIFYING', 'ESCALATED'].includes(task.state);
  if (busy && (opts.choiceId != null || correction || /开单|草稿|占库|核销|收款|到账|重新试算|重试|重新建|重新生成/.test(text))) {
    throw Object.assign(new Error('此任务正在执行或结果尚未核实，请查询原任务，不能修改或另换请求键'), { status: 409 });
  }
  if (opts.choiceId == null && route.graph === 'B-sale-draft' && intakeSale(text).explicit &&
      !(task.graph === 'B-sale-draft' && task.state === 'DISAMBIGUATING' &&
        task.intent?.intake && !task.intent.customerKeyword)) return fresh();
  const accountReply = task.graph === 'D-receipt' && task.state === 'AWAITING_CONFIRM' && task.preview?.needsAccountChoice
    && (opts.choiceId != null || isAccountReply(text, task, route));
  if (accountReply) return tryAccountSelection(store, actor, text, client, task, opts.choiceId);
  if (opts.choiceId == null && correction) {
    if (task.graph !== 'B-sale-draft') return fresh();
    assertTaskAccess(task, actor, store);
    if (correction.kind === 'reference') {
      correction = resolveSaleCorrection(task, correction);
      if (!correction) return { task, preview: task.preview, reply: '请明确是要改客户、商品还是数量。原草稿已保留。' };
    }
    if (correction.kind === 'product' && task.intent?.stockCondition) return {
      task, preview: task.preview, reply: '这张草稿绑定原查库商品。请先用新商品重新查库，原草稿未更改。',
    };
    if (task.state === 'DISAMBIGUATING' && task.intent?.lines) return correctSaleIntake(store, client, actor, task, text, correction);
    if (correction.kind === 'quantity') return reviseSalePreview(store, client, actor, task, correction);
    return replaceSalePreviewInput(store, client, actor, task, text, correction);
  }
  if (opts.choiceId == null && route.kind === 'clarify') return fresh();
  if (opts.choiceId == null && /^(?:(?:小满|帮我|请|麻烦)[，,:：\s]*)*(?:查|看看|看一下|核对)/.test(text)) return fresh();
  if (opts.choiceId == null && task.state === 'DISAMBIGUATING' && task.intent?.intake && !task.candidates?.length) {
    const nextGraph = route.graph ?? ruleGraphFor(text);
    if (task.graph === 'B-sale-draft' && (!nextGraph || nextGraph === 'B-sale-draft')) {
      if (task.saleDraftReselected || task.salePreviewRevised) assertTaskAccess(task, actor, store);
      return graphSaleDraft(store, client, actor, text, { task });
    }
    if (task.graph === 'A-inventory' && !nextGraph) {
      if (task.intent.needsWarehouse) {
        const warehouse = /^(?:仓库(?:是|为|[：:])\s*(.{1,40})|([^\s，,。]{1,30}[仓倉](?:库|庫)?))$/.exec(text.replace(/[。！!]+$/, ''));
        if (!warehouse) return { task, reply: task.reply };
        assertTaskAccess(task, actor, store);
        return graphInventory(store, client, actor, task.userText, task.intent.productKeyword, { task, warehouseOverride: warehouse[1] ?? warehouse[2] });
      }
      const product = productReply(text);
      if (product) {
        assertTaskAccess(task, actor, store);
        const out = await graphInventory(store, client, actor, task.stockSale?.query ?? task.userText, product,
          { task, warehouseKeyword: task.intent.warehouseKeyword, warehouseOverride: task.intent.warehouseOverride });
        return finishStockSale(store, client, actor, out);
      }
    }
  }
  if (opts.choiceId != null) {
    assertTaskAccess(task, actor, store);
    if (task.state !== 'DISAMBIGUATING' || !task.selection || !task.candidates?.some(c => String(c.id) === String(opts.choiceId))) throw Object.assign(new Error('请选择本任务原候选列表中的对象'), { status: 400 });
    const { keyword, type, slot } = task.selection;
    const latest = await lookupEntity(client, keyword, type, actor);
    const { hits: current } = await scopeHits(client, actor, latest.hits, type, latest.alternative);
    if (!current.some(c => String(c.id) === String(opts.choiceId))) throw Object.assign(new Error('该候选当前已不可见，请重新发起查询'), { status: 409 });
    task.selections = { ...task.selections, [slot]: opts.choiceId };
    return executeIntent(store, client, actor, task.userText, task.intent, task);
  }
  if (task.state === 'DISAMBIGUATING' && /^(?:选|第)?[\d一二两三四五六七八九十]+(?:个|项|号)?[。！!]?$/u.test(text)) {
    assertTaskAccess(task, actor, store); return { task, reply: task.reply || task.error, candidates: task.candidates };
  }
  // taskId 是当前选中记录的上下文，不把它视为“所有后续消息都修改此任务”。新问题只送新文本。
  return handleMessageUnlocked(store, client, actor, text, { ...opts, taskId: undefined });
}

function productReply(text) {
  const product = text.trim().replace(/^(?:商品(?:名|名称|编号)?(?:是|叫|为|[：:])|看|要查)\s*/, '').replace(/[。！!]+$/, '').trim();
  return /^[\p{L}][\p{L}\p{N} ()（）+&./_·-]{0,79}$/u.test(product)
    && !/^(?:我|你|这|那|先|暂|等|算了|不|刚才|上次)|吗$|呢$|吧$/.test(product) ? product : null;
}

function saleLineIndex(target, lines) {
  const number = /第\s*([\d零一二两三四五六七八九十百]+)\s*行/.exec(target)?.[1];
  if (number) {
    const index = quantityNumber(number) - 1;
    return Number.isSafeInteger(index) && index >= 0 && index < lines.length ? index : -1;
  }
  const matches = lines.flatMap((line, i) => target.includes(line.productName || line.productKeyword) ? [i] : []);
  if (matches.length === 1) return matches[0];
  const currentOnly = /^(?:把|刚才|之前|原来|这(?:张|单|张单)|的|数量|\s)*$/.test(target);
  return lines.length === 1 && currentOnly ? 0 : -1;
}

function resolveSaleCorrection(task, { previous, next, lines }) {
  const names = [task.preview?.customer?.name, task.intent?.customerKeyword].filter(Boolean);
  const rows = task.preview?.lines ?? task.intent?.lines ?? [];
  const sameName = name => Boolean(name && (name === previous || (previous.length >= 2 && name.includes(previous))));
  const customer = names.some(sameName);
  const products = rows.flatMap((row, i) => sameName(row.productName) || sameName(row.productKeyword)
    || sameName(task.intent?.lines?.[i]?.productKeyword) ? [i] : []);
  if (customer && !products.length) return { kind: 'customer', customerKeyword: next };
  if (!customer && products.length === 1 && lines?.length === 1) return { kind: 'product', lineIndex: products[0], lines };
  return null;
}

function replaceSaleLines(lines, { lines: incoming, lineIndex }) {
  if (!incoming?.length) return null;
  if (lineIndex == null) return lines.length <= 1 ? incoming : null;
  return lines.map((line, i) => i === lineIndex ? incoming[0] : line);
}

async function correctSaleIntake(store, client, actor, task, text, correction) {
  let { customerKeyword, lines } = task.intent;
  if (correction.kind === 'customer') customerKeyword = correction.customerKeyword;
  if (correction.kind === 'product') {
    const updated = replaceSaleLines(lines, correction);
    if (!updated) return { task, reply: '请说明要换的商品和数量。多行草稿请指出原商品。' };
    lines = updated;
  }
  if (correction.kind === 'quantity') {
    const index = saleLineIndex(correction.target, lines);
    if (index < 0 || !correction.amount) return { task, reply: '请说明第几行商品要改为多少，并给出明确数量。原草稿信息已保留。' };
    lines = lines.map((line, i) => i === index ? { ...line, ...correction.amount } : line);
  }
  clearChoice(task);
  if (correction.kind === 'customer' && task.selections) delete task.selections.customer;
  if (correction.kind === 'product' && task.selections) {
    delete task.selections['line:' + (correction.lineIndex ?? 0)];
  }
  return graphSaleDraft(store, client, actor, text, { task, customerKeyword, lines });
}

async function replaceSalePreviewInput(store, client, actor, task, text, correction) {
  if (task.state !== 'AWAITING_CONFIRM' || task.previewExpired()) throw previewConflict('请重新打开有效且待确认的销售草稿再修改。');
  if (!hasPerm(actor, 'sale.order.create')) throw Object.assign(new Error('当前没有销售单新建权限，未修改预览'), { status: 403 });
  const old = task.preview;
  const customerKeyword = correction.customerKeyword ?? task.intent?.customerKeyword ?? old.customer.name;
  const oldLines = old.lines.map(({ productName, qty }, i) => ({
    productKeyword: task.intent?.lines?.[i]?.productKeyword ?? productName, qty,
    requestedUnit: task.intent?.lines?.[i]?.requestedUnit,
  }));
  const replacingProduct = correction.kind === 'product';
  const lines = replacingProduct ? (correction.lines?.length === 1 ? replaceSaleLines(oldLines, correction) : null) : oldLines;
  if (!lines) {
    return { task, preview: old, reply: '请明确要换的原商品、新商品和数量。也可以用预览卡上的「重选商品」。原预览未更改。' };
  }
  const selections = Object.fromEntries(old.lines.map((line, i) => ['line:' + i, line.productId]));
  if (replacingProduct) {
    selections.customer = old.customer.id;
    delete selections['line:' + (correction.lineIndex ?? 0)];
  }
  clearChoice(task);
  task.selections = selections;
  task.preview = null;
  task.salePreviewRevised = true;
  task.saleEditWarehouseId = old.warehouseId;
  task.accessWarehouseIds = [Number(old.warehouseId)];
  task.revision++;
  task.transition('DISAMBIGUATING');
  store.save(task);
  return graphSaleDraft(store, client, actor, text, { task, customerKeyword, lines });
}

async function reviseSalePreview(store, client, actor, task, { target, amount }) {
  if (task.state !== 'AWAITING_CONFIRM' || task.previewExpired()) throw Object.assign(new Error('只能修改有效且待确认的销售草稿预览；请核对当前任务或重新试算'), { status: 409 });
  if (!hasPerm(actor, 'sale.order.create')) throw Object.assign(new Error('当前没有销售单新建权限，未修改预览'), { status: 403 });
  if (!amount || /审批|付款|发货|确认|提交|执行/.test(target)) return { task, reply: '请说明「第几行数量改成多少」，修改后需要再次核对新预览。', preview: task.preview };
  const index = saleLineIndex(target, task.preview.lines);
  if (index < 0) return { task, reply: '有多行或无法确定要改哪一行，请明确「第几行数量改成多少」，我没有猜行或改量。', preview: task.preview };
  const { qty, requestedUnit } = amount;
  const lines = task.preview.lines.map((line, i) => ({
    productKeyword: line.productName, productHit: { id: line.productId, title: line.productName },
    ...(i === index ? { qty, requestedUnit } : { qty: line.qty, requestedUnit: task.intent?.lines?.[i]?.requestedUnit }),
  }));
  let fresh;
  try { fresh = await buildSalePreview(client, { customerHit: { id: task.preview.customer.id }, warehouseId: task.preview.warehouseId, lines }, actor); }
  catch (error) { return { task, reply: `预览未修改：${error.message}`, preview: task.preview }; }
  if (task.intent?.stockCondition && !matchesStockCondition(fresh, task.intent.stockCondition)) {
    return { task, reply: '当前库存或单位不满足原条件，原草稿数量保持不变。', preview: task.preview };
  }
  fresh.warehouseName = await warehouseName(client, fresh.warehouseId);
  fresh.payload = salePayload(fresh);
  task.setPreview(fresh);
  task.salePreviewRevised = true;
  task.intent ??= { graph: 'B-sale-draft', customerKeyword: task.preview.customer.name };
  task.intent.lines = lines.map(({ productKeyword, qty, requestedUnit }) => ({ productKeyword, qty, requestedUnit }));
  task.error = null;
  store.save(task);
  return { task, preview: task.preview, reply: `第 ${index + 1} 行「${fresh.lines[index].productName}」数量已改为 ${qty}，已重新读取商品规则、价格和库存试算，合计 ¥${(fresh.totalCents / 100).toFixed(2)}。这是第 ${task.revision} 版预览，请核对后点击确认，尚未建单。` };
}

async function handleMessageUnlocked(store, client, actor, text, opts = {}) {
  const t = activeTopicText(text);
  if (opts.taskId) return continueTask(store, client, actor, t, { ...opts, startsNewTopic: t !== String(text).trim() });
  const greeting = smallTalkReply(t);
  if (greeting) return { task: null, reply: greeting };
  const routing = classifyMessage(t);
  if (routing.kind === 'sale-handoff') return graphSaleHandoff(store, client, actor, t, routing.handoff);
  if (routing.kind === 'operational-read') return graphOperationalRead(store, client, actor, t, routing);
  if (routing.kind === 'stock-before-sale') return stockBeforeSale(store, client, actor, t, routing);
  if (routing.kind === 'ordered-read') {
    const task = createReadSequence(store, actor, t, routing.steps);
    return store.exclusive(task.id, () => runSequence(store, client, actor, task));
  }
  if (resumesOriginal(t)) return { task: null, reply: '请从最近记录打开要继续的原任务，我会按原进度核对。' };
  if (routing.kind === 'defer-write') {
    if (routing.graph === 'A-inventory') return graphInventory(store, client, actor, routing.query);
    if (routing.graph === 'C-replenishment') return graphReplenishment(store, client, actor, routing.query);
    return { task: null, reply: routing.reply };
  }
  if (saleCorrection(t) && routing.kind !== 'blocked' && !routing.explicitOutside) {
    return { task: null, reply: '请先打开要修改的销售草稿，或说明哪张单、哪个商品需要调整。' };
  }
  if (['blocked', 'outside', 'clarify'].includes(routing.kind)) return { task: null, reply: routing.reply };
  if (routing.kind === 'discussion') {
    const local = knownConceptReply(t);
    if (local) return { task: null, reply: local };
    return { task: null, reply: DISCUSSION_CLOSED_REPLY };
  }
  if (routing.graph === 'A-inventory') {
    const { written } = inventoryWords(t);
    const ordinalVariant = Number.isFinite(warehouseOrdinal(written)) && /第|号|號|倉|[０-９]/.test(written);
    if (opts.preferInventoryRule || ordinalVariant || missingInventoryProduct(t) || /^只(?:查|看).+库存[？?。！!]*$/.test(t)) {
      return graphInventory(store, client, actor, t);
    }
  }
  if (routing.graph === 'B-sale-draft' && intakeSale(t).explicit) return graphSaleDraft(store, client, actor, t);
  if (routing.graph === 'B2-reserve') return graphReserve(store, client, actor, t);
  const parseIntent = opts.parseIntent || (config.model.apiKey ? parseIntentLLM : null);
  if (parseIntent) {
    try {
      const proposed = await parseIntent(t);
      const intent = proposed?.graph === 'D-receipt' ? proposed : groundCustomerIntent(proposed, t);
      if (intent?.graph === 'B-sale-draft') {
        const grounded = groundSaleLines(t, intent);
        if (!grounded) return { task: null, reply: '请按原话逐行说明商品、数量和单位，我需要核对每一行再准备销售草稿。' };
        return executeIntent(store, client, actor, t, grounded);
      }
      if (intent && intent.graph !== 'none') return executeIntent(store, client, actor, t, intent);
      if (intent?.graph === 'none' && !routing.graph) return refusal(t);
    } catch { /* 模型异常 → 回退规则，不中断服务 */ }
  }
  // 规则规划器（确定性回退）
  switch (routing.graph) {
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
