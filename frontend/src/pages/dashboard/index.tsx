import { Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Pencil, Save, X, RotateCcw, GripVertical, Plus, Minus, LayoutGrid, Check, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/IconButton'
import PageHeader from '@/components/shared/PageHeader'
import { EditModeBadge } from '@/components/shared/EditModeBadge'
import { usePermission } from '@/hooks/usePermission'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import {
  useDashboardLayout, useSaveDashboardLayout, useLowStock,
} from '@/hooks/useDashboard'
import {
  WIDGETS, WIDGET_MAP, CATEGORY_LABEL, CATEGORY_ORDER,
  buildDefaultLayout, buildAllLayout, mergeLayout, type WidgetCategory,
} from '@/components/dashboard/registry'
import type { DashboardLayout, DashboardWidgetLayout } from '@/types/dashboard'
import '@/components/dashboard/dashboard.css'

// 列跨度 → Tailwind col-span（静态映射，避免动态拼接被 purge）。
// sm 只有 2 列，故 w≥2 一律占满 sm；lg 4 列按 w 展开。
const SPAN: Record<number, string> = {
  1: 'sm:col-span-1 lg:col-span-1',
  2: 'sm:col-span-2 lg:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
  4: 'sm:col-span-2 lg:col-span-4',
}

// 列表按内容决定高度并设置滚动上限；图表保持有界尺寸。
function widgetHeight(id: string, editing = false) {
  const definition = WIDGET_MAP[id]
  if (definition.category === 'list') return undefined
  const height = definition.size === 'lg' ? 380 : definition.category === 'kpi' ? 160 : 260
  return height + (editing ? 36 : 0)
}

function ReadOnlyWidget({ widget, className }: { widget: DashboardWidgetLayout; className: string }) {
  const Body = WIDGET_MAP[widget.id].Component
  return (
    <div data-widget-id={widget.id} data-widget-sizing={WIDGET_MAP[widget.id].category === 'list' ? 'content' : undefined} style={{ height: widgetHeight(widget.id) }} className={cn('dashboard-item min-w-0', className)}>
      <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">加载中…</div>}>
        <Body />
      </Suspense>
    </div>
  )
}

export default function DashboardPage() {
  const { can } = usePermission()
  const { data: saved, isLoading } = useDashboardLayout()
  const saveMut = useSaveDashboardLayout()

  const merged = useMemo(() => mergeLayout(saved), [saved])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<DashboardLayout | null>(null)
  const [libOpen, setLibOpen] = useState(false)
  const dragId = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  // 有权限访问某小组件？无 permission 字段=所有登录用户可见。
  const allowed = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const w of WIDGETS) map[w.id] = !w.permission || can(w.permission)
    return map
  }, [can])

  // 低库存桌面通知（保留原有行为，与是否个性化布局无关）
  const { data: lowStock } = useLowStock(10)
  const notified = useRef(false)
  useEffect(() => {
    if (!lowStock?.length || notified.current) return
    notified.current = true
    if (!('Notification' in window)) return
    const send = () => new Notification('极序 Flow 低库存预警', {
      body: `${lowStock.length} 种商品库存不足，请及时补货`, icon: `${import.meta.env.BASE_URL}icons/icon-192.png?v=0.9.9`,
    })
    if (Notification.permission === 'granted') send()
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') send() })
  }, [lowStock])

  const layout = editing && draft ? draft : merged

  // 渲染的可见小组件：显示 + 有权限
  const visible = layout.widgets.filter(w => WIDGET_MAP[w.id] && w.visible && allowed[w.id])
  // 组件库可添加：隐藏 + 有权限
  const addable = layout.widgets.filter(w => WIDGET_MAP[w.id] && !w.visible && allowed[w.id])

  // ── 编辑操作 ──────────────────────────────────────────────────────────────
  function startEdit() { setDraft(mergeLayout(saved)); setEditing(true) }
  function cancelEdit() { setEditing(false); setDraft(null); setLibOpen(false) }
  function showAll() { setDraft(buildAllLayout()); setEditing(true); setLibOpen(false) }
  function resetDefault() { setDraft(buildDefaultLayout()); toast.success('已载入推荐布局预览，保存后生效') }
  async function save() {
    if (!draft) return
    try {
      await saveMut.mutateAsync(draft)
      toast.success('仪表盘布局已保存')
      setEditing(false); setDraft(null); setLibOpen(false)
    } catch {
      toast.error('保存失败，请重试')
    }
  }

  // 未保存变更保护：进入编辑模式即视为有草稿待保存（关闭标签拦截）
  const tabPath = useContext(TabPathContext) || ''
  useDirtyGuard(tabPath, editing && draft != null)

  const patch = (fn: (ws: DashboardWidgetLayout[]) => DashboardWidgetLayout[]) =>
    setDraft(prev => prev ? { widgets: fn([...prev.widgets]) } : prev)

  const hide = (id: string) => patch(ws => ws.map(w => w.id === id ? { ...w, visible: false } : w))
  const resize = (id: string, delta: number) =>
    patch(ws => ws.map(w => w.id === id ? { ...w, w: Math.min(4, Math.max(1, w.w + delta)) } : w))
  const add = (id: string) => patch(ws => {
    const cur = ws.find(w => w.id === id)
    const rest = ws.filter(w => w.id !== id)
    rest.push({ id, visible: true, w: cur?.w ?? WIDGET_MAP[id]?.defaultW ?? 2 })
    return rest
  })
  const reorder = (overId: string) => {
    const from = dragId.current
    if (!from || from === overId) return
    patch(ws => {
      const fi = ws.findIndex(w => w.id === from)
      const ti = ws.findIndex(w => w.id === overId)
      if (fi < 0 || ti < 0) return ws
      const [m] = ws.splice(fi, 1)
      ws.splice(ti, 0, m)
      return ws
    })
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader title="仪表盘"
        description={editing ? '拖拽调整卡片顺序 · 调整宽度 · 隐藏或添加卡片，完成后保存' : "查看待办、经营指标与个人工具。"} status={editing ? <EditModeBadge /> : undefined}
        actions={<div className="flex flex-wrap items-center gap-2">
          {!editing ? (
            <>
              <Button variant="outline" size="sm" onClick={showAll}><LayoutGrid className="h-3.5 w-3.5" /> 展示全部卡片</Button>
              <Button variant="outline" size="sm" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /> 编辑仪表盘</Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setLibOpen(v => !v)}>
                <LayoutGrid className="h-3.5 w-3.5" /> 组件库
                {addable.length > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-xs text-primary">{addable.length}</span>}
              </Button>
              <Button variant="outline" size="sm" onClick={resetDefault}>
                <RotateCcw className="h-3.5 w-3.5" /> 载入推荐
              </Button>
              <Button variant="outline" size="sm" onClick={cancelEdit}>
                <X className="h-3.5 w-3.5" /> 取消
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saveMut.isPending}>
                <Save className="h-3.5 w-3.5" /> {saveMut.isPending ? '保存中…' : '保存'}
              </Button>
            </>
          )}
        </div>}
      />


      {/* 组件库（编辑态内联展开，非模态） */}
      {editing && libOpen && (
        <div className="card-base p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-section-title">组件库</h2>
            <span className="text-xs text-muted-foreground">点击添加到仪表盘</span>
          </div>
          {addable.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">已添加全部可用小组件</p>
          ) : (
            <div className="space-y-4">
              {CATEGORY_ORDER.map(cat => {
                const items = addable.filter(w => WIDGET_MAP[w.id].category === cat)
                if (!items.length) return null
                return (
                  <div key={cat}>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">{CATEGORY_LABEL[cat as WidgetCategory]}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map(w => {
                        const def = WIDGET_MAP[w.id]
                        const Icon = def.icon
                        return (
                          <button key={w.id} type="button" onClick={() => add(w.id)}
                            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="min-w-0 whitespace-normal [overflow-wrap:anywhere] text-sm font-medium text-foreground">{def.title}</p>
                              <p className="min-w-0 whitespace-normal [overflow-wrap:anywhere] text-xs text-muted-foreground">{def.description}</p>
                            </div>
                            <Plus className="h-4 w-4 shrink-0 text-primary" />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 加载骨架 */}
      {isLoading && !editing ? (
        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card-base h-36 animate-pulse bg-muted/40" />)}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card-base h-[340px] animate-pulse bg-muted/40" />)}
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="card-base flex flex-col items-center gap-3 py-16 text-center">
          <LayoutGrid className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {editing ? '还没有显示任何小组件，点「组件库」添加' : '仪表盘为空，点右上角「编辑仪表盘」添加小组件'}
          </p>
          {!editing && <Button size="sm" variant="outline" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /> 编辑仪表盘</Button>}
        </div>
      ) : editing ? (
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map(w => {
            const def = WIDGET_MAP[w.id]
            const Body = def.Component
            return (
              <div
                key={w.id}
                data-widget-id={w.id}
                data-widget-sizing={def.category === 'list' ? 'content' : undefined}
                style={{ height: widgetHeight(w.id, true) }}
                className={cn(SPAN[w.w] ?? SPAN[2], 'desktop-widget-editor relative flex min-w-0 flex-col', dragging === w.id && 'opacity-40')}
                draggable={editing}
                onDragStart={editing ? () => { dragId.current = w.id; setDragging(w.id) } : undefined}
                onDragEnter={editing ? () => reorder(w.id) : undefined}
                onDragOver={editing ? (e) => e.preventDefault() : undefined}
                onDragEnd={editing ? () => { dragId.current = null; setDragging(null) } : undefined}
              >
                {editing && (
                  <>
                    <div className="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-dashed border-primary/40" />
                    <div className="desktop-widget-controls relative z-20 flex shrink-0 items-center gap-0.5 px-2 py-1">
                      <span title="拖拽排序" className="mr-auto flex h-7 w-7 cursor-grab items-center justify-center rounded text-muted-foreground active:cursor-grabbing">
                        <GripVertical aria-hidden="true" className="h-3.5 w-3.5" />
                      </span>
                      <IconButton label={`减小${def.title}宽度`} icon={Minus} onClick={() => resize(w.id, -1)} disabled={w.w <= 1}
                        className="h-7 w-7 rounded-md text-muted-foreground disabled:opacity-30" />
                      <span className="w-4 text-center text-xs tabular-nums text-muted-foreground">{w.w}</span>
                      <IconButton label={`增大${def.title}宽度`} icon={Plus} onClick={() => resize(w.id, 1)} disabled={w.w >= 4}
                        className="h-7 w-7 rounded-md text-muted-foreground disabled:opacity-30" />
                      <IconButton label={`隐藏${def.title}`} icon={X} onClick={() => hide(w.id)}
                        className="h-7 w-7 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive-ink" />
                    </div>
                  </>
                )}
                {/* Suspense：图表 widget 为 lazy（recharts 按需加载），fallback 占位避免白屏 */}
                <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">加载中…</div>}>
                  <Body />
                </Suspense>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map(widget => <ReadOnlyWidget key={widget.id} widget={widget} className={SPAN[widget.w] ?? SPAN[2]} />)}
        </div>
      )}

      {editing && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5" /> 布局保存到你的账号，桌面端与网页端同步
        </p>
      )}
    </div>
  )
}
