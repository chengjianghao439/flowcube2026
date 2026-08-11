import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
    (set) => ({
      companyId: 1,
      companyName: null,
      setCompany: (id, name) => set({ companyId: id, companyName: name ?? null }),
    }),
    { name: 'flowcube-accounting-company' },
  ),
)
