import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { ArrowUp, Boxes, ClipboardList, MessageSquare, Plus, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import PageHeader from '@/components/shared/PageHeader'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { GRAPH_LABELS, TASK_STATE_LABELS } from './types'
import { useAssistantConversation } from './useAssistantConversation'
import TaskPreview from './TaskPreview'
import ResultLinks from './ResultLinks'
import MessageText, { ASSISTANT_GUIDE_LINKS, useOpenWorkspacePath } from './MessageText'
import './xiaoman.css'

const PROMPTS = [
  { label: '查库存', hint: '看现存、可用量与库位', text: '查库存：', Icon: Boxes },
  { label: '销售开单', hint: '先看价格和数量，再确认', text: '开销售草稿：', Icon: ShoppingBag },
  { label: '补货建议', hint: '看看哪些商品需要补货', text: '有哪些商品需要补货？', Icon: ClipboardList },
  { label: '经营简报', hint: '了解当前经营与待办情况', text: '给我一份经营简报', Icon: TrendingUp },
]
export default function AgentWorkspace() {
  const generation = useAuthStore(s => s.sessionGeneration)
  const server = useSyncExternalStore(subscribeApiClientBaseURL, getApiClientBaseURL)
  return <Conversation key={`${generation}:${server}`} />
}
function Conversation() {
  const state = useAssistantConversation()
  const openGuide = useOpenWorkspacePath()
  const { selected, busy, loading } = state
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const followEnd = useRef(true)
  useLayoutEffect(() => {
    if (followEnd.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [state.messages, selected?.preview, selected?.candidates, selected?.id, busy])
  const recovery = Boolean(selected && (state.recoveryId === selected.id || ['CONFIRMED', 'EXECUTING', 'VERIFYING', 'RESULT_UNKNOWN', 'ESCALATED'].includes(selected.state)))
  function fill(text: string) { state.setInput(text); input.current?.focus() }
  return <div className="xiaoman-page">
    <PageHeader title="小满" description="按你的权限查询与办理，涉及写入时，先看预览、再由你确认。"
      status={<span className={`xiaoman-connection ${state.connected ? 'is-online' : ''}`}><i />{loading ? '连接中' : state.connected ? '已连接' : '暂未连接'}</span>}
      actions={state.identity && <p className="xiaoman-identity">{[state.identity.realName, state.identity.roleName, state.identity.warehouseScope].filter(Boolean).join(' · ')}</p>} />
    <div className="xiaoman-workspace">
      <aside className="xiaoman-sidebar" aria-label="最近记录">
        <button className="xiaoman-new" type="button" disabled={busy || loading} onClick={() => { followEnd.current = true; state.newTask(); input.current?.focus() }}><Plus size={16} aria-hidden="true" />新对话</button>
        <div className="xiaoman-history-heading"><h2>最近记录</h2><button type="button" aria-label="刷新最近记录" disabled={busy || loading} onClick={() => void state.loadTasks()}><RefreshCw size={14} aria-hidden="true" /></button></div>
        <div className="xiaoman-history">
          {loading ? <p className="xiaoman-sidebar-hint" role="status">正在找回最近记录…</p> : state.historyError ? <div className="xiaoman-history-error" role="alert"><p>{state.historyError}</p><button type="button" onClick={() => void state.loadTasks()}>重试读取任务</button></div> : state.tasks.length === 0 ? <p className="xiaoman-sidebar-hint">最近记录只留下走过业务的任务。打招呼、本地短回和闲聊不会出现在这里。</p> : state.tasks.map(task => <button
            key={task.id} type="button" disabled={busy} aria-label={`打开记录：${GRAPH_LABELS[task.graph] || '业务'}，${task.userText || '最近记录'}`}
            aria-current={selected?.id === task.id ? 'true' : undefined} className={`xiaoman-history-item ${selected?.id === task.id ? 'is-selected' : ''}`}
            onClick={() => { followEnd.current = true; void state.selectTask(task.id) }}>
            <span className="xiaoman-history-title">{task.userText || GRAPH_LABELS[task.graph] || '最近记录'}</span>
            <span className="xiaoman-history-meta"><span>{GRAPH_LABELS[task.graph]} · {TASK_STATE_LABELS[task.state] || '待核对'}</span>{task.updatedAt && <time dateTime={task.updatedAt}>{formatDisplayDateTime(task.updatedAt)}</time>}</span>
          </button>)}
        </div>
        {state.tasks.length === 30 && <p className="xiaoman-history-foot">显示最近30项记录</p>}
      </aside>
      <section className="xiaoman-conversation" aria-label="与小满对话">
        <div className="xiaoman-thread" ref={log} onScroll={() => { if (log.current) followEnd.current = log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 80 }}>
          <div className="xiaoman-thread-content">
            {state.messages.length === 0 ? <div className="xiaoman-welcome">
              <span className="xiaoman-mark" aria-hidden="true">满</span><h2>今天想先办哪件事？</h2>
              <div className="xiaoman-scope">
                <h3>能做</h3>
                <p>查库存、开销售或采购草稿、看账款和收款、查仓库里卡住的作业、看经营简报。商品名不太准时，会列出你权限内的相近商品让你点选，不会擅自换成某一个。</p>
                <h3>不能做</h3>
                <p>取消订单、改价、审批、付款、发货，请走下面的菜单。大额硬拦这轮不做。卡点只看仓库执行，不扩到商务。闲聊不留。</p>
                <p>最近记录只留下走过业务的任务。打招呼、本地短回和闲聊不进列表，不是聊天记录丢了。</p>
              </div>
              <div className="xiaoman-guides">{ASSISTANT_GUIDE_LINKS.map(link => <button type="button" key={link.path} className="xiaoman-guide" disabled={busy || loading} onClick={() => openGuide(link.path)}>{link.label}</button>)}</div>
              <div className="xiaoman-prompts">{PROMPTS.map(({ label, hint, text, Icon }) => <button type="button" key={label} disabled={busy || loading} onClick={() => fill(text)}><Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{hint}</small></span></button>)}</div>
            </div> : <div role="log" aria-live="polite" aria-label="小满对话" className="xiaoman-messages">{state.messages.map(message => <div key={message.id} className={`xiaoman-message is-${message.role}`}>
              {message.role === 'assistant' && <span className="xiaoman-avatar" aria-hidden="true">满</span>}<div className="xiaoman-message-text">{message.role === 'assistant' ? <MessageText text={message.text} /> : message.text}</div>
            </div>)}</div>}
            {selected && <div className="xiaoman-current">
              {selected.state === 'DISAMBIGUATING' && selected.candidates?.length ? <fieldset className="xiaoman-candidates"><legend>你指的是哪一个？</legend>{selected.candidates.map(candidate => <button key={candidate.id} type="button" disabled={busy || loading} onClick={() => void state.send(`选择${candidate.title}`, candidate.id)}>
                <span><strong>{candidate.title}</strong>{candidate.subtitle && <small>{candidate.subtitle}</small>}</span>
                {candidate.details?.length ? <small>{candidate.details.map(d => `${d.label}：${d.value}`).join(' · ')}</small> : null}
              </button>)}</fieldset> : null}
              {selected.preview && <TaskPreview task={selected} busy={busy || loading} recovering={recovery} onConfirm={() => void state.confirm()} onAccount={index => void state.send(String(index + 1))} />}
              {recovery && <div className="xiaoman-recovery"><p>这件事的执行结果还需要核对，先查原任务，避免重复办理。</p><button className="xiaoman-primary" type="button" disabled={busy || loading} onClick={() => void state.confirm()}>查询原任务结果</button></div>}
              <ResultLinks task={selected} />
            </div>}
            {busy && <div role="status" className="xiaoman-working"><MessageSquare size={15} aria-hidden="true" />正在核对，请稍候…</div>}
          </div>
        </div>
        <form className="xiaoman-composer" onSubmit={event => { event.preventDefault(); followEnd.current = true; void state.send(state.input) }}>
          {state.error && <div className="xiaoman-error" role="alert">{state.error}</div>}
          <div className="xiaoman-input-box"><textarea ref={input} aria-label="告诉小满要做什么" placeholder="说说你想查什么，或想办哪件事…" rows={2} maxLength={4000} value={state.input} disabled={busy || loading}
            onChange={event => state.setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); followEnd.current = true; void state.send(state.input) } }} />
            <button className="xiaoman-send" type="submit" aria-label="发送" disabled={busy || loading || !state.input.trim()}><ArrowUp size={19} aria-hidden="true" /></button>
          </div><p className="xiaoman-input-hint">Enter 发送，Shift + Enter 换行</p>
        </form>
      </section>
    </div>
  </div>
}
