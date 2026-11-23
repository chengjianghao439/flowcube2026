import { compositeRoute } from './composite-routing.js';
import { operationsReadRoute } from './operations-read.js';
import { handoffRequest, SALE_HANDOFF_GRAPH } from './sale-handoff.js';
import { saleTraceRequest } from './sale-trace.js';
import { receiptAllocationRequest } from './receipt-allocation.js';
import { MONTHLY_GRAPH, monthlyRequest } from './monthly-reconciliation.js';
import { CROSS_PERIOD, BACKFILL_ACTION, crossPeriodRequest } from './cross-period.js';
import { RETURN_FINANCE, REFUND_EXECUTE, returnFinanceRequest } from './return-finance.js';

// 消息分流与确定性业务规则共用一份定义，避免“入口判闲聊、后续却有业务规则”的漂移。
const RULE_ROUTES = [
  ['F-briefing', /简报/],
  ['E-stuck', /卡住|卡点|卡着/],
  ['C-purchase-draft', /(?:建|做|生成|准备|起)(?:一?[个张份])?\s*(?:采购草稿|采购单)|采购草稿(?:试算|预览)/],
  ['C-replenishment', /补货|(?:哪些|什么).{0,8}货.{0,6}(?:补|缺)/],
  ['B2-reserve', /占库|SL\d{6,}.*预占|预占.*SL\d{6,}/i],
  ['D-receipt', /核销/],
  ['B-sale-draft', /(?:开|建|做|准备|创建)(?:一?[个张份])?销售(?:单|草稿)|开单|下一单(?!据)|开一单|做一单|来一单|下个单|开个单|做个单|来个单|销售草稿|(?:做|开|下|来|建|新建|创建)(?:一)?(?:个|张|份)?\s*(?:销售)?订单/],
  ['D-ledger', /应收|结清|的账|欠款|(?:还有|还剩)多少(?:没收|未收)/],
  ['A-inventory', /还剩|库存|有多少/],
];
const GUIDE_LINKS = [
  ['销售订单', '/sale'],
  ['新建销售单', '/sale/new-kit'],
  ['采购订单', '/purchase'],
  ['库存管理', '/inventory'],
  ['客户往来', '/payments/receivable'],
  ['供应商往来', '/payments/payable'],
  ['待审批', '/approvals/pending'],
  ['发货出库', '/warehouse-shipping'],
  ['商品资料', '/products'],
];
const guideToken = ([label, path]) => `[[${label}|${path}]]`;
function guideLinksFor(text) {
  const picked = [];
  const add = (label) => {
    const item = GUIDE_LINKS.find(([name]) => name === label);
    if (item && !picked.some(([, path]) => path === item[1])) picked.push(item);
  };
  if (/取消|作废/.test(text)) add('销售订单');
  if (/改价|价格/.test(text)) { add('商品资料'); add('销售订单'); }
  if (/审批|审核/.test(text)) add('待审批');
  if (/付款|退款/.test(text)) add('供应商往来');
  if (/发货|出库/.test(text)) add('发货出库');
  if (/采购/.test(text)) add('采购订单');
  if (/库存|还剩|有多少/.test(text)) add('库存管理');
  if (/账款|欠款|应收|收款|台账/.test(text)) add('客户往来');
  if (!picked.length) ['新建销售单', '库存管理', '采购订单', '客户往来'].forEach(add);
  return picked.map(guideToken).join('、');
}
const OUTSIDE_FLOW_REPLY = `这边只聊极序相关的事。要查库存或开单，直接说。也可以先打开 ${guideLinksFor('')}。`;
export const DISCUSSION_CLOSED_REPLY = `小满不做开放讨论。要办事直接说，例如「做个订单」或「查库存」，也可以打开 ${guideLinksFor('')}。`;
const CLARIFY_BUSINESS_REPLY = '请说明要查询的对象：单据请给出类型和完整单号，账款请给出客户全称，库存请给出商品和仓库。我不会把“这张单”或“那笔款”猜成某一条记录。';
function blockedGuide(text) {
  return `这一步我不能代为办理。请到对应菜单继续：${guideLinksFor(text)}。我不会替你提交。`;
}
export function guideReply(text) {
  return `我没直接对上要办的事。可以直接说「做个订单」或「查库存」，也可以先打开 ${guideLinksFor(text)}。`;
}

export function ruleGraphFor(text) { return RULE_ROUTES.find(([, pattern]) => pattern.test(text))?.[0] || null; }

// 显式换话题后，只用最后的新目标判断归属；前文提到极序不能充当许可。
export function activeTopicText(input) {
  const text = String(input || '').trim();
  const switches = [...text.matchAll(/(?:换(?:个|一个)?话题|转而(?:聊|谈|讨论)|接下来(?:聊|谈|讨论)|(?:^|[，,；;。]\s*)(?:另外(?:再)?(?:问(?:一下|下|个问题|个事)?|想问)|再问个(?:事|问题)|还有个问题|另(?:开|起|做|建)(?:一)?[张个份](?:新(?:的)?单)?|另一个问题))([，,:：；;。！!？?\s]*)(?:(?:我们|来)?(?:聊聊|聊|说说|说|谈谈|谈|讨论)(?:一下)?)?[，,:：；;。！!？?\s]*/g)];
  const last = switches.at(-1);
  return last ? text.slice(last.index + last[0].length).trim() : text;
}

// 只有查库存的指令与仓库说明，未提供具体商品。
export function missingInventoryProduct(text) {
  const match = /^(?:(?:小满|请|帮我|麻烦)[，,:：\s]*)*(?:只查|只看|查询一下|查一下|查询|查看|看一下|看看|查|看)\s*(?:(.{1,32}?[仓倉](?:库|庫)?)(?:的|里(?:的)?|中(?:的)?)?\s*)?(?:库存|现存|可用量)[：:。！!？?]*$/.exec(text);
  if (!match) return null;
  return { warehouseKeyword: match[1] };
}

// 真实对象或当前事实优先；概念/产品讨论必须有明确极序主题，未知话题默认不进入模型。
const FLOW_IDENTIFIER = /\b(?:(?:SL|PC|WT|IT|RT|TR|SC|PR|SR|RC|SO|PO|AR|AP)[-_]?\d{6,}|[PCSI]\d{6,})\b/i;
const FLOW_MARKER = /极序|\bFlowCube\b|(?:这个|这套|本)(?:系统|软件)/i;
const FLOW_CONCEPT = /预占|占库|ATP|库存|应收|应付|账款|台账|核销|收款|补货|授信|审批|审核|盘点|拣货|分拣|上架|销售订单|采购订单|销售单|采购单|仓库作业/;
// 极序必须是所讨论产品/流程的所属对象；仅作地点前缀或顺带提及不构成主题。
const FLOW_TOPIC = /(?:极序(?:\s*Flow)?|\bFlowCube\b|(?:这个|这套|本)(?:系统|软件))(?:里|中|上|的|里的|中的)?\s*(?:(?:的|怎么|如何|为什么|能否|可以|无法|不能|查询|查|使用|操作|打开|进入|设置|管理|优化|改进|设计|聊聊|讨论|让|把)\s*){0,4}(?:页面|界面|表格|表单|按钮|导航|菜单|交互|布局|产品设计|文案|筛选|搜索|信息层级|功能|登录|权限|流程|配置|排错|报错|错误|连接|仓库|库存|现存|在库|可用|订单|账款|欠款|销售|采购|应收|应付|预占|占库|核销|收款|补货|审批|审核|盘点|拣货|上架|发货|出库)/i;
const EXPLANATION = /是什么(?:意思|含义)?|什么是|什么意思|如何理解|怎么理解|概念|原理|区别|解释|介绍|状态机/;
const DISCUSSION = /怎么|如何|建议|设计|解释|介绍|聊聊|讨论|谈谈|你怎么看|有什么看法|是什么意思|什么意思|原理|区别|更清楚|更好用|排错|报错|错误|连不上|进不去|无法/;
const DIRECT_LOOKUP = /^(?:小满[，,:：\s]*)?(?:(?:请你|请|麻烦你|麻烦|帮我|替我|给我|帮忙|能否|可以)\s*)*(?:查(?:一下|询|看)?|看看|看一下|核对|统计|列出|显示)/;
const BUSINESS_REFERENCE = /(?:这|那)(?:一)?(?:张|笔|批)(?:订单|单据|单|账款|款项|款|货)|(?:这|那)单|刚才(?:那|这)(?:一)?(?:张|笔|批)/;
// “那个铰链”已给出商品名，不能仅因量词就当作缺实体；只拦裸指代接数据问题的形态。
const POINTER = /(?:这|那)(?:一)?(?:张|笔|批|个)(?:的)?(?:状态|余额|金额|欠款|编号|单号|进度|还有|还剩|未收|未付|怎么样|如何|在哪|[？?。！!]|$)|(?:刚才|上(?:一)?(?:笔|张|次)|它)(?:的|那|这|还有|还剩|余额|状态|[？?。！!]|$)/;
const DATA_QUESTION = /余额|金额|欠款|未收|未付|状态|进度|多少|还剩|还有|在哪|编号|单号/;
const CURRENT_FACT = /还剩|还有(?:多少|几)|(?:余额|金额|欠款|应收|应付|库存).{0,8}(?:多少|几|是\s*\d)|(?:当前|现在|实时|本系统|系统里).{0,12}(?:库存|余额|账款|订单|单据|配置|版本|地址)/;
const BUSINESS_RESOURCE = /库存|仓库|仓里|[一二三四五六七八九十\d]+仓|销售|采购|客户|供应商|应收|应付|欠款|账款|台账|未结|未收|未付|收款|到账|入账|单据|订单|单号|补货|还有货|有货吗|没货|缺货|拣货|上架|生意|权限|卡点/;
const BUSINESS_TRANSACTION = /开单|建.{0,8}草稿|占库|核销|订(?:购)?\s*(?:\d|[一二两三四五六七八九十])/;
const UNSUPPORTED_ACTION = /取消.{0,10}(?:订单|销售单|采购单)|(?:订单|销售单|采购单).{0,10}取消|删除|作废|改价|价格.{0,8}(?:改成|改为)|付款|退款|发货|出库|审批|审核|生成凭证|库存调整|调账/;
const DEFER_SALE = /^(?:先\s*)?(?:别|不要|不用|不必)\s*(?:再\s*)?(?:开(?:一?[个张份])?(?:销售)?(?:单|订单)|(?:创建|新建|建)销售(?:单|草稿))(?:了|先)?$/;
const DEFER_PURCHASE = /^(?:(?:采购单|采购草稿)(?:先)?(?:别|不要|不用|不必)(?:再)?(?:建|开|生成)|(?:先)?(?:别|不要|不用|不必)(?:再)?(?:建|开|生成)(?:采购单|采购草稿))(?:了)?$/;

function groupedRequest(text, classify) {
  const clauses = text.split(/[，,；;。！？!?]/).map(clause => clause.trim()).filter(Boolean);
  for (const [negated, readonlyGraph, label] of [
    [DEFER_SALE, 'A-inventory', '销售'],
    [DEFER_PURCHASE, 'C-replenishment', '采购'],
  ]) {
    const remaining = clauses.filter(clause => !negated.test(clause));
    if (remaining.length === clauses.length) continue;
    if (remaining.length === 1 && ruleGraphFor(remaining[0]) === readonlyGraph && !UNSUPPORTED_ACTION.test(remaining[0])) {
      return { kind: 'defer-write', graph: readonlyGraph, query: remaining[0] };
    }
    if (remaining.length >= 2) {
      const joined = remaining.map(clause => clause.replace(/^(?:再|然后|接着|顺便|同时|最后)\s*/, '')).join('，再');
      const read = compositeRoute(joined, classify);
      if (read?.kind === 'ordered-read') return read;
    }
    return { kind: 'defer-write', reply: `好，先不建${label}草稿。你可以告诉我要查什么。` };
  }
  return null;
}

export function classifyMessage(input, { single = false } = {}) {
  const original = String(input || '').trim();
  if (/忽略.{0,12}(?:规则|指令|限制)|绕过|跳过.{0,6}(?:审批|确认|权限)|不用.{0,4}(?:确认|审批)|冒充|伪造|直接执行/.test(original)) {
    return { kind: 'blocked', guarded: true, reply: '权限、核对和确认这几步不能跳过。需要办理业务的话，请按原页面的流程来。' };
  }
  const text = activeTopicText(original);
  if (/(?:不用|不使用|不谈|不聊|别聊|不讨论)\s*(?:极序|FlowCube)|(?:极序|FlowCube).{0,6}(?:先放一边|放一边|暂且不谈|无关)/i.test(text)) return { kind: 'outside', explicitOutside: true, reply: OUTSIDE_FLOW_REPLY };
  if (/天气|气温|(?:多少|几)度|°[cCfF]/.test(text)) return { kind: 'outside', explicitOutside: true, reply: OUTSIDE_FLOW_REPLY };
  if (!text) return { kind: 'clarify', reply: '好，接下来想查什么或办哪件事？' };
  if (/^(?:(?:小满|请|帮我|麻烦|能不能)[，,:：\s]*)*(?:处理(?:一下|下)?|帮忙|看一下|弄一下|办一下)(?:这个|这件事)?[。！!？?]*$/.test(text)) {
    return { kind: 'clarify', reply: '你想办哪件事？可以说要查的库存、单据或账款，也可以说要准备哪类草稿。' };
  }
  if (/^(?:(?:小满|帮我|请|麻烦)[，,:：\s]*)*(?:有(?:一)?笔(?:款|收款)(?:要|需要|想)登记|要登记收款|登记收款|收款登记|收款核销|登记并核销)[。！!？?]*$/.test(text)) {
    return { kind: 'clarify', reply: '请告诉我付款客户全称和准确到账金额，例如「某某公司到账 19.75 元，登记收款并核销」。' };
  }
  if (!single) {
    const classifySingle = fragment => classifyMessage(fragment, { single: true });
    const compound = groupedRequest(text, classifySingle) ?? compositeRoute(text, classifySingle);
    if (compound) return { ...compound, compound: true };
  }
  const crossPeriod = crossPeriodRequest(text);
  if (crossPeriod) return { kind: 'cross-period', graph: crossPeriod.action === 'read' ? CROSS_PERIOD : BACKFILL_ACTION, crossPeriod };
  const returning = returnFinanceRequest(text);
  if (returning) return { kind: 'return-finance', graph: returning.action === 'read' ? RETURN_FINANCE : REFUND_EXECUTE, returning };
  const monthly = monthlyRequest(text);
  if (monthly) return { kind: 'monthly-reconciliation', graph: monthly.action === 'read' ? MONTHLY_GRAPH : 'D-settle', monthly };
  const receipt = receiptAllocationRequest(text);
  if (receipt?.action === 'prepare') return { kind: 'receipt-allocation', graph: 'D-settle', receipt };
  const handoff = saleTraceRequest(text) ?? handoffRequest(text);
  if (handoff) return { kind: 'sale-handoff', graph: SALE_HANDOFF_GRAPH, handoff };
  if (receipt) return { kind: 'receipt-allocation', graph: 'J-receipt-status', receipt };
  const operation = operationsReadRoute(text);
  if (operation) return operation;
  const identified = FLOW_IDENTIFIER.test(text);
  const lookupText = text.replace(/^(?:在)?极序(?:\s*Flow)?(?:里|中|上)?[，,:：\s]*/i, '');
  const directLookup = DIRECT_LOOKUP.test(lookupText);
  const reference = BUSINESS_REFERENCE.test(text) || (POINTER.test(text) && (directLookup || DATA_QUESTION.test(text)));
  const conceptText = text.replace(/^(?:(?:小满|请|帮我|麻烦|解释一下|解释|介绍一下|介绍|什么是|我想知道)[，,:：\s]*)+/, '');
  const genericConcept = !FLOW_MARKER.test(text) && FLOW_CONCEPT.exec(conceptText)?.index === 0 && EXPLANATION.test(text);
  const scopedDiscussion = !identified && !reference && !directLookup && !CURRENT_FACT.test(text)
    && ((FLOW_TOPIC.test(text) && DISCUSSION.test(text)) || genericConcept);
  const readingProgress = /卡点|简报|进度|待审批|待发货|待出库|状态/.test(text)
    && !/(?:帮我|替我|直接|立即|马上).{0,5}(?:取消|删除|作废|付款|退款|发货|出库|审批|审核)/.test(text);
  if (!scopedDiscussion && !readingProgress && UNSUPPORTED_ACTION.test(text)) {
    return { kind: 'blocked', reply: blockedGuide(text) };
  }
  if (reference && !identified) return { kind: 'clarify', reply: CLARIFY_BUSINESS_REPLY };
  if (identified) return { kind: 'business', graph: ruleGraphFor(text) };
  if (scopedDiscussion) return { kind: 'discussion' };
  const graph = ruleGraphFor(text);
  if (graph || BUSINESS_RESOURCE.test(text) || BUSINESS_TRANSACTION.test(text)) return { kind: 'business', graph };
  if (directLookup) return { kind: 'clarify', reply: CLARIFY_BUSINESS_REPLY };
  return { kind: 'outside', reply: OUTSIDE_FLOW_REPLY };
}
