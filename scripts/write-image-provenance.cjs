#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function buildProvenance(root, archive, reports, env = process.env) {
  const sha = env.GITHUB_SHA, run = env.GITHUB_RUN_ID
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^\d+$/.test(run || '')) throw Error('Invalid build provenance')
  const subjects = [{ name: path.basename(archive), digest: { sha256: digest(archive) } }]
  const dependencies = [{ uri: 'git+https://github.com/' + env.GITHUB_REPOSITORY, digest: { gitCommit: sha } }]
  for (const service of ['backend', 'frontend']) {
    const image = fs.readFileSync(path.join(reports, service + '.image-id'), 'utf8').trim()
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error('Invalid image digest')
    subjects.push({ name: 'flowcube-' + service + ':' + sha, digest: { sha256: image.slice(7) } })
    const sbomFile = path.join(reports, service + '.sbom.json')
    const sbom = JSON.parse(fs.readFileSync(sbomFile, 'utf8'))
    if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components) || !sbom.components.length) throw Error('Invalid or empty image SBOM')
    subjects.push({ name: service + '.sbom.json', digest: { sha256: digest(sbomFile) } })
    for (const file of ['Dockerfile.' + service, service + '/package-lock.json']) {
      dependencies.push({ uri: file, digest: { sha256: digest(path.join(root, file)) } })
    }
    for (const imageRef of fs.readFileSync(path.join(root, 'Dockerfile.' + service), 'utf8').matchAll(/^FROM\s+(\S+)/gm)) {
      if (!/@sha256:[a-f0-9]{64}$/.test(imageRef[1])) throw Error('Mutable base image')
      dependencies.push({ uri: 'docker://' + imageRef[1], digest: { sha256: imageRef[1].split('@sha256:')[1] } })
    }
  }
  return {
    _type: 'https://in-toto.io/Statement/v1', subject: subjects,
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: { buildType: 'https://github.com/' + env.GITHUB_REPOSITORY + '/scripts/build-deploy-images.sh', externalParameters: { platform: 'linux/amd64', sourceSha: sha }, internalParameters: {}, resolvedDependencies: dependencies },
      runDetails: { builder: { id: 'https://github.com/' + env.GITHUB_REPOSITORY + '/.github/workflows/deploy-browser.yml' }, metadata: { invocationId: 'https://github.com/' + env.GITHUB_REPOSITORY + '/actions/runs/' + run, runAttempt: env.GITHUB_RUN_ATTEMPT || '1' } },
    },
  }
}
if (require.main === module) {
  try {
    const [archive, reports] = process.argv.slice(2)
    fs.writeFileSync(path.join(reports, 'provenance.json'), JSON.stringify(buildProvenance(process.cwd(), archive, reports), null, 2) + '\n')
  } catch (error) { console.error('::error::' + error.message); process.exitCode = 1 }
}
module.exports = { buildProvenance }
