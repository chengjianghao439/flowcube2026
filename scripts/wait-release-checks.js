#!/usr/bin/env node
'use strict'

const REQUIRED_WORKFLOWS = ['test.yml', 'security-scan.yml']

function assessRuns(runs, sha) {
  if (!Array.isArray(runs)) throw new Error('GitHub 检查结果格式无效')
  const run = runs.filter(r => r.head_sha === sha && r.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(r.event))
    .sort((a, b) => b.id - a.id || (b.run_attempt || 1) - (a.run_attempt || 1))[0]
  if (!run || run.status !== 'completed') return { state: 'pending', run }
  return { state: run.conclusion === 'success' ? 'success' : 'failed', run }
}

async function waitForChecks({ repository, sha, token, apiUrl = 'https://api.github.com', timeoutMs = 25 * 60 * 1000, intervalMs = 15000,
  requiredWorkflows = REQUIRED_WORKFLOWS, fetchImpl = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[a-f0-9]{40}$/i.test(sha || '') || !token) throw new Error('缺少合法仓库、提交 SHA 或 GitHub token')
  const deadline = now() + timeoutMs
  while (true) {
    const states = await Promise.all(requiredWorkflows.map(async workflow => {
      const url = new URL(`/repos/${repository}/actions/workflows/${workflow}/runs`, apiUrl)
      url.searchParams.set('head_sha', sha)
      url.searchParams.set('per_page', '100')
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }, signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`${workflow} 检查查询失败：HTTP ${response.status}`)
      const data = await response.json()
      const state = assessRuns(data.workflow_runs, sha)
      if (state.state === 'failed') throw new Error(`${workflow} 在 ${sha} 的检查未通过：${state.run.conclusion}`)
      return { workflow, ...state }
    }))
    if (states.every(s => s.state === 'success')) {
      log(`同一提交 ${sha} 的必要工作流均已成功：${requiredWorkflows.join(', ')}`)
      return states
    }
    if (now() >= deadline) throw new Error(`等待同一提交检查超时：${sha}`)
    log(`等待检查：${states.filter(s => s.state === 'pending').map(s => s.workflow).join(', ')}`)
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())))
  }
}

if (require.main === module) {
  if (process.env.GITHUB_REF !== 'refs/heads/main' && !/^refs\/tags\/v\d+\.\d+\.\d+$/.test(process.env.GITHUB_REF || '')) {
    console.error('::error::仅允许部署 main 分支的提交')
    process.exitCode = 1
  } else {
    waitForChecks({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA, token: process.env.GITHUB_TOKEN, apiUrl: process.env.GITHUB_API_URL,
      requiredWorkflows: process.env.REQUIRE_BROWSER_DEPLOY === '1' ? [...REQUIRED_WORKFLOWS, 'deploy-browser.yml'] : REQUIRED_WORKFLOWS })
      .catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1 })
  }
}

module.exports = { assessRuns, waitForChecks }
