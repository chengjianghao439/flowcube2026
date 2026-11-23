import { useCallback, useEffect, useRef, useState } from 'react'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { AssistantRequestError, requestAssistant } from '@/api/assistant'
import type { AssistantMessage, AssistantResponse, AssistantTask } from './types'

const pendingStates = ['PAUSED', 'DISAMBIGUATING', 'AWAITING_CONFIRM', 'CONFIRMED', 'EXECUTING', 'RESULT_UNKNOWN', 'VERIFYING', 'ESCALATED']
const unfinished = (task: AssistantTask) => pendingStates.includes(task.state) ||
  (task.state === 'EXPIRED' && task.graph === 'B-sale-draft' && Boolean(task.preview))
const completedReview = (task?: AssistantTask) => task?.state === 'DONE'
  && ['L-sale-handoff', 'B2-reserve', 'D-settle'].includes(task.graph)
const inaccessible = (cause: unknown) => cause instanceof AssistantRequestError && [401, 403, 404].includes(cause.status)
const newConversationId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('')

function mergeTask(task: AssistantTask, out: AssistantResponse, previous?: AssistantTask, userText?: string): AssistantTask {
  return {
    ...previous, ...task, userText: task.userText || previous?.userText || userText,
    reply: out.reply || task.reply || previous?.reply,
    preview: completedReview(task) || ['DISAMBIGUATING', 'CANCELLED'].includes(task.state) ? undefined : out.preview || task.preview || previous?.preview,
    result: out.result || task.result,
    candidates: out.candidates || task.candidates || [],
    candidateKey: task.candidateKey,
    reviewRequired: task.reviewRequired,
  }
}

export function useAssistantConversation() {
  const active = useActiveWorkspaceTab()
  const [tasks, setTasks] = useState<AssistantTask[]>([])
  const [resumeAmbiguous, setResumeAmbiguous] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const referenceId = useRef<string | null>(null)
  const previousId = useRef<string | null>(null)
  const historyQuery = useRef<string | null>(null)
  const conversationId = useRef<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [recoveryId, setRecoveryId] = useState<string | null>(null)
  const [identity, setIdentity] = useState<{ realName?: string; roleName?: string; warehouseScope?: string } | null>(null)
  const [connected, setConnected] = useState(false)
  const mounted = useRef(false)
  const locked = useRef(false)
  const loadSequence = useRef(0)
  const selectionTouched = useRef(false)
  const controllers = useRef(new Set<AbortController>())
  const sequence = useRef(0)
  const selected = tasks.find(t => t.id === selectedId) ?? null
  const select = useCallback((id: string | null, keepReferences = false) => {
    if (id && id !== referenceId.current) {
      previousId.current = referenceId.current
      referenceId.current = id
    } else if (!id && !keepReferences) {
      referenceId.current = null
      previousId.current = null
    }
    selectedIdRef.current = id
    setSelectedId(id)
  }, [])

  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      return await requestAssistant<T>(path, body, controller.signal)
    } finally { controllers.current.delete(controller) }
  }, [])
  const append = useCallback((role: AssistantMessage['role'], text: string) => {
    setMessages(items => [...items, { id: ++sequence.current, role, text }].slice(-200))
  }, [])
  const restore = useCallback((task: AssistantTask) => {
    select(task.id); setRecoveryId(null); setError('')
    historyQuery.current = null
    conversationId.current = task.conversationId ?? null
    setMessages([
      ...(task.userText ? [{ id: ++sequence.current, role: 'user' as const, text: task.userText }] : []),
      { id: ++sequence.current, role: 'assistant', text: task.reply || task.error || (task.state === 'AWAITING_CONFIRM' ? '已恢复原任务，请核对当前预览后确认。' : '已恢复原任务，可继续查看结果。') },
    ])
  }, [select])
  const reviewSnapshot = useCallback(async (task: AssistantTask) => {
    const reviewedResult = completedReview(task)
    if (!task.reviewRequired || (task.state !== 'AWAITING_CONFIRM' && !reviewedResult)) return task
    let reply: string | undefined
    try {
      const out = await request<AssistantResponse>(`/tasks/${encodeURIComponent(task.id)}/resume`, {})
      if (out.task?.id === task.id) return mergeTask(out.task, out, task)
      reply = out.reply
    } catch (cause) {
      if (inaccessible(cause)) return null
    }
    if (reviewedResult) return { ...task, preview: undefined, result: undefined, reply: reply || '暂时无法核对原单，请稍后重开最近记录。' }
    return { ...task, reply: '暂时无法复核原预览。请稍后核对这条记录。' }
  }, [request])
  const loadTasks = useCallback(async () => {
    if (locked.current) return
    const loadId = ++loadSequence.current
    setLoading(true); setHistoryError('')
    try {
      const out = await request<{ tasks: AssistantTask[]; resumeAmbiguous?: boolean }>('/tasks')
      if (!mounted.current || loadId !== loadSequence.current) return
      let rows = Array.isArray(out.tasks) ? out.tasks.slice(0, 30) : []
      const initial = !selectionTouched.current
      const pending = initial ? rows.filter(unfinished) : []
      const initialTarget = out.resumeAmbiguous ? undefined : pending.length === 1 ? pending[0] : pending.length === 0 ? rows[0] : undefined
      const target = initial ? initialTarget
        : rows.find(task => task.id === selectedIdRef.current)
      const checked = target ? await reviewSnapshot(target) : undefined
      if (!mounted.current || loadId !== loadSequence.current) return
      if (target) rows = checked ? rows.map(task => task.id === target.id ? checked : task) : rows.filter(task => task.id !== target.id)
      setTasks(rows)
      setResumeAmbiguous(Boolean(out.resumeAmbiguous))
      if (initial && checked) {
        restore(checked)
        selectionTouched.current = true
      } else if (checked?.reply && completedReview(target) && target?.reviewRequired && checked.id === selectedIdRef.current) {
        const text = checked.reply
        const note = { id: ++sequence.current, role: 'assistant' as const, text }
        setMessages(items => items.at(-1)?.text === text ? items : [...items, note].slice(-200))
      } else if (selectedIdRef.current && !rows.some(t => t.id === selectedIdRef.current)) {
        select(null); setMessages([]); setRecoveryId(null); historyQuery.current = null; conversationId.current = null
      }
    } catch {
      if (mounted.current && loadId === loadSequence.current) { setHistoryError('最近记录读取失败，请重试。'); setTasks([]); select(null); setMessages([]); setRecoveryId(null) }
    } finally { if (mounted.current && loadId === loadSequence.current) setLoading(false) }
  }, [request, restore, reviewSnapshot, select])
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

  function apply(out: AssistantResponse, userText: string, completedId?: string) {
    if (!mounted.current) return
    const task = out.task
    conversationId.current = task?.conversationId ?? out.conversationId ?? conversationId.current
    historyQuery.current = out.historyLookup && out.historyQuery ? out.historyQuery : null
    if (task) {
      setTasks(rows => {
        const previous = rows.find(t => t.id === task.id)
        const next = mergeTask(task, out, previous, userText)
        return [next, ...rows.filter(t => t.id !== next.id).map(t => t.id === completedId ? { ...t, state: 'DONE' } : t)].slice(0, 30)
      })
      select(task.id)
    } else if (out.detachTask) select(null, out.keepReferences)
    append('assistant', out.reply || out.error || '暂未取得结果，请查询原任务。')
    setRecoveryId(null); setConnected(true)
  }
  async function send(text: string, choiceId?: number | string) {
    const value = text.trim()
    if (!value || locked.current || loading) return
    locked.current = true; selectionTouched.current = true; setBusy(true); setError(''); setInput('')
    append('user', value)
    try {
      conversationId.current ??= newConversationId()
      apply(await request<AssistantResponse>('/chat', {
        message: value,
        conversationId: conversationId.current,
        ...(selected ? { taskId: selected.id } : referenceId.current ? { referenceTaskId: referenceId.current } : {}),
        ...(previousId.current ? { previousTaskId: previousId.current } : {}),
        ...(selected?.candidateKey ? { candidateKey: selected.candidateKey } : {}),
        ...(choiceId == null ? {} : { choiceId }),
        ...(historyQuery.current ? { historyLookup: true, historyQuery: historyQuery.current } : {}),
      }), value)
    }
    catch (cause) {
      if (mounted.current) {
        setInput(value)
        setError(cause instanceof AssistantRequestError ? cause.message : '连接失败，刚才的话已保留，可以再试一次。')
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function confirm() {
    if (!selected || selected.id !== selectedIdRef.current || selected.state !== 'AWAITING_CONFIRM'
      || selected.reviewRequired || recoveryId === selected.id || locked.current || loading) return
    const original = selected
    locked.current = true; setBusy(true); setError('')
    try {
      const out = await request<AssistantResponse>(`/tasks/${encodeURIComponent(original.id)}/confirm`, { revision: original.revision })
      apply(out, original.userText || '', out.task?.id !== original.id ? original.id : undefined)
    } catch (cause) {
      if (mounted.current) {
        if (cause instanceof AssistantRequestError && cause.code === 'PREVIEW_REVISION_CONFLICT') {
          try {
            const fresh = await request<{ task: AssistantTask }>(`/tasks/${encodeURIComponent(original.id)}`)
            const checked = await reviewSnapshot(fresh.task)
            if (!checked) throw cause
            apply({ task: checked, preview: checked.preview, reply: checked.reply || '预览已更新，请重新核对后确认。' }, original.userText || '')
          } catch {
            if (mounted.current) { select(null); setError('原预览已更新，暂时没能读取最新内容。请重新打开这条记录。') }
          }
        } else if (cause instanceof AssistantRequestError && cause.status >= 400 && cause.status < 500
          && cause.status !== 408 && cause.code !== 'TASK_BUSY') setError(cause.message)
        else { setRecoveryId(original.id); setError('尚未取得执行结果，请查询原任务，避免重复发起。') }
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function resume() {
    if (!selected || locked.current || loading) return
    const original = selected
    locked.current = true; setBusy(true); setError('')
    try {
      const out = await request<AssistantResponse>(`/tasks/${encodeURIComponent(original.id)}/resume`, {})
      apply(out, original.userText || '', out.task && out.task.id !== original.id ? original.id : undefined)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof AssistantRequestError ? cause.message : '暂时无法读取原任务，请稍后继续。')
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function changeSaleDraft(action: 'reselect' | 'cancel', original = selected) {
    if (!original || selected?.id !== original.id || selected.revision !== original.revision || selected.reviewRequired || locked.current || loading) return
    const path = `/tasks/${encodeURIComponent(original.id)}`
    locked.current = true; selectionTouched.current = true; setBusy(true); setError('')
    try {
      apply(await request<AssistantResponse>(`${path}/sale-draft`, { action, revision: original.revision }), original.userText || '')
    } catch (cause) {
      if (!mounted.current) return
      const message = cause instanceof AssistantRequestError ? cause.message : '暂未取得操作结果。'
      try {
        const { task } = await request<{ task: AssistantTask }>(path)
        if (!mounted.current) return
        apply({ task, reply: task.reply || '已读取原任务。' }, original.userText || '')
        if (task.revision === original.revision) setError(message)
      } catch {
        if (mounted.current) { select(null); setError('暂时无法核对操作结果，请重新打开原记录。') }
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function selectTask(id: string) {
    if (locked.current || loading) return
    selectionTouched.current = true; locked.current = true; setBusy(true); setError('')
    try {
      const out = await request<{ task: AssistantTask }>(`/tasks/${encodeURIComponent(id)}`)
      const checked = await reviewSnapshot(out.task)
      if (!mounted.current) return
      if (!checked) {
        setTasks(rows => rows.filter(t => t.id !== id)); select(null); setMessages([])
        setError('当前权限或仓库范围已变化，无法继续这条记录。')
        return
      }
      setTasks(rows => rows.map(t => t.id === id ? checked : t)); restore(checked)
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof AssistantRequestError ? cause.message : '任务读取失败，请重试。')
        if (inaccessible(cause)) { setTasks(rows => rows.filter(t => t.id !== id)); select(null); setMessages([]) }
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  function newTask() {
    if (locked.current) return
    selectionTouched.current = true; select(null); historyQuery.current = null; conversationId.current = null
    setMessages([]); setInput(''); setError(''); setRecoveryId(null)
  }
  const multipleUnfinished = !selected && (resumeAmbiguous || tasks.filter(unfinished).length > 1)
  return { tasks, selected, messages, input, setInput, busy, loading, error, historyError, identity, connected, recoveryId, multipleUnfinished, send, confirm, resume, changeSaleDraft, selectTask, newTask, loadTasks }
}
