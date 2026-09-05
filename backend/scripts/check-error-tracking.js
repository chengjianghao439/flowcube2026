'use strict'
// 默认只检查配置。--send-test 显式向已经批准的接收端发送一条无业务数据的事件。
// 凭据只从进程环境注入，不读取或输出真实 .env。
const Sentry = require('@sentry/node')
const { initializeErrorTracking, captureUnexpectedError } = require('../src/utils/errorTracking')

async function main() {
  const dsn = String(process.env.SENTRY_DSN || '').trim()
  if (!dsn) { console.error('未配置 SENTRY_DSN，错误追踪尚未接通'); process.exitCode = 2; return }
  if (!process.argv.includes('--send-test')) {
    console.log('已配置错误追踪接收端；未发送事件。使用 --send-test 验证实际接收。')
    return
  }
  let accepted = false
  let responseCode = null
  // 只发送这一条合成事件；失败后的 client report 会新建请求并延长退出期限。
  initializeErrorTracking({ dsn, sendClientReports: false, transport: options => {
    const nativeHttp = new URL(options.url).protocol === 'https:' ? require('node:https') : require('node:http')
    // SDK flush 的期限不会取消底层请求；探针必须同时释放未响应的 socket。
    const httpModule = { request(...args) {
      const request = nativeHttp.request(...args)
      const deadline = setTimeout(() => request.destroy(new Error('Probe transport deadline')), 4000)
      request.once('close', () => clearTimeout(deadline))
      return request
    } }
    const transport = Sentry.makeNodeTransport({ ...options, httpModule })
    return {
      async send(envelope) {
        const result = await transport.send(envelope)
        responseCode = result.statusCode ?? null
        accepted = responseCode >= 200 && responseCode < 300
        return result
      },
      flush: timeout => transport.flush(timeout),
    }
  } })
  const eventId = captureUnexpectedError(new Error('Flowcube observability probe'), { method: 'PROBE', route: 'deployment-check' })
  const flushed = await Sentry.flush(5000)
  if (!flushed || !accepted) {
    console.error(`错误追踪探针未获接收确认（HTTP ${responseCode ?? '无响应'}），不能标记已接通`)
    process.exitCode = 1
  } else console.log(`接收端已接受错误追踪探针；事件ID ${eventId}，请在平台核对检索和告警。`)
  await Sentry.close(1000)
}
main().catch(() => { console.error('错误追踪探针失败，请检查配置与网络；未输出接收端凭据'); process.exitCode = 1 })
