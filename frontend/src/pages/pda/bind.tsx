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
import { Camera } from 'lucide-react'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCameraScanner } from '@/hooks/useCameraScanner'
import { Capacitor } from '@capacitor/core'
import {
  getDeviceCredential,
  getDeviceSession,
  saveDeviceCredential,
  clearDeviceBinding,
  parseBindingPayload,
} from '@/lib/pdaDeviceBinding'
import { ensureDeviceSession } from '@/api/pda-session'

/**
 * 相机扫码引导浮层（扫描期间主内容整体让位，见 handleCameraScan）：
 * 浮层本身不画任何大块背景——相机画面由「WebView 背景透明」透出的原生视图呈现，
 * 悬浮 UI 只负责引导文案与取消按钮。
 */
function CameraOverlay({ onCancel, scanning }: { onCancel: () => void; scanning: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-end pb-[16vh] pointer-events-none">
      <div className="pointer-events-auto rounded-2xl border border-border bg-black/60 px-5 py-3 text-center text-white backdrop-blur-sm">
        <div className="text-sm">
          {scanning ? (
            <>
              <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white align-middle" />
              正在识别…
            </>
          ) : (
            '将二维码对准取景框'
          )}
        </div>
        <p className="mt-1 text-xs text-white/70">若相机已打开但没有画面，请检查系统相机权限</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="pointer-events-auto mt-4 rounded-full bg-background/90 px-8 py-2 text-sm font-medium text-foreground shadow-lg active:scale-95"
      >
        取消
      </button>
    </div>
  )
}

export default function PdaBindPage() {
  const nav = useNavigate()
  const { flash, ok, err, warn } = usePdaFeedback()
  const { scan, close, scanning, open } = useCameraScanner()
  const [credential, setCredential] = useState(() => getDeviceCredential())
  const [session, setSession] = useState(() => getDeviceSession())
  const [manual, setManual] = useState({ code: '', secret: '' })
  const [manualOpen, setManualOpen] = useState(false)
  const [binding, setBinding] = useState(false)

  async function bind(deviceCode: string, deviceSecret: string) {
    setBinding(true)
    await saveDeviceCredential(deviceCode, deviceSecret)
    try {
      const created = await ensureDeviceSession()
      if (!created) {
        // 凭据存下来了但换不到票据：多半是设备被停用或密钥已被重置，
        // 留着一份错的凭据只会让后续每个请求都失败，不如直接清掉重来
        await clearDeviceBinding()
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

  async function handleCameraScan() {
    await scan(
      raw => {
        // 相机取景在原生层，一个扫码结果回调即完成本次绑定；关闭取景后 toast 提示
        close()
        handleScan(raw)
      },
      () => err('无法打开相机，本机可能没有摄像头或相机被其他应用占用'),
    )
  }

  async function handleUnbind() {
    await clearDeviceBinding()
    setCredential(null)
    setSession(null)
    warn('已解除绑定，这台机器需要重新扫码才能继续作业')
  }

  // —— 相机取景模式（startScan 的原生预览从 WebView 底层透出）—————
  // 页面主内容全部让位：只渲染透明根 + 引导浮层，否则 header/卡片/底栏的
  // 不透明背景会盖住预览，页面文字也会叠在相机画面上。
  if (open) {
    return (
      <div className="flex min-h-screen flex-col">
        <CameraOverlay onCancel={close} scanning={scanning} />
      </div>
    )
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
        <div className="flex items-stretch gap-2">
          <div className="flex-1">
            <PdaScanner onScan={handleScan} placeholder="扫描绑定二维码" disabled={binding} />
          </div>
          {Capacitor.isNativePlatform() && (
            <button
              type="button"
              onClick={() => void handleCameraScan()}
              disabled={scanning || binding}
              className="shrink-0 rounded-2xl border border-border bg-card px-4 text-muted-foreground transition-all active:scale-95 disabled:opacity-40"
              aria-label="相机扫码"
            >
              <Camera className="mx-auto h-5 w-5" />
              <span className="mt-0.5 block text-xs">{scanning ? '识别中…' : '相机扫码'}</span>
            </button>
          )}
        </div>
      </PdaBottomBar>
    </div>
  )
}
