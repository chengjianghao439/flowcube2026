#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function resolveReleaseTarget(env = process.env) {
  const event = env.GITHUB_EVENT_NAME
  const ref = env.GITHUB_REF || ''
  const releaseTag = /^refs\/tags\/v\d+\.\d+\.\d+$/.test(ref)
  if (!['push', 'workflow_dispatch'].includes(event) || (ref !== 'refs/heads/main' && !(event === 'push' && releaseTag))) {
    throw Error('Release workflow must run from main or an exact vX.Y.Z push tag')
  }
  const requested = String(env.RELEASE_CHECKOUT_REF || '').trim()
  if (requested && !/^(?:main|[a-f0-9]{40}|v\d+\.\d+\.\d+)$/.test(requested)) throw Error('Only main, a full main SHA, or an exact release tag is accepted')
  const candidate = requested || env.GITHUB_SHA
  if (!/^(?:[a-f0-9]{40}|main|v\d+\.\d+\.\d+)$/.test(candidate || '')) throw Error('Missing or invalid release target')
  const mainSha = git('rev-parse', '--verify', 'refs/remotes/origin/main^{commit}')
  const sha = git('rev-parse', '--verify', (candidate === 'main' ? mainSha : candidate) + '^{commit}')
  git('merge-base', '--is-ancestor', sha, mainSha)
  if (releaseTag && (requested || git('rev-parse', '--verify', ref + '^{commit}') !== env.GITHUB_SHA || sha !== env.GITHUB_SHA)) throw Error('Tag event and release target SHA must match')
  return { sha, main_sha: mainSha }
}

if (require.main === module) {
  try {
    const result = resolveReleaseTarget()
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => key + '=' + value).join('\n') + '\n')
    console.log(JSON.stringify(result))
  } catch (error) { console.error('::error::Untrusted release target: ' + error.message); process.exitCode = 1 }
}
module.exports = { resolveReleaseTarget }
