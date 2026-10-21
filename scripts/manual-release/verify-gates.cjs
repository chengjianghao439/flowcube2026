#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { waitForChecks } = require('../wait-release-checks')
const targets = ['backend', 'desktop', 'frontend', 'scripts/browser-smoke']
function requireGate(ok, message) { if (!ok) throw Error(message) }
function verifyJobs(workflow, jobs) {
  requireGate(Array.isArray(jobs) && jobs.length > 0 && jobs.every(j => j.status === 'completed' && j.conclusion === 'success'), '必要 GitHub job 未成功或被跳过')
  if (workflow === 'security-scan.yml') for (const target of targets) {
    const audit = jobs.find(j => j.name === `npm audit — 依赖漏洞扫描 (${target})`)
    requireGate(audit?.steps?.some(s => s.name === 'Audit dependencies and enforce result integrity' && s.status === 'completed' && s.conclusion === 'success'), 'npm audit 目标未实际通过')
  }
}
function verifyApproval(approval, backup, { sha, actorId, bossIds, operatorIds, now = Date.now(), triggeredAt = now }) {
  requireGate(Array.isArray(bossIds) && bossIds.includes(actorId), '触发者不在经代码审核的老大身份白名单')
  requireGate(approval.body === `发 ${sha}` && String(approval.user?.id) === actorId, '批准必须由本次触发者在 GitHub 明确回复 发 加完整 SHA')
  const receipt = backup.body?.match(new RegExp(`^备份就绪 ${sha}\\n收据 SHA256 ([a-f0-9]{64})$`))
  requireGate(receipt && operatorIds.includes(String(backup.user?.id)), '缺少运维身份绑定的备份记录')
  const a = Date.parse(approval.updated_at || approval.created_at), b = Date.parse(backup.updated_at || backup.created_at)
  requireGate(approval.id !== backup.id && approval.issue_url === backup.issue_url && Number.isFinite(a) && Number.isFinite(b) && b <= a && a <= triggeredAt && triggeredAt <= now && now - b < 24 * 3600 * 1000, '备份和批准须在同一主题内按顺序完成且未过期')
  requireGate(!approval.performed_via_github_app && !backup.performed_via_github_app && !approval.user?.login?.endsWith('[bot]') && !backup.user?.login?.endsWith('[bot]'), '机器人评论不是人工批准')
  return { commentId: String(approval.id), backupCommentId: String(backup.id), operatorId: String(backup.user.id), backupReceiptSha256: receipt[1], approvalTime: new Date(a).toISOString(), backupTime: new Date(b).toISOString() }
}
async function verifyGates(env = process.env, fetchImpl = fetch, identityPolicy = JSON.parse(fs.readFileSync(path.join(__dirname, 'approvers.json'), 'utf8'))) {
  const sha = env.TARGET_SHA, repo = env.GITHUB_REPOSITORY
  requireGate(identityPolicy.schema === 1 && Array.isArray(identityPolicy.bossIds) && identityPolicy.bossIds.includes(env.GITHUB_ACTOR_ID) && Array.isArray(identityPolicy.operatorIds) && identityPolicy.operatorIds.length > 0, '必须先通过代码审查配置老大和运维数字身份白名单')
  requireGate(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_RUN_ATTEMPT === '1' && env.GITHUB_ACTOR === env.GITHUB_TRIGGERING_ACTOR, '仅允许新的 main 人工触发，不能重跑或串联发布')
  requireGate(/^[a-f0-9]{40}$/.test(sha || '') && /^[\w.-]+\/[\w.-]+$/.test(repo || '') && env.GITHUB_TOKEN, '缺少合法目标或 GitHub 读取权限')
  for (const id of [env.APPROVAL_COMMENT_ID, env.BACKUP_COMMENT_ID]) requireGate(/^[1-9]\d*$/.test(id || ''), '必须给出可核验的 GitHub 评论 ID')
  const main = execFileSync('git', ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'], {encoding:'utf8'}).trim()
  execFileSync('git', ['merge-base', '--is-ancestor', sha, main], {stdio:'ignore'})
  const api = async endpoint => {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/${endpoint}`, {headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)})
    requireGate(response.ok, `GitHub 门禁查询失败 HTTP ${response.status}`)
    return response.json()
  }
  const run = await api(`actions/runs/${env.GITHUB_RUN_ID}`)
  requireGate(run.event === 'workflow_dispatch' && run.run_attempt === 1 && String(run.actor?.id) === env.GITHUB_ACTOR_ID && run.head_sha === env.GITHUB_SHA && run.head_branch === 'main', 'GitHub 执行身份不匹配')
  const approval = verifyApproval(await api(`issues/comments/${env.APPROVAL_COMMENT_ID}`), await api(`issues/comments/${env.BACKUP_COMMENT_ID}`), {sha, actorId:env.GITHUB_ACTOR_ID, bossIds:identityPolicy.bossIds, operatorIds:identityPolicy.operatorIds, triggeredAt:Date.parse(run.created_at)})
  const states = await waitForChecks({ repository:repo, sha, token:env.GITHUB_TOKEN, fetchImpl, events: ['push', 'workflow_dispatch', 'schedule'] })
  const checks = []
  for (const state of states) {
    const jobs = []
    for (let page=1; ; page++) {
      const data = await api(`actions/runs/${state.run.id}/attempts/${state.run.run_attempt || 1}/jobs?per_page=100&page=${page}`)
      requireGate(Array.isArray(data.jobs), 'GitHub jobs 响应无效')
      jobs.push(...data.jobs)
      if (data.jobs.length < 100) break
      requireGate(page < 100, 'GitHub job 分页超限')
    }
    verifyJobs(state.workflow,jobs)
    checks.push({workflow:state.workflow,sha,conclusion:'success',event:state.run.event,branch:'main',runId:state.run.id,allJobsPassed:true,...(state.workflow==='security-scan.yml'?{auditTargets:targets}:{})})
  }
  fs.writeFileSync(env.RELEASE_CHECKS_OUTPUT || 'checks.json', JSON.stringify({checks,approval})+'\n')
  return {checks,approval}
}
if (require.main === module) verifyGates().catch(error => { console.error('::error::'+error.message); process.exitCode=1 })
module.exports = {verifyJobs,verifyApproval,verifyGates}
