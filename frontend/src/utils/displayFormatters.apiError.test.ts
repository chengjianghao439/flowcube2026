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
    .toBe('该库存条码已被其它任务占用')
  expect(resolveApiErrorMessage('CONFLICT', '')).toMatch(/操作失败/)
})

// 2026-09-18 审计 P2：formatBackendCode 原本按 `_INVALID / _CONFLICT / _NOT_FOUND / _FORBIDDEN /
// _ERROR / _FAILED` 后缀批量映射成通用文案，于是**具体业务码**也被当成通用码，把后端给出的、
// 可行动的中文原文替换成「当前操作无效，请刷新后重试」。现场只能反复刷新，不知道该修什么。
// 现在只有显式登记在码表里的码才允许覆盖，其余一律透出后端原文。
test('未登记的带后缀业务码必须保留后端原文，不被后缀映射吞掉', () => {
  expect(resolveApiErrorMessage('AUTH_OLD_PASSWORD_INVALID', '旧密码错误'))
    .toBe('旧密码错误')
  expect(resolveApiErrorMessage('INBOUND_PURCHASE_SOURCE_INVALID', '该收货行缺少合法采购来源，请核对后重试'))
    .toBe('该收货行缺少合法采购来源，请核对后重试')
  expect(resolveApiErrorMessage('OVER_RECEIVE_CONFIRM_REQUIRED', '超收已超过确认阈值，请确认后重试'))
    .toBe('超收已超过确认阈值，请确认后重试')
  expect(resolveApiErrorMessage('PURCHASE_RETURN_ITEM_LINK_MISSING', '该退货任务缺少行级关联，请联系管理员处理'))
    .toBe('该退货任务缺少行级关联，请联系管理员处理')
  // 后端没给原因时仍退回兜底文案，不能变成空白
  expect(resolveApiErrorMessage('SOMETHING_FAILED', '')).toMatch(/操作失败/)
})
