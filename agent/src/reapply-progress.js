const clean = value => typeof value === 'string'
  ? value.replace(/[\p{Cc}\p{Cf}\[\]*]/gu, ' ').trim().slice(0, 80) : '';

function quantityList(lines, field = 'qty') {
  const amounts = new Map();
  for (const line of lines) {
    const unit = clean(line.unit);
    amounts.set(unit, (amounts.get(unit) ?? 0) + Math.round(line[field] * 100));
  }
  return [...amounts].map(([unit, qty]) => `${qty / 100}${unit ? ' ' + unit : ''}`).join('、');
}

const yuan = cents => '¥' + (cents / 100).toFixed(2);
const excessText = (issue, domain) => domain === 'sale'
  ? (issue.excess?.length ? quantityList(issue.excess) : '') : (Number.isSafeInteger(issue.excessCents) ? yuan(issue.excessCents) : '');
const receiptAmountText = (row, domain) => domain === 'sale'
  ? (row?.lines?.length || row?.movement?.length ? quantityList(row.lines ?? row.movement) : '')
  : (Number.isSafeInteger(row?.cents ?? row?.movementCents) ? yuan(row.cents ?? row.movementCents) : '');

function batchIssue(issue, domain) {
  const where = domain === 'sale' ? '占库事件' : '核销分录';
  const ref = where + ' #' + issue.id;
  if (issue.reason === 'origin') return `请财务核对${issue.ordinal ? '第 ' + issue.ordinal + ' 笔' : '这笔'}冲回属于哪次核销（分录 #${issue.id}）。`;
  if (issue.reason === 'unassigned') return `请核对${ref}对应原单的哪一批。`;
  if (issue.reason === 'conflict') return `请核对${ref}的成功回执应归属哪一批，回执与原批关联不一致。`;
  if (issue.reason === 'sequence') return `${ref}先于所关联的原批次，请核对这笔回执的归属与先后。`;
  if (issue.reason === 'capacity') {
    const excess = excessText(issue, domain);
    const excessLines = domain === 'sale' && issue.excess?.length > 1
      ? '（' + issue.excess.map(line => `原单明细 #${line.itemId} 超出 ${quantityList([line])}`).join('，') + '）' : '';
    const amount = receiptAmountText(issue, domain);
    const owner = domain === 'sale' ? '销售或客服' : '财务';
    const scope = issue.shared ? '与同批其他待核回执合计仍超出' : '归入该批后仍超出';
    return `${ref}${amount ? '本笔记录为 ' + amount + '，' : ''}${scope}原批额度${excess ? ' ' + excess : ''}${excessLines}。请${owner}核对这笔回执的归属和${domain === 'sale' ? '数量' : '金额'}。`;
  }
  if (issue.reason === 'reported' && issue.partial) return `请核对${ref}的部分撤回或改归凭据。`;
  if (issue.reason === 'reported') return `请核对${ref}回执的撤回或改回结果。`;
  if (issue.check === 'missing' || issue.check === 'mismatch') {
    const amount = receiptAmountText(issue, domain);
    const recorded = amount ? `原${where}记录为 ${amount}，这部分待核。` : '';
    const prefix = issue.check === 'missing' ? `暂未取得${ref}的成功回执。` : `${ref}的成功回执与原单数量或金额对不上。`;
    return prefix + recorded + '请核对这笔回执。';
  }
  return `请核对${ref}的成功回执与原单数量或金额是否一致。`;
}

const batchIssues = batch => batch.issues ?? (batch.issue ? [batch.issue] : []);
const issueText = (batch, domain) => batchIssues(batch).map(issue => batchIssue(issue, domain)).join('');

export function releaseBatchText(batch) {
  const posted = batch.supplements.map(row => `${clean(row.operator) || '同事'}补占 ${quantityList(row.lines)}（回执对应事件 #${row.id}）`);
  const label = `第 ${batch.ordinal} 次释放 ${quantityList(batch.lines)}（事件 #${batch.id}）`;
  const filled = batch.supplements.flatMap(row => row.lines);
  const confirmed = batch.issue && batch.lines.every(row => Number.isFinite(row.confirmedRemaining))
    ? '，按已核实办理还剩 ' + quantityList(batch.lines, 'confirmedRemaining') : '';
  const byLine = batch.lines.length > 1 && !batch.issue ? batch.lines
    .map((row, index) => `本批第 ${index + 1} 行（原单明细 #${row.itemId}）剩 ${quantityList([row], 'remaining')}`).join('，') + '。' : '';
  return label + (posted.length ? '，' + posted.join('，') + '，已补 ' + quantityList(filled) : '，已补 0')
    + (batch.issue ? confirmed + '，本批余量待核。' + issueText(batch, 'sale') : '，还剩 ' + quantityList(batch.lines, 'remaining') + '。')
    + byLine + (batch.issue || batch.lines.some(line => line.remaining > 0) ? '下一步由销售或客服核对，具备占库权限的同事办理。' : '下一步由销售核对整单能否派发，仓库按正式任务作业。');
}

export function reversalBatchText(batch) {
  const posted = batch.posted.map(row => `${clean(row.operator) || '同事'}补核销 ${yuan(row.cents)}（回执对应分录 #${row.id}）`);
  const filled = batch.posted.reduce((sum, row) => sum + row.cents, 0);
  const confirmed = batch.issue && Number.isSafeInteger(batch.confirmedOpen)
    ? '，按已核实办理还剩 ' + yuan(batch.confirmedOpen) : '';
  return `${clean(batch.orderNo)} 第 ${batch.ordinal} 笔冲回 ${yuan(batch.amountCents)}（分录 #${batch.id}）`
    + (posted.length ? '，' + posted.join('，') : '') + '，已补 ' + yuan(filled)
    + (batch.issue ? confirmed + '，本批余量待核。' + issueText(batch, 'payment') : '，还剩 ' + yuan(batch.open) + '。')
    + (batch.issue || batch.open > 0 ? '下一步由有核销权限的财务核对原收款与应收后办理。' : '下一步由财务按原收款单核对其余余额。');
}

// Only these affirmative follow-ups may prepare a card without a new amount.
export function batchFollowup(text, { selectingReceipt, groupOrderNo } = {}) {
  const correction = correctionFollowup(text, selectingReceipt, groupOrderNo);
  if (correction) return correction;
  const match = /^(?:(?:小满|请|帮我|麻烦)[，,:：\s]*)*(?:(?:(销售单|收款单)(?:号)?\s*[：:]?\s*)?([a-z][a-z\d_-]{0,18}?\d{6,28})[，,:：\s]*)?(?:(刚才(?:选的|看的|说的)?(?:那|这)(?:一)?批|刚才那一笔)(?:[，,\s]*(?:(?:把)?剩下的补(?:了|上|齐)|继续补办|接着补|先试算))?|(?:把)?剩下的(?:都)?补(?:了|上|齐)|把这批剩下的补(?:了|上|齐)|(先补能(?:办|核实)的(?:那批)?|能(?:办|核实)的先补|把能(?:办|核实)的补(?:了|上|齐))(?:[，,\s]*待核的先放着)?)[。！!]*$/i.exec(text);
  if (!match) return null;
  const no = match[2]?.toUpperCase();
  const domain = match[1] === '销售单' || !match[1] && /^SL/i.test(no ?? '') ? 'sale'
    : match[1] === '收款单' || !match[1] && /^RC/i.test(no ?? '') ? 'receipt' : null;
  return { no, domain, mode: match[4] ? 'ready' : match[3] || /这批剩下/.test(text) ? 'recent' : 'remaining' };
}

export const releaseHasRemaining = batch => batch.lines.some(line => line.remaining > 0);
export const reversalHasRemaining = batch => batch.open > 0;

export function batchReconciliationText(no, batches, domain, correction, selected) {
  const seen = new Set();
  if (correction?.movementId != null && !correction.verified) seen.add(correction.movementId);
  const format = domain === 'sale' ? releaseBatchText : reversalBatchText;
  const hasRemaining = domain === 'sale' ? releaseHasRemaining : reversalHasRemaining;
  const lines = batches.map(batch => format({ ...batch, issues: batchIssues(batch).filter(issue => {
    if (seen.has(issue.id)) return false;
    seen.add(issue.id);
    return true;
  }) }));
  const target = selected && batches.find(batch => batch.id === selected.id);
  const complete = target && !target.issue && !hasRemaining(target) ? '该批已补完。' : '';
  return [domain === 'sale' ? `销售单 ${no}` : `收款单 ${no}`, correction?.reply, complete, ...lines].filter(Boolean).join('\n');
}

export function batchProgress(batches, hasRemaining) {
  return { ready: batches.filter(batch => !batch.issue && hasRemaining(batch)), review: batches.filter(batch => batch.issue) };
}

function correctionFollowup(text, selectingReceipt, groupOrderNo) {
  const partial = partialCorrectionFollowup(text, groupOrderNo);
  if (partial) return partial;
  const bare = (selectingReceipt ? /^(?:回执|占库事件|事件|核销分录|分录)?\s*[#＃]?\s*([1-9]\d*)[。！!]*$/
    : /^回执\s*[#＃]\s*([1-9]\d*)[。！!]*$/).exec(text);
  if (bare && Number.isSafeInteger(Number(bare[1]))) return { correction: true, movementId: Number(bare[1]), mode: 'read' };
  const multi = /^(?:(?:小满|请|帮我|麻烦)[，,:：\s]*)*(?:(销售单|收款单)(?:号)?\s*[：:]?\s*([a-z][a-z\d_-]{0,18}?\d{6,28})[，,:：\s]*)?((?:这|那)?(?:两|几|多)笔回执|回执\s*[#＃]\s*[1-9]\d*(?:[、，,和与及\s]+(?:回执\s*)?[#＃]\s*[1-9]\d*)+)(.*)$/i.exec(text);
  const sequence = /^(?:的)?(?:交叉)?(?:(?:更正|撤回|撤销|改归|改回原批)(?:[、，,和与及或\s]+(?:更正|撤回|撤销|改归|改回原批))*)?[，,\s]*(?:的)?(?:前后|先后|更正)?顺序(?:对不上|不一致|有冲突|乱了)[，,\s]*(?:(?:重新核对|再核对|重查|核对)(?:一下)?)?[。！!]*$/;
  if (multi && sequence.test(multi[4].trim())) return { no: multi[2]?.toUpperCase(), domain: multi[1] === '销售单' ? 'sale' : multi[1] === '收款单' ? 'receipt' : null,
    correction: true, multiCorrection: true, mode: 'read',
    movementIds: [...new Set([...multi[3].matchAll(/[#＃]\s*([1-9]\d*)/g)].map(match => Number(match[1])).filter(Number.isSafeInteger))] };
  const match = /^(?:(?:小满|请|帮我|麻烦)[，,:：\s]*)*(?:(销售单|收款单)(?:号)?\s*[：:]?\s*([a-z][a-z\d_-]{0,18}?\d{6,28})[，,:：\s]*)?(?:(按更正后的归属(?:继续补办|接着办|继续))|(?:(?:这笔|那笔|待核的|刚才那笔)?回执)(?:\s*[#＃]\s*([1-9]\d*))?(?:的)?(?:(?:已经|已|又|再次)\s*)*(补齐|找回|更正撤回|撤回|撤销|更正|改归另一批|改归|改回原批|还对不上)(?:了|后)?[，,\s]*(重新核对|再核对|重查|接着办|继续补办|重新预览|按更正后的归属继续补办)(?:一下)?)[。！!]*$/i.exec(text);
  if (!match) return null;
  const movementId = Number(match[4]);
  const prepare = Boolean(match[3] || /接着办|继续补办|重新预览/.test(match[6]));
  return { no: match[2]?.toUpperCase(), domain: match[1] === '销售单' ? 'sale' : match[1] === '收款单' ? 'receipt' : null,
    correction: true, followCorrection: Boolean(match[3] || prepare && (/改归|改回原批/.test(match[5]) || /按更正后的归属/.test(match[6]))),
    withdrawalClaim: /撤回|撤销/.test(match[5] ?? ''), returnClaim: match[5] === '改回原批',
    movementId: Number.isSafeInteger(movementId) && movementId > 0 ? movementId : undefined,
    mode: prepare ? 'remaining' : 'read' };
}

function partialCorrectionFollowup(text, groupOrderNo) {
  const parts = /^(?:(?:小满|请|帮我|麻烦)[，,:：\s]*)*(?:(销售单|收款单)(?:号)?\s*[：:]?\s*([a-z][a-z\d_-]{0,18}?\d{6,28})[，,:：\s]*)?(.*)$/i.exec(text);
  if (!parts) return null;
  const words = parts[3];
  const group = groupedReassignmentFollowup(words, Boolean(groupOrderNo && (!parts[2] || parts[2].toUpperCase() === groupOrderNo)));
  if (group) return { no: parts[2]?.toUpperCase(), domain: parts[1] === '销售单' ? 'sale' : parts[1] === '收款单' ? 'receipt' : null,
    correction: true, partialCorrection: true, groupedReassignment: true, ...group };
  const overage = /^(?:(?:这笔|那笔)?超(?:量|额)回执(?:\s*[#＃]\s*([1-9]\d*))?\s*(?:只更正了一部分|部分更正了?|更正了一部分)|(?:回执\s*[#＃]\s*([1-9]\d*)\s*(?:的)?\s*)?超出(?:的)?部分\s*(撤回|撤销|改归(?:到)?另一批)(?:了)?)[，,\s]*(重新核对|再核对|重查|看看进度|按更正后的归属继续补办|重新预览)?[。！!]*$/.exec(words);
  const closed = /^(?:(?:第\s*(?:1|一)\s*批|原批|前一批)(?:已经|已)?补完(?:了)?[，,\s]*)?(?:原来)?(?:(?:另一笔|那笔|这笔)(?:待核的?)?|待核的?)?回执(?:\s*[#＃]\s*([1-9]\d*))?\s*(?:(?:后来|已经|已|也|才)\s*)*(?:核清|核实|改归(?:到|了)?已补完(?:的)?(?:第\s*(?:1|一)\s*批|那批|批次)?)(?:了)?[，,\s]*(重新核对|再核对|重查|看看进度|按更正后的归属继续补办|重新预览)?[。！!]*$/.exec(words);
  const resumeCleared = /^(?:按)?(?:已)?核清的(?:那|这)(?:一)?批[，,\s]*(?:继续补办|继续办|接着办|重新预览|接着补办)[。！!]*$/.test(words);
  const report = /^(?:一笔|(?:这笔)?回执\s*[#＃]\s*([1-9]\d*))\s*(?:已经|已)?核(?:清|实)(?:了)?[，,\s]*另(?:一|那)笔(?:回执)?(?:仍|还|尚)?(?:在)?待核(?:对)?(?:[，,\s]*(?:期间)?同事(?:期间)?又补(?:办|过|了)(?:了)?)?(?:[，,\s]*(?:重新核对|再核对|重查|看看进度)(?:一下)?)?[。！!]*$/.exec(words);
  const pending = /^(?:还)?剩哪(?:一)?笔(?:回执)?(?:还|仍)?待核(?:对)?[？?。]*$/.test(words);
  if (!report && !pending && !resumeCleared && !closed && !overage) return null;
  const id = Number(overage?.[1] ?? overage?.[2] ?? closed?.[1] ?? report?.[1]);
  const prepare = resumeCleared || /继续补办|重新预览/.test(overage?.[4] ?? closed?.[2] ?? '');
  const capacityAction = overage && (/^改归/.test(overage[3] ?? '') ? 'move' : overage[3] ? 'withdraw' : 'review');
  return { no: parts[2]?.toUpperCase(), domain: parts[1] === '销售单' ? 'sale' : parts[1] === '收款单' ? 'receipt' : null,
    correction: true, partialCorrection: true, followCorrection: prepare, pendingOnly: pending, afterClosed: Boolean(closed || overage), capacityAction,
    movementId: Number.isSafeInteger(id) && id > 0 ? id : undefined, mode: prepare ? 'remaining' : 'read' };
}

function groupPreviewTarget(words) {
  const name = /^(?:按)?(.+?)[，,\s]*(?:继续补办|续办|接着办|重新预览|先试算|给我个预览)[。！!]*$/.exec(words)?.[1]
    ?? /^(?:(?:就|先)补(?:办)?|先试算)\s*(.+?)(?:[，,\s]*先给我看看)?[。！!]*$/.exec(words)?.[1];
  if (!name) return null;
  const batch = name.trim();
  if (/^刚(?:刚)?(?:核清|核实|对上|对平)的(?:那|这)批$/.test(batch)) return 'cleared';
  if (/^(?:撤回后)?重新有余量的(?:那|这)批$/.test(batch)) return 'reopened';
  if (/^改归后(?:能办|可办)的(?:那|这)批$/.test(batch)) return 'ready';
  return null;
}

const groupProgressQuestion = /^(?:(?:先|帮我|请)\s*)*(?:重新核对|再核对|重查|再?查(?:看|下|一下)?|看看?)(?:\s*(?:各批|每批)?(?:现在)?(?:进度|(?:还差|还剩|还能补)多少))?$/;
const groupPause = /^(?:先)?(?:别|不用|不要)补(?:办)?$/;
const groupStatus = /^(?:原已补满批次|(?:(?:刚才|之前|原先)?(?:已(?:被同事)?)?补?满的)?(?:那|这|一|另一)批(?:的(?:待核)?回执)?|另一笔(?:待核)?(?:回执)?)(?:又|被|同事|已经|已|也|同时|仍|还|补满后)*(补满|补完|待核(?:对)?|核清|核实|对上|对平|部分撤回|撤回了部分|(?:撤回?|退回)了一?点)(?:了)?$/;

function groupedReassignmentFollowup(words, hasGroup) {
  const target = groupPreviewTarget(words);
  if (target) return { followCorrection: true, mode: 'remaining', reassignmentTarget: target === 'ready' ? undefined : target };
  const prefix = /^(?:超出(?:的)?部分\s*(?:分次|分批)(?:改归|重新归)(?:到)?(?:了)?(?:多个批次|不同批次|多批)|(?:这|那)(?:几|多)笔(?=回执))/.exec(words);
  if (!prefix && !hasGroup) return null;
  const rest = words.slice(prefix?.[0].length ?? 0);
  const receiptList = prefix && /^[，,\s]*[（(]?\s*(回执\s*[#＃]\s*[1-9]\d*(?:[、，,和与及\s]+(?:回执\s*)?[#＃]\s*[1-9]\d*)*)\s*[）)]?/.exec(rest);
  const clauses = rest.slice(receiptList?.[0].length ?? 0).split(/[，,、。！？?!]/).map(clause => clause.trim()).filter(Boolean);
  let withdrawalReported = false;
  let hasReview = false;
  for (const clause of clauses) {
    if (groupPause.test(clause)) continue;
    const status = groupStatus.exec(clause)?.[1];
    if (!status && !groupProgressQuestion.test(clause)) return null;
    hasReview = true;
    if (status && /撤|退/.test(status)) withdrawalReported = true;
  }
  if (!hasReview && (!prefix || clauses.length)) return null;
  const refs = [...(receiptList?.[1] ?? '').matchAll(/[#＃]\s*([1-9]\d*)/g)].map(match => Number(match[1]));
  return { mode: 'read', withdrawalReported, reassignmentIds: receiptList ? [...new Set(refs.filter(Number.isSafeInteger))] : undefined,
    incompleteReassignment: refs.some(id => !Number.isSafeInteger(id)) };
}

export function batchReviewHistory(batches, previous, correction) {
  const waiting = (Array.isArray(batches) ? batches : []).flatMap(batch =>
    batchIssues(batch).map(issue => ({ movementId: issue.id, id: batch.id, ordinal: batch.ordinal })));
  // A bounded snapshot is for resolving references only. Amounts always come from the current document.
  if (correction?.movementId != null && !correction.verified && !waiting.some(row => row.movementId === correction.movementId)) {
    waiting.push(...(previous?.waiting ?? []).filter(row => row.movementId === correction.movementId));
  }
  const last = correction?.reference ?? previous?.last;
  const history = new Map((previous?.receipts ?? []).map(row => [row.movementId, row]));
  for (const receipt of [previous?.last, last]) {
    if (!receipt) continue;
    history.delete(receipt.movementId);
    history.set(receipt.movementId, receipt);
  }
  return { waiting: waiting.slice(0, 80), truncated: waiting.length > 80, receipts: [...history.values()].slice(-80), last,
    reviewGroup: correction?.reviewGroup ?? previous?.reviewGroup,
    reassignmentGroup: correction?.reassignmentGroup ?? (previous?.reassignmentGroup && correction?.reference
      ? { ...previous.reassignmentGroup, selectedMovementId: correction.reference.movementId } : previous?.reassignmentGroup),
    clearedMovementId: correction?.clearedMovementId === undefined ? previous?.clearedMovementId : correction.clearedMovementId,
    selectionRequired: correction?.selectionRequired ?? (correction?.reference ? false : previous?.selectionRequired) };
}

export function reviewedReceipt(review, id) {
  if (id == null) return undefined;
  return review?.last?.movementId === id ? review.last : review?.receipts?.find(row => row.movementId === id);
}

export function verifiedBatchMovement(batches, movementId, domain) {
  if (!Array.isArray(batches) || batches.some(batch => batchIssues(batch).some(issue => issue.id === movementId))) return null;
  const matches = batches.filter(batch => batchMovement(batch, movementId, domain));
  return matches.length === 1 ? matches[0] : null;
}

function batchMovement(batch, movementId, domain) {
  return (domain === 'sale' ? batch.supplements : batch.posted).find(row => row.id === movementId);
}

function receiptAmounts(row, domain) {
  if (domain !== 'sale') {
    const cents = row?.cents ?? row?.movementCents;
    return Number.isSafeInteger(cents) && cents > 0 ? { cents } : null;
  }
  const lines = row?.lines ?? row?.movement;
  if (!lines?.length || lines.some(line => !line.itemId || !line.warehouseId || !Number.isFinite(line.qty) || line.qty <= 0)) return null;
  return Object.fromEntries(lines.map(line => [JSON.stringify([line.itemId, line.warehouseId, line.unit]), Math.round(line.qty * 100)]));
}

function reducedReceipt(previous, current) {
  if (!previous || !current) return false;
  return Object.entries(current).every(([key, value]) => previous[key] >= value)
    && Object.entries(previous).some(([key, value]) => (current[key] ?? 0) < value);
}

function partialCorrectionUnconfirmed(action, before, batch, movement, domain) {
  if (!movement || before?.batchId !== batch.id) return false;
  return action === 'move' || (action === 'withdraw' && !reducedReceipt(before.amounts, receiptAmounts(movement, domain)));
}

function proofStillDisputed(receipt, batch, domain) {
  if (receipt?.claim?.batchId !== batch.id) return false;
  const movement = batchMovement(batch, receipt.movementId, domain);
  if (receipt.claim.partialAction) return partialCorrectionUnconfirmed(receipt.claim.partialAction, receipt.claim.before, batch, movement, domain);
  return receipt.claim.movementProofVersion ? movement?.proofVersion === receipt.claim.movementProofVersion
    : receipt.claim.proofVersion === batch.proofVersion;
}

export function withBatchClaims(batches, review, domain) {
  const records = review?.receipts ?? (review?.last ? [review.last] : []);
  if (!records.some(row => row.state === 'pending' && row.claim)) return batches;
  return batches.map(batch => {
    const current = batchIssues(batch);
    const claims = records.filter(row => row.state === 'pending' && proofStillDisputed(row, batch, domain)
      && !current.some(issue => issue.id === row.movementId)).map(row => ({ id: row.movementId, reason: 'reported', partial: Boolean(row.claim.partialAction) }));
    const issues = [...current, ...claims];
    return claims.length ? { ...batch, issue: issues[0], issues } : batch;
  });
}

function batchLabel(batch, domain) {
  return batch.ordinal == null ? `批次 #${batch.id}` : domain === 'sale' ? `第 ${batch.ordinal} 次释放` : `第 ${batch.ordinal} 笔冲回`;
}

export function compareBatchCorrection(batches, previous, request, domain) {
  const label = batch => batchLabel(batch, domain);
  const refLabel = domain === 'sale' ? '事件' : '分录';
  const current = Array.isArray(batches) ? batches : [];
  const question = `请给出有冲突的那笔回执对应的${refLabel}编号。`;
  if (request.groupedReassignment) return compareReassignmentGroup(current, previous, request, domain);
  if (request.followCorrection && request.movementId == null && !request.partialCorrection
      && !request.withdrawalClaim && !request.returnClaim && previous?.reassignmentGroup) {
    const focused = previous.reassignmentGroup.selectedMovementId;
    if (focused == null) return compareReassignmentGroup(current, previous, request, domain);
    request = { ...request, movementId: focused };
  }
  if (request.partialCorrection || request.followCorrection && !request.returnClaim && !request.withdrawalClaim && previous?.clearedMovementId
      && previous.last?.movementId === previous.clearedMovementId && !request.movementId) {
    return comparePartialCorrection(current, previous, request, domain, refLabel);
  }
  if (request.multiCorrection) {
    const ids = new Set(current.flatMap(batchIssues).map(issue => issue.id).filter(id =>
      !request.movementIds?.length || request.movementIds.includes(id)));
    // The conversation group is a reference set. All membership in a live batch must be proved again.
    const group = request.movementIds?.length ? request.movementIds : [...ids];
    const reviewGroup = { ids: group.slice(0, 80), truncated: group.length > 80 };
    const note = '已按原单逐笔核对当前回执，无法从这些记录确定不同回执的更正先后。';
    if (ids.size !== 1) return { reply: note + question, selectionRequired: true, includeSummary: true, reviewGroup, clearedMovementId: null };
    const [id] = ids;
    const checked = compareBatchCorrection(current, previous, { movementId: id }, domain);
    return { ...checked, reply: note + '\n' + checked.reply, includeSummary: true, reviewGroup, clearedMovementId: null };
  }
  if (previous?.selectionRequired && request.movementId == null) return { reply: question, selectionRequired: true };
  const known = previous?.waiting ?? [];
  const last = previous?.last;
  const scoped = known.filter(row => row.id === request.focusBatchId);
  const ids = [...new Set((scoped.length ? scoped : known).map(row => row.movementId))];
  const movementId = request.movementId ?? ((request.followCorrection || !ids.length) ? last?.movementId : undefined)
    ?? (!previous?.truncated && ids.length === 1 ? ids[0] : undefined);
  if (movementId == null) return { reply: question };
  const previousReceipt = reviewedReceipt(previous, movementId);
  const old = known.filter(row => row.movementId === movementId);
  const from = previousReceipt?.from ?? (old.length === 1 ? old[0] : null);
  const observed = previousReceipt?.observed ?? (from ? [{ id: from.id, ordinal: from.ordinal }] : []);
  const previousBatch = observed.at(-1);
  const batch = verifiedBatchMovement(current, movementId, domain);
  const head = `回执（${refLabel} #${movementId}）`;
  const previousOverage = previousReceipt?.overage;
  const partialAction = request.capacityAction === 'withdraw' || request.capacityAction === 'move'
    ? request.capacityAction : previousReceipt?.claim?.partialAction;
  const before = previousReceipt?.claim?.partialAction === partialAction ? previousReceipt?.claim?.before ?? previousOverage : previousOverage;
  const partialClaim = partialAction && before ? { batchId: before.batchId, partialAction, before } : null;
  const afterClosed = Boolean(previousReceipt?.afterClosed || previousOverage || request.capacityAction
    || previous?.reassignmentGroup?.ids?.includes(movementId));
  const reference = { movementId, from, observed, observedTruncated: previousReceipt?.observedTruncated, state: 'pending',
    ...(afterClosed ? { afterClosed } : {}) };
  const previousScope = previousOverage ? `（${label({ id: previousOverage.batchId, ordinal: previousOverage.ordinal })}）` : '';
  const earlierExcess = previousOverage?.excess ? `上次${previousOverage.shared ? '合计' : ''}超出 ${previousOverage.excess}${previousScope}`
    + (previousOverage.amount ? `，当时这笔记录为 ${previousOverage.amount}。` : '。') : '';
  if (!batch) {
    const affectedBatch = current.find(row => batchIssues(row).some(issue => issue.id === movementId && issue.reason === 'capacity'))
      ?? current.find(row => batchIssues(row).some(issue => issue.id === movementId));
    const issue = affectedBatch && batchIssues(affectedBatch).find(row => row.id === movementId);
    const overage = issue?.reason === 'capacity' ? { batchId: affectedBatch.id, ordinal: affectedBatch.ordinal,
      excess: excessText(issue, domain), shared: Boolean(issue.shared),
      amount: receiptAmountText(issue, domain), amounts: receiptAmounts(issue, domain) } : previousOverage;
    const prior = previousReceipt?.observed?.length ? `${head}上次核实归${label(previousBatch)}，本次待核。\n` : '';
    const changedOverage = overage?.excess !== previousOverage?.excess || overage?.amount !== previousOverage?.amount
      || overage?.shared !== previousOverage?.shared || overage?.batchId !== previousOverage?.batchId;
    const comparison = earlierExcess && (issue?.reason !== 'capacity' || changedOverage) ? earlierExcess + '\n' : '';
    return { movementId, reference: { ...reference, ...(overage ? { overage } : {}), ...(partialClaim ? { claim: partialClaim } : {}) },
      partial: afterClosed || issue?.reason === 'capacity',
      reply: prior + comparison + (issue ? batchIssue(issue, domain)
        : `请核对${refLabel} #${movementId} 的成功回执和当前批次归属。`) };
  }
  const movement = batchMovement(batch, movementId, domain);
  const currentAmount = receiptAmountText(movement, domain);
  if (partialCorrectionUnconfirmed(partialAction, before, batch, movement, domain)) {
    return { movementId, partial: true, reference: { ...reference, overage: previousOverage,
      claim: partialClaim },
      reply: `${earlierExcess}${head}当前归${label(batch)}${currentAmount ? '，核实量为 ' + currentAmount : ''}。请核对这笔回执的部分撤回或改归凭据。` };
  }
  const previousVerifiedId = previousReceipt?.observed?.at(-1)?.id;
  const stillDisputed = proofStillDisputed(previousReceipt, batch, domain);
  if (stillDisputed || (request.withdrawalClaim && (previousVerifiedId == null || previousVerifiedId === batch.id))
      || (request.returnClaim && from && from.id !== batch.id)) {
    return { movementId, reference: { ...reference, claim: { batchId: batch.id, proofVersion: batch.proofVersion,
      movementProofVersion: movement?.proofVersion } },
      ...(afterClosed ? { partial: true } : {}),
      reply: `${head}的正式记录仍归${label(batch)}。请核对这笔回执的撤回或改回结果。` };
  }

  const changed = previousBatch != null && previousBatch.id !== batch.id;
  const priorSeen = observed.some(row => row.id === batch.id);
  const returned = changed && priorSeen && previousReceipt?.observed?.length > 0;
  const nextObserved = previousBatch?.id === batch.id ? observed : [...observed, { id: batch.id, ordinal: batch.ordinal }];
  const kept = nextObserved.length > 12 ? [nextObserved[0], ...nextObserved.slice(-11)] : nextObserved;
  const line = returned ? `${head}上次核实归${label(previousBatch)}，现改回${label(batch)}。`
    : changed ? `${head}${previousReceipt?.observed?.length ? '上次核实归' : '原关联'}${label(previousBatch)}，现归${label(batch)}。`
      : `${head}${old.length > 1 ? '此前涉及多批待核，现' : ''}已核实，归属${label(batch)}。`;
  const truncated = Boolean(reference.observedTruncated || nextObserved.length > 12);
  const labels = kept.map(label);
  if (truncated) labels.splice(1, 0, '…');
  const history = returned && kept.length > 2 ? `本对话核对到的归属顺序为${labels.join(' → ')}。` : '';
  return { verified: true, movementId, batch, from, changed: changed || previousReceipt?.state === 'pending',
    ...(afterClosed ? { partial: true, clearedMovementId: movementId } : {}),
    reference: { ...reference, observed: kept, observedTruncated: truncated, state: 'verified' },
    reply: (earlierExcess ? earlierExcess + '\n' : '') + line + (afterClosed && currentAmount ? `本次已核实办理量为 ${currentAmount}。` : '') + history };
}

function compareReassignmentGroup(current, previous, request, domain) {
  const saved = previous?.reassignmentGroup;
  const ids = request.reassignmentIds ?? saved?.ids ?? [];
  const reassignmentGroup = { ids: ids.slice(0, 80),
    incomplete: request.reassignmentIds ? Boolean(request.incompleteReassignment || ids.length > 80) : Boolean(saved?.incomplete) };
  const detail = withBatchClaims(current, previous, domain);
  const byBatch = new Map(detail.map(batch => [batch.id, batch]));
  const issueIds = new Set(detail.flatMap(batchIssues).map(issue => issue.id));
  const remaining = domain === 'sale' ? releaseHasRemaining : reversalHasRemaining;
  const ref = domain === 'sale' ? '事件' : '分录';
  const destinations = new Map();
  const unverified = [];
  for (const id of reassignmentGroup.ids) {
    const verified = verifiedBatchMovement(current, id, domain);
    if (verified) {
      const batch = byBatch.get(verified.id);
      if (!destinations.has(batch.id)) destinations.set(batch.id, { batch, id });
    } else if (!issueIds.has(id)) {
      unverified.push(`请核对回执对应的${ref} #${id} 及其当前归属。`);
    }
  }
  const open = [...destinations.values()].filter(({ batch }) => !batch.issue && remaining(batch));
  const complete = [...destinations.values()].filter(({ batch }) => !batch.issue && !remaining(batch));
  const sameGroup = saved?.ids?.length === ids.length && ids.every(id => saved.ids.includes(id));
  const pending = reassignmentGroup.ids.filter(id => issueIds.has(id));
  const changes = reassignmentChanges(sameGroup ? saved : null, current, byBatch, destinations, domain, request.withdrawalReported);
  reassignmentGroup.observation = observeReassignment(complete, pending, domain);
  reassignmentGroup.changes = changes.targets;
  const notes = ['已按原单逐笔核对当前改归回执和各批进度。', ...changes.notes,
    ...complete.map(({ batch }) => batchLabel(batch, domain) + '已补完。'), ...unverified];
  const response = { partial: true, includeSummary: true, reassignmentGroup };
  if (request.mode === 'read') return { ...response, reply: notes.join('\n') };
  const choose = id => {
    const checked = compareBatchCorrection(current, previous, { movementId: id }, domain);
    if (!checked.verified) return { ...response, reply: [...notes, checked.reply].join('\n') };
    return { ...checked, ...response, clearedMovementId: id, reassignmentGroup: { ...reassignmentGroup, selectedMovementId: id },
      reply: [...notes, checked.reply].join('\n') };
  };
  if (request.reassignmentTarget) {
    const targets = changes.targets[request.reassignmentTarget];
    if (targets.length === 1) {
      const [{ batchId, movementId }] = targets;
      if (verifiedBatchMovement(current, movementId, domain)?.id === batchId) return choose(movementId);
      if (!issueIds.has(movementId)) notes.push(`请核对这批所对应的${ref} #${movementId} 当前归属。`);
    } else {
      notes.push(`请给出要续办的那批对应的${ref}编号。`);
    }
    return { ...response, reply: notes.join('\n') };
  }
  if (reassignmentGroup.incomplete || ids.length < 2) {
    notes.push(`请给出要续办的那笔回执对应的${ref}编号。`);
  } else if (open.length === 0) {
    notes.push('这组改归回执目前没有可继续补办的批次。');
  } else if (request.requireGroupFocus || open.length > 1) {
    notes.push('请给出要续办的那批对应的回执编号。');
  } else {
    const [{ id }] = open;
    return choose(id);
  }
  return { ...response, reply: notes.join('\n') };
}

function observeReassignment(complete, pending, domain) {
  let available = 80;
  const closed = complete.map(({ batch, id }) => {
    const movements = (domain === 'sale' ? batch.supplements : batch.posted).slice(0, available);
    available -= movements.length;
    return { id: batch.id, movementId: id, movements: movements.map(row => ({ id: row.id, amount: receiptAmountText(row, domain),
      amounts: domain === 'sale' && row.lines.length > 80 ? null : receiptAmounts(row, domain) })) };
  });
  return { closed, pending };
}

function reassignmentChanges(previous, current, byBatch, destinations, domain, reported) {
  const notes = [];
  const ref = domain === 'sale' ? '事件' : '分录';
  const remaining = domain === 'sale' ? releaseHasRemaining : reversalHasRemaining;
  const reopened = [];
  const cleared = [];
  const stillFull = [];
  for (const closed of previous?.observation?.closed ?? []) {
    const entry = destinations.get(closed.id);
    if (!entry) {
      const batch = byBatch.get(closed.id);
      if (batch && batchIssues(batch).some(issue => issue.id === closed.movementId)) {
        reopened.push({ batchId: closed.id, movementId: closed.movementId });
      }
      continue;
    }
    const { batch, id } = entry;
    const label = batchLabel(batch, domain);
    if (batch.issue || remaining(batch)) reopened.push({ batchId: batch.id, movementId: id });
    if (!batch.issue && remaining(batch)) {
      const changed = closed.movements.flatMap(before => {
        const movement = batchMovement(batch, before.id, domain);
        return reducedReceipt(before.amounts, receiptAmounts(movement, domain))
          ? [`${ref} #${before.id} 原先核实 ${before.amount}，现核实 ${receiptAmountText(movement, domain)}。`] : [];
      });
      notes.push(`${label}先前已补满，当前重新有余量。` + changed.join(''));
    } else if (!batch.issue) stillFull.push(label);
  }
  if (reported && reopened.length === 0 && stillFull.length) {
    notes.push(stillFull.length === 1
      ? `${stillFull[0]}当前仍已补完。请核对该批发生部分撤回的回执编号。`
      : '这几批当前仍已补完。请核对发生部分撤回的那笔回执编号。');
  }
  for (const id of previous?.observation?.pending ?? []) {
    const batch = verifiedBatchMovement(current, id, domain);
    if (!batch) continue;
    cleared.push({ batchId: batch.id, movementId: id });
    notes.push(`回执对应${ref} #${id} 现已核清，归${batchLabel(batch, domain)}。`);
  }
  return { notes, targets: { reopened: reopened.length ? reopened : previous?.changes?.reopened ?? [],
    cleared: cleared.length ? cleared : previous?.changes?.cleared ?? [] } };
}

function comparePartialCorrection(current, previous, request, domain, refLabel) {
  if (request.pendingOnly) {
    const pending = withBatchClaims(current, previous, domain).some(batch => batch.issue);
    return { partial: true, includeSummary: true,
      reply: pending ? '以下是原单当前仍待核的回执和各批进度。' : '原单当前可查的批次没有待核回执。' };
  }
  const known = previous?.reviewGroup;
  const fallbackIds = [...new Set((previous?.waiting ?? []).map(row => row.movementId))];
  const ids = known?.ids ?? fallbackIds;
  const pending = !previous?.selectionRequired && previous?.last?.state === 'pending' ? previous.last.movementId
    : !previous?.truncated && fallbackIds.length === 1 ? fallbackIds[0] : undefined;
  const capacityFocus = request.capacityAction && !previous?.selectionRequired && previous?.last?.afterClosed ? previous.last.movementId : undefined;
  const anchored = request.movementId ?? (request.afterClosed ? capacityFocus ?? pending : previous?.clearedMovementId);
  const candidates = anchored != null ? [anchored] : (known?.truncated ?? previous?.truncated) ? []
    : ids.filter(id => verifiedBatchMovement(current, id, domain));
  const checked = candidates.map(movementId => compareBatchCorrection(current, previous, { movementId, capacityAction: request.capacityAction }, domain));
  const verified = checked.filter(row => row.verified);
  const chosen = anchored != null ? checked[0] : verified.length === 1 ? verified[0] : null;
  if (chosen) return { ...chosen, partial: true, includeSummary: true,
    reference: request.afterClosed ? { ...chosen.reference, afterClosed: true } : chosen.reference,
    clearedMovementId: request.afterClosed && !chosen.verified ? undefined : chosen.movementId };
  const reply = request.mode === 'read' ? '已重新核对原单和各批最新回执。'
    : `请给出要续办的已核清回执对应的${refLabel}编号。`;
  return { partial: true, includeSummary: true, clearedMovementId: null, reply };
}
