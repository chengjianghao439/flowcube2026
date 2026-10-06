import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useActiveWorkspaceTab } from './useActiveWorkspaceTab'
import { getHandlingSourceApi } from '@/api/disposal-handling'
import { getProductApi } from '@/api/products'
import { getWarehousesActiveApi } from '@/api/warehouses'
import { captureHandlingOwner, handlingOwnerCurrent, handlingConfig, handlingRevision, mayHandle, subscribeHandling } from '@/lib/disposalHandlingRecovery'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import type { HandlingSource } from '@/types/disposal-handling'
import type { Product } from '@/types/products'
export function useDisposalHandlingSource(id: number, type: 1 | 2 | 3) {
  useSyncExternalStore(subscribeHandling, handlingRevision)
  const [owner] = useState(captureHandlingOwner), active = useActiveWorkspaceTab()
  const latest = useRef({ active, serial: 0, activityGeneration: 0 })
  if (latest.current.active !== active) latest.current.activityGeneration++
  latest.current.active = active
  const activityGeneration = latest.current.activityGeneration
  const [data, setData] = useState<{ source: HandlingSource; product: Product } | null>(null), [error, setError] = useState('')
  const current = useCallback(() => latest.current.active && latest.current.activityGeneration === activityGeneration && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW), [owner, activityGeneration])
  useEffect(() => {
    if (!active || data || error || !current()) return
    const state = latest.current, serial = ++state.serial, abort = new AbortController()
    const valid = () => current() && serial === latest.current.serial
    const assert = () => { if (!valid()) throw Error('原读取已暂停，草稿保留') }
    void (async () => {
      try {
        const config = { ...handlingConfig(owner), signal: abort.signal }
        assert()
        const source = await getHandlingSourceApi(id, config)
        assert()
        if (source.id !== id || source.handlingType !== type || !source.intentUuid || !source.unit || !Number.isSafeInteger(source.revision) || source.revision <= 0) throw Error('处理来源身份或动作不符，请从来源列表重新打开')
        if (!mayHandle(P.PRODUCT_VIEW, P.WAREHOUSE_VIEW)) throw Error('需要商品与仓库查看权限才能核对当前主档；原来源保留')
        const product = await getProductApi(source.productId, config)
        assert()
        const warehouses = await getWarehousesActiveApi(config)
        assert()
        if (product.id !== source.productId || !product.isActive || product.unit !== source.unit || !warehouses.some(w => w.id === source.warehouseId)) throw Error('当前商品或仓库已停用、缺失或单位变化，请人工核对，不能创建目标')
        setData({ source, product })
      } catch (e) { if (valid()) setError(e instanceof Error ? e.message : '来源核对失败') }
    })()
    return () => { state.serial++; abort.abort() }
  }, [active, data, error, id, type, owner, current])
  return { owner, active, activityGeneration, current: current(), isCurrent: current, data: current() ? data : null, error: handlingOwnerCurrent(owner) ? error : '账号、权限或服务器已变化，原草稿保留', reload: () => { if (current()) { setData(null); setError('') } } }
}
