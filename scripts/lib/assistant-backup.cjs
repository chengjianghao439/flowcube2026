#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { createHash } = require('node:crypto')

const BYTES_LIMIT = 256 * 1024 * 1024
const FILE_LIMIT = 128 * 1024 * 1024
const COUNT_LIMIT = 32768
const INPUT_LIMIT = BYTES_LIMIT * 2
const RECORD_LIMIT = Math.ceil(FILE_LIMIT / 3) * 4 + 1024
const digest = data => createHash('sha256').update(data).digest('hex')
const safeName = name => typeof name === 'string' && name.length <= 512 &&
  name.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')
const pendingFile = name => name === 'tasks.json.tmp' || /^tasks-v2\/\.task-[a-f0-9-]{36}\.tmp$/.test(name)

async function writeRecord(record) {
  if (!process.stdout.write(JSON.stringify(record) + '\n')) await once(process.stdout, 'drain')
}

async function readTree(root, emit = false) {
  if (!fs.lstatSync(root).isDirectory()) throw Error('持久目录身份无效')
  const files = []
  let bytes = 0
  async function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name
      if (pendingFile(name) && entry.isFile()) continue
      if (!safeName(name)) throw Error('持久目录有无法归档的文件名')
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(file, name + '/')
        continue
      }
      if (!entry.isFile()) throw Error('持久目录有符号链接或特殊文件')
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      let data
      try {
        const before = fs.fstatSync(fd)
        if (!before.isFile() || before.size + bytes > BYTES_LIMIT || before.size > FILE_LIMIT || files.length >= COUNT_LIMIT) {
          throw Error('持久目录超过归档限制')
        }
        data = Buffer.alloc(before.size)
        const read = fs.readSync(fd, data, 0, data.length, 0)
        const after = fs.fstatSync(fd)
        if (read !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
          throw Error('持久目录在归档期间发生改变')
        }
      } finally {
        fs.closeSync(fd)
      }
      bytes += data.length
      const meta = { name, bytes: data.length, sha256: digest(data) }
      files.push(meta)
      if (emit) await writeRecord({ ...meta, data: data.toString('base64') })
    }
  }
  await visit(root)
  return files.sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

async function snapshot(root) {
  await writeRecord({ formatVersion: 1 })
  const files = await readTree(root, true)
  const capturedAt = new Date().toISOString()
  if (JSON.stringify(await readTree(root)) !== JSON.stringify(files)) throw Error('持久目录在归档期间发生改变')
  await writeRecord({ capturedAt, files: files.length })
}

async function* records() {
  let size = 0
  let lineBytes = 0
  let chunks = []
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > INPUT_LIMIT) throw Error('小满归档过大')
    let start = 0
    let end
    while ((end = chunk.indexOf(10, start)) >= 0) {
      if (lineBytes + end - start > RECORD_LIMIT) throw Error('小满归档单条记录过大')
      chunks.push(chunk.subarray(start, end))
      let record
      try { record = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
        throw Error('小满归档 JSON 损坏')
      }
      yield record
      chunks = []
      lineBytes = 0
      start = end + 1
    }
    if (start < chunk.length) {
      lineBytes += chunk.length - start
      if (lineBytes > RECORD_LIMIT) throw Error('小满归档单条记录过大')
      chunks.push(chunk.subarray(start))
    }
  }
  if (chunks.length) throw Error('小满归档不完整')
}

function verifyFile(file, names) {
  if (!safeName(file?.name) || names.has(file.name) || typeof file.data !== 'string' ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > FILE_LIMIT) {
    throw Error('小满归档文件身份或大小无效')
  }
  const content = Buffer.from(file.data, 'base64')
  if (content.length !== file.bytes || content.toString('base64') !== file.data || digest(content) !== file.sha256) {
    throw Error('小满归档摘要校验失败')
  }
  return content
}

async function readArchive(stage) {
  const names = new Set()
  let bytes = 0
  let formatVersion
  let summary
  for await (const record of records()) {
    if (!formatVersion) {
      if (record?.formatVersion !== 1) throw Error('小满归档格式无效')
      formatVersion = record.formatVersion
    } else if (summary) {
      throw Error('小满归档末尾有额外记录')
    } else if (record?.capturedAt) {
      if (record.files !== names.size || !Number.isFinite(Date.parse(record.capturedAt))) throw Error('小满归档回执无效')
      summary = { formatVersion, capturedAt: record.capturedAt, files: names.size, bytes }
    } else {
      const content = verifyFile(record, names)
      if ((bytes += content.length) > BYTES_LIMIT || names.size >= COUNT_LIMIT) throw Error('小满归档超出限制')
      names.add(record.name)
      if (stage) {
        const file = path.join(stage, record.name)
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
        fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 })
      }
    }
  }
  if (!summary) throw Error('小满归档缺少结束回执')
  for (const name of names) {
    for (let parent = path.posix.dirname(name); parent !== '.'; parent = path.posix.dirname(parent)) {
      if (names.has(parent)) throw Error('小满归档目录与文件冲突')
    }
  }
  return { summary, names }
}

function restore(root, stage, names) {
  if (!fs.existsSync(root)) fs.mkdirSync(root, { mode: 0o700 })
  if (!fs.lstatSync(root).isDirectory() || fs.readdirSync(root).length) throw Error('恢复目标必须是独立空目录')
  for (const name of names) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    fs.copyFileSync(path.join(stage, name), target, fs.constants.COPYFILE_EXCL)
  }
}

async function main() {
  const [mode, root] = process.argv.slice(2)
  if (mode === 'snapshot' && root) { await snapshot(root); return }
  if (mode !== 'verify' && !(mode === 'restore' && root)) throw Error('用法：snapshot <目录> | verify | restore <独立空目录>')
  const stage = mode === 'restore' ? fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-assistant-restore-')) : null
  try {
    const { summary, names } = await readArchive(stage)
    if (stage) restore(root, stage, names)
    process.stdout.write(JSON.stringify(summary) + '\n')
  } finally {
    if (stage) fs.rmSync(stage, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.code ? '小满归档文件操作失败' : error.message)
  process.exitCode = 1
})
