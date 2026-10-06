#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const { createHash } = require('node:crypto')
// electron-userland release, independently matches app-builder-lib 26.15.3 toolsets/windows.js.
const NSIS_SHA256 = '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa'
function verifyNsisArchive(file, expected = NSIS_SHA256) {
  const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (actual !== expected) throw Error('NSIS archive SHA256 mismatch; extraction is forbidden')
  return actual
}
if (require.main === module) {
  try { verifyNsisArchive(process.argv[2]); console.log('NSIS archive integrity verified') }
  catch (error) { console.error('::error::' + error.message); process.exitCode = 1 }
}
module.exports = { verifyNsisArchive, NSIS_SHA256 }
