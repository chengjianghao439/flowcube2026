#!/usr/bin/env node
'use strict'
const { execFileSync } = require('node:child_process')
const { waitForChecks } = require('./wait-release-checks')
const { verifyLiveRelease } = require('./verify-live-release.cjs')

function publishTagForCommit({ sha, tag, runner = execFileSync }) {
  const head = runner('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== sha) throw new Error('等待期间 HEAD 已改变，拒绝给另一发布目标打 tag')
  const pkg = JSON.parse(runner('git', ['show', `${sha}:desktop/package.json`], { encoding: 'utf8' }))
  if (`v${pkg.version}` !== tag) throw new Error('发布目标版本与 tag 不一致')
  return runner('bash', ['scripts/release-desktop-tag.sh'], { stdio: 'inherit' })
}

async function completeRelease({ repository, sha, token, tag, origin, wait = waitForChecks, verify = verifyLiveRelease,
  publishTag = publishTagForCommit, log = console.log }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('无效发布 tag')
  const started = Date.now()
  // PDA 必须先发布完，避免 tag 与 PDA 同时进入单 pending 的服务器部署组。
  await wait({ repository, sha, token, timeoutMs: 270 * 60 * 1000,
    requiredWorkflows: ['test.yml', 'security-scan.yml', 'deploy-browser.yml', 'build-pda-apk.yml', 'build-desktop.yml'] })
  await publishTag({ sha, tag })
  // 同 SHA 的 main 桌面构建只做验证；必须等 tag 的发布运行成功。
  await wait({ repository, sha, token, branch: tag, events: ['push'], timeoutMs: 60 * 60 * 1000,
    requiredWorkflows: ['build-desktop.yml'] })
  const result = await verify({ origin })
  if (!result.ok) throw new Error('三端线上版本核对未通过，不能宣布发版完成')
  const seconds = Math.round((Date.now() - started) / 1000)
  log(`三端发布及线上版本核对通过，用时 ${seconds} 秒；15 分钟目标${seconds <= 900 ? '达成' : '未达成，请查看排队/传输/验收耗时'}`)
  return result
}

if (require.main === module) {
  completeRelease({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA, token: process.env.GITHUB_TOKEN,
    tag: process.env.RELEASE_TAG, origin: process.env.FLOWCUBE_ERP_ORIGIN })
    .catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1 })
}
module.exports = { completeRelease, publishTagForCommit }
