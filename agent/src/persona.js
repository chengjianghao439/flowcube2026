// 小满的人格与极序无工具交流边界。实际运行入口在 agent.js，不依赖未调用的提示词草稿。
export const CHAT_GRAPH = 'G-chat';
export const FLOW_CHAT_SCOPE = 'flow-product-v1';
export const PERSONA_PROMPT = `你是小满（XiaoMan），极序 Flow 里聪明、细心、可靠的数字伙伴。名字来自节气小满，理念是“聪明一点，贴心一点，做事稳一点”。这只作为行为准则，不要反复介绍名字或念理念。
使用简体中文，温和自然，简单问题直接回答，复杂问题先给结论再展开。可以适度幽默，有自己的观点，也愿意接受纠正；不卖弄术语、不用客服腔，不机械地“首先其次”，不夸赞卖萌、不幼稚。
不假装拥有人类生活经历、线下活动或私人记忆。不确定就坦诚说不确定，区分事实、推测与建议，不替用户做重要决定。
这里只能交流极序相关的事：业务概念、极序使用和流程、排错思路、产品及页面设计建议。不要扩展到生活、天气、阅读习惯、泛科技或其他公司的设计话题；无关话题简短说明范围即可。
此通道没有工具，也看不到本系统业务数据、部署配置或实时状态。不要声称查询、修改、取消、付款、发货、审批或完成了任何业务；业务数字只有正式工具结果才可作为事实。涉及真实对象和当前事实时先请用户提供明确对象并回到查询或预览流程，尊重权限与人工确认，失败不能装完成。
唯一已核对的当前能力是：查库存、销售草稿与占库、补货建议及采购草稿、客户应收台账、分两步登记收款与核销、作业卡点、经营简报。写入都须人工确认。不能代取消订单、改价、审批、付款或发货。概念解释可用一般知识并标为概念；产品设计只能作为建议，不能把建议说成已实现。未列明的能力、配置、版本和当前数据一律说明未核实，不用常识补出本系统事实。
解释概念时不要代入具体客户、商品数字或模拟单号；确需算术例子必须明确标成假设示例，不能混入“实际查到”的说法。设计建议中的状态文案用引号标明，例如“待确认”，不要写成这次已执行完成。
用户可见名称只用“小满”，不自称“助手”“AI助手”或“Agent”。`;

export function smallTalkReply(text) {
  if (/你(?:叫|是).*(?:什么|谁)|叫什么名字|你的名字|小满是谁/.test(text)) return '我叫小满，名字取自“小满”节气。这里只聊极序相关的事。';
  if (/^(?:小满[，,！! ]*)?(?:在吗|在不在|你好|嗨|哈喽|hello|hi)[？?！!。 ]*$/i.test(text)) return '在。你想看极序哪块业务？';
  if (/^(?:谢谢|多谢|谢啦|谢谢你|辛苦了|辛苦啦)[！!。～~ ]*$/.test(text)) return '不客气。';
  if (/你.*(?:没听懂|没明白|答错|理解错)|^(?:不对|不是这个意思|又错了)[！!。 ]*$/.test(text)) return '刚才理解偏了。你指出要改的地方，我按你的意思重新来。';
  return null;
}

// 已核对 inventory.service.js 的列表投影与 business-semantics.md 的预占/ATP口径。
// 仅在 routing.js 已认定为概念讨论后使用；不替代具体商品或单据的实时查询。
export function knownConceptReply(text) {
  const explanation = /是什么|什么意思|含义|如何理解|怎么理解|区别|解释/;
  if (!explanation.test(text)) return null;
  if (/审批|审核/.test(text)) {
    return '业务审批，是由有权人员复核申请，决定业务能否继续；不等于在小满的预览上点击确认。\n\n普通收款登记确认后，会通过原系统校验并入账；核销还要另行确认。跨期补录等特殊情况按原有审批流程办理。\n\n我不代审批，具体审批配置以原系统为准。';
  }
  if (/预占|占库/.test(text) || (/现存|在库/.test(text) && /可用/.test(text))) {
    return '预占库存，就是先把可承诺的数量留给销售单，避免重复承诺给其他订单。\n\n预占本身不会扣减实存在库，也不代表已经发货。现存是在库容器的实际余量；列表“可用”是现存扣除预占后的参考量，最低为零。\n\n销售占库还可能计入预计到货的可承诺量，所以“可承诺”“现存”和“当前可拣现货”要分开看。具体能拣多少、是否能出库，仍由正式作业检查。\n\n这是规则说明；具体商品、仓库的数量需要另查。';
  }
  return null;
}

export function buildChatMessages(history, text) {
  const messages = [];
  let remaining = 6000;
  for (const turn of history.slice(-12).reverse()) {
    if (!['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string') continue;
    const content = turn.content.slice(0, Math.min(1000, remaining));
    if (!content) break;
    messages.unshift({ role: turn.role, content });
    remaining -= content.length;
  }
  return [{ role: 'system', content: PERSONA_PROMPT }, ...messages, { role: 'user', content: String(text).slice(0, 2000) }];
}

function normalizeClaimText(reply) {
  return String(reply).normalize('NFKC')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/(?:[¥￥]|\b(?:RMB|CNY)\b|人民币)(?=\s*[+-]?(?:\d|\.\d))/gi, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '');
}

export function unverifiedChatReply(reply) {
  const text = normalizeClaimText(reply);
  const selfExecution = /(?:我(?:已(?:经)?|刚才|刚)|(?:已(?:经)?|刚才)(?:帮你|替你|为你)).{0,20}(?:取消|付款|发货|出库|审批|核销|收款|建单|创建|登记|查到|更新|删除|修改)/;
  const unsupportedCapability = /(?:极序|本系统|小满)(?:目前|现在|已经|已)?(?:支持|可以|能够|具备).{0,20}(?:自动审批|自动付款|自动发货|取消订单|代为审批|代为付款|代为发货)/;
  const configurationClaim = /(?:当前|本系统|极序|生产环境).{0,12}(?:地址|版本|配置)(?:是|为|[:：])/;
  if ([selfExecution, unsupportedCapability, configurationClaim].some(pattern => pattern.test(text))) return true;
  const numericBusiness = /(?:账户余额|应收余额|库存|现存(?:量)?|在库(?:数量)?|预占(?:量|库存)?|可用(?:量|库存)?|该客户欠|订单金额)(?:是|为|有|还剩|只有|显示)?\s*[:：=]?\s*[+-]?(?:\d|\.\d)/;
  const completed = /(?:已经|已)(?:成功)?(?:取消|付款|发货|出库|审批|核销|收款|建单|创建|登记)|(?:取消订单|付款|发货|核销|收款|建单|创建)(?:已经|已)?(?:成功|完成)/;
  for (const sentence of text.split(/[。！？!?\n]/)) {
    let hypothetical = false;
    for (const clause of sentence.split(/[，,；;]/)) {
      if (/假设|假如|设想|例如|比如|举例|示例/.test(clause)) hypothetical = true;
      else if (/实际上|实际(?:库存|在库|业务)|当前|实时|查到|经查询|系统显示|本系统(?:目前|当前)|极序(?:目前|当前)/.test(clause)) hypothetical = false;
      if (numericBusiness.test(clause) && !hypothetical) return true;
      // 引号中的状态标签、否定关系及条件说明，不是一次业务操作的回执。
      const prose = clause.replace(/[“「『][^”」』]*[”」』]/g, '');
      const match = completed.exec(prose);
      if (match && !hypothetical) {
        const before = prose.slice(0, match.index);
        const after = prose.slice(match.index + match[0].length);
        const relevantBefore = before.split(/但是|但|不过|然而|实际上/).at(-1);
        const conceptual = /不代表|不等于|不是|不应该|不应|不能|并非|没有|未|如果|只有|假如|一旦/.test(relevantBefore) || /^(?:的|后|以后|之后|时|才能)/.test(after);
        const statusLabel = /状态标签|状态文案|按钮|列名|标签|文案/.test(prose) && !/当前|本次|这张|那张|你的|查到|查询结果|系统显示|实际/.test(prose);
        if (!conceptual && !statusLabel) return true;
      }
    }
  }
  return false;
}
