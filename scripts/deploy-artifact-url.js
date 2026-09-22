#!/usr/bin/env node
'use strict'

async function resolveArtifactUrl({ repository, artifactId, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^\d+$/.test(artifactId || '') || !token) throw new Error('缺少合法仓库、artifact ID 或 token')
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`, {
    redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (response.status !== 302) throw new Error(`下载地址获取失败：HTTP ${response.status}`)
  const location = response.headers.get('location') || ''
  const url = new URL(location)
  if (url.protocol !== 'https:' || url.username || url.password || /[\s"\\]/.test(location)) throw new Error('无效 HTTPS 签名地址')
  return location
}

if (require.main === module) {
  resolveArtifactUrl({ repository: process.env.GITHUB_REPOSITORY, artifactId: process.env.DEPLOY_ARTIFACT_ID, token: process.env.GITHUB_TOKEN })
    .then(url => process.stdout.write(url + '\n'))
    // URL 属于短期凭据，不回显 fetch 异常对象或 URL。
    .catch(() => { console.error('::warning::无法获取镜像 HTTPS 下载地址，回退 SCP'); process.exitCode = 1 })
}
module.exports = { resolveArtifactUrl }
