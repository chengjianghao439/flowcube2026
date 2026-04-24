import { useEffect } from 'react'
import { payloadClient as apiClient } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'

type ClientInfo = { clientId: string; hostname: string }

type ClaimedJob = {
  id: number
  printerId: number | null
  printerName: string | null
  content: string
  contentType: string
  ackToken?: string | null
}

async function getDesktopClientInfo(): Promise<ClientInfo | null> {
  if (!IS_ELECTRON_DESKTOP) return null
  const fn = window.flowcubeDesktop?.getClientInfo
  if (typeof fn !== 'function') return null
  try {
    const info = await fn()
    if (!info?.clientId || !info?.hostname) return null
    return info
  } catch {
    return null
  }
}

async function getDesktopPrinterNames(): Promise<string[]> {
  const fn = window.flowcubeDesktop?.getSystemPrinters
  if (typeof fn !== 'function') return []
  try {
    const rows = await fn()
    return [...new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => String(row?.name || '').trim())
        .filter(Boolean),
    )]
  } catch {
    return []
  }
}

async function heartbeatClient(info: ClientInfo) {
  const printers = await getDesktopPrinterNames()
  await apiClient.post('/printers/client-heartbeat', {
    clientId: info.clientId,
    hostname: info.hostname,
    printers,
  }, { skipGlobalError: true })
}

async function claimClientJobs(info: ClientInfo): Promise<ClaimedJob[]> {
  const res = await apiClient.post<ClaimedJob[]>(
    '/print-jobs/claim-client',
    { clientId: info.clientId, limit: 3 },
    { skipGlobalError: true },
  )
  return Array.isArray(res) ? res : []
}

async function completeClientJob(info: ClientInfo, jobId: number, ackToken?: string | null) {
  await apiClient.post(
    `/print-jobs/${jobId}/complete-client`,
    { ackToken },
    { headers: { 'X-Client-Id': info.clientId }, skipGlobalError: true },
  )
}

async function failClientJob(info: ClientInfo, jobId: number, errorMessage: string) {
  await apiClient.post(
    `/print-jobs/${jobId}/fail-client`,
    { errorMessage },
    { headers: { 'X-Client-Id': info.clientId }, skipGlobalError: true },
  )
}

async function printClaimedJob(info: ClientInfo, job: ClaimedJob) {
  const printerName = String(job.printerName || '').trim()
  const content = String(job.content || '')
  if (!printerName) {
    await failClientJob(info, job.id, '打印机未配置本机名称')
    return
  }
  if (!content.trim()) {
    await failClientJob(info, job.id, '打印内容为空')
    return
  }
  try {
    await window.flowcubeDesktop!.printZpl!({ printerName, content })
    await completeClientJob(info, job.id, job.ackToken)
  } catch (e) {
    const message =
      e instanceof Error && e.message.trim()
        ? e.message.trim()
        : '本机 RAW 打印失败'
    await failClientJob(info, job.id, message)
  }
}

export default function DesktopPrintClientBridge() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    if (!IS_ELECTRON_DESKTOP || !isAuthenticated) return
    if (typeof window === 'undefined') return
    if (typeof window.flowcubeDesktop?.printZpl !== 'function') return

    let cancelled = false
    let busy = false

    const run = async () => {
      if (cancelled || busy) return
      busy = true
      try {
        const info = await getDesktopClientInfo()
        if (!info || cancelled) return
        await heartbeatClient(info)
        const jobs = await claimClientJobs(info)
        for (const job of jobs) {
          if (cancelled) break
          await printClaimedJob(info, job)
        }
      } catch {
        // 静默重试，避免桌面端每次轮询都弹错误
      } finally {
        busy = false
      }
    }

    void run()
    const heartbeatTimer = window.setInterval(() => { void run() }, 15000)
    const claimTimer = window.setInterval(() => { void run() }, 4000)

    return () => {
      cancelled = true
      window.clearInterval(heartbeatTimer)
      window.clearInterval(claimTimer)
    }
  }, [isAuthenticated])

  return null
}
