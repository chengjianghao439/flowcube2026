#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const configPath = path.join(root, 'deploy', 'production.json')

if (!fs.existsSync(configPath)) {
  console.error(`Missing deploy config: ${configPath}`)
  process.exit(1)
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

function readByPath(target, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), target)
}

const requestedPath = process.argv[2]

if (!requestedPath) {
  console.log(JSON.stringify(config, null, 2))
  process.exit(0)
}

const value = readByPath(config, requestedPath)
if (value === undefined) {
  console.error(`Missing deploy config key: ${requestedPath}`)
  process.exit(1)
}

if (typeof value === 'object') {
  console.log(JSON.stringify(value))
} else {
  console.log(String(value))
}
