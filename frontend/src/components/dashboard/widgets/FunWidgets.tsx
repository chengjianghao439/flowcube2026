import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import {
  Sparkles, Timer, PartyPopper, Volume2, VolumeX, Settings2,
  Play, Pause, RotateCcw, Plus, Trash2, Quote, RefreshCw, Fish, Clover, Hourglass,
  Droplet, StickyNote, CheckCircle2, Circle, Gauge,
} from 'lucide-react'
import { WidgetShell } from '../WidgetShell'
import { cn } from '@/lib/utils'

// 趣味小组件：与业务数据无关，纯本地状态，给仪表盘一点人味儿。
// 全部适配固定卡高——内容在卡内居中或滚动，编辑/抽签/内容多少都不改变卡片高度。
// 偏好（功德数 / 音效 / 下班时间 / 假期 / 发薪日 / 饮水 / 待办）都存 localStorage。

const pad = (n: number) => String(n).padStart(2, '0')
const DAY_MS = 86400000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }

// 用 Web Audio 合成一声木鱼「笃」：短促、快速衰减，比引外部音频文件干净。
function playKnock(ctxRef: MutableRefObject<AudioContext | null>) {
  try {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') void ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(200, t)
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.12)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    osc.start(t)
    osc.stop(t + 0.24)
  } catch { /* 音频不可用则静默降级，不影响计数 */ }
}

// ── 撒花（下班庆祝）──────────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']
function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 32 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    dur: 1.6 + Math.random() * 1.3,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    w: 5 + Math.random() * 6,
  })), [])
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {pieces.map((p, i) => (
        <span key={i} className="fc-confetti-piece absolute top-0 block rounded-[1px]"
          style={{ left: `${p.left}%`, width: p.w, height: p.w * 0.6, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }} />
      ))}
    </div>
  )
}

// ── 电子木鱼（连击特效）· lg ─────────────────────────────────────────────────
export function WoodenFish() {
  const [merit, setMerit] = useState(() => Number(localStorage.getItem('dash-merit') || 0))
  const [sound, setSound] = useState(() => localStorage.getItem('dash-merit-sound') !== 'off')
  const [hit, setHit] = useState(false)
  const [combo, setCombo] = useState(0)
  const [floats, setFloats] = useState<{ id: number; combo: number }[]>([])
  const nextId = useRef(0)
  const lastKnock = useRef(0)
  const comboTimer = useRef<number | undefined>(undefined)
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => () => { void ctxRef.current?.close(); window.clearTimeout(comboTimer.current) }, [])

  function knock() {
    const t = Date.now()
    const chained = t - lastKnock.current < 1200
    lastKnock.current = t
    const nextCombo = chained ? combo + 1 : 1
    setCombo(nextCombo)
    window.clearTimeout(comboTimer.current)
    comboTimer.current = window.setTimeout(() => setCombo(0), 1500)

    setMerit(m => { const n = m + 1; localStorage.setItem('dash-merit', String(n)); return n })
    setHit(true); window.setTimeout(() => setHit(false), 110)
    setFloats(f => [...f, { id: nextId.current++, combo: nextCombo }])
    if (sound) playKnock(ctxRef)
  }
  function toggleSound() {
    setSound(s => { const n = !s; localStorage.setItem('dash-merit-sound', n ? 'on' : 'off'); return n })
  }

  return (
    <WidgetShell
      title="电子木鱼" icon={Sparkles} tone="warning"
      action={
        <button type="button" onClick={toggleSound} title={sound ? '关闭音效' : '开启音效'}
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted">
          {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-1.5">
        <button type="button" onClick={knock} aria-label="敲木鱼，功德加一" className="relative select-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {combo >= 3 && (
            <span className={cn('absolute -right-2 -top-1 z-20 whitespace-nowrap rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-bold text-orange-500 transition-transform',
              combo >= 8 && 'scale-110 text-red-500')}>
              🔥 {combo} 连击
            </span>
          )}
          {floats.map(f => (
            <span key={f.id} onAnimationEnd={() => setFloats(cur => cur.filter(x => x.id !== f.id))}
              className={cn('animate-merit-float pointer-events-none absolute left-1/2 top-0 z-10 whitespace-nowrap font-bold',
                f.combo >= 8 ? 'text-lg text-red-500' : f.combo >= 4 ? 'text-base text-orange-500' : 'text-sm text-amber-500')}>
              功德 +1{f.combo >= 3 ? ` ×${f.combo}` : ''}
            </span>
          ))}
          <svg width="72" height="72" viewBox="0 0 100 100"
            className={cn('transition-transform duration-100 will-change-transform',
              hit ? (combo >= 5 ? 'scale-90 -rotate-3' : 'scale-90') : 'scale-100 hover:scale-105')}>
            <defs>
              <radialGradient id="fc-wood" cx="38%" cy="30%" r="80%">
                <stop offset="0%" stopColor="#d99b62" />
                <stop offset="55%" stopColor="#b47a44" />
                <stop offset="100%" stopColor="#7a4c28" />
              </radialGradient>
            </defs>
            <ellipse cx="50" cy="57" rx="41" ry="33" fill="url(#fc-wood)" stroke="#5c3a1e" strokeWidth="2.5" />
            <path d="M28 55 Q50 70 72 55" fill="none" stroke="#5c3a1e" strokeWidth="3" strokeLinecap="round" />
            <ellipse cx="50" cy="31" rx="11" ry="5" fill="#00000022" />
            <ellipse cx="37" cy="44" rx="9" ry="5" fill="#ffffff55" />
          </svg>
        </button>
        <p className="text-sm text-muted-foreground">
          功德 <span className="ml-0.5 text-lg font-bold tabular-nums text-amber-500">{merit.toLocaleString()}</span>
        </p>
      </div>
    </WidgetShell>
  )
}

// ── 下班倒计时（到点撒花）· sm ───────────────────────────────────────────────
export function OffWorkCountdown() {
  const [off, setOff] = useState(() => localStorage.getItem('dash-offwork') || '18:00')
  const [editing, setEditing] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [celebrate, setCelebrate] = useState(false)
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t) }, [])

  const day = now.getDay()
  const isWeekend = day === 0 || day === 6
  const [oh, om] = off.split(':').map(Number)
  const target = new Date(now); target.setHours(oh || 18, om || 0, 0, 0)
  const diffMs = target.getTime() - now.getTime()
  const done = !isWeekend && diffMs <= 0

  const prevDone = useRef(done)
  useEffect(() => {
    if (done && !prevDone.current) { setCelebrate(true); window.setTimeout(() => setCelebrate(false), 4000) }
    prevDone.current = done
  }, [done])

  let big: ReactNode
  let hint: string
  if (isWeekend) {
    big = <span className="text-2xl font-semibold text-success">周末愉快 🎉</span>
    hint = '今天休息，别想工作'
  } else if (done) {
    big = <span className="text-2xl font-semibold text-success">已下班，辛苦啦 🎉</span>
    hint = `下班时间 ${off} · 点这里再撒把花`
  } else {
    const s = Math.floor(diffMs / 1000)
    big = (
      <span className="text-3xl font-semibold tabular-nums text-primary">
        {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
      </span>
    )
    hint = `距离 ${off} 下班`
  }

  return (
    <WidgetShell
      title="下班倒计时" icon={Timer} tone="primary" scrollBody
      action={
        <button type="button" onClick={() => setEditing(e => !e)} title="设置下班时间"
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted">
          <Settings2 className="h-4 w-4" />
        </button>
      }
    >
      <div className="relative flex h-full flex-col items-center justify-center gap-1.5">
        {celebrate && <Confetti />}
        <button type="button" onClick={() => done && setCelebrate(true)} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={!done}>{big}</button>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {editing && (
          <input aria-label="下班时间" type="time" value={off}
            onChange={e => { setOff(e.target.value); localStorage.setItem('dash-offwork', e.target.value) }}
            className="mt-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
        )}
      </div>
    </WidgetShell>
  )
}

// ── 可编辑假期日历 · lg（scrollBody）─────────────────────────────────────────
interface HolidayItem { id: string; name: string; date: string; emoji: string }
const SEED_HOLIDAYS: HolidayItem[] = [
  { id: 's-yuandan26', name: '元旦',   date: '2026-01-01', emoji: '🎉' },
  { id: 's-chunjie26', name: '春节',   date: '2026-02-17', emoji: '🧧' },
  { id: 's-qingming26', name: '清明节', date: '2026-04-05', emoji: '🌱' },
  { id: 's-wuyi26',    name: '劳动节', date: '2026-05-01', emoji: '🛠️' },
  { id: 's-duanwu26',  name: '端午节', date: '2026-06-19', emoji: '🐉' },
  { id: 's-zhongqiu26', name: '中秋节', date: '2026-09-25', emoji: '🌕' },
  { id: 's-guoqing26', name: '国庆节', date: '2026-10-01', emoji: '🇨🇳' },
  { id: 's-yuandan27', name: '元旦',   date: '2027-01-01', emoji: '🎉' },
]
const EMOJI_CHOICES = ['🎉', '🧧', '🌱', '🛠️', '🐉', '🌕', '🇨🇳', '🏖️', '✈️', '🎂', '❤️', '😴']

function loadHolidays(): HolidayItem[] {
  try {
    const raw = localStorage.getItem('dash-holidays')
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) return a }
  } catch { /* 坏数据回落到种子 */ }
  return SEED_HOLIDAYS
}

export function HolidayCountdown() {
  const [items, setItems] = useState<HolidayItem[]>(loadHolidays)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [emoji, setEmoji] = useState('🎉')
  const today = startOfDay(new Date())

  function persist(next: HolidayItem[]) {
    const sorted = [...next].sort((a, b) => a.date.localeCompare(b.date))
    setItems(sorted)
    localStorage.setItem('dash-holidays', JSON.stringify(sorted))
  }
  function add() {
    if (!name.trim() || !date) return
    persist([...items, { id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), date, emoji }])
    setName(''); setDate('')
  }

  const upcoming = items
    .map(i => ({ ...i, ts: new Date(i.date + 'T00:00:00').getTime() }))
    .filter(i => i.ts >= today)
    .sort((a, b) => a.ts - b.ts)
  const next = upcoming[0]
  const days = next ? Math.round((next.ts - today) / DAY_MS) : 0

  return (
    <WidgetShell
      title="假期倒计时" icon={PartyPopper} tone="success" scrollBody={editing}
      action={
        <button type="button" onClick={() => setEditing(e => !e)} title="管理假期"
          className={cn('flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-muted', editing ? 'text-primary' : 'text-muted-foreground')}>
          <Settings2 className="h-4 w-4" />
        </button>
      }
    >
      {!editing ? (
        !next ? (
          <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">假期表已空，点右上角添加</p>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <span className="text-3xl leading-none">{next.emoji}</span>
            {days === 0 ? (
              <span className="text-lg font-bold text-success">今天是{next.name} 🎉</span>
            ) : (
              <p className="text-center leading-tight">
                <span className="text-xs text-muted-foreground">距离{next.name}还有 </span>
                <span className="text-3xl font-semibold tabular-nums text-success">{days}</span>
                <span className="text-sm text-muted-foreground"> 天</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">{next.date.replace(/-/g, '/')}</p>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {next && (
            <p className="text-center text-xs text-muted-foreground">
              下一个：{next.emoji} {next.name} · {days === 0 ? '就是今天' : `${days} 天后`}
            </p>
          )}
          <div className="space-y-2 border-b border-border pb-3">
            <div className="flex flex-wrap gap-2">
              <input aria-label="假期日期" type="date" value={date} onChange={e => setDate(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
              <input aria-label="假期名称" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="假期名称" maxLength={12}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
            </div>
            <div className="flex flex-wrap gap-1">
              {EMOJI_CHOICES.map(e => (
                <button key={e} type="button" onClick={() => setEmoji(e)}
                  className={cn('flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-muted', emoji === e && 'bg-primary/10 ring-1 ring-primary')}>
                  {e}
                </button>
              ))}
            </div>
            <button type="button" onClick={add} disabled={!name.trim() || !date}
              className="flex w-full items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
              <Plus className="h-4 w-4" /> 添加假期
            </button>
          </div>
          <div className="space-y-1">
            {items.map(i => (
              <div key={i.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50">
                <span>{i.emoji}</span>
                <span className="flex-1 truncate text-foreground">{i.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{i.date.replace(/-/g, '/')}</span>
                <button type="button" onClick={() => persist(items.filter(x => x.id !== i.id))} title="删除"
                  className="flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => persist(SEED_HOLIDAYS)}
            className="w-full text-xs text-muted-foreground transition-colors hover:text-foreground">
            恢复法定节假日
          </button>
        </div>
      )}
    </WidgetShell>
  )
}

// ── 番茄钟 · lg ──────────────────────────────────────────────────────────────
const FOCUS_SEC = 25 * 60
export function PomodoroTimer() {
  const [left, setLeft] = useState(FOCUS_SEC)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000)
    return () => window.clearInterval(t)
  }, [running])
  useEffect(() => { if (left === 0 && running) setRunning(false) }, [left, running])

  const done = left === 0
  const R = 42, C = 2 * Math.PI * R
  const mm = Math.floor(left / 60), ss = left % 60

  return (
    <WidgetShell title="番茄钟" icon={Hourglass} tone="danger">
      <div className="flex h-full items-center justify-center gap-5">
        <div className="relative h-[84px] w-[84px] shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
            <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--destructive))" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (left / FOCUS_SEC)} className="transition-[stroke-dashoffset] duration-500" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular-nums text-foreground">{pad(mm)}:{pad(ss)}</span>
            <span className="text-xs leading-tight text-muted-foreground">{done ? '完成 🎉' : running ? '专注中' : '待开始'}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setRunning(r => !r)} disabled={done}
            className="flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
            {running ? <><Pause className="h-4 w-4" /> 暂停</> : <><Play className="h-4 w-4" /> 开始</>}
          </button>
          <button type="button" onClick={() => { setRunning(false); setLeft(FOCUS_SEC) }}
            className="flex items-center justify-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted">
            <RotateCcw className="h-4 w-4" /> 重置
          </button>
        </div>
      </div>
    </WidgetShell>
  )
}

// ── 每日一言 · sm ────────────────────────────────────────────────────────────
const QUOTES = [
  '今天也要元气满满哦',
  '努力不一定成功，但不努力一定很轻松',
  '认真你就输了，摸鱼你就赢了',
  '慢慢来，比较快',
  '热爱可抵岁月漫长',
  '工作是老板的，身体是自己的',
  '生活不止眼前的苟且，还有诗和远方',
  '把每一件小事做好，就是不平凡',
  '早睡早起身体好，摸鱼划水乐逍遥',
  '保持热爱，奔赴山海',
  '今日事今日毕，除非今天不想毕',
  '不为难自己，不辜负美食',
  '成年人的世界，除了发际线，什么都在涨',
  '愿你眼里有光，心中有爱，兜里有钱',
]
export function DailyQuote() {
  const [i, setI] = useState(() => {
    const d = new Date()
    return (d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % QUOTES.length
  })
  return (
    <WidgetShell
      title="每日一言" icon={Quote} tone="info"
      action={
        <button type="button" onClick={() => setI(x => (x + 1) % QUOTES.length)} title="换一条"
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted">
          <RefreshCw className="h-4 w-4" />
        </button>
      }
    >
      <div className="flex h-full items-center justify-center px-2">
        <p className="text-center text-base font-medium leading-relaxed text-foreground">“{QUOTES[i]}”</p>
      </div>
    </WidgetShell>
  )
}

// ── 摸鱼倒计时（距周末 / 发薪日）· sm ────────────────────────────────────────
export function SlackingCountdown() {
  const [payday, setPayday] = useState(() => Number(localStorage.getItem('dash-payday') || 15))
  const [editing, setEditing] = useState(false)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(t) }, [])

  const day = now.getDay()
  const isWeekend = day === 0 || day === 6
  const daysToWeekend = 6 - day
  const today = startOfDay(now)
  let pd = new Date(now.getFullYear(), now.getMonth(), payday)
  if (startOfDay(pd) < today) pd = new Date(now.getFullYear(), now.getMonth() + 1, payday)
  const daysToPay = Math.round((startOfDay(pd) - today) / DAY_MS)

  return (
    <WidgetShell
      title="摸鱼倒计时" icon={Fish} tone="info" scrollBody
      action={
        <button type="button" onClick={() => setEditing(e => !e)} title="设置发薪日"
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted">
          <Settings2 className="h-4 w-4" />
        </button>
      }
    >
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex items-center justify-between border-b border-border px-1 py-3">
          <span className="text-sm text-muted-foreground">距离周末</span>
          <span className="text-sm font-semibold text-foreground">
            {isWeekend ? '正在摸鱼 🐟' : daysToWeekend === 0 ? '就是今天 🎉' : `还有 ${daysToWeekend} 天`}
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-border px-1 py-3">
          <span className="text-sm text-muted-foreground">距离发薪日</span>
          <span className="text-sm font-semibold text-success">
            {daysToPay === 0 ? '发钱啦 🤑' : `还有 ${daysToPay} 天`}
          </span>
        </div>
        {editing && (
          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <span>每月发薪日</span>
            <input aria-label="每月发薪日" type="number" min={1} max={28} value={payday}
              onChange={e => { const v = Math.min(28, Math.max(1, Number(e.target.value) || 1)); setPayday(v); localStorage.setItem('dash-payday', String(v)) }}
              className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
            <span>号</span>
          </div>
        )}
      </div>
    </WidgetShell>
  )
}

// ── 今日运势 · sm ────────────────────────────────────────────────────────────
const FORTUNES = [
  { level: '大吉', emoji: '🎊', text: '诸事顺遂，宜大胆前行' },
  { level: '中吉', emoji: '😄', text: '小有收获，宜专注手头事' },
  { level: '吉',   emoji: '🙂', text: '平稳向好，宜低调行事' },
  { level: '小吉', emoji: '🍀', text: '运气尚可，宜多喝热水' },
  { level: '末吉', emoji: '😌', text: '波澜不惊，宜按部就班' },
  { level: '凶',   emoji: '😅', text: '诸事宜缓，今日适合摸鱼' },
]
export function DailyFortune() {
  // 抽签持久化：当天抽过就保留（存签的索引 + 日期），次日自动可重抽
  const [f, setF] = useState<typeof FORTUNES[number] | null>(() => {
    try {
      const r = JSON.parse(localStorage.getItem('dash-fortune') || '{}')
      if (r.date === todayKey() && typeof r.idx === 'number' && FORTUNES[r.idx]) return FORTUNES[r.idx]
    } catch { /* 坏数据忽略 */ }
    return null
  })
  function draw() {
    const idx = Math.floor(Math.random() * FORTUNES.length)
    setF(FORTUNES[idx])
    localStorage.setItem('dash-fortune', JSON.stringify({ date: todayKey(), idx }))
  }
  return (
    <WidgetShell title="今日运势" icon={Clover} tone="success">
      <div className="flex h-full flex-col items-center justify-center gap-1.5">
        {!f ? (
          <button type="button" onClick={draw}
            className="rounded-lg border border-dashed border-border px-5 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
            🎋 点击抽取今日签
          </button>
        ) : (
          <>
            <span className="text-4xl">{f.emoji}</span>
            <span className="text-lg font-bold text-success">{f.level}</span>
            <span className="text-center text-sm text-muted-foreground">{f.text}</span>
            <button type="button" onClick={draw} className="mt-0.5 text-xs text-primary hover:underline">再抽一次</button>
          </>
        )}
      </div>
    </WidgetShell>
  )
}

// ── 喝水提醒 · sm ────────────────────────────────────────────────────────────
const WATER_GOAL = 8
export function WaterTracker() {
  const [cups, setCups] = useState(() => {
    try { const r = JSON.parse(localStorage.getItem('dash-water') || '{}'); return r.date === todayKey() ? Number(r.cups) || 0 : 0 } catch { return 0 }
  })
  function set(n: number) {
    const v = Math.max(0, Math.min(WATER_GOAL, n))
    setCups(v); localStorage.setItem('dash-water', JSON.stringify({ date: todayKey(), cups: v }))
  }
  return (
    <WidgetShell
      title="喝水提醒" icon={Droplet} tone="info"
      action={
        <button type="button" onClick={() => set(0)} title="重置"
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted">
          <RotateCcw className="h-4 w-4" />
        </button>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="flex max-w-[15rem] flex-wrap justify-center gap-1.5">
          {Array.from({ length: WATER_GOAL }).map((_, i) => (
            <button key={i} type="button" onClick={() => set(i + 1 === cups ? i : i + 1)} aria-label={`喝到第 ${i + 1} 杯`}
              className={cn('text-2xl transition-transform hover:scale-110', i >= cups && 'opacity-25 grayscale')}>
              💧
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          今日 <span className="font-bold text-info">{cups}</span> / {WATER_GOAL} 杯
          {cups >= WATER_GOAL && ' · 达标啦 🎉'}
        </p>
      </div>
    </WidgetShell>
  )
}

// ── 待办便签 · lg（scrollBody）───────────────────────────────────────────────
interface Todo { id: string; text: string; done: boolean }
export function TodoNote() {
  const [todos, setTodos] = useState<Todo[]>(() => {
    try { const r = JSON.parse(localStorage.getItem('dash-todos') || '[]'); return Array.isArray(r) ? r : [] } catch { return [] }
  })
  const [text, setText] = useState('')
  function persist(next: Todo[]) { setTodos(next); localStorage.setItem('dash-todos', JSON.stringify(next)) }
  function add() { if (!text.trim()) return; persist([...todos, { id: `t-${Date.now()}`, text: text.trim(), done: false }]); setText('') }
  const left = todos.filter(t => !t.done).length

  return (
    <WidgetShell
      title="待办便签" icon={StickyNote} tone="warning" scrollBody
      action={todos.length > 0 ? <span className="text-xs text-muted-foreground">{left} 待办</span> : undefined}
    >
      <div className="space-y-2">
        <div className="sticky top-0 flex gap-2 bg-card pb-1">
          <input aria-label="待办内容" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="添加待办，回车确认…" maxLength={40}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
          <button aria-label="添加待办" type="button" onClick={add} disabled={!text.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {todos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">还没有待办，享受清闲 🎐</p>
        ) : (
          <div className="space-y-0.5">
            {todos.map(t => (
              <div key={t.id} className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50">
                <button type="button" onClick={() => persist(todos.map(x => x.id === t.id ? { ...x, done: !x.done } : x))} aria-label={t.done ? '标记未完成' : '标记完成'}>
                  {t.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                </button>
                <span className={cn('min-w-0 flex-1 truncate', t.done && 'text-muted-foreground line-through')}>{t.text}</span>
                <button type="button" onClick={() => persist(todos.filter(x => x.id !== t.id))} title="删除"
                  className="flex h-6 w-6 items-center justify-center rounded text-destructive opacity-70 transition-opacity hover:bg-destructive/10 focus-visible:opacity-100 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetShell>
  )
}

// ── 年度进度 · sm ────────────────────────────────────────────────────────────
export function YearProgress() {
  const [now] = useState(() => new Date())
  const y = now.getFullYear()
  const start = new Date(y, 0, 1).getTime()
  const end = new Date(y + 1, 0, 1).getTime()
  const ratio = (now.getTime() - start) / (end - start)
  const totalDays = Math.round((end - start) / DAY_MS)
  const dayOfYear = Math.floor((startOfDay(now) - start) / DAY_MS) + 1

  return (
    <WidgetShell title="年度进度" icon={Gauge} tone="primary">
      <div className="flex h-full flex-col justify-center gap-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">{y} 年</span>
          <span className="text-2xl font-semibold tabular-nums text-primary">{(ratio * 100).toFixed(1)}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${ratio * 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">第 {dayOfYear} / {totalDays} 天 · 还剩 {totalDays - dayOfYear} 天</p>
      </div>
    </WidgetShell>
  )
}
