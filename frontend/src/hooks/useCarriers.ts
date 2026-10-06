import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from './useKits'
import { commercialReadConfig } from '@/api/sale-commercial'
import { useQuery } from '@tanstack/react-query'
import { getCarriersActiveApi } from '@/api/carriers'

export const useCarriersActive = (readOwner?: KitReadOwner, readCurrent?: () => boolean) =>
  useQuery({
    queryKey: readOwner
      ? ['carriers-active', readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration]
      : ['carriers-active'],
    enabled: !readCurrent || readCurrent(),
    queryFn: async () => {
      if (readCurrent && !readCurrent()) throw Error("当前读取已暂停")
      if (!readOwner) return getCarriersActiveApi().then((r) => r || [])
      assertKitReadOwner(readOwner)
      const data = await getCarriersActiveApi(commercialReadConfig(readOwner))
      assertKitReadOwner(readOwner)
      if (readCurrent && !readCurrent()) throw Error("当前读取已暂停")
      return data || []
    }
  })
