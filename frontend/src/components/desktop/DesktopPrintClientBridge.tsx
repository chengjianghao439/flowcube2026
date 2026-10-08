import { useEffect, useState } from 'react'
import { getEffectiveApiOrigin } from '@/config/api'
import { payloadClient as apiClient } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'
import { preparePrintJobContent } from '@/lib/printJobContent'
import { reportPrintOutcomeWithRetry } from '@/lib/desktopLocalPrint'
import { registerPrintPoller, setDesktopClientId } from '@/lib/printQueue'

type ClientInfo = { clientId: string; hostname: string; credential: string; origin: string }

type ClaimedJob = {
  id: number
  printerId: number | null
  printerName: string | null
  content: string
  contentType: string
  copies?: number
  ackToken?: string | null
}

async function getDesktopClientInfo(): Promise<ClientInfo | null> {
  if (!IS_ELECTRON_DESKTOP) return null
  const fn = window.flowcubeDesktop?.getClientInfo
  if (typeof fn !== 'function') return null
  try {
    const info = await fn()
    if (!info?.clientId || !info?.hostname) return null
    const origin = getEffectiveApiOrigin()
    const credential = origin ? await window.flowcubeDesktop?.getPrintClientCredential?.(origin) : null
    if (!credential) return null
    return { ...info, credential, origin: origin! }
  } catch {
    return null
  }
}

function clientHeaders(info: ClientInfo) { return { 'X-Client-Id': info.clientId, 'X-Print-Client-Credential': info.credential } }
// A workstation secret belongs to one server. Disable the API candidate fallback
// even when the user has not explicitly configured a server address.
function clientConfig(info: ClientInfo) { return { headers: clientHeaders(info), baseURL: `${info.origin}/api`, _erpApiFallbackTried: true, skipGlobalError: true } }
async function heartbeatClient(info: ClientInfo) {
  await apiClient.post('/printers/client-heartbeat', { hostname: info.hostname }, clientConfig(info))
}

async function claimClientJobs(info: ClientInfo): Promise<ClaimedJob[]> {
  const res = await apiClient.post<ClaimedJob[]>(
    '/print-jobs/claim-client',
    { limit: 3 },
    clientConfig(info),
  )
  return Array.isArray(res) ? res : []
}

async function completeClientJob(info: ClientInfo, jobId: number, ackToken?: string | null) {
  await reportPrintOutcomeWithRetry(
    `/print-jobs/${jobId}/complete-client`,
    { ackToken },
    clientConfig(info),
  )
}

async function failClientJob(info: ClientInfo, jobId: number, errorMessage: string, ackToken?: string | null) {
  await reportPrintOutcomeWithRetry(
    `/print-jobs/${jobId}/fail-client`,
    { errorMessage, ackToken },
    clientConfig(info),
  )
}

async function printClaimedJob(info: ClientInfo, job: ClaimedJob) {
  const printerName = String(job.printerName || '').trim()
  const content = String(job.content || '')
  if (!printerName) {
    await failClientJob(info, job.id, '打印机未配置本机名称', job.ackToken).catch(() => {})
    return
  }
  if (!content.trim()) {
    await failClientJob(info, job.id, '打印内容为空', job.ackToken).catch(() => {})
    return
  }
  try {
    const batch = preparePrintJobContent(content, job.copies)
    await window.flowcubeDesktop!.printZpl!({ printerName, ...batch })
  } catch (e) {
    const message =
      e instanceof Error && e.message.trim()
        ? e.message.trim()
        : '本机 RAW 打印失败'
    await failClientJob(info, job.id, message, job.ackToken).catch(() => {})
    return
  }
  // RAW 已提交到操作系统：核销上报失败（网络卡顿/断网）不等于打印失败，不能再判为 fail，
  // 否则会把已经印好的标签误记为失败，后续人工重试会导致重复出纸。失败留给 TTL 兜底清扫。
  await completeClientJob(info, job.id, job.ackToken).catch(() => {})
}

export default function DesktopPrintClientBridge() {
  const [registrationRequired, setRegistrationRequired] = useState(false)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    if (!IS_ELECTRON_DESKTOP || !isAuthenticated) return
    if (typeof window === 'undefined') return
    if (typeof window.flowcubeDesktop?.printZpl !== 'function') return

    let cancelled = false
    let busy = false
    // 本轮执行期间又被唤醒（页面刚入队新任务）：结束后立刻补跑一轮，
    // 否则这次唤醒会因为 busy 被丢弃，用户要多等一个轮询周期才出纸。
    let rerunRequested = false

    const run = async () => {
      if (cancelled) return
      if (busy) {
        rerunRequested = true
        return
      }
      busy = true
      try {
        const info = await getDesktopClientInfo()
        if (cancelled) return
        setRegistrationRequired(!info)
        if (!info) return
        // 让入队请求能带上本机标识，实现「在哪台电脑点的就从哪台电脑的打印机出纸」
        setDesktopClientId(info.clientId)
        await heartbeatClient(info)
        const jobs = await claimClientJobs(info)
        for (const job of jobs) {
          if (cancelled) break
          await printClaimedJob(info, job)
        }
      } catch (e) {
        const failure = e as { status?: number; code?: string; response?: { status?: number } }
        if (failure.code === 'PRINT_CLIENT_CREDENTIAL_INVALID' || (failure.status ?? failure.response?.status) === 401) setRegistrationRequired(true)
        // 静默重试，避免桌面端每次轮询都弹错误
      } finally {
        busy = false
        if (rerunRequested && !cancelled) {
          rerunRequested = false
          void run()
        }
      }
    }

    // 业务页面入队后通过 triggerPrintPoll() 唤醒本客户端立即领取，无需自己执行打印
    registerPrintPoller(() => { void run() })

    void run()
    const heartbeatTimer = window.setInterval(() => { void run() }, 15000)
    const claimTimer = window.setInterval(() => { void run() }, 4000)

    return () => {
      cancelled = true
      registerPrintPoller(null)
      setDesktopClientId(null)
      window.clearInterval(heartbeatTimer)
      window.clearInterval(claimTimer)
    }
  }, [isAuthenticated])

  return registrationRequired && isAuthenticated ? <div role="status" className="px-4 py-2 text-sm text-warning-ink">本机打印尚未注册或凭据已失效。请升级桌面端，由管理员打开「设置 → 打印机管理」注册本机后继续打印。</div> : null
}
