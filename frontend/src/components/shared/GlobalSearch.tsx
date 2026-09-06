import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Factory, User, ShoppingCart, Truck, ClipboardList, ArrowLeftRight, Undo2, Inbox, Receipt, Archive, Banknote, ShieldCheck, ListChecks, FileText } from 'lucide-react'
import { searchGlobalApi, type GlobalSearchItem } from '@/api/search'

type SearchResult = GlobalSearchItem

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
// 分组展示顺序（与后端 ENTITIES 一致）
const TYPE_ORDER = ['product','supplier','customer','purchase','sale','requisition','transfer','purchaseReturn','saleReturn','inbound','expense','disposal','refund','creditOverride','stockcheck','invoice']

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const abort = useRef<AbortController | null>(null)
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
      if (e.key === 'Escape') {
        requestId.current += 1
        clearTimeout(timer.current)
        abort.current?.abort()
        setQuery(''); setResults([]); setLoading(false); setError(''); setFocused(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearTimeout(timer.current)
      requestId.current += 1
      abort.current?.abort()
    }
  }, [])

  const search = (q: string) => {
    setQuery(q)
    const currentRequest = ++requestId.current
    clearTimeout(timer.current)
    setResults([])
    abort.current?.abort()
    setError('')
    const keyword = q.trim()
    setLoading(Boolean(keyword))
    if (!keyword) return
    const controller = new AbortController()
    abort.current = controller
    timer.current = setTimeout(async () => {
      try {
        const page = await searchGlobalApi(keyword, { signal: controller.signal })
        if (currentRequest === requestId.current) setResults(page.items)
      } catch {
        if (currentRequest === requestId.current) setError('搜索失败，请重新输入关键词后重试')
      } finally {
        if (currentRequest === requestId.current) setLoading(false)
      }
    }, 300)
  }

  const go = (result: SearchResult) => {
    navigate(result.path)
    search(''); setFocused(false)
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
      <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-background w-56 focus-within:ring-2 focus-within:ring-primary/30 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          ref={inputRef}
          aria-label="全局搜索单据与资料"
          value={query}
          onChange={e => search(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { if (!suppressBlur.current) setTimeout(() => setFocused(false), 150); suppressBlur.current = false }}
          onKeyDown={onKeyDown}
          placeholder={`搜索… ${shortcutHint}`}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
        />
        {loading && <span className="text-xs text-muted-foreground shrink-0">...</span>}
      </div>

      {showDropdown && (
        <div data-search-results className="absolute top-full right-0 mt-2 w-[560px] max-w-[calc(100vw-2rem)] bg-popover text-popover-foreground rounded-lg shadow-lg border border-border z-50 max-h-[70vh] overflow-y-auto">
          {loading && <div role="status" className="py-8 text-center text-sm text-muted-foreground">正在搜索全部历史记录…</div>}
          {error && <div role="alert" className="px-4 py-8 text-center text-sm text-destructive">{error}</div>}
          {results.length === 0 && !loading && !error && (
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
                    <div className="sticky top-0 border-b bg-muted px-4 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
                      <Icon className="size-3.5" /> {group[0].typeLabel}
                    </div>
                    {group.map(r => (
                      <button key={r.id} onClick={() => go(r)} onMouseDown={onMouseDownResult}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors text-left">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium break-words leading-5">{r.title}</p>
                          {r.subtitle && r.subtitle !== r.title && <p className="text-xs text-muted-foreground break-words leading-5">{r.subtitle}</p>}
                          {!!r.details?.length && <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                            {r.details.map(detail => <span key={detail.label} className="break-words min-w-0 max-w-full leading-5">{detail.label}：{detail.value}</span>)}
                          </div>}
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </button>
                    ))}

                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
