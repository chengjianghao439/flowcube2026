#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function manifestFor(directory, extension, sha, runId) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^\d+$/.test(runId || '')) throw Error('Invalid artifact provenance')
  const files = fs.readdirSync(directory).filter(file => file.endsWith(extension))
  if (files.length !== 1) throw Error('Artifact must contain exactly one ' + extension + ' file')
  const file = files[0]
  if (!/^[A-Za-z0-9_.-]+$/.test(file)) throw Error('Unsafe artifact filename')
  const metadata = {}
  for (const name of fs.readdirSync(directory)) {
    if (name === 'release-provenance.json') continue
    if (![file, 'version.json', 'releaseNotes.md'].includes(name) || !fs.lstatSync(path.join(directory, name)).isFile()) throw Error('Unexpected artifact entry')
    if (name !== file) metadata[name] = digest(path.join(directory, name))
  }
  return { sha, runId, file, sha256: digest(path.join(directory, file)), metadata }
}
function verifyArtifact(directory, extension, sha, runId) {
  const actual = manifestFor(directory, extension, sha, runId)
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'release-provenance.json'), 'utf8'))
  for (const key of Object.keys(actual)) if (JSON.stringify(actual[key]) !== JSON.stringify(stored[key])) throw Error('Artifact provenance mismatch: ' + key)
  return actual
}
if (require.main === module) {
  try {
    const [mode, dir, extension] = process.argv.slice(2)
    const sha = process.env.TARGET_SHA, runId = process.env.GITHUB_RUN_ID
    if (mode === 'write') fs.writeFileSync(path.join(dir, 'release-provenance.json'), JSON.stringify(manifestFor(dir, extension, sha, runId)) + '\n')
    else if (mode === 'verify') verifyArtifact(dir, extension, sha, runId)
    else throw Error('Expected write or verify mode')
  } catch (error) { console.error('::error::' + error.message); process.exitCode = 1 }
}
module.exports = { manifestFor, verifyArtifact }
