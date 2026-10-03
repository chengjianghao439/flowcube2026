import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { usePdaRole, type PdaPerm } from '@/hooks/usePdaRole'

/** 已确认结果的只读交接；调用页负责原任务和最新读取，目标路由仍自行校验。 */
export default function PdaNextStep({ enabled, required, to, label, hint }: {
  enabled: boolean
  required: PdaPerm[]
  to: string
  label: string
  hint?: string
}) {
  const navigate = useNavigate()
  const { permissionsMissing, canAll } = usePdaRole()
  if (!enabled || permissionsMissing || !canAll(required)) return null
  return <div className="w-full space-y-2">
    {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    <Button size="lg" className="w-full" onClick={() => navigate(to)}>{label}</Button>
  </div>
}
