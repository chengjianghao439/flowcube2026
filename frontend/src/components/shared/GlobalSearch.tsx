import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Factory, User, ShoppingCart, Truck, ClipboardList, ArrowLeftRight, Undo2, Inbox, Receipt, Archive, Banknote, ShieldCheck, ListChecks, FileText } from 'lucide-react'
import { payloadClient as client } from '@/api/client'

interface SearchResult { id: number; type: string; typeLabel: string; title: string; subtitle: string; path: string }

const TYPE_ICON: Record<string, React.ComponentType<{className?: string}>> = {
  product: Package,
  supplier: Factory,
  customer: User,
  purchase: ShoppingCart,
  sale: Truck,
  requisition: ClipboardList,
  transfer: ArrowLeftRight,
  purchaseReturn: Undo2,
  saleReturn: Undo2,
  inbound: Inbox,
  expense: Receipt,
  disposal: Archive,
  refund: Banknote,
  creditOverride: ShieldCheck,
  stockcheck: ListChecks,
  invoice: FileText,
}
const TYPE_COLOR: Record<string, string> = {
  product:'text-blue-600 bg-blue-50',
  supplier:'text-purple-600 bg-purple-50',
  customer:'text-green-600 bg-green-50',
  purchase:'text-orange-600 bg-orange-50',
  sale:'text-red-600 bg-red-50',
  requisition:'text-cyan-600 bg-cyan-50',
  transfer:'text-indigo-600 bg-indigo-50',
  purchaseReturn:'text-amber-600 bg-amber-50',
  saleReturn:'text-rose-600 bg-rose-50',
  inbound:'text-teal-600 bg-teal-50',
  expense:'text-emerald-600 bg-emerald-50',
  disposal:'text-stone-600 bg-stone-50',
  refund:'text-fuchsia-600 bg-fuchsia-50',
  creditOverride:'text-sky-600 bg-sky-50',
  stockcheck:'text-lime-600 bg-lime-50',
  invoice:'text-violet-600 bg-violet-50',
}
// 分组展示顺序（与后端 ENTITIES 一致）
const TYPE_ORDER = ['product','supplier','customer','purchase','sale','requisition','transfer','purchaseReturn','saleReturn','inbound','expense','disposal','refund','creditOverride','stockcheck','invoice']

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // 平台化快捷键提示：macOS 显示 ⌘K，Windows/Linux 显示 Ctrl+K
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  const shortcutHint = isMac ? '⌘K' : 'Ctrl+K'

  // 快捷键 Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus() }
      if (e.key === 'Escape') { setQuery(''); inputRef.current?.blur() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const search = (q: string) => {
    setQuery(q)
    clearTimeout(timer.current)
    if (!q.trim()) { setResults([]); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await client.get<SearchResult[]>('/search', { params: { q } })
        setResults(r || [])
      } catch (_) {}
      setLoading(false)
    }, 300)
  }

  const go = (result: SearchResult) => {
    navigate(result.path)
    setQuery(''); setResults([])
  }

  // 回车跳转第一个结果；阻止点击时被 blur 抢先收起（mousedown 时记录，避免 150ms 竞争）
  const suppressBlur = useRef(false)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault()
      go(results[0])
    }
  }
  const onMouseDownResult = () => { suppressBlur.current = true }

  const showDropdown = focused && (query.trim().length > 0)

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-background w-56 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => search(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { if (!suppressBlur.current) setTimeout(() => setFocused(false), 150); suppressBlur.current = false }}
          onKeyDown={onKeyDown}
          placeholder={`搜索... ${shortcutHint}`}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
        />
        {loading && <span className="text-xs text-muted-foreground shrink-0">...</span>}
      </div>

      {showDropdown && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-white rounded-lg shadow-xl border z-50 overflow-hidden">
          {results.length === 0 && !loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">未找到「{query}」相关内容</div>
          )}
          {results.length > 0 && (
            <div>
              {/* 按类型分组显示 */}
              {TYPE_ORDER.map(type => {
                const group = results.filter(r => r.type === type)
                if (!group.length) return null
                const Icon = TYPE_ICON[type] || FileText
                return (
                  <div key={type}>
                    <div className={`px-3 py-1 text-xs font-semibold ${TYPE_COLOR[type] || 'text-muted-foreground bg-muted/40'} border-b flex items-center gap-1`}>
                      <Icon className="size-3.5" /> {group[0].typeLabel}
                    </div>
                    {group.map(r => (
                      <button key={r.id} onClick={() => go(r)} onMouseDown={onMouseDownResult}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors text-left">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{r.title}</p>
                          {r.subtitle && <p className="text-xs text-muted-foreground truncate">{r.subtitle}</p>}
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                )
              })}
              <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
                点击跳转到对应页面
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
