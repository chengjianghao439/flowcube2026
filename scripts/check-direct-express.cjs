#!/usr/bin/env node
'use strict'
// 仅检查本地配置，不访问平台、不创建运单、不输出凭据及月结号。
const path = require('node:path')
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../backend/.env'), quiet: true })
const { getWaybillCredential } = require('../backend/src/config/env')
const { credentials } = require('../backend/src/modules/logistics/carrier-adapters/direct-common')
const [platform, ref] = process.argv.slice(2)
if (!['sf', 'deppon'].includes(platform) || !ref) {
  console.error('用法：npm run check:direct-express -- sf sf_main（或 deppon deppon_main）')
  process.exitCode = 1
} else {
  try {
    const credential = getWaybillCredential(ref)
    credentials(credential, platform)
    if (platform === 'deppon') {
      credentials(credential, platform, true)
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(credential.orderPrefix || '')) throw new Error('请配置德邦分配的渠道单号前缀')
    }
    console.log(`${platform === 'sf' ? '顺丰' : '德邦'}凭据字段及官方地址校验通过，环境：${credential.mode === 'production' ? '正式' : '沙箱'}。未联网，仍需验证账号权限与真实回执。`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}
