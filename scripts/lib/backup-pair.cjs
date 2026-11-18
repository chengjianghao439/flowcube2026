#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const STAMP = /^\d{8}_\d{6}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const validTime = value => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value))
const TOKEN = /^[A-Za-z0-9_.+-]+$/
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/

const expectedFiles = stamp => ({
  database: `flowcube_${stamp}.sql.gz`,
  assistant: `assistant/flowcube_${stamp}.json.gz`,
})

async function archiveIdentity(root, relative) {
  const file = path.join(root, relative)
  const before = fs.lstatSync(file)
  if (!before.isFile() || before.size === 0) throw Error('备份目标必须是非空普通文件')
  const hash = createHash('sha256')
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes)
  const after = fs.lstatSync(file)
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('备份文件在核对时发生改变')
  return { file: relative, bytes: before.size, sha256: hash.digest('hex') }
}

function verifyShape(receipt, stamp) {
  const mysql = receipt?.database
  const assistant = receipt?.assistant
  if (receipt?.formatVersion !== 1 || receipt.stamp !== stamp || !UUID.test(mysql?.uuid || '') ||
      !validTime(mysql.snapshotStartedAt) || !validTime(mysql.dumpFinishedAt) ||
      !TOKEN.test(mysql.version || '') || !TOKEN.test(mysql.schema || '') ||
      !TOKEN.test(assistant?.volume || '') || !IMAGE_ID.test(assistant.imageId || '') ||
      !validTime(assistant.capturedAt) || !Number.isSafeInteger(assistant.files) || assistant.files < 0 ||
      Date.parse(assistant.capturedAt) > Date.parse(mysql.snapshotStartedAt) ||
      Date.parse(mysql.snapshotStartedAt) > Date.parse(mysql.dumpFinishedAt)) {
    throw Error('成对备份回执来源或时间无效')
  }
}

async function main() {
  const [mode, root, stamp] = process.argv.slice(2)
  if (!root || !STAMP.test(stamp || '')) throw Error('需要显式备份目录和时间戳')
  const files = expectedFiles(stamp)
  const receiptFile = path.join(root, 'paired', `flowcube_${stamp}.json`)
  if (mode === 'write') {
    const [uuid, version, schema, snapshotStartedAt, dumpFinishedAt, volume, imageId, summary] = process.argv.slice(5)
    const { capturedAt, files: fileCount } = JSON.parse(summary)
    const receipt = {
      formatVersion: 1, stamp,
      database: { uuid, version, schema, snapshotStartedAt, dumpFinishedAt, ...await archiveIdentity(root, files.database) },
      assistant: { volume, imageId, capturedAt, files: fileCount, ...await archiveIdentity(root, files.assistant) },
    }
    verifyShape(receipt, stamp)
    const pending = receiptFile + '.part'
    fs.writeFileSync(pending, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    fs.renameSync(pending, receiptFile)
  } else if (mode === 'verify') {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
    verifyShape(receipt, stamp)
    for (const [key, file] of Object.entries(files)) {
      const actual = await archiveIdentity(root, file)
      if (receipt[key].file !== file || receipt[key].sha256 !== actual.sha256 || receipt[key].bytes !== actual.bytes) {
        throw Error('备份文件与成对回执摘要或大小不符')
      }
    }
    console.log('成对备份文件与回执一致')
  } else {
    throw Error('需要 write 或 verify')
  }
}

main().catch(error => {
  console.error(error.code ? '备份回执文件操作失败' : error.message)
  process.exitCode = 1
})
