'use strict'

const ts = require('../../frontend/node_modules/typescript')

function parse(source, fileName = 'copy.tsx') {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
}

// 从语法节点的 trivia 位置读注释，不能把 URL、正则和模板正文里的 // 当注释。
// 等长替换保留扫描器报告的原始行号与列偏移。
function stripComments(source, fileName) {
  const tree = parse(source, fileName)
  const ranges = new Map()
  function visit(node) {
    if (!ts.isJsxText(node)) {
      for (const range of [
        ...(ts.getLeadingCommentRanges(source, node.pos) || []),
        ...(ts.getTrailingCommentRanges(source, node.end) || []),
      ]) ranges.set(range.pos, range)
    }
    for (const child of node.getChildren(tree)) visit(child)
  }
  visit(tree)
  let result = source
  for (const { pos, end } of [...ranges.values()].sort((a, b) => b.pos - a.pos)) {
    result = result.slice(0, pos) + source.slice(pos, end).replace(/[^\r\n]/g, ' ') + result.slice(end)
  }
  return result
}

function textSpans(node, tree) {
  const spans = []
  function visit(current) {
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)
      || ts.isTemplateHead(current) || ts.isTemplateMiddle(current) || ts.isTemplateTail(current)
      || ts.isJsxText(current)) {
      spans.push({ text: current.text, index: current.getStart(tree) })
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return spans
}

function uiCopySpans(source, fileName) {
  const tree = parse(source, fileName)
  return textSpans(tree, tree).filter(span => /[\u4e00-\u9fff]/.test(span.text))
}

function appErrorSpans(source, fileName = 'copy.js') {
  const tree = parse(source, fileName)
  const spans = []
  function visit(node) {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'AppError' && node.arguments?.[0]) {
      spans.push(...textSpans(node.arguments[0], tree))
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return spans
}

module.exports = { stripComments, uiCopySpans, appErrorSpans }
