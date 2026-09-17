import { expect, test } from 'vitest'
import { resolveApiErrorMessage } from './displayFormatters'

// 2026-09-17 验收 ISSUE-003 / ISSUE-016：后端通用码曾把可操作的中文原因覆盖成
// 「状态已变化，请刷新后重试」，现场无法判断该去处理打印任务还是改调拨数量。
test('通用码不覆盖后端中文原因', () => {
  expect(resolveApiErrorMessage('CONFLICT', '箱贴仍待确认：箱号 L000493 尚未打印完成，请先收口打印任务'))
    .toBe('箱贴仍待确认：箱号 L000493 尚未打印完成，请先收口打印任务')
  expect(resolveApiErrorMessage('BUSINESS_ERROR', '该容器 5 件超出调拨单剩余可调量 1 件，无法整箱扫码；请核对容器与单据'))
    .toMatch(/超出调拨单剩余可调量/)
  expect(resolveApiErrorMessage(null, '任务状态已变化，请刷新后重试')).toBe('任务状态已变化，请刷新后重试')
})

test('具体业务码仍按既有映射展示，缺失原因时退回兜底文案', () => {
  expect(resolveApiErrorMessage('PDA_WAREHOUSE_MISMATCH', '设备绑定仓库与调拨源仓不一致，无法扫出'))
    .toBe('设备绑定仓库与调拨源仓不一致，无法扫出')
  expect(resolveApiErrorMessage('CONTAINER_LOCK_CONFLICT', '这个货已被其它任务占用'))
    .toBe('容器已被其它任务占用')
  expect(resolveApiErrorMessage('CONFLICT', '')).toMatch(/操作失败/)
})
