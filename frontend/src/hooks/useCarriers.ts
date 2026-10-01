import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from './useKits'
import { commercialReadConfig } from '@/api/sale-commercial'
import { useQuery } from '@tanstack/react-query'
import { getCarriersActiveApi } from '@/api/carriers'

export const useCarriersActive = (readOwner?: KitReadOwner) =>
  useQuery({
    queryKey: readOwner
      ? ['carriers-active', readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration]
      : ['carriers-active'],
    queryFn: async () => {
      if (!readOwner) return getCarriersActiveApi().then((r) => r || [])
      assertKitReadOwner(readOwner)
      const data = await getCarriersActiveApi(commercialReadConfig(readOwner))
      assertKitReadOwner(readOwner)
      return data || []
    }
  })
