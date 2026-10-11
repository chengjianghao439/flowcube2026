import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'

/** 一次性编辑意图；采购页面独立核验采购状态、权限和读取结果。 */
export function usePurchaseEditEntry(tabPath: string, ready: boolean, onEdit: () => void) {
  const active = useActiveWorkspaceTab(), navigate = useNavigate(), consumed = useRef(false)
  const edits = new URLSearchParams(tabPath.split('?')[1] ?? '').getAll('edit')
  const requested = edits.length === 1 && edits[0] === '1'
  useEffect(() => {
    if (!requested) { consumed.current = false; return }
    if (!active || !ready || consumed.current) return
    consumed.current = true
    onEdit()
    const [path, search = ''] = tabPath.split('?'), params = new URLSearchParams(search)
    params.delete('edit')
    navigate(path + (params.size ? `?${params}` : ''), { replace: true })
  }, [active, navigate, onEdit, ready, requested, tabPath])
}
