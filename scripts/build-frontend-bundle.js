#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const frontendDir = path.join(root, 'frontend')

function normalizeOrigin(raw) {
  const value = String(raw || '').trim().replace(/\/$/, '')
  if (!value) return ''
  try {
    const parsed = new URL(value.startsWith('http') ? value : `http://${value}`)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return ''
  }
}

function readDeployConfigOrigin() {
  const candidatePaths = [
    process.env.FLOWCUBE_DEPLOY_CONFIG,
    path.join(root, 'deploy', 'production.local.json'),
    path.join(root, 'deploy', 'production.json'),
  ].filter(Boolean)

  for (const candidate of candidatePaths) {
    const resolved = path.resolve(candidate)
    if (!fs.existsSync(resolved)) continue
    const config = JSON.parse(fs.readFileSync(resolved, 'utf8'))
    const origin = normalizeOrigin(config.erpOrigin)
    if (origin) return origin
  }
  return ''
}

function resolveProductionOrigin() {
  return (
    normalizeOrigin(process.env.VITE_ERP_PRODUCTION_ORIGIN) ||
    normalizeOrigin(process.env.FLOWCUBE_ERP_ORIGIN) ||
    readDeployConfigOrigin()
  )
}

const target = process.argv[2]
if (!['electron', 'pda'].includes(target)) {
  console.error('Usage: node scripts/build-frontend-bundle.js <electron|pda>')
  process.exit(1)
}

const productionOrigin = resolveProductionOrigin()
if (!productionOrigin && process.env.ALLOW_LOCAL_API_FALLBACK !== '1') {
  console.error(
    [
      `FlowCube: ${target} 安装包构建必须注入生产 API 地址，避免安装包默认连到 localhost。`,
      '请设置 VITE_ERP_PRODUCTION_ORIGIN，或创建 deploy/production.local.json 并填写 erpOrigin。',
      '仅本机临时测试可设置 ALLOW_LOCAL_API_FALLBACK=1 跳过此检查。',
    ].join('\n'),
  )
  process.exit(1)
}

const env = {
  ...process.env,
  VITE_ERP_PRODUCTION_ORIGIN: productionOrigin || process.env.VITE_ERP_PRODUCTION_ORIGIN || '',
}

if (target === 'electron') {
  env.VITE_ELECTRON = '1'
  delete env.VITE_CAPACITOR
} else {
  env.VITE_CAPACITOR = '1'
  delete env.VITE_ELECTRON
}

console.log(
  `[build-frontend-bundle] target=${target} api=${productionOrigin || '(local fallback allowed)'}`,
)

const command = 'npm'
const args = ['run', target === 'pda' ? 'build:pda' : 'build']
const result = spawnSync(command, args, {
  cwd: frontendDir,
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status == null ? 1 : result.status)
