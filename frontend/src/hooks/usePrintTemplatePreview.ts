import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPrintTemplatePreviewApi } from '@/api/print-templates'
import { useAuthStore } from '@/store/authStore'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { adaptTemplatePreview } from '@/lib/printTemplatePreview'
import type { TemplateType } from '@/types/print-template'

export function usePrintTemplatePreview(type: TemplateType, enabled: boolean) {
  const generation = useAuthStore(s => s.sessionGeneration)
  const authenticated = useAuthStore(s => s.isAuthenticated)
  const active = useSectionActive()
  const queryClient = useQueryClient()
  const queryKey = ['print-template-preview', generation, type]
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try { return await getPrintTemplatePreviewApi(type, signal) }
      catch (error) {
        if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
          // 撤权后丢弃缓存，后续网络失败也不能重新显示这份旧数据。
          queryClient.setQueryData(queryKey, null)
        }
        throw error
      }
    },
    enabled: enabled && authenticated && active,
    staleTime: 30_000, gcTime: 0, retry: false, refetchOnWindowFocus: false,
  })
  const accessDenied = [401, 403].includes((query.error as { status?: number } | null)?.status ?? 0)
  const source = !accessDenied && authenticated && query.data?.type === type ? query.data : null
  const mapped = useMemo(() => source ? adaptTemplatePreview(source) : null, [source])
  return { ...query, source, mapped }
}
