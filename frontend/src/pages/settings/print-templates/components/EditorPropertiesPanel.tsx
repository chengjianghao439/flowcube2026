import { useId, useState } from 'react'
import type React from 'react'
import {
  Trash2, X, AlignLeft, AlignCenter, AlignRight, Bold,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  ChevronUp, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TABLE_COLUMN_OPTIONS } from '@/constants/printFieldDefs'
import type { TemplateElement } from '@/types/print-template'
import { LayoutNumberInput } from './LayoutNumberInput'
import { labelFontMm, type AlignDir } from './editorUtils'

interface PropertiesPanelProps {
  el: TemplateElement | null
  multiCount: number
  isLabel: boolean
  canvasW: number
  canvasH: number
  onChange: (id: string, patch: Partial<TemplateElement>, inputKey?: string) => void
  onToggle: (id: string, key: 'showIndex' | 'tableRowWrap') => void
  onEndInputEdit: () => void
  onDelete: (id: string) => void
  onDeleteMulti: () => void
  onAlign: (dir: AlignDir) => void
  onDistribute: (dir: 'horizontal' | 'vertical') => void
}

export function PropertiesPanel({ el, multiCount, isLabel, canvasW, canvasH, onChange, onToggle, onEndInputEdit, onDelete, onDeleteMulti, onAlign, onDistribute }: PropertiesPanelProps) {
  const [customColKey, setCustomColKey] = useState('')
  const controlId = useId()
  if (!el) {
    return (
      <div className="flex w-60 shrink-0 flex-col border-l bg-muted/20">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium text-foreground">属性面板</p>
        </div>
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          点击画布中的元素以编辑属性
        </div>
      </div>
    )
  }

  if (multiCount > 1) {
    return (
      <div className="flex w-60 shrink-0 flex-col overflow-hidden border-l bg-muted/20">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-medium text-foreground">属性面板</p>
          <span className="text-xs text-muted-foreground">已选 {multiCount} 项</span>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">对齐画布</label>
            <div className="grid grid-cols-3 gap-1">
              {([
                ['left', <AlignHorizontalJustifyStart className="size-3.5" />, '左对齐'],
                ['hcenter', <AlignHorizontalJustifyCenter className="size-3.5" />, '水平居中'],
                ['right', <AlignHorizontalJustifyEnd className="size-3.5" />, '右对齐'],
                ['top', <AlignVerticalJustifyStart className="size-3.5" />, '顶对齐'],
                ['vmiddle', <AlignVerticalJustifyCenter className="size-3.5" />, '垂直居中'],
                ['bottom', <AlignVerticalJustifyEnd className="size-3.5" />, '底对齐'],
              ] as [AlignDir, React.ReactNode, string][]).map(([dir, icon, title]) => (
                <Button key={dir} size="sm" variant="outline" className="p-0" title={title} aria-label={`对齐：${title}`}
                  onClick={() => onAlign(dir)}>
                  {icon}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">等距分布（需 ≥3 项）</label>
            <div className="grid grid-cols-2 gap-1">
              <Button size="sm" variant="outline" className="p-0" title="垂直等距"
                disabled={multiCount < 3} onClick={() => onDistribute('vertical')} aria-label="垂直等距分布">
                <AlignVerticalSpaceAround className="size-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="p-0" title="水平等距"
                disabled={multiCount < 3} onClick={() => onDistribute('horizontal')} aria-label="水平等距分布">
                <AlignHorizontalSpaceAround className="size-3.5" />
              </Button>
            </div>
          </div>
          <Button size="sm" variant="outline" className="w-full text-destructive-ink hover:text-destructive-ink"
            onClick={() => onDeleteMulti()}>
            删除选中项 (Delete)
          </Button>
        </div>
      </div>
    )
  }

  const customCols = (el.tableColumns ?? []).filter(k => !TABLE_COLUMN_OPTIONS.some(c => c.key === k))

  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden border-l bg-muted/20">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-medium text-foreground">属性面板</p>
        <Button size="sm" variant="ghost" className="size-7 p-0 text-destructive-ink hover:text-destructive-ink" aria-label="删除该元素"
          onClick={() => onDelete(el.id)}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">显示标签</label>
          <Input
            value={el.label}
            onFocus={onEndInputEdit}
            onChange={e => onChange(el.id, { label: e.target.value }, 'label')}
            onBlur={onEndInputEdit}
            className="h-7 text-xs"
          />
          {el.type === 'image' && (
            <p className="text-xs leading-snug text-muted-foreground">
              图片来源：系统设置 → 品牌标识（公司 Logo，未上传时不显示）
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">位置与尺寸 (mm)</label>
          <div className="grid grid-cols-2 gap-1.5">
            {([['x', 'X', 0, canvasW], ['y', 'Y', 0, canvasH], ['width', '宽', 3, canvasW], ['height', '高', 3, canvasH]] as const).map(([k, lbl, min, max]) => (
              <div key={k} className="flex items-center gap-1">
                <span className="w-5 shrink-0 text-xs text-muted-foreground">{lbl}</span>
                <LayoutNumberInput
                  min={min} max={max} step="1" aria-label={lbl}
                  value={el[k]}
                  onValueChange={value => onChange(el.id, { [k]: value }, k)}
                  onComplete={onEndInputEdit}
                  className="h-7 text-xs"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">对齐到画布</label>
          <div className="flex gap-1">
            {([
              ['left', <AlignHorizontalJustifyStart className="size-3.5" />, '左对齐'],
              ['hcenter', <AlignHorizontalJustifyCenter className="size-3.5" />, '水平居中'],
              ['right', <AlignHorizontalJustifyEnd className="size-3.5" />, '右对齐'],
              ['top', <AlignVerticalJustifyStart className="size-3.5" />, '顶对齐'],
              ['vmiddle', <AlignVerticalJustifyCenter className="size-3.5" />, '垂直居中'],
              ['bottom', <AlignVerticalJustifyEnd className="size-3.5" />, '底对齐'],
            ] as [AlignDir, React.ReactNode, string][]).map(([dir, icon, title]) => (
              <Button key={dir} size="sm" variant="outline" className="flex-1 p-0" title={title}
                onClick={() => onAlign(dir)}>
                {icon}
              </Button>
            ))}
          </div>
        </div>

        {el.type === 'barcode' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">码制</label>
              <Select
                value={el.barcodeSymbology ?? 'code128'}
                onValueChange={v => onChange(el.id, { barcodeSymbology: v as 'code128' | 'ean13' })}
              >
                <SelectTrigger className="h-7 py-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="code128">Code 128（通用）</SelectItem>
                  <SelectItem value="ean13">EAN-13（13 位数字）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor={`${controlId}-hri`} className="cursor-pointer text-xs font-medium text-muted-foreground">显示可读数字</label>
              <Switch id={`${controlId}-hri`} aria-label="显示可读数字" checked={el.barcodeHRI !== false}
                onCheckedChange={checked => onChange(el.id, { barcodeHRI: checked })} />
            </div>
          </div>
        )}

        {el.type !== 'divider' && el.type !== 'barcode' && el.type !== 'image' && (
          isLabel ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">字高 (mm)</label>
              <LayoutNumberInput
                min={1} max={30} step="0.5" aria-label="字高"
                value={labelFontMm(el)}
                onValueChange={value => onChange(el.id, { fontHeightMm: value }, 'fontHeightMm')}
                onComplete={onEndInputEdit}
                className="h-7 w-20 text-xs"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">字体</label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">大小</span>
                  <LayoutNumberInput
                    min={6} max={72} step="1" aria-label="字体大小"
                    value={el.fontSize}
                    onValueChange={value => onChange(el.id, { fontSize: value }, 'fontSize')}
                    onComplete={onEndInputEdit}
                    className="h-7 w-14 text-xs"
                  />
                </div>
                <Button
                  size="sm" variant={el.fontWeight === 'bold' ? 'default' : 'outline'}
                  className="size-7 p-0"
                  aria-label="加粗"
                  aria-pressed={el.fontWeight === 'bold'}
                  onClick={() => onChange(el.id, { fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold' })}
                >
                  <Bold className="size-3.5" />
                </Button>
              </div>
            </div>
          )
        )}

        {isLabel && el.type === 'text' && (
          <div className="flex items-center justify-between">
            <label htmlFor={`${controlId}-prefix`} className="cursor-pointer text-xs font-medium text-muted-foreground">显示「标签：」前缀</label>
            <Switch id={`${controlId}-prefix`} aria-label="显示标签：前缀" checked={!!el.showLabel}
              onCheckedChange={checked => onChange(el.id, { showLabel: checked })} />
          </div>
        )}

        {el.type !== 'divider' && el.type !== 'barcode' && el.type !== 'image' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">对齐方式</label>
            <ToggleGroup type="single" value={el.textAlign} aria-label="对齐方式" className="flex w-full"
              onValueChange={value => {
                if (value === 'left' || value === 'center' || value === 'right') onChange(el.id, { textAlign: value })
              }}>
              {(['left', 'center', 'right'] as const).map(a => (
                <ToggleGroupItem
                  key={a}
                  value={a}
                  className="flex-1 p-0"
                  aria-label={a === 'left' ? '左对齐' : a === 'center' ? '居中对齐' : '右对齐'}
                >
                  {a === 'left' && <AlignLeft className="size-3.5" />}
                  {a === 'center' && <AlignCenter className="size-3.5" />}
                  {a === 'right' && <AlignRight className="size-3.5" />}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        {!isLabel && el.type === 'text' && (
          <div className="flex items-center justify-between">
            <label htmlFor={`${controlId}-border`} className="cursor-pointer text-xs font-medium text-muted-foreground">显示边框</label>
            <Switch id={`${controlId}-border`} aria-label="显示边框" checked={!!el.border}
              onCheckedChange={checked => onChange(el.id, { border: checked })} />
          </div>
        )}

        {el.type === 'table' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor={`${controlId}-index`} className="cursor-pointer text-xs font-medium text-muted-foreground">显示序号列</label>
              <Switch id={`${controlId}-index`} aria-label="显示序号列" checked={el.showIndex !== false}
                onCheckedChange={() => onToggle(el.id, 'showIndex')} />
            </div>

            {(el.tableColumns ?? ['name', 'qty', 'price', 'amount']).includes('name') && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">名称后附加信息</label>
                <ToggleGroup type="multiple" value={el.nameAttrs ?? []} aria-label="名称后附加信息"
                  className="flex flex-wrap justify-start bg-transparent p-0"
                  onValueChange={nameAttrs => onChange(el.id, { nameAttrs })}>
                  {(['color', 'spec', 'unit', 'articleNo'] as const).map(key => {
                    const def = TABLE_COLUMN_OPTIONS.find(c => c.key === key) ?? { key, label: key }
                    return (
                      <ToggleGroupItem
                        key={key}
                        value={key}
                        className="border border-border px-2 data-[state=on]:border-primary/25 data-[state=on]:bg-primary/5 data-[state=on]:shadow-none"
                      >
                        {def.label}
                      </ToggleGroupItem>
                    )
                  })}
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">勾选后拼接在商品名称后（如「商品A [黑色] [500g] [件]」），不再作为独立列。</p>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">表格列（打印顺序）</label>
              {(el.tableColumns ?? []).map((key, idx) => {
                const def = TABLE_COLUMN_OPTIONS.find(c => c.key === key) ?? { key, label: key, align: 'left' as const }
                const colW = (el.tableColumnWidths ?? {})[key]
                const setColumnWidth = (value?: number) => {
                  const widths = { ...(el.tableColumnWidths ?? {}) }
                  if (value === undefined) delete widths[key]
                  else widths[key] = value
                  onChange(el.id, { tableColumnWidths: widths }, `width:${key}`)
                }
                return (
                  <div key={key} className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                      title="向左调整顺序"
                      aria-label={`上移列 ${def.label}`}
                      disabled={idx === 0}
                      onClick={() => {
                        const cols = el.tableColumns ?? []
                        const next = [...cols]
                        ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                        onChange(el.id, { tableColumns: next })
                      }}
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                      title="向右调整顺序"
                      aria-label={`下移列 ${def.label}`}
                      disabled={idx === (el.tableColumns ?? []).length - 1}
                      onClick={() => {
                        const cols = el.tableColumns ?? []
                        const next = [...cols]
                        ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                        onChange(el.id, { tableColumns: next })
                      }}
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => {
                          const cols = el.tableColumns ?? []
                          const widths = { ...(el.tableColumnWidths ?? {}) }
                          delete widths[key]
                          onChange(el.id, { tableColumns: cols.filter(c => c !== key), tableColumnWidths: widths })
                        }}
                        className="size-3"
                      />
                      <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{def.label}</span>
                    </label>
                    <LayoutNumberInput
                      min={0} step="1" aria-label={`${def.label}列宽`}
                      placeholder="均分"
                      value={colW}
                      onValueChange={setColumnWidth}
                      onClear={setColumnWidth}
                      onComplete={onEndInputEdit}
                      className="h-6 w-14 text-xs"
                    />
                  </div>
                )
              })}
              {(el.tableColumns ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">尚未选择任何列，请在下方添加</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">添加列</label>
              <div className="flex flex-wrap gap-1.5">
                {TABLE_COLUMN_OPTIONS.filter(col => !(el.tableColumns ?? []).includes(col.key)).map(col => (
                  <button
                    key={col.key}
                    type="button"
                    className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    onClick={() => onChange(el.id, { tableColumns: [...(el.tableColumns ?? []), col.key] })}
                  >
                    + {col.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">自定义列（key）</label>
              {customCols.map(key => (
                <div key={key} className="flex items-center justify-between rounded-md border border-dashed px-2 py-1">
                  <span className="font-mono text-xs">{key}</span>
                  <Button size="sm" variant="ghost" className="size-5 p-0 text-muted-foreground hover:text-destructive-ink"
                    title="移除自定义列"
                    onClick={() => {
                      const cols = el.tableColumns ?? []
                      const widths = { ...(el.tableColumnWidths ?? {}) }
                      delete widths[key]
                      onChange(el.id, { tableColumns: cols.filter(c => c !== key), tableColumnWidths: widths })
                    }}>
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
              <form
                className="flex gap-1"
                onSubmit={e => {
                  e.preventDefault()
                  const key = customColKey.trim()
                  if (!key) return
                  const cols = el.tableColumns ?? []
                  if (!cols.includes(key)) onChange(el.id, { tableColumns: [...cols, key] })
                  setCustomColKey('')
                }}
              >
                <Input
                  value={customColKey}
                  onChange={e => setCustomColKey(e.target.value)}
                  placeholder="如 batch_no"
                  className="h-7 flex-1 font-mono text-xs"
                />
                <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">添加</Button>
              </form>
            </div>

            <div className="space-y-1.5 border-t border-border/60 pt-3">
              <label className="text-xs font-medium text-muted-foreground">行高与换行</label>
              <p className="text-xs leading-snug text-muted-foreground">
                注：打印时表格高度随明细行数自动撑开（画布上的「高」仅用于预览排布示意）。
              </p>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">最小行高</span>
                <LayoutNumberInput
                  min={0} step="0.5" aria-label="最小行高"
                  placeholder="自适应"
                  value={el.tableMinRowHeightMm}
                  onValueChange={value => onChange(el.id, { tableMinRowHeightMm: value }, 'tableMinRowHeightMm')}
                  onClear={() => onChange(el.id, { tableMinRowHeightMm: undefined }, 'tableMinRowHeightMm')}
                  onComplete={onEndInputEdit}
                  className="h-7 flex-1 text-xs"
                />
                <span className="shrink-0 text-xs text-muted-foreground">mm</span>
              </div>
              <div className="flex items-center justify-between">
                <label htmlFor={`${controlId}-wrap`} className="cursor-pointer text-xs font-medium text-muted-foreground">自动换行</label>
                <Switch id={`${controlId}-wrap`} aria-label="表格自动换行" checked={el.tableRowWrap !== false}
                  onCheckedChange={() => onToggle(el.id, 'tableRowWrap')} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
