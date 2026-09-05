import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { queryClient } from '@/lib/queryClient'
import { isAccountingQuery } from '@/lib/companyScope'

/**
 * 会计账套切换（文档10 多账套）：当前账套 id 持久化到 localStorage。
 * API 层（api/client.ts 拦截器）读它注入 X-Company-Id 头；后端 companyScope 中间件解析。
 */
interface CompanyStore {
  companyId: number
  companyName: string | null
  setCompany: (id: number, name?: string | null) => void
}

export const useCompanyStore = create<CompanyStore>()(
  persist(
    (set, get) => ({
      companyId: 1,
      companyName: null,
      setCompany: (id, name) => {
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('账套编号无效')
        if (id !== get().companyId) {
          if (queryClient.isMutating()) throw new Error('有操作正在保存，请完成后再切换账套')
          // 先取消旧查询及重试，再切换状态；晚到结果不能重新填入旧缓存。
          void queryClient.cancelQueries({ predicate: query => isAccountingQuery(query.queryKey) })
          queryClient.removeQueries({ predicate: query => isAccountingQuery(query.queryKey) })
        }
        set({ companyId: id, companyName: name ?? null })
      },
    }),
    { name: 'flowcube-accounting-company' },
  ),
)
