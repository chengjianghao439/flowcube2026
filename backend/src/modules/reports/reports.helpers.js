function firstValue(row, key, fallback = 0) {
  if (!row || row[key] == null) return fallback
  const n = Number(row[key])
  return Number.isFinite(n) ? n : fallback
}

function mapWorkbenchItem(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    path: row.path,
    badge: row.badge || null,
    hint: row.hint || null,
    createdAt: row.createdAt || null,
  }
}

const WORKBENCH_CARD_PRIORITY = {
  'warehouse-pending-receive': 10,
  'warehouse-putaway': 20,
  'warehouse-audit': 30,
  'warehouse-print': 40,
  'sale-pending-ship': 10,
  'sale-anomaly': 20,
  'sale-below-cost': 30,
  'management-audit': 10,
  'management-anomaly-task': 20,
  'management-stock': 30,
  'management-high-risk': 40,
}

const WORKBENCH_CARD_PRIORITY_LABEL = {
  'warehouse-pending-receive': 'P1',
  'warehouse-putaway': 'P2',
  'warehouse-audit': 'P3',
  'warehouse-print': 'P4',
  'sale-pending-ship': 'P1',
  'sale-anomaly': 'P2',
  'sale-below-cost': 'P3',
  'management-audit': 'P1',
  'management-anomaly-task': 'P2',
  'management-stock': 'P3',
  'management-high-risk': 'P4',
}

const WORKBENCH_SECTION_PRIORITY = {
  warehouse: 10,
  sale: 20,
  management: 30,
}

function getWorkbenchCardPriority(cardKey) {
  return WORKBENCH_CARD_PRIORITY[cardKey] ?? 1000
}

function getWorkbenchCardPriorityLabel(cardKey) {
  return WORKBENCH_CARD_PRIORITY_LABEL[cardKey] ?? 'P4'
}

function getWorkbenchSectionPriority(sectionKey) {
  return WORKBENCH_SECTION_PRIORITY[sectionKey] ?? 1000
}

function sortWorkbenchSections(sections) {
  return [...sections]
    .map(section => ({
      ...section,
      priorityRank: getWorkbenchSectionPriority(section.key),
      cards: [...section.cards]
        .map(card => ({
          ...card,
          priorityRank: getWorkbenchCardPriority(card.key),
          priorityLabel: getWorkbenchCardPriorityLabel(card.key),
        }))
        .sort((a, b) => {
          if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank
          return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN')
        }),
    }))
    .sort((a, b) => {
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank
      return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN')
    })
}

function pickTopWorkbenchCard(sections) {
  const cards = []
  for (const section of sections) {
    for (const card of section.cards) {
      if (Number(card.count) > 0) {
        cards.push({
          ...card,
          sectionKey: section.key,
          sectionTitle: section.title,
          sectionDescription: section.description,
        })
      }
    }
  }

  if (!cards.length) return null

  cards.sort((a, b) => {
    const scoreA = Number(a.count) * 1000 - getWorkbenchCardPriority(a.key)
    const scoreB = Number(b.count) * 1000 - getWorkbenchCardPriority(b.key)
    if (scoreA !== scoreB) return scoreB - scoreA
    return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN')
  })

  const top = cards[0]
  return {
    sectionKey: top.sectionKey,
    sectionTitle: top.sectionTitle,
    title: top.title,
    description: top.description,
    count: top.count,
    path: top.path,
    actionLabel: top.actionLabel,
    accent: top.accent,
    priorityLabel: top.priorityLabel || getWorkbenchCardPriorityLabel(top.key),
    badge: top.accent === 'rose'
      ? '高优先'
      : top.accent === 'amber'
        ? '提醒'
        : top.accent === 'emerald'
          ? '待办'
          : '待处理',
  }
}

function buildDateFilter(column, startDate, endDate) {
  const conds = []
  const params = []
  if (startDate) {
    conds.push(`DATE(${column}) >= ?`)
    params.push(startDate)
  }
  if (endDate) {
    conds.push(`DATE(${column}) <= ?`)
    params.push(endDate)
  }
  return {
    sql: conds.length ? ` AND ${conds.join(' AND ')}` : '',
    params,
  }
}

function paymentStatusName(status) {
  return { 1: '未付', 2: '部分付', 3: '已付清' }[Number(status)] || '未知'
}

function paymentTypeName(type) {
  return Number(type) === 1 ? '应付' : '应收'
}

function safeNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

module.exports = {
  firstValue,
  mapWorkbenchItem,
  getWorkbenchCardPriority,
  getWorkbenchCardPriorityLabel,
  sortWorkbenchSections,
  pickTopWorkbenchCard,
  buildDateFilter,
  paymentStatusName,
  paymentTypeName,
  safeNum,
}
