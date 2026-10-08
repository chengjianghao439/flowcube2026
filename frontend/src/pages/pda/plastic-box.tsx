import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePdaSplitRecovery } from '@/hooks/usePdaSplitRecovery'
import PdaHeader from '@/components/pda/PdaHeader'
import { Button } from '@/components/ui/button'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import PdaFillPage from './fill'
import PdaSplitPage from './split'
type Action = 'fill' | 'repack' | 'split'
interface WorkState { hasInput: boolean; pending: boolean }
const choices: { action: Action; label: string; hint: string }[] = [
  { action: 'fill', label: '整件放入盒', hint: '扫整件I码与目标B盒，按原整件实存全部放入' },
  { action: 'repack', label: '盒还原整件', hint: '扫B盒，逐箱填写数量，生成整件I码' },
  { action: 'split', label: '整件拆出散件盒', hint: '扫整件I码，填写部分数量，生成散件B盒' },
]
export default function PdaPlasticBoxPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Action | null>(null)
  const [states, setStates] = useState<Partial<Record<Action, WorkState>>>({})
  const splitRecovery = usePdaSplitRecovery({ active: false })
  const callbacks = useMemo(() => {
    const update = (action: Action) => (next: WorkState) => setStates(previous => previous[action]?.hasInput === next.hasInput && previous[action]?.pending === next.pending ? previous : { ...previous, [action]: next })
    return { fill: update('fill'), repack: update('repack'), split: update('split') }
  }, [])
  const pendingAction = choices.find(c => states[c.action]?.pending)?.action ?? (splitRecovery.blocked ? 'split' : undefined)
  const hasDraft = splitRecovery.blocked || choices.some(c => states[c.action]?.hasInput || states[c.action]?.pending)
  const hasUnsubmittedInput = choices.some(c => states[c.action]?.hasInput && !states[c.action]?.pending)
  return <div>
    <KeepAliveSection active={selected === null}>
      <PdaHeader title="塑料盒作业" subtitle="选择本次动作，分别按原条码和数量规则执行" onBack={() => { if (!hasUnsubmittedInput) navigate('/pda') }} />
      <div className="mx-auto max-w-md space-y-4 p-4">
        {hasDraft && <p className="rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning-ink">原动作的输入和待确认记录已保留，请点原动作继续；有结果待确认时先核对原提交，再切换其他塑料盒动作。{hasUnsubmittedInput ? '返回工作台前请先完成或取消尚未提交的输入。' : '原请求已保存，可返回工作台进行其他仓库作业，再从原动作继续核对。'}</p>}
        {choices.map(c => <Button size="lg" key={c.action} variant="outline" className="px-3 h-auto w-full flex-col items-start whitespace-normal py-4 text-left" disabled={!!pendingAction && pendingAction !== c.action} onClick={() => setSelected(c.action)}>
          <span className="font-semibold">{c.label}</span><span className="text-xs text-muted-foreground">{c.hint}</span>
          {(states[c.action]?.hasInput || states[c.action]?.pending || c.action === pendingAction) && <span className="text-xs text-warning-ink">原输入已保留 · 点此继续</span>}
        </Button>)}
      </div>
    </KeepAliveSection>
    <KeepAliveSection active={selected === 'fill'}><PdaFillPage active={selected === 'fill'} onBack={() => setSelected(null)} onWorkStateChange={callbacks.fill} /></KeepAliveSection>
    <KeepAliveSection active={selected === 'repack'}><PdaSplitPage fixedMode="repack" active={selected === 'repack'} onBack={() => setSelected(null)} onWorkStateChange={callbacks.repack} /></KeepAliveSection>
    <KeepAliveSection active={selected === 'split'}><PdaSplitPage fixedMode="split" active={selected === 'split'} onBack={() => setSelected(null)} onWorkStateChange={callbacks.split} /></KeepAliveSection>
  </div>
}
