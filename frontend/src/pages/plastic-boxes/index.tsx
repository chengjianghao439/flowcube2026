import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ProductFinder, FinderTrigger } from '@/components/finder'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { TableColumn } from '@/types'
import type { FinderResult } from '@/types/finder'
import BaseCrudPage from '@/components/shared/BaseCrudPage'
import {
  getPlasticBoxesApi,
  createPlasticBoxApi,
  deletePlasticBoxApi,
  usePlasticBoxMovements,
  type PlasticBox,
} from '@/hooks/usePlasticBoxes'

export default function PlasticBoxesPage() {
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [detailTarget, setDetailTarget] = useState<PlasticBox | null>(null)
  // 新建表单状态（塑料盒不支持编辑，弹窗固定是创建态）
  const [product, setProduct] = useState<FinderResult | null>(null)
  const [warehouse, setWarehouse] = useState<FinderResult | null>(null)
  const [productFinderOpen, setProductFinderOpen] = useState(false)

  const columns: TableColumn<PlasticBox>[] = [
    { key: 'barcode', title: '条码', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'productName', title: '绑定产品', width: 180, render: (_, row) => row.productName ? `${row.productName} (${row.productCode})` : '—' },
    { key: 'warehouseName', title: '仓库', width: 140 },
    { key: 'remainingQty', title: '当前数量', width: 80, render: v => <span className="font-semibold">{String(v)}</span> },
    {
      key: 'status', title: '状态', width: 80,
      render: v => Number(v) === 1
        ? <SoftStatusLabel label="在库" tone="active" />
        : <SoftStatusLabel label="空置" tone="draft" />,
    },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => formatDisplayDateTime(v) },
  ]

  return (
    <>
      <BaseCrudPage<PlasticBox>
        title="塑料盒管理"
        description="管理永久暂存容器（B 条码），每个塑料盒绑定一个产品，用于零散出货"
        columns={columns}
        queryKey={['plastic-boxes', keyword]}
        listQuery={() => getPlasticBoxesApi({ pageSize: 99999, keyword })}
        deleteApi={(id) => deletePlasticBoxApi(id, { skipGlobalError: true })}
        deleteMessage="确认删除该塑料盒？"
        createLabel="+ 新建塑料盒"
        saveSuccessMessage={() => '塑料盒已创建'}
        formWidthClass="max-w-md"
        renderToolbar={
          <FilterCard>
            <Input
              placeholder="搜索条码 / 产品..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-56"
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search) } }}
            />
            <Button size="sm" variant="outline" onClick={() => { setKeyword(search) }}>搜索</Button>
            {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>}
          </FilterCard>
        }
        renderActions={(row, helpers) => (
          <TableActionsMenu
            primaryLabel="详情"
            primaryVariant="outline"
            onPrimaryClick={() => setDetailTarget(row)}
            items={[
              ...(row.remainingQty === 0 ? [{
                label: '删除',
                destructive: true,
                onClick: () => helpers.openDelete(row),
              }] : []),
            ]}
          />
        )}
        renderForm={() => (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>绑定产品 *</Label>
              <FinderTrigger value={product?.name ?? ''} placeholder="点击选择产品..." onClick={() => setProductFinderOpen(true)} />
            </div>
            <div className="space-y-1.5">
              <Label>所属仓库 *</Label>
              <WarehouseSelect
                value={warehouse?.id ?? null}
                onChange={(id, name) => setWarehouse(id ? { id, name } : null)}
                placeholder="选择仓库"
              />
            </div>
            <ProductFinder open={productFinderOpen} onClose={() => setProductFinderOpen(false)} onConfirm={(p) => { setProduct(p); setProductFinderOpen(false) }} />
          </div>
        )}
        submitForm={() => {
          if (!product) { toast.warning('请选择产品'); throw { response: { data: { message: '请选择产品' } } } }
          if (!warehouse) { toast.warning('请选择仓库'); throw { response: { data: { message: '请选择仓库' } } } }
          return createPlasticBoxApi({
            productId: product.id,
            productName: product.name,
            productCode: product.code,
            warehouseId: warehouse.id,
            warehouseName: warehouse.name,
            unit: (product as unknown as Record<string, unknown>).unit || '',
          }, { skipGlobalError: true })
        }}
        formTitle={() => '新建塑料盒'}
      />
      <DetailDialog box={detailTarget} onClose={() => setDetailTarget(null)} />
    </>
  )
}

function DetailDialog({ box, onClose }: { box: PlasticBox | null; onClose: () => void }) {
  const { data, isLoading } = usePlasticBoxMovements(box?.id ?? null)
  const TYPE_NAMES: Record<number, string> = { 1: '入库', 2: '出库', 3: '调整' }
  const TYPE_TONE: Record<number, 'success' | 'danger' | 'info'> = { 1: 'success', 2: 'danger', 3: 'info' }

  return (
    <Dialog open={!!box} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>塑料盒流水 · {box?.barcode}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          {box?.productName ? `绑定产品：${box.productName} (${box.productCode})` : '未绑定产品'}
          {box?.warehouseName ? ` · ${box.warehouseName}` : ''}
          {` · 当前数量 ${box?.remainingQty ?? 0}`}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : !data?.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无流水</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">类型</th>
                  <th className="py-2 pr-3 font-medium text-right">数量</th>
                  <th className="py-2 pr-3 font-medium">备注</th>
                  <th className="py-2 font-medium">操作人</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDisplayDateTime(m.createdAt)}</td>
                    <td className="py-2 pr-3">
                      <SoftStatusLabel label={m.moveTypeName ?? TYPE_NAMES[m.type] ?? `类型${m.type}`} tone={TYPE_TONE[m.type] ?? 'info'} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.qty}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{m.remark ?? '—'}</td>
                    <td className="py-2">{m.operatorName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
