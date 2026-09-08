import { useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'

export function usePartyLedger(type: 1 | 2) {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const { can } = usePermission()
  return {
    canView: can(PERMISSIONS.PAYMENT_VIEW),
    open: (party: { id: number; name: string }) => {
      const path = `/payments/ledger/${type === 2 ? 'customer' : 'supplier'}/${party.id}`
      addTab({ key: path, path, title: `往来明细 · ${party.name}` })
      navigate(path)
    },
  }
}
