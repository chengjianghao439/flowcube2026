'use strict'

const fs = require('node:fs')
const path = require('node:path')
const ts = require('../../frontend/node_modules/typescript')

function parse(source, file = 'source.js') {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
}

function visit(root, callback) {
  function walk(node) {
    if (callback(node) !== false) ts.forEachChild(node, walk)
  }
  walk(root)
}

function owner(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent) || ts.isSourceFile(parent)) return parent
  }
}

function functionName(fn) {
  return fn.name?.getText() || fn.parent?.name?.getText() || '(匿名函数)'
}

function literals(node) {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.getText().slice(1, -1)
}

function callName(node) {
  return ts.isCallExpression(node) ? node.expression.name?.text ?? node.expression.text : undefined
}

function filesUnder(dir, accept) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(name, accept) : accept(entry.name) ? [name] : []
  })
}

module.exports = { ts, parse, visit, owner, functionName, literals, callName, filesUnder }
