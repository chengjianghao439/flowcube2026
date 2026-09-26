import { describe, expect, test } from 'vitest'
import { ApiClientError } from '@/api/client'
import { isUncertainError, receiptDecision } from './useIdempotentSubmit'

/**
 * 请求键轮换规则的边界测试（2026-09-26 一致性审查 · 任务 7）。
 *
 * `receiptDecision` 是**两处调用方共用**的判定：付款/核销/退款三入口（useIdempotentSubmit.checkLastResult）
 * 与新建手工应付（CreateManualPayableDialog.checkMut）。边界只有一条：什么时候允许换请求键。
 * 判错的代价不对称——把「可能已经做成」当成「确定没做成」并换键，就是重复付款/重复核销。
 */

describe('receiptDecision：只有服务端明确写下失败行才允许换键', () => {
  test('success：换键（这一笔已有确定结果，下一次是全新一笔）', () => {
    expect(receiptDecision('success')).toEqual({ rotateKey: true, keepUncertain: false })
  })

  test('failed：换键（服务端明确记了失败行，未结束的事务会挡住这次 UPDATE）', () => {
    expect(receiptDecision('failed')).toEqual({ rotateKey: true, keepUncertain: false })
  })

  test('pending：保留键且维持未确认（结果还没落地）', () => {
    expect(receiptDecision('pending')).toEqual({ rotateKey: false, keepUncertain: true })
  })

  test('not_found：保留键且维持未确认（查不到 ≠ 没做成）', () => {
    // PENDING 行写在业务事务里（backend/src/utils/operationRequest.js 的 beginOperationRequest
    // 用业务事务的连接），事务提交前另一个连接读不到；而查回执走的正是另一条连接。
    // 上次提交超时但服务端仍在处理时必然得到 not_found。此时换键重提＝把同一笔再做一遍。
    expect(receiptDecision('not_found')).toEqual({ rotateKey: false, keepUncertain: true })
  })

  test('四种回执里只有 success/failed 换键', () => {
    const rotating = (['pending', 'success', 'failed', 'not_found'] as const).filter(s => receiptDecision(s).rotateKey)
    expect(rotating).toEqual(['success', 'failed'])
  })
})

describe('isUncertainError：只认传输层失败', () => {
  test('超时与断网属于未确认', () => {
    expect(isUncertainError(new ApiClientError({ message: '请求超时', code: 'REQUEST_TIMEOUT' }))).toBe(true)
    expect(isUncertainError(new ApiClientError({ message: '网络错误', code: 'NETWORK_ERROR' }))).toBe(true)
  })

  test('业务错误是确定的失败，不是未确认', () => {
    expect(isUncertainError(new ApiClientError({ message: '期间已结账', code: 'FINANCE_PERIOD_CLOSED' }))).toBe(false)
    expect(isUncertainError(new ApiClientError({ message: '参数不合法', code: 'VALIDATION_ERROR' }))).toBe(false)
  })

  test('没有 code 的错误、非错误值都不算未确认', () => {
    expect(isUncertainError(new Error('boom'))).toBe(false)
    expect(isUncertainError(undefined)).toBe(false)
    expect(isUncertainError(null)).toBe(false)
  })
})
