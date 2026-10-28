import { useCallback, useEffect, useRef, useState } from 'react'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { AssistantRequestError, requestAssistant } from '@/api/assistant'
import type { AssistantMessage, AssistantResponse, AssistantTask } from './types'

const pendingStates = ['DISAMBIGUATING', 'AWAITING_CONFIRM', 'EXECUTING', 'RESULT_UNKNOWN', 'ESCALATED']

export function useAssistantConversation() {
  const active = useActiveWorkspaceTab()
  const [tasks, setTasks] = useState<AssistantTask[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
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
  const select = useCallback((id: string | null) => { selectedIdRef.current = id; setSelectedId(id) }, [])

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
    setMessages([
      ...(task.userText ? [{ id: ++sequence.current, role: 'user' as const, text: task.userText }] : []),
      { id: ++sequence.current, role: 'assistant', text: task.reply || task.error || (task.state === 'AWAITING_CONFIRM' ? '已恢复原任务，请核对当前预览后确认。' : '已恢复原任务，可继续查看结果。') },
    ])
  }, [select])
  const loadTasks = useCallback(async () => {
    const loadId = ++loadSequence.current
    setLoading(true); setHistoryError('')
    try {
      const out = await request<{ tasks: AssistantTask[] }>('/tasks')
      if (!mounted.current || loadId !== loadSequence.current) return
      const rows = Array.isArray(out.tasks) ? out.tasks.slice(0, 30) : []
      setTasks(rows)
      if (!selectionTouched.current) {
        const first = rows.find(t => pendingStates.includes(t.state)) ?? rows[0]
        if (first) { restore(first); selectionTouched.current = true }
      } else {
        if (selectedIdRef.current && !rows.some(t => t.id === selectedIdRef.current)) { select(null); setMessages([]); setRecoveryId(null) }
      }
    } catch {
      if (mounted.current && loadId === loadSequence.current) { setHistoryError('最近记录读取失败，请重试。'); setTasks([]); select(null); setMessages([]); setRecoveryId(null) }
    } finally { if (mounted.current && loadId === loadSequence.current) setLoading(false) }
  }, [request, restore, select])
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
    if (task) {
      setTasks(rows => {
        const previous = rows.find(t => t.id === task.id)
        const next: AssistantTask = {
          ...previous, ...task, userText: task.userText || previous?.userText || userText,
          reply: out.reply || task.reply || previous?.reply,
          preview: out.preview || task.preview || previous?.preview,
          result: out.result || task.result,
          candidates: out.candidates || task.candidates || [],
        }
        return [next, ...rows.filter(t => t.id !== next.id).map(t => t.id === completedId ? { ...t, state: 'DONE' } : t)].slice(0, 30)
      })
      select(task.id)
    }
    append('assistant', out.reply || out.error || '暂未取得结果，请查询原任务。')
    setRecoveryId(null); setConnected(true)
  }
  async function send(text: string, choiceId?: number | string) {
    const value = text.trim()
    if (!value || locked.current || loading) return
    locked.current = true; selectionTouched.current = true; setBusy(true); setError(''); setInput('')
    append('user', value)
    try { apply(await request<AssistantResponse>('/chat', { message: value, ...(selected ? { taskId: selected.id } : {}), ...(choiceId == null ? {} : { choiceId }) }), value) }
    catch (cause) {
      if (mounted.current) {
        setInput(value)
        setError(cause instanceof AssistantRequestError ? cause.message : '连接失败，刚才的话已保留，可以再试一次。')
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function confirm() {
    if (!selected || locked.current) return
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
            apply({ task: fresh.task, preview: fresh.task.preview, reply: fresh.task.reply || '预览已更新，请重新核对后确认。' }, original.userText || '')
          } catch {
            if (mounted.current) { select(null); setError('原预览已更新，暂时没能读取最新内容。请重新打开这条记录。') }
          }
        } else if (cause instanceof AssistantRequestError && cause.status >= 400 && cause.status < 500) setError(cause.message)
        else { setRecoveryId(original.id); setError('尚未取得执行结果，请查询原任务，避免重复发起。') }
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function selectTask(id: string) {
    if (locked.current) return
    selectionTouched.current = true; locked.current = true; setBusy(true); setError('')
    try {
      const out = await request<{ task: AssistantTask }>(`/tasks/${encodeURIComponent(id)}`)
      if (!mounted.current) return
      setTasks(rows => rows.map(t => t.id === id ? out.task : t)); restore(out.task)
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof AssistantRequestError ? cause.message : '任务读取失败，请重试。')
        if (cause instanceof AssistantRequestError && [401, 403, 404].includes(cause.status)) { setTasks(rows => rows.filter(t => t.id !== id)); select(null); setMessages([]) }
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  function newTask() {
    if (locked.current) return
    selectionTouched.current = true; select(null); setMessages([]); setInput(''); setError(''); setRecoveryId(null)
  }
  return { tasks, selected, messages, input, setInput, busy, loading, error, historyError, identity, connected, recoveryId, send, confirm, selectTask, newTask, loadTasks }
}
