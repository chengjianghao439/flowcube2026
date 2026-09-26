import { describe, expect, test } from 'vitest'
import { ApiClientError } from '@/api/client'
import { isBackfillApplication, periodClosedError } from './backfillFlow'

/**
 * 跨期补录接线的边界测试（2026-09-26 一致性审查 · 任务 7）。
 *
 * 两个判定都只按「错误码」和「返回体形状」走，没有 HTTP 状态可用（`payloadRequest` 只把 `data`
 * 交给调用方），所以判错不会有任何报错——只会静默地把「已提交待审批」显示成「钱已付」。
 */

describe('periodClosedError：只认 FINANCE_PERIOD_CLOSED 这个闸门错误', () => {
  test('期间已结账：返回错误本身（弹窗要展示后端原话）', () => {
    const e = new ApiClientError({ message: '会计期间已结账，请走跨期补录', status: 409, code: 'FINANCE_PERIOD_CLOSED' })
    expect(periodClosedError(e)).toBe(e)
    expect(periodClosedError(e)?.message).toBe('会计期间已结账，请走跨期补录')
  })

  test('其它业务错误不触发补录申请', () => {
    expect(periodClosedError(new ApiClientError({ message: '余额不足', code: 'INSUFFICIENT_BALANCE' }))).toBe(null)
    expect(periodClosedError(new ApiClientError({ message: '参数不合法', code: 'VALIDATION_ERROR' }))).toBe(null)
  })

  test('code 为空的 ApiClientError、普通 Error 与非错误值都不触发', () => {
    expect(periodClosedError(new ApiClientError({ message: '无 code' }))).toBe(null)
    expect(periodClosedError(new Error('FINANCE_PERIOD_CLOSED'))).toBe(null)
    // 形状相同但不是 ApiClientError 实例（例如别处构造的普通对象）不算：靠 instanceof 判定，
    // 否则任何带 code 字段的载荷都能把用户送进补录申请流程
    expect(periodClosedError({ code: 'FINANCE_PERIOD_CLOSED', message: '伪造' })).toBe(null)
    expect(periodClosedError(undefined)).toBe(null)
  })
})

describe('isBackfillApplication：只有申请单才提示「待审批」', () => {
  test('补录申请单（HTTP 202 的返回体）判为 true', () => {
    expect(isBackfillApplication({ id: 12, applicationNo: 'BF2026092600001' })).toBe(true)
  })

  test('三类业务结果都判为 false', () => {
    // 付款登记：payments.service 的返回
    expect(isBackfillApplication({ newPaid: 100, newBalance: 20, status: 3, entryId: 9 })).toBe(false)
    // 收款核销：创建汇款单/核销的返回
    expect(isBackfillApplication({ receiptNo: 'SK20260926001', balance: 0 })).toBe(false)
    // 退款执行
    expect(isBackfillApplication({ refundNo: 'TK20260926001', amount: 100 })).toBe(false)
  })

  test('applicationNo 必须是字符串，空对象/空值/非对象都不是申请单', () => {
    expect(isBackfillApplication({})).toBe(false)
    expect(isBackfillApplication({ id: 12 })).toBe(false)
    expect(isBackfillApplication({ applicationNo: 20260926 })).toBe(false)
    expect(isBackfillApplication({ applicationNo: null })).toBe(false)
    expect(isBackfillApplication(null)).toBe(false)
    expect(isBackfillApplication(undefined)).toBe(false)
    expect(isBackfillApplication('BF2026092600001')).toBe(false)
  })
})
