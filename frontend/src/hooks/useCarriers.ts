import { useQuery } from '@tanstack/react-query'
import { getCarriersActiveApi } from '@/api/carriers'

export const useCarriersActive = () => useQuery({ queryKey: ['carriers-active'], queryFn: () => getCarriersActiveApi().then(r => r || []) })
