#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const candidatePaths = [
  process.env.FLOWCUBE_DEPLOY_CONFIG,
  path.join(root, 'deploy', 'production.local.json'),
  path.join(root, 'deploy', 'production.json'),
].filter(Boolean)

const configPath = candidatePaths.find((candidate) => fs.existsSync(path.resolve(candidate)))

if (!configPath) {
  console.error(
    `Missing deploy config. Set FLOWCUBE_DEPLOY_CONFIG or create ${path.join(root, 'deploy', 'production.local.json')} from deploy/production.example.json`,
  )
  process.exit(1)
}

const resolvedConfigPath = path.resolve(configPath)
const config = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf8'))

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
