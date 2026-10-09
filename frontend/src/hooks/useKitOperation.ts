import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { assertKitReadOwner } from './useKits'
import type { KitReadOwner } from '@/api/kits'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { createRequestKey } from '@/lib/requestKey'
import { kitQuerySession } from '@/lib/kitRecoveryIdentity'
import {
  loadKitQuery,
  queryRecordOwned,
  receiptMatches,
  removeKitQuery,
  sameStoredKitQuery,
  saveKitQuery,
  type KitQueryRecord
} from '@/lib/kitOperationRecovery'

type QueryIdentity = Pick<
  KitQueryRecord,
  'action' | 'kind' | 'resourceType' | 'resourceId' | 'context'
>
export interface KitOperationConfirmation<P, R> {
  data: R
  query: KitQueryRecord
  payload?: P
  owner: KitReadOwner
  queryOnly: boolean
}
/** Kit sales, source-return creation and cancel-return use one narrow receipt flow.
 * Only the mounted page owns a frozen body; storage restores query identity only. */
export function useKitOperation<P, R>(
  owner: KitReadOwner,
  scope: string,
  options: {
    execute: (
      payload: P,
      query: KitQueryRecord,
      owner: KitReadOwner
    ) => Promise<R>
    validate: (data: R, query: KitQueryRecord) => boolean
    mayWrite?: (payload: P) => boolean
    isCurrent?: () => boolean
  }
) {
  const currentGuard = useRef(options.isCurrent)
  currentGuard.current = options.isCurrent
  function assertCurrent() {
    if (currentGuard.current && !currentGuard.current())
      throw new Error('页面读取归属已变化，原请求和草稿保持冻结，请核对原来源')
  }
  const [originalView] = useState(() => ({ scope, ...owner }))
  const currentView = useRef({ scope, ...owner })
  currentView.current = { scope, ...owner }
  const sameView = () =>
    JSON.stringify(currentView.current) === JSON.stringify(originalView)
  const [initial] = useState(() => {
    try {
      return { query: loadKitQuery(scope), error: '' }
    } catch (e) {
      return {
        query: null,
        error: e instanceof Error ? e.message : '原查询记录无法读取'
      }
    }
  })
  const queryRef = useRef<KitQueryRecord | null>(initial.query)
  const mountedBody = useRef<{
    payload: P
    owner: KitReadOwner
    uncertain: boolean
  } | null>(null)
  const mounted = useRef(true),
    running = useRef(false),
    last = useRef<KitOperationConfirmation<P, R> | null>(null)
  const [pending, setPending] = useState(initial.query),
    [error, setError] = useState(initial.error),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [storageBlocked, setStorageBlocked] = useState(!!initial.error)
  useAuthStore((state) => state.sessionGeneration)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  function owns(query: KitQueryRecord, generation: number) {
    try {
      assertCurrent()
      return (
        sameView() &&
        mounted.current &&
        queryRef.current === query &&
        useAuthStore.getState().sessionGeneration === generation &&
        queryRecordOwned(query) &&
        sameStoredKitQuery(query)
      )
    } catch {
      return false
    }
  }
  function finish(
    data: R,
    query: KitQueryRecord,
    readOwner: KitReadOwner
  ): KitOperationConfirmation<P, R> | null {
    if (!options.validate(data, query))
      throw new Error('原操作结果无法核对归属，请继续查询')
    assertCurrent()
    const body = mountedBody.current
    try {
      removeKitQuery(query)
    } catch {
      throw new Error(
        '原业务结果已确认，但查询记录未能安全清理，请保留阻断并核对浏览器存储；不要新建请求'
      )
    }
    const answer = {
      data,
      query,
      payload: body?.payload,
      owner: body?.owner ?? readOwner,
      queryOnly: !body
    }
    queryRef.current = null
    mountedBody.current = null
    setPending(null)
    setError('')
    last.current = answer
    return answer
  }
  function markUnknown(query: KitQueryRecord, message: string) {
    if (mountedBody.current) mountedBody.current.uncertain = true
    setPending(query)
    setError(message)
  }
  async function execute(
    query: KitQueryRecord
  ): Promise<KitOperationConfirmation<P, R> | null> {
    const body = mountedBody.current
    if (!body) return null
    if (!sameView()) throw new Error('页面来源或草稿已变化，原请求保持冻结')
    assertKitReadOwner(body.owner)
    if (options.mayWrite && !options.mayWrite(body.payload))
      throw new Error('原操作权限已变化，草稿保留')
    assertCurrent()
    const generation = body.owner.sessionGeneration
    try {
      const data = await options.execute(body.payload, query, body.owner)
      if (!owns(query, generation)) {
        if (mounted.current)
          markUnknown(query, '原结果已收到，但来源或登录状态已变化，草稿保留')
        return null
      }
      return finish(data, query, body.owner)
    } catch (caught) {
      if (!mounted.current || queryRef.current !== query) return null
      const e = caught as {
        status?: number
        response?: { status?: number }
        message?: string
      }
      const status = e.status ?? e.response?.status
      if (
        !owns(query, generation) ||
        body.uncertain ||
        status == null ||
        status === 408 ||
        status >= 500
      ) {
        markUnknown(
          query,
          e.message || '提交结果待确认。原请求已冻结，请先查询原操作结果。'
        )
      } else {
        removeKitQuery(query)
        queryRef.current = null
        mountedBody.current = null
        setPending(null)
        setConflict(status === 409)
        setError(e.message || '原操作被拒绝，草稿保留')
      }
      return null
    }
  }
  async function guarded(
    run: () => Promise<KitOperationConfirmation<P, R> | null>
  ) {
    if (running.current) return null
    running.current = true
    setBusy(true)
    setConflict(false)
    try {
      return await run()
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : '原操作无法核实')
      return null
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function submit(payload: P, identity: QueryIdentity) {
    if (queryRef.current || initial.error) return null
    return guarded(async () => {
      if (!sameView()) throw new Error('页面来源或草稿已变化，请核对原请求')
      assertKitReadOwner(owner)
      if (options.mayWrite && !options.mayWrite(payload))
        throw new Error('你没有本次操作权限，草稿保留')
      assertCurrent()
      const query: KitQueryRecord = {
        version: 1,
        draftId: crypto.randomUUID(),
        scope,
        sessionId: kitQuerySession(),
        userId: owner.userId!,
        baseURL: owner.baseURL,
        requestKey: createRequestKey(identity.kind),
        action: identity.action,
        kind: identity.kind,
        resourceType: identity.resourceType,
        ...(identity.resourceId == null
          ? {}
          : { resourceId: identity.resourceId }),
        ...(identity.context ? { context: identity.context } : {})
      }
      try {
        saveKitQuery(query)
      } catch (e) {
        setStorageBlocked(true)
        throw e
      }
      queryRef.current = loadKitQuery(scope)!
      mountedBody.current = {
        payload: JSON.parse(JSON.stringify(payload)) as P,
        owner,
        uncertain: false
      }
      last.current = null
      setPending(queryRef.current)
      return execute(queryRef.current)
    })
  }
  async function queryOriginal(retry: boolean) {
    const query = queryRef.current
    if (!query) return null
    return guarded(async () => {
      assertCurrent()
      const generation = useAuthStore.getState().sessionGeneration
      if (!owns(query, generation))
        throw new Error(
          '原记录的服务器、账号或登录状态已变化，请回原来源人工核对'
        )
      const readOwner = {
        baseURL: query.baseURL,
        userId: query.userId,
        sessionGeneration: generation
      }
      const result = await getOperationRequestStatusApi(
        query.requestKey,
        query.action,
        {
          baseURL: readOwner.baseURL,
          _authSessionGeneration: readOwner.sessionGeneration,
          _erpApiFallbackTried: true,
          skipGlobalError: true
        }
      )
      assertCurrent()
      if (!owns(query, generation)) return null
      if (result.status === 'success') {
        if (!receiptMatches(query, result))
          throw new Error('原操作结果对应的单据不符，请保留记录并核对')
        return finish(result.data as R, query, readOwner)
      }
      if (result.status === 'failed') {
        if (
          (result.resourceType != null || result.resourceId != null) &&
          !receiptMatches(query, result)
        )
          throw new Error('失败结果对应的原单据无法核对，请保留待确认记录')
        removeKitQuery(query)
        queryRef.current = null
        mountedBody.current = null
        setPending(null)
        setError(result.message || '原操作已确认失败，草稿保留')
        return null
      }
      if (result.status === 'not_found' && retry && mountedBody.current)
        return execute(query)
      setError(
        result.status === 'not_found'
          ? '暂未找到原操作结果，这不证明提交失败。刷新后只可继续查询；原表单未保存，不能重新拼接提交。'
          : '原请求仍在处理中，请稍后再次查询，不要另发请求。'
      )
      return null
    })
  }
  // Viewing a confirmed receipt never reapplies its old payload. Ownership checks still apply.
  function canView(answer: KitOperationConfirmation<P, R>): boolean {
    return last.current === answer &&
      !queryRef.current &&
      !running.current &&
      sameView() &&
      mounted.current &&
      (() => {
        try {
          assertCurrent()
          assertKitReadOwner(answer.owner)
          return queryRecordOwned(answer.query)
        } catch {
          return false
        }
      })()
  }
  return {
    blocked: busy || !!pending || storageBlocked,
    storageBlocked,
    submit,
    queryOriginal: () => queryOriginal(false),
    retry: () => queryOriginal(true),
    pending,
    busy,
    error,
    conflict,
    pendingPayload: mountedBody.current?.payload,
    canRetry: !!pending && !!mountedBody.current,
    canApply: (answer: KitOperationConfirmation<P, R>) => !answer.queryOnly && canView(answer),
    canView,
  }
}
