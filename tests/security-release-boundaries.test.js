'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('../frontend/node_modules/js-yaml')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const workflow = file => yaml.load(read('.github/workflows/' + file))

test('桌面构建为只读且不持有发布凭据，发布独立作业依赖受信SHA', () => {
  const wf = workflow('build-desktop.yml')
  assert.equal(wf.permissions.contents, 'read')
  assert.ok(wf.jobs['resolve-release-target'])
  assert.ok(wf.jobs.publish)
  assert.doesNotMatch(JSON.stringify(wf.jobs.build), /secrets\.|contents":"write/)
  assert.match(JSON.stringify(wf.jobs.publish), /needs\.resolve-release-target\.outputs\.sha/)
  assert.match(JSON.stringify(wf.jobs.publish), /artifact-ids/)
})

test('PDA构建没有签名密钥，fresh签名job不运行Gradle或npm', () => {
  const wf = workflow('build-pda-apk.yml')
  assert.ok(wf.jobs['resolve-release-target'])
  assert.ok(wf.jobs['sign-pda'])
  assert.doesNotMatch(JSON.stringify(wf.jobs['build-pda']), /secrets\.|FLOWCUBE_UPLOAD_STORE_PASSWORD/)
  assert.doesNotMatch(JSON.stringify(wf.jobs['sign-pda']), /gradlew|npm /)
  assert.match(JSON.stringify(wf.jobs['sign-pda']), /apksigner/)
  for (const step of wf.jobs['publish-pda'].steps.filter(s => s.uses?.startsWith('actions/checkout'))) {
    assert.equal(step.with.ref, '${{ needs.resolve-release-target.outputs.main_sha }}')
    assert.equal(step.with['persist-credentials'], false)
  }
})

test('Gitleaks许可选择互斥，fallback镜像固定、源只读且无token', () => {
  const steps = workflow('security-scan.yml').jobs.gitleaks.steps
  const primary = steps.find(s => s.name === 'Run Gitleaks')
  const fallback = steps.find(s => s.name === 'Fallback gitleaks (Docker)')
  assert.match(primary.if || '', /steps\.license\.outputs\.enabled == 'true'/)
  assert.match(fallback.if || '', /steps\.license\.outputs\.enabled != 'true'/)
  assert.match(fallback.run, /gitleaks[^\s]*@sha256:[0-9a-f]{64}/)
  assert.match(fallback.run, /:\/repo:ro/)
  assert.doesNotMatch(fallback.run, /GITHUB_TOKEN|secrets\./)
})

test('NSIS校验在提取可执行文件前执行', () => {
  const step = workflow('build-desktop.yml').jobs.build.steps.find(s => s.name === 'Prepare fixed NSIS 3.0.4.1')
  assert.ok(step.run.indexOf('verify-nsis-archive.cjs') >= 0)
  assert.ok(step.run.indexOf('verify-nsis-archive.cjs') < step.run.indexOf('7z x'))
})

test('生产基础镜像不可随tag漂移，Dockerfile和MySQL引用带digest', () => {
  for (const file of ['Dockerfile.backend', 'Dockerfile.frontend']) {
    const refs = [...read(file).matchAll(/^FROM\s+(\S+)/gm)].map(m => m[1])
    for (const image of refs) assert.match(image, /@sha256:[0-9a-f]{64}$/)
  }
  for (const [service, config] of Object.entries(yaml.load(read('docker-compose.yml')).services)) {
    if (config.build) continue // Application bytes are admitted from the same-SHA runner archive.
    assert.match(config.image, /@sha256:[0-9a-f]{64}$/, service)
  }
})

test('Gradle发行归档固定官方SHA256', () => {
  assert.match(read('frontend/android/gradle/wrapper/gradle-wrapper.properties'), /^distributionSha256Sum=89d4e70e4e84e2d2dfbb63e4daa53e21b25017cc70c37e4eea31ee51fb15098a$/m)
})

 test('历史桌面构建内置SHA与目标提交一致，发布镜像保留SBOM/来源记录', () => {
  const step = workflow('build-desktop.yml').jobs.build.steps.find(s => s.name === 'Build desktop installer')
  assert.equal(step.env.GITHUB_SHA, '${{ needs.resolve-release-target.outputs.sha }}')
  assert.match(step.run, /cat \.git-build-sha/)
  const build = workflow('deploy-browser.yml').jobs.deploy.steps.find(s => s.name === 'Build application images on GitHub runner')
  assert.match(build.run, /generate-image-sbom\.sh/)
  assert.match(read('scripts/generate-image-sbom.sh'), /anchore\/syft[^\s]*@sha256:[a-f0-9]{64}/)
  assert.doesNotMatch(read('scripts/generate-image-sbom.sh'), /docker\.sock/)
 })
