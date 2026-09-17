import { useState, useEffect, useRef, type SetStateAction } from 'react'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useCarriersActive } from '@/hooks/useCarriers'
import type { useSaleDetail } from '@/hooks/useSale'
import { getCustomerPriceApi } from '@/api/price-lists'
import { getProductApi } from '@/api/products'
import { dirtyItems } from '@/lib/editMode'
import type { ProductFinderResult, ProductUnit } from '@/types/products'
import type { FinderResult } from '@/types/finder'
import type { DraftItem } from './validate'

/** CreateView / EditView 共用的表单状态与操作逻辑；传 order 则从已有订单初始化（编辑），不传则从空白开始（新建）。 */
export function useSaleOrderForm(tabPath: string, order?: NonNullable<ReturnType<typeof useSaleDetail>['data']>) {
  const [customerId,      commitCustomerId]      = useState(order ? String(order.customerId) : '')
  const [customerName,    setCustomerName]    = useState(order?.customerName ?? '')
  const [warehouseId,     setWarehouseId]     = useState(order ? String(order.warehouseId) : '')
  const [warehouseName,   setWarehouseName]   = useState(order?.warehouseName ?? '')
  const [remark,          setRemark]          = useState(order?.remark ?? '')
  const [carrierId,       setCarrierId]       = useState(order?.carrierId ? String(order.carrierId) : '')
  const [shippingProduct, setShippingProduct] = useState(order?.shippingProduct ?? '')
  const [freightType,     setFreightType]     = useState(order?.freightType ? String(order.freightType) : '')
  const [receiverName,    setReceiverName]    = useState(order?.receiverName ?? '')
  const [receiverPhone,   setReceiverPhone]   = useState(order?.receiverPhone ?? '')
  const [receiverAddress, setReceiverAddress] = useState(order?.receiverAddress ?? '')
  const [discountAmount,  setDiscountAmount]  = useState(order?.discountAmount ? String(order.discountAmount) : '')
  const counterRef    = useRef((order?.items ?? []).length)
  const quantityRefs  = useRef<Map<number, HTMLInputElement>>(new Map())
  const mkEmpty = (): DraftItem => ({ _key: ++counterRef.current, productId: 0, productCode: '', productName: '', articleNumber: null, spec: null, color: null, unit: '', entryUnit: '', units: [], quantity: 1, unitPrice: 0, remark: '', priceSource: 'default', resolvedPrice: null, resolvedPriceLevel: null, costPrice: null })

  const { data: carrierOptions = [] } = useCarriersActive()

  const [items, commitItems] = useState<DraftItem[]>(() =>
    (order?.items ?? []).map((item, i) => ({
      _key: i, productId: item.productId, productCode: item.productCode,
      productName: item.productName, articleNumber: item.articleNumber ?? null, spec: item.spec ?? null, color: item.color ?? null,
      unit: item.unit, entryUnit: item.entryUnit ?? item.unit, units: [],
      // 表单的数量/单价是「录入单位」口径：数量=entryQty(箱)，单价=每录入单位价（由 amount/entryQty 精确还原）
      quantity: item.entryQty ?? item.quantity,
      warehouseId: item.warehouseId ?? null, warehouseName: item.warehouseName ?? null,
      unitPrice: item.entryQty && item.entryQty > 0 ? Math.round((item.amount / item.entryQty) * 100) / 100 : item.unitPrice,
      remark: item.remark ?? '', priceSource: 'default' as const, costPrice: item.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null,
    })),
  )
  // 同步保存事件后的身份，防止同一次批处理中的后续事件读到旧 render 快照。
  const itemsRef = useRef(items)
  const customerIdRef = useRef(customerId)
  const mountedRef = useRef(true)
  const priceRequests = useRef(new Map<number, object>())
  const productRequests = useRef(new Map<number, object>())
  const focusTimers = useRef(new Set<ReturnType<typeof setTimeout>>())
  function setItems(change: SetStateAction<DraftItem[]>) {
    const next = typeof change === 'function' ? change(itemsRef.current) : change
    itemsRef.current = next
    commitItems(next)
  }
  function setCustomerId(change: SetStateAction<string>) {
    const next = typeof change === 'function' ? change(customerIdRef.current) : change
    customerIdRef.current = next
    commitCustomerId(next)
  }
  useEffect(() => {
    mountedRef.current = true
    const timers = focusTimers.current
    const prices = priceRequests.current
    const products = productRequests.current
    return () => {
      mountedRef.current = false
      prices.clear()
      products.clear()
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])
  // 编辑/改单态：为每个明细行商品拉多计量单位，供单位下拉回显（新建态在 handleFinderConfirm 里拉）
  useEffect(() => {
    const src = order?.items ?? []
    const productIds = [...new Set(src.filter(i => i.productId > 0).map(i => i.productId))]
    if (!productIds.length) return
    let cancelled = false
    const initialRows = new Map(itemsRef.current.map(i => [i._key, { productId: i.productId, selection: productRequests.current.get(i._key) }]))
    Promise.all(productIds.map(pid =>
      getProductApi(pid).then(p => [pid, p?.units ?? []] as [number, ProductUnit[]]).catch(() => [pid, [] as ProductUnit[]] as [number, ProductUnit[]]),
    )).then(pairs => {
      if (cancelled) return
      const map = new Map<number, ProductUnit[]>(pairs)
      setItems(prev => prev.map(i => {
        const initial = initialRows.get(i._key)
        return initial?.productId === i.productId
          && initial.selection === productRequests.current.get(i._key)
          && map.has(i.productId)
          ? { ...i, units: map.get(i.productId)! }
          : i
      }))
    })
    return () => { cancelled = true }
  }, [order])
  const [priceLoading, setPriceLoading] = useState<Record<number, boolean>>({})
  const [priceErrors, setPriceErrors] = useState<Record<number, string>>({})
  const [finderOpen,    setFinderOpen]    = useState(false)
  const [finderItemKey, setFinderItemKey] = useState<number | null>(null)
  const [customerFinderOpen,  setCustomerFinderOpen]  = useState(false)
  const [customerError, setCustomerError] = useState(false)
  const [warehouseError, setWarehouseError] = useState(false)
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<number>>(new Set())

  // 编辑态初始值本就非空，"是否非空"不能代表"是否改过"，改成和进入编辑时的快照比较；
  // 新建态没有快照可比，沿用"任意字段非空即算改过"。
  // 明细行只比对用户可改字段：units（多计量单位）由接口异步回填，见 dirtyItems。
  const dirtyComparable = () => JSON.stringify({
    customerId, warehouseId, remark, carrierId, shippingProduct, freightType,
    receiverName, receiverPhone, receiverAddress, discountAmount, items: dirtyItems(items),
  })
  const editSnapshotRef = useRef(order ? dirtyComparable() : null)
  const isDirty = order
    ? dirtyComparable() !== editSnapshotRef.current
    : !!(customerId || warehouseId || remark || carrierId || receiverName || items.length)
  useDirtyGuard(tabPath, isDirty)

  // 添加商品：新增一行并立即弹出选品对话框，与采购单/调拨单/退货单一致
  const addItem = () => {
    const item = mkEmpty()
    setItems(prev => [...prev, item])
    setFinderItemKey(item._key)
    setFinderOpen(true)
  }

  function clearPriceError(k: number) {
    setPriceErrors(prev => {
      const next = { ...prev }
      delete next[k]
      return next
    })
  }

  async function lookupPrice(k: number, productId: number, cid: string) {
    const request = {}
    priceRequests.current.set(k, request)
    const isCurrent = () => mountedRef.current
      && priceRequests.current.get(k) === request
      && customerIdRef.current === cid
      && itemsRef.current.some(i => i._key === k && i.productId === productId)
    setPriceLoading(prev => ({ ...prev, [k]: true }))
    clearPriceError(k)
    // 旧的客户定价凭据在新请求开始时失效；保存须等待请求结束或手动确认。
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, priceSource: 'default', resolvedPrice: null, resolvedPriceLevel: null }
      : i))
    try {
      const r = await getCustomerPriceApi(+cid, productId)
      if (!isCurrent()) return
      if (r && Number.isFinite(r.salePrice) && r.salePrice > 0) {
        setItems(prev => prev.map(i => i._key === k
          ? { ...i, unitPrice: r.salePrice, priceSource: 'list', resolvedPrice: r.salePrice, resolvedPriceLevel: r.priceLevel }
          : i))
      } else {
        setPriceErrors(prev => ({ ...prev, [k]: '当前客户未设置有效价格，请手动确认单价' }))
      }
    } catch {
      if (isCurrent()) setPriceErrors(prev => ({ ...prev, [k]: '价格查询失败，请手动确认单价' }))
    } finally {
      // 只有当前请求可收尾，旧请求不能提前清掉新请求的 loading。
      if (isCurrent()) {
        priceRequests.current.delete(k)
        setPriceLoading(prev => ({ ...prev, [k]: false }))
      }
    }
  }

  function handleCustomerConfirm(result: FinderResult) {
    const cid = String(result.id)
    setCustomerId(cid)
    setCustomerName(result.name)
    setCustomerError(false)
    // 明确选择客户仍按现行规则重新定价，包括之前手动修改过的单价。
    for (const item of itemsRef.current) {
      if (item.productId) void lookupPrice(item._key, item.productId, cid)
    }
  }

  function removeItem(k: number) {
    priceRequests.current.delete(k)
    productRequests.current.delete(k)
    setItems(prev => prev.filter(i => i._key !== k))
    setPriceLoading(prev => {
      const next = { ...prev }
      delete next[k]
      return next
    })
    clearPriceError(k)
  }

  function updateItem(k: number, field: string, val: string | number) {
    if (field === 'unitPrice') {
      priceRequests.current.delete(k)
      clearPriceError(k)
      setPriceLoading(prev => ({ ...prev, [k]: false }))
    }
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, [field]: val, priceSource: field === 'unitPrice' ? 'manual' : i.priceSource }
      : i))
  }

  async function handleFinderConfirm(product: ProductFinderResult) {
    if (finderItemKey === null || !mountedRef.current) return
    const k = finderItemKey
    if (!itemsRef.current.some(i => i._key === k)) return
    priceRequests.current.delete(k)
    clearPriceError(k)
    setPriceLoading(prev => ({ ...prev, [k]: false }))
    const selection = {}
    productRequests.current.set(k, selection)
    const isCurrentProduct = () => mountedRef.current
      && productRequests.current.get(k) === selection
      && itemsRef.current.some(i => i._key === k && i.productId === product.id)
    setItems(prev => prev.map(i => i._key === k
      ? { ...i, productId: product.id, productCode: product.code, productName: product.name, articleNumber: product.articleNumber ?? null, spec: product.spec ?? null, color: product.color ?? null, unit: product.unit, entryUnit: product.unit, units: [], quantity: 0, unitPrice: product.salePrice ?? 0, priceSource: 'default', costPrice: product.costPrice ?? null, resolvedPrice: null, resolvedPriceLevel: null }
      : i
    ))
    const timer = setTimeout(() => {
      focusTimers.current.delete(timer)
      if (!isCurrentProduct()) return
      const inp = quantityRefs.current.get(k)
      if (inp) { inp.focus(); inp.select() }
    }, 0)
    focusTimers.current.add(timer)
    // 单位查询与查价并行，且使用独立版本，手动改价不丢弃合法的单位响应。
    void getProductApi(product.id)
      .then(full => {
        if (!isCurrentProduct()) return
        const units = full?.units ?? []
        setItems(prev => prev.map(i => i._key === k ? { ...i, units } : i))
      })
      .catch(() => { /* 拉取失败：按基本单位录入 */ })
    const cid = customerIdRef.current
    if (cid) await lookupPrice(k, product.id, cid)
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const discount = Math.max(0, Number(discountAmount) || 0)
  const discountedTotal = Math.max(0, total - discount)

  return {
    customerId, setCustomerId, customerName, setCustomerName,
    warehouseId, setWarehouseId, warehouseName, setWarehouseName,
    remark, setRemark, carrierId, setCarrierId, shippingProduct, setShippingProduct, freightType, setFreightType,
    receiverName, setReceiverName, receiverPhone, setReceiverPhone, receiverAddress, setReceiverAddress,
    discountAmount, setDiscountAmount, total, discount, discountedTotal,
    quantityRefs, carrierOptions,
    items, priceLoading, priceErrors,
    finderOpen, setFinderOpen, finderItemKey, setFinderItemKey,
    customerFinderOpen, setCustomerFinderOpen,
    customerError, setCustomerError, warehouseError, setWarehouseError,
    invalidItemKeys, setInvalidItemKeys,
    isDirty, addItem, removeItem, updateItem,
    handleCustomerConfirm, handleFinderConfirm,
  }
}
