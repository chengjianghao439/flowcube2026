#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const {
  WT_STATUS,
  WT_STATUS_NAME,
  WT_STATUS_TONE,
  WT_STATUS_ACTIVE,
  WT_STATUS_PICK_POOL,
  WT_STATUS_TERMINAL,
  WT_TRANSITIONS,
  WT_ACTION_RULES,
} = require(path.join(root, 'backend/src/constants/warehouseTaskStatus'))
const {
  SALE_STATUS,
  SALE_STATUS_NAME,
  SALE_STATUS_TONE,
  SALE_STATUS_ACTIVE,
  SALE_STATUS_TERMINAL,
} = require(path.join(root, 'backend/src/constants/saleOrderStatus'))
const { DOCUMENT_STATUS_RULES } = require(path.join(root, 'backend/src/constants/documentStatusRules'))

const outFile = path.join(root, 'frontend/src/generated/status.ts')

function stableObject(obj) {
  if (Array.isArray(obj)) return obj.map(stableObject)
  if (!obj || typeof obj !== 'object') return obj
  return Object.fromEntries(
    Object.keys(obj)
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((key) => [key, stableObject(obj[key])]),
  )
}

function tsConst(name, value) {
  return `export const ${name} = ${JSON.stringify(stableObject(value), null, 2)} as const`
}

function buildOptions(statusName) {
  return Object.entries(statusName).map(([value, label]) => ({ value: String(value), label }))
}

const wtKanbanColumns = [
  { status: WT_STATUS.PICKING, label: WT_STATUS_NAME[WT_STATUS.PICKING], accentClass: 'bg-primary/10' },
  { status: WT_STATUS.SORTING, label: WT_STATUS_NAME[WT_STATUS.SORTING], accentClass: 'bg-yellow-500/10' },
  { status: WT_STATUS.CHECKING, label: WT_STATUS_NAME[WT_STATUS.CHECKING], accentClass: 'bg-purple-500/10' },
  { status: WT_STATUS.PACKING, label: WT_STATUS_NAME[WT_STATUS.PACKING], accentClass: 'bg-orange-500/10' },
  { status: WT_STATUS.SHIPPING, label: WT_STATUS_NAME[WT_STATUS.SHIPPING], accentClass: 'bg-cyan-500/10' },
  { status: WT_STATUS.SHIPPED, label: WT_STATUS_NAME[WT_STATUS.SHIPPED], accentClass: 'bg-green-500/10' },
  { status: WT_STATUS.CANCELLED, label: WT_STATUS_NAME[WT_STATUS.CANCELLED], accentClass: 'bg-red-500/5' },
]

const lines = [
  '/* eslint-disable */',
  '// AUTO-GENERATED FILE. Do not edit manually.',
  '// Source: backend/src/constants/warehouseTaskStatus.js, backend/src/constants/saleOrderStatus.js',
  '// Regenerate with: node scripts/generate-status-constants.js',
  '',
  "export type StatusTone = 'draft' | 'active' | 'success' | 'danger'",
  '',
  tsConst('WT_STATUS', WT_STATUS),
  'export type WtStatus = typeof WT_STATUS[keyof typeof WT_STATUS]',
  tsConst('WT_STATUS_NAME', WT_STATUS_NAME),
  tsConst('WT_STATUS_TONE', WT_STATUS_TONE),
  tsConst('WT_STATUS_ACTIVE', WT_STATUS_ACTIVE),
  tsConst('WT_STATUS_PICK_POOL', WT_STATUS_PICK_POOL),
  tsConst('WT_STATUS_TERMINAL', WT_STATUS_TERMINAL),
  tsConst('WT_TRANSITIONS', WT_TRANSITIONS),
  tsConst('WT_ACTION_RULES', WT_ACTION_RULES),
  tsConst('WT_STATUS_OPTIONS', [
    { value: '', label: '全部状态' },
    ...buildOptions(WT_STATUS_NAME).filter((item) => item.value !== String(WT_STATUS.PENDING)),
  ]),
  tsConst('WT_KANBAN_COLUMNS', wtKanbanColumns),
  '',
  tsConst('SALE_STATUS', SALE_STATUS),
  'export type SaleStatus = typeof SALE_STATUS[keyof typeof SALE_STATUS]',
  tsConst('SALE_STATUS_NAME', SALE_STATUS_NAME),
  tsConst('SALE_STATUS_TONE', SALE_STATUS_TONE),
  tsConst('SALE_STATUS_ACTIVE', SALE_STATUS_ACTIVE),
  tsConst('SALE_STATUS_TERMINAL', SALE_STATUS_TERMINAL),
  tsConst('SALE_ACTION_RULES', DOCUMENT_STATUS_RULES.sale.actions),
  tsConst('SALE_STATUS_OPTIONS', [{ value: '', label: '全部状态' }, ...buildOptions(SALE_STATUS_NAME)]),
  '',
]

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, `${lines.join('\n')}\n`)
console.log(`[generate-status-constants] wrote ${path.relative(root, outFile)}`)
