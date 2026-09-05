import { Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import PdaConnectionGate from '@/components/pda/PdaConnectionGate'
import { pdaRoutes } from './pdaRoutes'

/** PDA 构建不引入 ERP 壳层、工作区或桌面桥；业务路由与浏览器版保持一致。 */
export default function PdaRouter() {
  return (
    <HashRouter>
      <PdaConnectionGate>
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">加载中…</div>}>
          <Routes>
            {pdaRoutes()}
            <Route path="*" element={<Navigate to="/pda" replace />} />
          </Routes>
        </Suspense>
      </PdaConnectionGate>
    </HashRouter>
  )
}
