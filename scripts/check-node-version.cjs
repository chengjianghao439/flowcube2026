'use strict'

const { engines: { node: required } } = require('../package.json')
const minimum = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(required)
if (!minimum) throw new Error('项目 Node 版本范围必须使用 ^主版本.次版本.修订号')

const [requiredMajor, requiredMinor, requiredPatch] = minimum.slice(1).map(Number)
const [major, minor, patch] = process.versions.node.split('.').map(Number)
if (major !== requiredMajor || minor < requiredMinor || (minor === requiredMinor && patch < requiredPatch)) {
  console.error(`需要 Node ${required}，当前为 ${process.versions.node}。请按 .nvmrc 切换或加载项目开发环境。`)
  process.exitCode = 1
}
