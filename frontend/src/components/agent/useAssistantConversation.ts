import { useCallback, useEffect, useRef, useState } from 'react'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { AssistantRequestError, requestAssistant } from '@/api/assistant'
import { taskNeedsRecovery, type AssistantMessage, type AssistantResponse, type AssistantTask } from './types'
import { createPreviewFreezeStore, PreviewFreezeStorageError, type PreviewFreezeObservation } from './previewFreeze'

type RecoverySnapshot = { task: AssistantTask; confirmationUncertain: boolean; confirmationRevision: number | null }
const taskRevision = (task: AssistantTask) => typeof task.revision === 'number' && Number.isSafeInteger(task.revision) && task.revision >= 0 ? task.revision : null
function olderTaskRevision(known: AssistantTask, incoming: AssistantTask) {
  const knownRevision = taskRevision(known), incomingRevision = taskRevision(incoming)
  return known.id === incoming.id && knownRevision != null && (incomingRevision == null || knownRevision > incomingRevision)
}
const terminalTask = (task: AssistantTask) => ['DONE', 'FAILED_FINAL', 'EXPIRED', 'CANCELLED'].includes(task.state)
const unavailableRecovery = '原任务暂不可读取，请核对原业务结果，勿另发重复请求。'
// 恢复集合只存展示与冻结协调必需的信息，不缓存完整预览、账户、明细或执行载荷。
function recoveryMetadata(task: AssistantTask): AssistantTask {
  return {
    id: task.id, graph: task.graph, state: task.state, userText: task.userText, revision: task.revision,
    confirmationBlocked: task.confirmationBlocked, previewUncertain: task.previewUncertain, previewStorageError: task.previewStorageError,
    preview: task.preview ? { customer: task.preview.customer ? { name: task.preview.customer.name } : undefined, orderNo: task.preview.orderNo, receiptNo: task.preview.receiptNo } : undefined,
    result: task.result ? { product: task.result.product, orderNo: task.result.orderNo, receiptNo: task.result.receiptNo } : undefined,
  }
}
function reconcileRecoverySnapshots(previous: RecoverySnapshot[], rows: AssistantTask[]): RecoverySnapshot[] {
  const next = new Map(previous.map(row => [row.task.id, row]))
  for (const task of rows) {
    const known = next.get(task.id)
    if (known && olderTaskRevision(known.task, task)) continue
    const confirmationUncertain = Boolean(known?.confirmationUncertain && !terminalTask(task))
    if (taskNeedsRecovery(task) || confirmationUncertain) next.set(task.id, { task: recoveryMetadata(task), confirmationUncertain, confirmationRevision: confirmationUncertain ? known?.confirmationRevision ?? null : null })
    else next.delete(task.id)
  }
  return [...next.values()]
}

export function useAssistantConversation() {
  const active = useActiveWorkspaceTab()
  const [tasks, setTasks] = useState<AssistantTask[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [retainedSelected, setRetainedSelected] = useState<AssistantTask | null>(null)
  const selectedTaskRef = useRef<AssistantTask | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([])
  const recoverySnapshotsRef = useRef<RecoverySnapshot[]>([])
  const [identity, setIdentity] = useState<{ realName?: string; roleName?: string; warehouseScope?: string } | null>(null)
  const [connected, setConnected] = useState(false)
  const mounted = useRef(false)
  const locked = useRef(false)
  const loadSequence = useRef(0)
  const selectionTouched = useRef(false)
  const selectionSequence = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  const sequence = useRef(0)
  const [previewFreezes] = useState(createPreviewFreezeStore)
  const selected = tasks.find(t => t.id === selectedId) ?? (retainedSelected?.id === selectedId ? retainedSelected : null)
  const recoveryId = selected && recoverySnapshots.some(row => row.task.id === selected.id && row.confirmationUncertain) ? selected.id : null
  useEffect(() => {
    selectedTaskRef.current = selected
    setRecoverySnapshots(previous => reconcileRecoverySnapshots(previous, selected && !tasks.some(task => task.id === selected.id) ? [...tasks, selected] : tasks))
  }, [tasks, selected])
  useEffect(() => { recoverySnapshotsRef.current = recoverySnapshots }, [recoverySnapshots])
  const select = useCallback((id: string | null) => { selectionSequence.current++; selectedIdRef.current = id; setSelectedId(id); if (id === null) { selectedTaskRef.current = null; setRetainedSelected(null) } }, [])
  const observePreviewFreezes = useCallback(() => {
    try { return previewFreezes.observe() }
    catch { return undefined } // 存储失败不拦只读恢复，也不给予任何清冻证据。
  }, [previewFreezes])
  const keepPreviewFreeze = useCallback((task: AssistantTask, observation?: PreviewFreezeObservation, allowAdvance = false): AssistantTask => {
    try { return { ...task, previewUncertain: previewFreezes.reconcile(task, observation, allowAdvance) && task.state === 'AWAITING_CONFIRM', previewStorageError: undefined } }
    catch (cause) { return { ...task, previewUncertain: task.state === 'AWAITING_CONFIRM', previewStorageError: task.state === 'AWAITING_CONFIRM' ? cause instanceof Error ? cause.message : '预览冻结记录读取失败，确认已暂停。' : undefined } }
  }, [previewFreezes])

  const refreshPreviewFreeze = useCallback((id: string) => {
    setTasks(rows => rows.map(row => row.id === id ? keepPreviewFreeze(row) : row))
    setRetainedSelected(row => row?.id === id ? keepPreviewFreeze(row) : row)
  }, [keepPreviewFreeze])

  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      return await requestAssistant<T>(path, body, controller.signal)
    } finally { controllers.current.delete(controller) }
  }, [])
  const append = useCallback((role: AssistantMessage['role'], text: string, businessPages?: AssistantMessage['businessPages']) => {
    setMessages(items => [...items, { id: ++sequence.current, role, text, businessPages }].slice(-200))
  }, [])
  const restore = useCallback((task: AssistantTask) => {
    selectedTaskRef.current = task; select(task.id); setRetainedSelected(task); setRecoverySnapshots(previous => reconcileRecoverySnapshots(previous, [task])); setError('')
    setMessages([
      ...(task.userText ? [{ id: ++sequence.current, role: 'user' as const, text: task.userText }] : []),
      { id: ++sequence.current, role: 'assistant', text: task.reply || task.error || (task.state === 'AWAITING_CONFIRM' ? '已恢复原任务，请核对当前预览后确认。' : '已恢复原任务，可继续查看结果。') },
    ])
  }, [select])
  const loadTasks = useCallback(async () => {
    const loadId = ++loadSequence.current
    const selectionAtStart = selectionSequence.current
    setLoading(true); setHistoryError('')
    try {
      const observation = observePreviewFreezes()
      const out = await request<{ tasks: AssistantTask[] }>('/tasks')
      if (!mounted.current || loadId !== loadSequence.current) return
      const rows = Array.isArray(out.tasks) ? out.tasks.slice(0, 30).map(task => keepPreviewFreeze(task, observation)) : []
      const originalId = selectedIdRef.current
      const original = selectedTaskRef.current
      const known = recoverySnapshotsRef.current
      const missing = new Map(known.filter(row => !rows.some(task => task.id === row.task.id)).map(row => [row.task.id, row.task]))
      // 普通选中卡只在满窗口缺席时额外核对；所有已知危险记录独立于当前选择保留。
      if (rows.length === 30 && original && originalId && original.id === originalId && !rows.some(task => task.id === originalId)) missing.set(originalId, original)
      const checked = await Promise.all([...missing.keys()].map(async (id): Promise<{ id: string; task?: AssistantTask; cause?: unknown }> => {
        const detailObservation = observePreviewFreezes()
        try { return { id, task: keepPreviewFreeze((await request<{ task: AssistantTask }>(`/tasks/${encodeURIComponent(id)}`)).task, detailObservation) } }
        catch (cause) { return { id, cause } }
      }))
      if (!mounted.current || loadId !== loadSequence.current) return
      const freshTasks = checked.flatMap(result => result.task ? [result.task] : [])
      const denied = checked.filter(result => result.cause instanceof AssistantRequestError && [401, 403, 404].includes(result.cause.status)).map(result => result.id)
      const temporaryFailure = checked.some(result => result.cause && !denied.includes(result.id))
      const selectionChanged = selectionSequence.current !== selectionAtStart
      const currentId = selectedIdRef.current
      const current = selectedTaskRef.current
      // 更高修订版本优先于旧终态；同版仍保留选择代次与当前授权核对。
      const protectCurrent = (task: AssistantTask) => current && current.id === currentId && task.id === currentId && !denied.includes(task.id)
        && (olderTaskRevision(current, task) || (selectionChanged && !terminalTask(task))) ? current : task
      const currentRows = rows.map(protectCurrent)
      const currentFresh = freshTasks.map(protectCurrent)
      const selectedTerminal = [...currentRows, ...currentFresh].find(task => task.id === currentId && terminalTask(task))
      setRecoverySnapshots(previous => reconcileRecoverySnapshots(previous.filter(row => !denied.includes(row.task.id)), [...currentRows, ...currentFresh]))
      if (temporaryFailure) setHistoryError('最近记录已更新，原任务暂时无法复核。已保留上次已知状态，请查询原任务。')
      if (denied.some(id => known.some(row => row.task.id === id))) setHistoryError(unavailableRecovery)
      if (currentId && denied.includes(currentId)) { select(null); setMessages([]) }
      else if (selectionChanged) { if (selectedTerminal) setRetainedSelected(selectedTerminal) }
      else if (!selectionTouched.current) {
        const first = currentRows.find(taskNeedsRecovery)
        if (first) restore(first)
        selectionTouched.current = true
      } else if (originalId && !rows.some(task => task.id === originalId)) {
        const fresh = currentFresh.find(task => task.id === originalId)
        if (selectedIdRef.current === originalId) {
          if (fresh) setRetainedSelected(fresh)
          else if (!missing.has(originalId) || denied.includes(originalId)) { select(null); setMessages([]) }
          else setRetainedSelected(original)
        }
      } else setRetainedSelected(null)
      setTasks(currentRows)
    } catch (cause) {
      if (mounted.current && loadId === loadSequence.current) {
        setHistoryError('最近记录读取失败，请重试。')
        // 会话由Conversation的账号/代次/服务器key隔离；同归属瞬时失败保留已知恢复。
        if (cause instanceof AssistantRequestError && [401, 403].includes(cause.status)) {
          if (recoverySnapshotsRef.current.length) setHistoryError(`最近记录读取失败。${unavailableRecovery}`)
          setTasks([]); select(null); setMessages([]); setRecoverySnapshots([])
        }
      }
    } finally { if (mounted.current && loadId === loadSequence.current) setLoading(false) }
  }, [request, restore, select, keepPreviewFreeze, observePreviewFreezes])
  useEffect(() => {
    mounted.current = true
    const current = controllers.current
    return () => { mounted.current = false; current.forEach(c => c.abort()); current.clear() }
  }, [])
  useEffect(() => {
    if (!active) return
    let ignored = false
    void loadTasks()
    void Promise.all([
      request<{ realName?: string; roleName?: string; warehouseScope?: string }>('/me'),
      request<{ ok?: boolean }>('/health'),
    ]).then(([me]) => { if (mounted.current && !ignored) { setIdentity(me); setConnected(true) } })
      .catch(() => { if (mounted.current && !ignored) setConnected(false) })
    return () => { ignored = true }
  }, [active, loadTasks, request])

  function apply(out: AssistantResponse, userText: string, completedId?: string, observation?: PreviewFreezeObservation, allowAdvance = false) {
    if (!mounted.current) return
    const task = out.task
    if (task) {
      const previous = selectedTaskRef.current?.id === task.id ? selectedTaskRef.current : tasks.find(t => t.id === task.id)
      const next: AssistantTask = keepPreviewFreeze({
        ...previous, ...task, userText: task.userText || previous?.userText || userText,
        reply: out.reply || task.reply || previous?.reply,
        preview: out.preview || task.preview || previous?.preview,
        result: out.result || task.result,
        candidates: out.candidates || task.candidates || [],
      }, observation, allowAdvance)
      setRecoverySnapshots(previous => reconcileRecoverySnapshots(previous.filter(row => row.task.id !== completedId), [next]))
      selectedTaskRef.current = next; setRetainedSelected(next); select(next.id)
      setTasks(rows => [next, ...rows.filter(t => t.id !== next.id).map(t => t.id === completedId ? { ...t, state: 'DONE',
        ...(t.graph === 'D-receipt' && next.graph === 'D-settle' ? { result: { ...t.result, stage2TaskId: next.id, ...(next.preview?.receiptId != null ? { receiptId: next.preview.receiptId } : {}), ...(next.preview?.receiptNo ? { receiptNo: next.preview.receiptNo } : {}) } } : {}),
      } : t)].slice(0, 30))
    }
    append('assistant', out.reply || out.error || '暂未取得结果，请查询原任务。', out.businessPages)
    setConnected(true)
  }
  async function send(text: string, choiceId?: number | string) {
    const value = text.trim()
    if (!value || locked.current || loading) return
    locked.current = true; selectionTouched.current = true; setBusy(true); setError(''); setInput('')
    append('user', value)
    try {
      const pending = selected?.state === 'AWAITING_CONFIRM' ? previewFreezes.begin(selected) : null
      const out = await request<AssistantResponse>('/chat', { message: value, ...(selected ? { taskId: selected.id } : {}), ...(choiceId == null ? {} : { choiceId }) })
      if (!mounted.current) return
      if (selected && pending && out.reply && (out.task === null || (out.task && (out.task.id !== selected.id || (out.task.state === 'AWAITING_CONFIRM' && out.task.revision === selected.revision && !out.task.confirmationBlocked))))) previewFreezes.finishUnchanged(selected, pending)
      // 当前同ID待确认回复只有文字确认、选账户和修订。文字确认可回显其他标签的新版本，不能证明本次修订；新增同任务回复分支时须重核此门。
      const revisedPreview = selected && pending && out.task?.id === selected?.id && out.task?.state === 'AWAITING_CONFIRM'
        && !out.task.confirmationBlocked && (out.preview || out.task.preview) && !value.includes('确认')
        && (taskRevision(out.task) ?? 0) > (taskRevision(selected) ?? 0)
      apply(out, value, undefined, pending && out.task?.id === selected?.id ? pending.observation : undefined, Boolean(revisedPreview))
    }
    catch (cause) {
      if (mounted.current) {
        setInput(value)
        setError(cause instanceof AssistantRequestError || cause instanceof PreviewFreezeStorageError ? cause.message : '连接失败，刚才的话已保留，可以再试一次。')
        if (selected?.state === 'AWAITING_CONFIRM') {
          refreshPreviewFreeze(selected.id)
          if (!(cause instanceof PreviewFreezeStorageError)) await readPreview(selected)
        }
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  function freezePreview(task: AssistantTask) {
    try { previewFreezes.begin(task) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '预览冻结记录保存失败，确认已暂停。') }
    refreshPreviewFreeze(task.id)
  }
  // 修改/放弃的响应丢失只读任务状态；绝不能通过 confirm 查询取消结果。
  async function readPreview(original: AssistantTask) {
    try {
      const observation = observePreviewFreezes()
      const fresh = await request<{ task: AssistantTask }>(`/tasks/${encodeURIComponent(original.id)}`)
      apply({ task: fresh.task, preview: fresh.task.preview, result: fresh.task.result, reply: fresh.task.reply || '已读取当前预览。请核对是否符合刚才的要求。' }, original.userText || '', undefined, observation)
    } catch (cause) {
      if (mounted.current) {
        if (cause instanceof AssistantRequestError && [401, 403, 404].includes(cause.status)) { setTasks(rows => rows.filter(t => t.id !== original.id)); setRecoverySnapshots(rows => rows.filter(row => row.task.id !== original.id)); select(null); setMessages([]) }
        setError(cause instanceof AssistantRequestError && [401, 403, 404].includes(cause.status) && recoverySnapshotsRef.current.some(row => row.task.id === original.id) ? unavailableRecovery : '当前预览暂时无法核对，确认已暂停。请重新读取原任务。')
      }
    }
  }
  async function checkPreview() {
    if (!selected || locked.current) return
    locked.current = true; setBusy(true); setError('')
    try { await readPreview(selected) }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function cancel() {
    if (!selected || locked.current) return
    const original = selected
    locked.current = true; setBusy(true); setError('')
    try {
      const pending = previewFreezes.begin(original)
      apply(await request<AssistantResponse>(`/tasks/${encodeURIComponent(original.id)}/cancel`, {}), original.userText || '', undefined, pending.observation)
    }
    catch (cause) {
      if (mounted.current) {
        refreshPreviewFreeze(original.id)
        setError(cause instanceof AssistantRequestError || cause instanceof PreviewFreezeStorageError ? cause.message : '暂未取得放弃结果，正在读取原任务；确认已暂停。')
        if (!(cause instanceof PreviewFreezeStorageError)) await readPreview(original)
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function confirm() {
    if (!selected || locked.current) return
    const original = selected
    locked.current = true; setBusy(true); setError('')
    try {
      const uncertain = recoverySnapshotsRef.current.find(row => row.task.id === original.id && row.confirmationUncertain)
      const recoveringServerTask = ['CONFIRMED', 'EXECUTING', 'VERIFYING', 'RESULT_UNKNOWN', 'ESCALATED'].includes(original.state)
      if (!recoveringServerTask && uncertain && (uncertain.confirmationRevision == null || uncertain.confirmationRevision !== taskRevision(original))) {
        setError('原确认版本与当前预览不同或无法核对，本次只读取原任务，不能将结果查询作为新版确认。')
        await readPreview(original)
        return
      }
      if (!recoveringServerTask) {
        if (original.state !== 'AWAITING_CONFIRM') return
        const checked = keepPreviewFreeze(original)
        if (checked.confirmationBlocked || checked.previewUncertain || checked.previewStorageError) {
          refreshPreviewFreeze(checked.id)
          setError(checked.previewStorageError || checked.confirmationBlocked || '预览修改结果尚未核对，确认已暂停。')
          if (uncertain) await readPreview(original)
          return
        }
      }
      const observation = observePreviewFreezes()
      const out = await request<AssistantResponse>(`/tasks/${encodeURIComponent(original.id)}/confirm`, { revision: uncertain ? uncertain.confirmationRevision : original.revision })
      apply(out, original.userText || '', out.task?.id !== original.id ? original.id : undefined, observation)
    } catch (cause) {
      if (mounted.current) {
        if (cause instanceof AssistantRequestError && ['PREVIEW_REVISION_CONFLICT', 'PREVIEW_CONFIRMATION_BLOCKED'].includes(cause.code || '')) {
          freezePreview(original)
          try {
            const observation = observePreviewFreezes()
            const fresh = await request<{ task: AssistantTask }>(`/tasks/${encodeURIComponent(original.id)}`)
            apply({ task: fresh.task, preview: fresh.task.preview, reply: fresh.task.reply || '预览已更新，请重新核对后确认。' }, original.userText || '', undefined, observation)
          } catch (cause) {
            if (mounted.current) {
              const denied = cause instanceof AssistantRequestError && [401, 403, 404].includes(cause.status)
              if (denied) { setTasks(rows => rows.filter(task => task.id !== original.id)); setRecoverySnapshots(rows => rows.filter(row => row.task.id !== original.id)); setMessages([]) }
              select(null); setError(denied ? unavailableRecovery : '原预览已更新，暂时没能读取最新内容。请重新打开这条记录。')
            }
          }
        } else if (cause instanceof AssistantRequestError && cause.status >= 400 && cause.status < 500) { freezePreview(original); setError(cause.message); await readPreview(original) }
        else {
          setRecoverySnapshots(previous => {
            const known = previous.find(row => row.task.id === original.id)
            return [...previous.filter(row => row.task.id !== original.id), {
              task: recoveryMetadata(known && olderTaskRevision(known.task, original) ? known.task : original), confirmationUncertain: true,
              confirmationRevision: known?.confirmationUncertain ? known.confirmationRevision : taskRevision(original),
            }]
          })
          setError('尚未取得执行结果，请查询原任务，避免重复发起。')
        }
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function selectTask(id: string) {
    if (locked.current) return
    selectionTouched.current = true; selectionSequence.current++; locked.current = true; setBusy(true); setError('')
    try {
      const observation = observePreviewFreezes()
      const out = await request<{ task: AssistantTask }>(`/tasks/${encodeURIComponent(id)}`)
      if (!mounted.current) return
      const task = keepPreviewFreeze(out.task, observation)
      setTasks(rows => rows.map(t => t.id === id ? task : t)); restore(task)
    } catch (cause) {
      if (mounted.current) {
        const deniedRecovery = cause instanceof AssistantRequestError && [401, 403, 404].includes(cause.status) && recoverySnapshotsRef.current.some(row => row.task.id === id)
        setError(deniedRecovery ? unavailableRecovery : cause instanceof AssistantRequestError ? cause.message : '任务读取失败，请重试。')
        if (cause instanceof AssistantRequestError && [401, 403, 404].includes(cause.status)) { setTasks(rows => rows.filter(t => t.id !== id)); setRecoverySnapshots(rows => rows.filter(row => row.task.id !== id)); select(null); setMessages([]) }
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  function newTask() {
    if (locked.current) return
    selectionTouched.current = true; select(null); setMessages([]); setInput(''); setError('')
  }
  return { tasks, selected, messages, input, setInput, busy, loading, error, historyError, identity, connected, recoveryId, recoveryTasks: recoverySnapshots.map(row => row.task), send, confirm, cancel, checkPreview, selectTask, newTask, loadTasks }
}
