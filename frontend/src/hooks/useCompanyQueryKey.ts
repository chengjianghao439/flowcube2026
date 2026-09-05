import type { QueryKey } from '@tanstack/react-query'
import { useCompanyStore } from '@/store/companyStore'

/** 保留首项业务前缀以兼容现有 invalidateQueries，第二项固定为账套。 */
export function useCompanyQueryKey(key: QueryKey): QueryKey {
  const companyId = useCompanyStore(state => state.companyId)
  return [key[0], companyId, ...key.slice(1)]
}
