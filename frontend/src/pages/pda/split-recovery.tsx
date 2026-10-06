import { useNavigate } from 'react-router-dom'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaFlash from '@/components/pda/PdaFlash'
import PdaSplitRecoveryPanel from '@/components/pda/PdaSplitRecoveryPanel'
import PdaNextStep from '@/components/pda/PdaNextStep'
import { usePdaSplitRecovery } from '@/hooks/usePdaSplitRecovery'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { PERMISSIONS } from '@/lib/permission-codes'
export default function PdaSplitRecoveryPage() {
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const recovery = usePdaSplitRecovery({ onConfirmed: result => ok(`原拆分已确认：${result.sourceBarcode} → ${result.newBarcode}；原码余 ${result.sourceRemainingAfter}`) })
  return <div className="min-h-screen space-y-4">
    <PdaHeader title="拆分结果核对" subtitle="只核对本人原拆分，不新建作业" onBack={() => navigate('/pda')} />
    <PdaFlash flash={flash} />
    <PdaSplitRecoveryPanel recovery={recovery} onError={err} />
    {!recovery.records.length && !recovery.error && <p className="px-4 text-sm text-muted-foreground">当前没有本人拆分结果待确认。</p>}
    <div className="px-4"><PdaNextStep enabled={!recovery.blocked} required={[PERMISSIONS.INVENTORY_CONTAINER_SPLIT]} to="/pda/plastic-box" label="返回塑料盒作业" /></div>
  </div>
}
