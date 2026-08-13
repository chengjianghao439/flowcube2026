/**
 * PDA 设备绑定
 * 路由：/pda/bind
 *
 * 管理员在 ERP「系统 → PDA 设备」里登记这台机器，屏幕上会出现一个绑定二维码。
 * 在这个页面扫那个码（或手动输入设备码+密钥）即可完成绑定，一台机器只需做一次。
 *
 * 绑定后这台机器的每次作业都会带上设备身份：绑了仓库的设备扫别仓的单据会被直接拒绝，
 * 机器丢了也能在 ERP 里一键停用、立即吊销它手上的票据。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import {
  getDeviceCredential,
  getDeviceSession,
  saveDeviceCredential,
  clearDeviceBinding,
  parseBindingPayload,
} from '@/lib/pdaDeviceBinding'
import { ensureDeviceSession } from '@/api/pda-session'

export default function PdaBindPage() {
  const nav = useNavigate()
  const { flash, ok, err, warn } = usePdaFeedback()
  const [credential, setCredential] = useState(() => getDeviceCredential())
  const [session, setSession] = useState(() => getDeviceSession())
  const [manual, setManual] = useState({ code: '', secret: '' })
  const [manualOpen, setManualOpen] = useState(false)
  const [binding, setBinding] = useState(false)

  async function bind(deviceCode: string, deviceSecret: string) {
    setBinding(true)
    saveDeviceCredential(deviceCode, deviceSecret)
    try {
      const created = await ensureDeviceSession()
      if (!created) {
        // 凭据存下来了但换不到票据：多半是设备被停用或密钥已被重置，
        // 留着一份错的凭据只会让后续每个请求都失败，不如直接清掉重来
        clearDeviceBinding()
        setCredential(null)
        setSession(null)
        err('绑定失败：设备码或密钥无效，也可能该设备已被停用，请让管理员确认后重新生成二维码')
        return
      }
      setCredential(getDeviceCredential())
      setSession(created)
      ok('设备绑定成功')
    } finally {
      setBinding(false)
    }
  }

  function handleScan(raw: string) {
    const parsed = parseBindingPayload(raw)
    if (!parsed) {
      err('这不是设备绑定二维码，请在 ERP「系统 → PDA 设备」里登记设备后扫那个码')
      return
    }
    void bind(parsed.deviceCode, parsed.deviceSecret)
  }

  function handleUnbind() {
    clearDeviceBinding()
    setCredential(null)
    setSession(null)
    warn('已解除绑定，这台机器需要重新扫码才能继续作业')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="设备绑定" backLabel="← 工作台" onBack={() => nav('/pda')} />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-3">
        {credential ? (
          <PdaCard active className="space-y-2">
            <div className="text-base font-semibold text-emerald-600">本机已绑定</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">设备码</span>
                <span className="font-mono">{credential.deviceCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">所属仓库</span>
                <span>{session?.warehouseId ? `#${session.warehouseId}` : '未绑定仓库（可跨仓作业）'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">票据状态</span>
                <SoftStatusLabel label={session ? '有效' : '需重新登录以获取'} tone={session ? 'success' : 'danger'} />
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={handleUnbind}>解除绑定</Button>
          </PdaCard>
        ) : (
          <PdaCard className="space-y-2">
            <div className="text-base font-semibold">本机尚未绑定设备</div>
            <p className="text-sm text-muted-foreground">
              请管理员在 ERP 端「系统 → PDA 设备」登记这台机器，然后用下方扫码框扫描屏幕上的二维码。
            </p>
          </PdaCard>
        )}

        <PdaCard className="space-y-2">
          <button
            type="button"
            className="w-full text-left text-sm text-primary"
            onClick={() => setManualOpen(v => !v)}
          >
            {manualOpen ? '▲ 收起手动输入' : '▼ 扫码失败？可手动输入设备码和密钥'}
          </button>
          {manualOpen && (
            <div className="space-y-2">
              <Input
                placeholder="设备码，例如 PDA-260726-4DE8"
                value={manual.code}
                onChange={e => setManual(m => ({ ...m, code: e.target.value }))}
              />
              <Input
                placeholder="密钥（64 位）"
                value={manual.secret}
                onChange={e => setManual(m => ({ ...m, secret: e.target.value }))}
              />
              <Button
                className="w-full"
                disabled={!manual.code.trim() || !manual.secret.trim() || binding}
                onClick={() => void bind(manual.code, manual.secret)}
              >
                {binding ? '绑定中…' : '确认绑定'}
              </Button>
            </div>
          )}
        </PdaCard>
      </div>

      <PdaBottomBar>
        <PdaScanner onScan={handleScan} placeholder="扫描绑定二维码" disabled={binding} />
      </PdaBottomBar>
    </div>
  )
}
