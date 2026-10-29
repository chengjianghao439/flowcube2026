import { ProductIdentitySummary } from '@/components/shared/ProductIdentitySummary'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { Package, Factory, User, ShoppingCart, Truck, ClipboardList, ArrowLeftRight, Undo2, Inbox, Receipt, Archive, Banknote, ShieldCheck, ListChecks, FileText, Search, ArrowRight, Loader2, X } from 'lucide-react'
import { searchGlobalApi, type GlobalSearchItem } from '@/api/search'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { EmptyState } from './EmptyState'
import { IconButton } from './IconButton'

type SearchResult = GlobalSearchItem
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  product: Package, supplier: Factory, customer: User, purchase: ShoppingCart, sale: Truck,
  requisition: ClipboardList, transfer: ArrowLeftRight, purchaseReturn: Undo2, saleReturn: Undo2,
  inbound: Inbox, expense: Receipt, disposal: Archive, refund: Banknote,
  creditOverride: ShieldCheck, stockcheck: ListChecks, invoice: FileText,
}
const TYPE_ORDER = ['product', 'supplier', 'customer', 'purchase', 'sale', 'requisition', 'transfer', 'purchaseReturn', 'saleReturn', 'inbound', 'expense', 'disposal', 'refund', 'creditOverride', 'stockcheck', 'invoice']
const resultValue = (result: SearchResult) => JSON.stringify([result.type, result.id, result.path])

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const navigate = useNavigate()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  const shortcutHint = isMac ? '⌘K' : 'Ctrl+K'

  const resetSearch = useCallback(() => {
    requestId.current += 1
    clearTimeout(timer.current)
    abort.current?.abort()
    setQuery(''); setResults([]); setSelected(''); setLoading(false); setError(''); setFocused(false)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); inputRef.current?.focus(); setFocused(true)
      }
      // 其他弹窗/表单的 Escape 不清空搜索，也不抢走其焦点。
      if (e.key === 'Escape' && rootRef.current?.contains(document.activeElement)) {
        resetSearch(); inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearTimeout(timer.current)
      requestId.current += 1
      abort.current?.abort()
    }
  }, [resetSearch])

  const search = (q: string) => {
    setQuery(q); setSelected('')
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
    resetSearch()
  }
  const showDropdown = focused && query.trim().length > 0
  const groups = TYPE_ORDER.map(type => ({ type, items: results.filter(result => result.type === type) })).filter(group => group.items.length)

  return <Command ref={rootRef} shouldFilter={false} vimBindings={false} loop value={selected} onValueChange={setSelected}
    label="全局搜索单据与资料" className="fc-global-search relative"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <Popover open={showDropdown} onOpenChange={setFocused}>
      <PopoverAnchor asChild>
        <div className="fc-global-search-input flex w-56 items-center gap-2 rounded-lg border bg-background px-3 py-1.5 transition-colors focus-within:ring-2 focus-within:ring-primary/30">
          <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <Command.Input asChild ref={inputRef} value={query} onValueChange={search}>
            <input aria-label="全局搜索单据与资料" aria-expanded={showDropdown}
              title="搜索单据与资料；商品支持编码、名称、条码、供应商型号、型号、颜色"
              autoComplete="off" onFocus={() => setFocused(true)} placeholder={`搜索… ${shortcutHint}`}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </Command.Input>
          {loading ? <Loader2 aria-label="正在搜索" className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
            : query && <IconButton label="清空全局搜索" icon={X} className="size-5 shrink-0" onClick={() => { search(''); inputRef.current?.focus() }} />}
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" sideOffset={8} role="presentation" aria-labelledby={undefined} data-search-results
        className="fc-global-search-results w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden"
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => { if (rootRef.current?.contains(event.target as Node)) event.preventDefault() }}
        onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); resetSearch(); inputRef.current?.blur() }}>
        <Command.List className="fc-global-search-list max-h-[min(420px,calc(var(--radix-popover-content-available-height)-40px))] overflow-y-auto overscroll-contain" label="搜索结果" aria-busy={loading}>
          {loading && <div role="status" className="px-5 py-8 text-center text-sm text-muted-foreground">正在搜索全部历史记录…</div>}
          {error && <div role="alert" className="px-5 py-8 text-center text-sm text-destructive-ink">{error}</div>}
          {!loading && !error && !results.length && <EmptyState variant="no-result" compact title={`未找到「${query}」相关内容`} description="" />}
          {groups.map(({ type, items }) => {
            const Icon = TYPE_ICON[type] || FileText
            return <Command.Group key={type} heading={<><Icon aria-hidden="true" className="size-3.5" />{items[0].typeLabel}</>}>
              {items.map(result => <Command.Item key={resultValue(result)} value={resultValue(result)} onSelect={() => go(result)}
                onMouseDown={event => event.preventDefault()} className="fc-global-search-result flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none">
                <div className="min-w-0 flex-1">
                  {result.type === 'product' ? <ProductIdentitySummary product={{ name: result.title, code: result.subtitle, spec: result.details?.find(d => d.label === '型号')?.value, color: result.details?.find(d => d.label === '颜色')?.value, articleNumber: result.details?.find(d => d.label === '供应商型号')?.value }} /> : <p className="break-words text-sm font-medium leading-5">{result.title}</p>}
                  {result.type === 'product' && query.trim() && result.searchMatch && <p className="break-words text-xs leading-5 text-muted-foreground">命中：{result.searchMatch}</p>}
                  {result.type !== 'product' && result.subtitle && result.subtitle !== result.title && <p className="break-words text-xs leading-5 text-muted-foreground">{result.subtitle}</p>}
                  {!!result.details?.length && <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {result.details.filter(detail => result.type !== 'product' || !['型号', '颜色', '供应商型号'].includes(detail.label)).map(detail => <span key={detail.label} className="min-w-0 max-w-full break-words leading-5">{detail.label}：{detail.value}</span>)}
                  </div>}
                </div>
                <ArrowRight aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
              </Command.Item>)}
            </Command.Group>
          })}
        </Command.List>
        {!!groups.length && <div className="fc-global-search-footer flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <span>{results.length} 项结果</span><span aria-hidden="true">↑↓ 选择 · Enter 打开</span>
        </div>}
      </PopoverContent>
    </Popover>
  </Command>
}
