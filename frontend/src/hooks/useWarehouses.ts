import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from './useKits'
import { commercialReadConfig } from '@/api/sale-commercial'
import { useQuery } from '@tanstack/react-query'
import { getWarehousesActiveApi } from '@/api/warehouses'

const QUERY_KEY = 'warehouses'

export function useWarehousesActive(readOwner?: KitReadOwner, readCurrent?: () => boolean) {
  return useQuery({
    enabled: !readCurrent || readCurrent(),
    queryKey: readOwner ? [QUERY_KEY, 'active', readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration] : [QUERY_KEY, 'active'],
    queryFn: async () => {
      if (readCurrent && !readCurrent()) throw Error("当前读取已暂停")
      if (!readOwner) return getWarehousesActiveApi()
      assertKitReadOwner(readOwner)
      const data = await getWarehousesActiveApi(commercialReadConfig(readOwner))
      assertKitReadOwner(readOwner)
      if (readCurrent && !readCurrent()) throw Error("当前读取已暂停")
      return data
    },
    staleTime: 1000 * 60 * 10,
  })
}
