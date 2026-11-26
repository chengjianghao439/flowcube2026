'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

// Resolve local imports through the same fixture so transitive dependencies also use its database double.
function loader(overrides) {
  const cache = new Map()
  function load(file, expose) {
    file = path.resolve(file)
    if (overrides.has(file)) return overrides.get(file)
    if (cache.has(file)) return cache.get(file).exports
    const instance = new Module(file, module)
    instance.filename = file
    instance.paths = Module._nodeModulePaths(path.dirname(file))
    cache.set(file, instance)
    const nativeRequire = instance.require.bind(instance)
    instance.require = name => name.startsWith('.')
      ? load(require.resolve(path.resolve(path.dirname(file), name)))
      : nativeRequire(name)
    const source = fs.readFileSync(file, 'utf8')
    instance._compile(expose ? source + '\nmodule.exports = ' + expose : source, file)
    return instance.exports
  }
  return load
}

module.exports = { loader }
