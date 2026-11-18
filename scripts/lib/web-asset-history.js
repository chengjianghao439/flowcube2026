#!/usr/bin/env node
'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const IMAGE_ID = /^sha256:[a-f0-9]{64}$/
const SNAPSHOT = /^generation-[a-f0-9]{64}$/
const ASSET = /^[^/]+-[A-Za-z0-9_-]{8,}\.[a-zA-Z0-9]+$/
const SIZE_LIMIT = 64 * 1024 * 1024

function saveHistory({ root, action, currentImage, previousImage, container }) {
  if (!IMAGE_ID.test(currentImage)) throw Error('目标前端镜像 ID 无法证明')
  if (previousImage && !IMAGE_ID.test(previousImage)) throw Error('原前端镜像 ID 无法证明')
  if (fs.mkdirSync(root, { recursive: true, mode: 0o755 })) fs.chmodSync(root, 0o755)
  const pointer = path.join(root, 'active')
  const recorded = path.join(root, 'deployed-image')
  if (action === 'confirm') {
    const temporary = path.join(root, '.deployed-image-pending')
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      fs.writeFileSync(temporary, currentImage + '\n', { flag: 'wx' })
      fs.renameSync(temporary, recorded)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    return
  }
  if (action !== 'prepare') throw Error('未知静态资源留存操作')
  if (!previousImage || previousImage === currentImage) return
  const installed = fs.existsSync(recorded) ? fs.readFileSync(recorded, 'utf8').trim() : null
  if (installed && !IMAGE_ID.test(installed)) throw Error('前端已发布镜像记录无效')
  const name = 'generation-' + previousImage.slice('sha256:'.length)
  let active = null
  try { active = fs.readlinkSync(pointer) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (active && (!SNAPSHOT.test(active) || !fs.existsSync(path.join(root, active, 'assets')))) {
    throw Error('原前端静态资源留存未通过核对')
  }
  // A failed candidate may have created a container without completing cutover.
  // Keep serving the last successfully captured predecessor during forward repair.
  if (active === name || (installed && installed !== previousImage) || (!installed && active)) return

  const identity = execFileSync('docker', ['inspect', '-f', '{{.Image}} {{index .Config.Labels "com.docker.compose.service"}}', container],
    { encoding: 'utf8', timeout: 5000 }).trim()
  if (identity !== `${previousImage} frontend`) throw Error('留存来源不是本次切换前实际的前端容器')
  const stage = path.join(root, '.staging')
  // server-update.sh holds the deployment lock for this entire sequence.
  if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true })
  fs.mkdirSync(stage, { mode: 0o700 })
  const assets = path.join(stage, 'assets')
  const nextPointer = path.join(stage, 'active')
  try {
    fs.mkdirSync(assets)
    execFileSync('docker', ['cp', `${container}:/usr/share/nginx/html/assets/.`, assets], { stdio: 'inherit', timeout: 15000 })
    const entries = fs.readdirSync(assets, { withFileTypes: true })
    let bytes = 0
    if (!entries.length) throw Error('原前端镜像没有可留存的静态资源')
    for (const entry of entries) {
      if (!entry.isFile() || !ASSET.test(entry.name)) throw Error('原前端包含非摘要资源或特殊文件')
      const file = path.join(assets, entry.name)
      const size = fs.statSync(file).size
      if (!size || (bytes += size) > SIZE_LIMIT) throw Error('原前端资源为空或超过留存容量')
      fs.chmodSync(file, 0o644)
    }
    fs.chmodSync(assets, 0o755)
    // Move a complete snapshot into place. If a prior crash left an inactive
    // copy of this generation, remove only that exact task-owned generation.
    const snapshot = path.join(root, name)
    if (fs.existsSync(snapshot)) fs.rmSync(snapshot, { recursive: true })
    const stagedSnapshot = path.join(stage, 'generation')
    fs.mkdirSync(stagedSnapshot, { mode: 0o755 })
    fs.chmodSync(stagedSnapshot, 0o755)
    fs.renameSync(assets, path.join(stagedSnapshot, 'assets'))
    fs.renameSync(stagedSnapshot, snapshot)
    fs.symlinkSync(name, nextPointer)
    fs.renameSync(nextPointer, pointer)
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && SNAPSHOT.test(entry.name) && entry.name !== name) {
        fs.rmSync(path.join(root, entry.name), { recursive: true })
      }
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
  console.log(`==> 已保留上一版前端资源：${previousImage}，供旧标签读取`)
}

if (require.main === module) {
  const [action, root, currentImage, previousImage, container] = process.argv.slice(2)
  try {
    saveHistory({ root, action, currentImage, previousImage, container })
  } catch (error) {
    console.error(`!! 前端版本资源留存失败：${error.message}`)
    process.exitCode = 1
  }
}
