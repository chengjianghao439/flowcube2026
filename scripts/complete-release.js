#!/usr/bin/env node
'use strict'
function disabled() { throw Error('旧本机串联发版已停用；须由老大明确批准完整 SHA 并在 GitHub 手动触发，见 docs/manual-release.md') }
async function completeRelease() { disabled() }
const publishTagForCommit = disabled
if (require.main === module) { console.error(disabledMessage()); process.exitCode = 1 }
function disabledMessage() { try { disabled() } catch (error) { return error.message } }
module.exports = { completeRelease, publishTagForCommit }
