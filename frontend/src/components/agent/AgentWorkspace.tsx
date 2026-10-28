import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { ArrowUp, Boxes, ClipboardList, MessageSquare, Plus, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import PageHeader from '@/components/shared/PageHeader'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { GRAPH_LABELS, taskHistoryGroups, taskHistoryStatus, taskHistoryTitle, taskNeedsRecovery, type AssistantTask } from './types'
import { useAssistantConversation } from './useAssistantConversation'
import TaskPreview from './TaskPreview'
import ResultLinks from './ResultLinks'
import MessageText from './MessageText'
import BusinessPageLinks from './BusinessPageLinks'
import './xiaoman.css'

const PROMPTS = [
  { label: '查库存', hint: '看现存、可用量与库位', text: '查库存：', Icon: Boxes },
  { label: '销售开单', hint: '先看价格和数量，再确认', text: '开销售草稿：', Icon: ShoppingBag },
  { label: '补货建议', hint: '看看哪些商品需要补货', text: '有哪些商品需要补货？', Icon: ClipboardList },
  { label: '经营简报', hint: '了解当前经营与待办情况', text: '给我一份经营简报', Icon: TrendingUp },
]
export default function AgentWorkspace() {
  const generation = useAuthStore(s => s.sessionGeneration)
  const userId = useAuthStore(s => s.user?.id)
  const server = useSyncExternalStore(subscribeApiClientBaseURL, getApiClientBaseURL)
  return <Conversation key={`${userId}:${generation}:${server}`} />
}
function Conversation() {
  const state = useAssistantConversation()
  const { selected, busy, loading } = state
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const followEnd = useRef(true)
  useLayoutEffect(() => {
    if (followEnd.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [state.messages, selected?.preview, selected?.candidates, selected?.id, busy])
  const recovery = Boolean(selected && (state.recoveryId === selected.id || ['CONFIRMED', 'EXECUTING', 'VERIFYING', 'RESULT_UNKNOWN', 'ESCALATED'].includes(selected.state)))
  const settleTaskId = selected?.graph === 'D-receipt' && selected.state === 'DONE' && typeof selected.result?.stage2TaskId === 'string' && /^[\w-]{1,100}$/.test(selected.result.stage2TaskId) ? selected.result.stage2TaskId : null
  const recoveryTasks = state.recoveryTasks
  const pendingCount = state.tasks.filter(task => ['DISAMBIGUATING', 'AWAITING_CONFIRM'].includes(task.state) && !taskNeedsRecovery(task)).length
  const widePreview = Boolean(selected?.preview?.drafts?.length || selected?.preview?.allocations?.length)
  function historyItem(task: AssistantTask) {
    return <button key={task.id} type="button" disabled={busy} aria-label={`打开记录：${GRAPH_LABELS[task.graph] || '业务'}，${task.userText || '最近记录'}`}
      aria-current={selected?.id === task.id ? 'true' : undefined} className={`xiaoman-history-item ${selected?.id === task.id ? 'is-selected' : ''}`}
      onClick={() => { followEnd.current = true; void state.selectTask(task.id) }}>
      <span className="xiaoman-history-title">{taskHistoryTitle(task)}</span>
      <span className="xiaoman-history-meta"><span>{taskHistoryStatus(task)}</span>{task.updatedAt && <time dateTime={task.updatedAt}>{formatDisplayDateTime(task.updatedAt)}</time>}</span>
    </button>
  }
  function fill(text: string) { state.setInput(text); input.current?.focus() }
  return <div className="xiaoman-page">
    <PageHeader title="小满" description="按你的权限查询与办理，涉及写入时，先看预览、再由你确认。"
      status={<SoftStatusLabel className={`xiaoman-connection ${state.connected ? 'is-online' : ''}`} label={loading ? '连接中' : state.connected ? '已连接' : '暂未连接'} tone={loading ? 'active' : state.connected ? 'success' : 'warning'} />}
      actions={state.identity?.warehouseScope && <p className="xiaoman-identity">操作范围：{state.identity.warehouseScope}</p>} />
    <div className="xiaoman-workspace">
      <aside className="xiaoman-sidebar" aria-label="最近记录">
        <button className="xiaoman-new" type="button" disabled={busy || loading} onClick={() => { followEnd.current = true; state.newTask(); input.current?.focus() }}><Plus size={16} aria-hidden="true" />新对话</button>
        <div className="xiaoman-history-heading"><h2>最近记录</h2><button type="button" aria-label="刷新最近记录" disabled={busy || loading} onClick={() => void state.loadTasks()}><RefreshCw size={14} aria-hidden="true" /></button></div>
        <div className="xiaoman-history">
          {state.historyError && <div className="xiaoman-history-error" role="alert"><p>{state.historyError}</p><button type="button" disabled={busy || loading} onClick={() => void state.loadTasks()}>重试读取任务</button></div>}
          {loading ? <p className="xiaoman-sidebar-hint" role="status">正在找回最近记录…</p> : state.tasks.length === 0 ? !state.historyError && <p className="xiaoman-sidebar-hint">聊过的事会留在这里，方便回来继续。</p> : taskHistoryGroups(state.tasks).map(group => group.length === 1 ? historyItem(group[0]) : <div key={group[0].id} role="group" aria-label={`同笔收款：${group[0].result?.receiptNo || group[1].preview?.receiptNo || group[0].preview?.customer?.name || '登记与核销'}`}>
            <p className="xiaoman-sidebar-hint">同笔收款 · 登记与核销分别确认</p>{group.map(historyItem)}
          </div>)}
        </div>
        {state.tasks.length === 30 && <p className="xiaoman-history-foot">显示最近30项记录</p>}
      </aside>
      <section className="xiaoman-conversation" aria-label="与小满对话">
        <div className="xiaoman-thread" ref={log} onScroll={() => { if (log.current) followEnd.current = log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 80 }}>
          <div className={`xiaoman-thread-content${widePreview ? ' has-wide-preview' : ''}`}>
            {recoveryTasks.length > 0 && <div className="xiaoman-recovery" role="alert"><p>有 {recoveryTasks.length} 项任务需要核对。先恢复原任务，避免重复办理。</p>{recoveryTasks.map(task => <button key={task.id} type="button" disabled={busy || loading} aria-label={`核对原任务：${taskHistoryTitle(task)}，${task.userText || '最近记录'}`} onClick={() => { followEnd.current = true; void state.selectTask(task.id) }}>{taskHistoryTitle(task)} · {taskHistoryStatus(task)}</button>)}</div>}
            {!loading && pendingCount > 0 && <p className="xiaoman-notice" role="status">有 {pendingCount} 项待办，可从最近记录手动恢复后继续。</p>}
            {state.messages.length === 0 ? <div className="xiaoman-welcome">
              <span className="xiaoman-mark" aria-hidden="true">满</span><h2>在呢，今天想先做点什么？</h2>
              <p>查业务、理流程，或聊聊极序的使用和设计。</p>
              <div className="xiaoman-prompts">{PROMPTS.map(({ label, hint, text, Icon }) => <button type="button" key={label} disabled={busy || loading} onClick={() => fill(text)}><Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{hint}</small></span></button>)}</div>
            </div> : <div role="log" aria-live="polite" aria-label="小满对话" className="xiaoman-messages">{state.messages.map(message => <div key={message.id} className={`xiaoman-message is-${message.role}`}>
              {message.role === 'assistant' && <span className="xiaoman-avatar" aria-hidden="true">满</span>}<div className="xiaoman-message-text">{message.role === 'assistant' ? <><MessageText text={message.text} /><BusinessPageLinks pages={message.businessPages} /></> : message.text}</div>
            </div>)}</div>}
            {selected && <div className="xiaoman-current">
              {selected.state === 'DISAMBIGUATING' && selected.candidates?.length ? <fieldset className="xiaoman-candidates"><legend>你指的是哪一个？</legend>{selected.candidates.map(candidate => <button key={candidate.id} type="button" disabled={busy || loading} onClick={() => void state.send(`选择${candidate.title}`, candidate.id)}>
                <span><strong>{candidate.title}</strong>{candidate.subtitle && <small>{candidate.subtitle}</small>}</span>
                {candidate.details?.length ? <small>{candidate.details.map(d => `${d.label}：${d.value}`).join(' · ')}</small> : null}
              </button>)}</fieldset> : null}
              {selected.preview && <TaskPreview task={selected} busy={busy || loading} recovering={recovery} onConfirm={() => void state.confirm()} onCancel={() => void state.cancel()} onAccount={index => void state.send(String(index + 1))} />}
              {selected.previewUncertain && <div className="xiaoman-recovery"><p>正在核对这份预览是否已修改或放弃。此处只读取原任务。</p><button type="button" disabled={busy || loading} onClick={() => void state.checkPreview()}>重新核对预览</button></div>}
              {recovery && <div className="xiaoman-recovery"><p>这件事的执行结果还需要核对，先查原任务，避免重复办理。</p><Button className="xiaoman-primary" size="sm" type="button" disabled={busy || loading} onClick={() => void state.confirm()}>查询原任务结果</Button></div>}
              {settleTaskId && <div className="xiaoman-recovery"><p>收款登记与核销是两个独立任务。可恢复原核销阶段查看当前状态。</p><button type="button" disabled={busy || loading} onClick={() => void state.selectTask(settleTaskId)}>恢复原核销任务</button></div>}
              <ResultLinks task={selected} />
            </div>}
            {busy && <div role="status" className="xiaoman-working"><MessageSquare size={15} aria-hidden="true" />正在核对，请稍候…</div>}
          </div>
        </div>
        <form className="xiaoman-composer" onSubmit={event => { event.preventDefault(); followEnd.current = true; void state.send(state.input) }}>
          {state.error && <div className="xiaoman-error" role="alert">{state.error}</div>}
          <div className="xiaoman-input-box"><textarea ref={input} aria-label="告诉小满要做什么" placeholder="说说你想查什么，或想办哪件事…" rows={2} maxLength={4000} value={state.input} disabled={busy || loading}
            onChange={event => state.setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); followEnd.current = true; void state.send(state.input) } }} />
            <Button className="xiaoman-send" size="icon" type="submit" aria-label="发送" disabled={busy || loading || !state.input.trim()}><ArrowUp size={19} aria-hidden="true" /></Button>
          </div><p className="xiaoman-input-hint">Enter 发送，Shift + Enter 换行</p>
        </form>
      </section>
    </div>
  </div>
}
