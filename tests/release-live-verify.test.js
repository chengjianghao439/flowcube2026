#!/usr/bin/env node
'use strict'

/**
 * 发版后线上核对脚本回归（离线，假 fetch）。
 *
 * 重点是 PDA：2026-09-18 发 v0.9.20 时才发现 v0.9.19 的 PDA 发布从未成功（failed + cancelled），
 * 生产 /api/pda/version 一直停在 0.9.18/126，而其它链路全绿。这里固定住「PDA 落后必须判失败
 * 并给出补跑命令」的行为。
 */

const assert = require('node:assert')
const { test } = require('node:test')
const { createHash } = require('node:crypto')

const { assessLiveRelease, resolveOrigin, verifyLiveRelease } = require('../scripts/verify-live-release.cjs')

const EXPECTED = { desktopVersion: '0.9.20', pdaVersion: '0.9.20', pdaVersionCode: 128 }

const goodPayloads = {
  latestJson: {
    version: '0.9.20',
    url: '/versions/v0.9.20/FlowCube-Setup-0.9.20.exe',
    sha256: 'f'.repeat(64),
    notes: '# v0.9.20\n\n说明',
  },
  appUpdate: { success: true, data: { version: '0.9.20' } },
  pdaVersion: { success: true, data: { version: '0.9.20', versionCode: 128, available: true, downloadUrl: 'https://x/api/pda/download?v=0.9.20&code=128', releaseNote: '本版修复…' } },
  health: { success: true, data: { status: 'ok' } },
}

test('全部一致时通过', () => {
  const checks = assessLiveRelease(goodPayloads, EXPECTED)
  assert.equal(checks.filter(c => !c.ok).length, 0, JSON.stringify(checks.filter(c => !c.ok)))
})

test('PDA 落后一个版本（v0.9.19 的真实故障）必须判失败', () => {
  const checks = assessLiveRelease({
    ...goodPayloads,
    pdaVersion: { success: true, data: { version: '0.9.18', versionCode: 126, available: true, downloadUrl: 'https://x/api/pda/download?code=126', releaseNote: '旧说明' } },
  }, EXPECTED)
  const failed = checks.filter(c => !c.ok).map(c => c.name)
  assert.deepEqual(failed, ['PDA 已发布版本', 'PDA 已发布 versionCode', 'PDA 安装包可下载'])
})

test('桌面清单/接口版本不一致时判失败', () => {
  const checks = assessLiveRelease({
    ...goodPayloads,
    latestJson: { ...goodPayloads.latestJson, version: '0.9.19', url: '/versions/v0.9.19/FlowCube-Setup-0.9.19.exe', notes: '# v0.9.19' },
    appUpdate: { success: true, data: { version: '0.9.19' } },
  }, EXPECTED)
  const failed = checks.filter(c => !c.ok).map(c => c.name)
  assert.ok(failed.includes('桌面更新清单版本'))
  assert.ok(failed.includes('桌面安装包路径'))
  assert.ok(failed.includes('桌面更新接口版本'))
  assert.ok(!failed.some(name => name.startsWith('PDA')), '桌面问题不应误报 PDA')
})

test('缺少摘要或 notes 判失败', () => {
  const checks = assessLiveRelease({
    ...goodPayloads,
    latestJson: { version: '0.9.20', url: '/versions/v0.9.20/FlowCube-Setup-0.9.20.exe', sha256: '', notes: '' },
  }, EXPECTED)
  const failed = checks.filter(c => !c.ok).map(c => c.name)
  assert.deepEqual(failed, ['桌面安装包摘要', '桌面更新说明'])
})

test('PDA 落后时打印补跑命令，且整体退出为失败', async () => {
  const lines = []
  const result = await verifyLiveRelease({
    origin: 'https://example.test',
    expected: EXPECTED,
    logger: line => lines.push(line),
    fetchImpl: async url => {
      const payload = String(url).includes('pda/version')
        ? { success: true, data: { version: '0.9.18', versionCode: 126, available: true, downloadUrl: 'https://x/api/pda/download?code=126', releaseNote: '旧' } }
        : String(url).includes('app-update')
          ? goodPayloads.appUpdate
          : String(url).includes('latest.json')
            ? goodPayloads.latestJson
            : goodPayloads.health
      return { ok: true, status: 200, json: async () => payload }
    },
  })
  assert.equal(result.ok, false)
  const output = lines.join('\n')
  assert.match(output, /gh workflow run build-pda-apk\.yml --ref main -f checkout_ref=/)
  assert.match(output, /❌ PDA 已发布版本/)
})

test('origin 解析：--origin、环境变量、deploy 配置依次生效', () => {
  assert.equal(resolveOrigin(['--origin', 'https://a.test/'], {}, () => 'https://ignored'), 'https://a.test')
  assert.equal(resolveOrigin([], { FLOWCUBE_ERP_ORIGIN: 'https://b.test' }, () => 'https://ignored'), 'https://b.test')
  assert.equal(resolveOrigin([], {}, () => 'https://c.test\n'), 'https://c.test')
  assert.throws(() => resolveOrigin([], {}, () => { throw new Error('missing') }), /缺少站点的 origin/)
})

for (const scenario of ['ok', 'corrupt', 'unavailable', 'missing-hash']) {
  test(`线上验收必须实际读取桌面和 PDA 包并核对 SHA256：${scenario}`, async () => {
    const binary = Buffer.from('fixture-installation-package')
    const hash = createHash('sha256').update(binary).digest('hex')
    const downloads = []
    const result = await verifyLiveRelease({ origin: 'https://fixture.test', expected: EXPECTED, logger: () => {},
      fetchImpl: async url => {
        if (url.endsWith('/latest.json')) return { ok: true, json: async () => ({ ...goodPayloads.latestJson, sha256: hash }) }
        if (url.endsWith('/api/app-update/latest')) return { ok: true, json: async () => goodPayloads.appUpdate }
        if (url.endsWith('/api/pda/version')) return { ok: true, json: async () => ({ success: true, data: { ...goodPayloads.pdaVersion.data,
          downloadUrl: '/api/pda/download?code=128', sha256: scenario === 'missing-hash' ? '' : hash } }) }
        if (url.endsWith('/api/health')) return { ok: true, json: async () => goodPayloads.health }
        downloads.push(url)
        return new Response(scenario === 'corrupt' ? 'wrong bytes' : binary, { status: scenario === 'unavailable' ? 404 : 200 })
      },
    })
    assert.equal(result.ok, scenario === 'ok')
    if (scenario === 'ok') assert.equal(downloads.length, 2, '不能只检查 manifest 的摘要格式')
    else assert.ok(result.checks.some(c => !c.ok && /下载完整性/.test(c.name)))
  })
}
