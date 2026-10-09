import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'

/** 列表的一次性编辑意图；沿本标签原实例，资格由原订单页面核验。 */
export function useSaleEditEntry(tabPath: string, ready: boolean, onEdit: () => void) {
  const active = useActiveWorkspaceTab()
  const navigate = useNavigate()
  const consumed = useRef(false)
  const edits = new URLSearchParams(tabPath.split('?')[1] ?? '').getAll('edit')
  const requested = edits.length === 1 && edits[0] === '1'
  useEffect(() => {
    if (!requested) { consumed.current = false; return }
    if (!active || !ready || consumed.current) return
    consumed.current = true
    onEdit()
    const [path, search = ''] = tabPath.split('?')
    const params = new URLSearchParams(search)
    params.delete('edit')
    const remaining = params.toString()
    navigate(path + (remaining ? `?${remaining}` : ''), { replace: true })
  }, [active, navigate, onEdit, ready, requested, tabPath])
}
