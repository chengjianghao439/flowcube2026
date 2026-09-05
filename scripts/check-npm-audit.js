#!/usr/bin/env node
'use strict'

const fs = require('node:fs')

/** npm 的 exit 1 也可能表示发现漏洞；必须先验证响应结构，再判定门禁。 */
function analyzeAudit(raw) {
  let data
  try { data = JSON.parse(raw) } catch { throw new Error('依赖审计未完成：结果为空或不是合法 JSON') }
  if (!data || data.error || data.auditReportVersion !== 2 || !data.vulnerabilities || Array.isArray(data.vulnerabilities)
    || typeof data.vulnerabilities !== 'object' || !Number.isInteger(data.metadata?.vulnerabilities?.total)) {
    throw new Error('依赖审计未完成：接口错误或报告结构不完整')
  }
  const findings = Object.entries(data.vulnerabilities).map(([name, item]) => {
    if (!item || !['info', 'low', 'moderate', 'high', 'critical'].includes(item.severity)
      || typeof item.isDirect !== 'boolean' || !Array.isArray(item.via)) throw new Error(`依赖审计报告条目无效：${name}`)
    return { name, severity: item.severity, isDirect: item.isDirect, via: item.via.map(v => typeof v === 'string' ? v : v.title || v.source || 'advisory') }
  })
  if (data.metadata.vulnerabilities.total !== findings.length) throw new Error('依赖审计报告条目数与汇总不一致')
  const blocking = findings.filter(f => ['high', 'critical'].includes(f.severity)).length
  return { findings, blocking }
}

if (require.main === module) {
  try {
    const file = process.argv[2]
    const exitCode = Number(process.argv[3])
    if (![0, 1].includes(exitCode)) throw new Error('依赖审计命令异常退出，不能认定扫描成功')
    const result = analyzeAudit(fs.readFileSync(file, 'utf8'))
    const lines = [`## npm audit — ${file}`, ...result.findings.map(f => `- [${f.severity}] ${f.name}（${f.isDirect ? '直接' : '传递'}依赖）：${f.via.join(', ')}`), `发现 ${result.findings.length} 项；阻断发布的高危/严重依赖 ${result.blocking} 项。`]
    console.log(lines.join('\n'))
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
    process.exitCode = result.blocking > 0 ? 1 : 0
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { analyzeAudit }
