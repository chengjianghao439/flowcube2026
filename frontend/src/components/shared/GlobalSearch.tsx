import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { payloadClient as client } from '@/api/client'

interface SearchResult { id: number; type: string; typeLabel: string; title: string; subtitle: string; path: string }

const TYPE_ICON: Record<string, string> = { product:'📦', supplier:'🏭', customer:'👤', purchase:'🛒', sale:'🚚' }
const TYPE_COLOR: Record<string, string> = {
  product:'text-blue-600 bg-blue-50',
  supplier:'text-purple-600 bg-purple-50',
  customer:'text-green-600 bg-green-50',
  purchase:'text-orange-600 bg-orange-50',
  sale:'text-red-600 bg-red-50',
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const timer = useRef<ReturnType<typeof setTimeout>>()

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
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="搜索... ⌘K"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
        />
        {loading && <span className="text-xs text-muted-foreground shrink-0">...</span>}
      </div>

      {showDropdown && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-white rounded-xl shadow-xl border z-50 overflow-hidden">
          {results.length === 0 && !loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">未找到「{query}」相关内容</div>
          )}
          {results.length > 0 && (
            <div>
              {/* 按类型分组显示 */}
              {['product','supplier','customer','purchase','sale'].map(type => {
                const group = results.filter(r => r.type === type)
                if (!group.length) return null
                return (
                  <div key={type}>
                    <div className={`px-3 py-1 text-xs font-semibold ${TYPE_COLOR[type]} border-b`}>
                      {TYPE_ICON[type]} {group[0].typeLabel}
                    </div>
                    {group.map(r => (
                      <button key={r.id} onClick={() => go(r)}
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
