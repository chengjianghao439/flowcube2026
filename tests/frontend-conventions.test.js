#!/usr/bin/env node
'use strict'

/**
 * 前端命名与呈现口径的**结构**守卫（2026-09-20）。
 *
 * 背景：`docs/frontend-pda-conventions.md` 里的命名约定（菜单名 = 工作区标签 = 页面标题、
 * 标签不超过 7 个汉字、带日期的查询弹窗必须能重置回本页默认窗口、纯图标按钮必须有可读名称）
 * 一直靠人工核对。人工核对的问题是**做过一次就不再有下一次**——本轮手工全量核对时只发现
 * 「商品分类」一处标题不一致，但那只能证明这一次干净，不能证明下次不会脏。
 *
 * 这些约定都有可机械验证的结构特征，所以固化成守卫：
 *   1. 路由标题不超过 7 个汉字（标签栏宽 7rem + truncate，超了直接看不见）；
 *   2. `nav.label` 必须等于 `routeDefinitions.title`（菜单名与标签名同源，覆盖了就会不一致）；
 *   3. 静态 `PageHeader title` 必须等于该路由的标题；
 *   4. 带日期字段的 `*QueryDialog` 必须支持 `resetValues`（或已用 `clearValue` 表达同义）；
 *   5. `<Button>` 只放一个图标时必须带 `aria-label` 或 `title`。
 *
 * 反向验证（每一条都试过会失败）：
 *   - 把某个路由标题改成 8 个汉字 / 给 nav 加一个不同的 label；
 *   - 把 `/categories` 的 PageHeader title 改回「商品分类管理」；
 *   - 删掉 SaleQueryDialog 的 resetValues 传参；
 *   - 去掉某个图标按钮的 aria-label。
 *
 * 运行：node --test tests/frontend-conventions.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'frontend/src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const MAX_TAB_HAN = 7
const hanCount = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length

function walk(dir, filter, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, filter, out)
    else if (filter(e.name)) out.push(p)
  }
  return out
}

/** 从 routeDefinitions.ts 粗解析出 { path, title, componentKey, navLabel } 列表 */
function routeEntries() {
  const src = read('router/routeDefinitions.ts')
  const out = []
  for (const block of src.split(/\n\s{2}\{\n/)) {
    const p = block.match(/path:\s*'([^']+)'/)
    const t = block.match(/title:\s*'([^']+)'/)
    if (!p || !t) continue
    const c = block.match(/componentKey:\s*'(\w+)'/)
    const nav = block.match(/nav:\s*\{[\s\S]{0,200}?label:\s*'([^']+)'/)
    out.push({ path: p[1], title: t[1], componentKey: c ? c[1] : null, navLabel: nav ? nav[1] : null })
  }
  return out
}

/** componentKey -> 页面源码 */
function keyToSource() {
  const reg = read('router/routeRegistry.ts')
  const map = new Map()
  for (const m of reg.matchAll(/(\w+):\s*lazy\(\(\)\s*=>\s*import\('@\/([^']+)'\)\)/g)) {
    const [, key, rel] = m
    const candidates = [`${rel}.tsx`, `${rel}/index.tsx`]
    const hit = candidates.find((c) => fs.existsSync(path.join(SRC, c)))
    if (hit) map.set(key, { file: hit, src: read(hit) })
  }
  return map
}

test('路由标题不超过 7 个汉字（标签栏 7rem + truncate，超了看不见）', () => {
  const bad = routeEntries()
    .filter((e) => hanCount(e.title) > MAX_TAB_HAN)
    .map((e) => `${e.title}（${hanCount(e.title)} 字，${e.path}）`)
  assert.deepEqual(bad, [], `这些标签名会被截断，请改短：${bad.join('、')}`)
})

test('菜单名必须等于路由标题（否则菜单与标签栏会各说各话）', () => {
  const bad = routeEntries()
    .filter((e) => e.navLabel && e.navLabel !== e.title)
    .map((e) => `${e.path}：菜单「${e.navLabel}」≠ 标签「${e.title}」`)
  assert.deepEqual(bad, [], bad.join('；'))
})

test('页面标题必须等于路由标题', () => {
  const keys = keyToSource()
  const bad = []
  for (const e of routeEntries()) {
    if (!e.componentKey || !keys.has(e.componentKey)) continue
    const { file, src } = keys.get(e.componentKey)
    // 只看静态字符串标题；模板串/变量标题（详情页用单号）不在此列
    const m = src.match(/<PageHeader\b[\s\S]{0,500}?title=(?:"([^"]+)"|'([^']+)')/)
    if (!m) continue
    const pageTitle = m[1] || m[2]
    if (pageTitle !== e.title) bad.push(`${file}：「${pageTitle}」≠ 路由「${e.title}」`)
  }
  assert.deepEqual(bad, [], `菜单名、工作区标签、页面标题三者必须同名：\n  ${bad.join('\n  ')}`)
})

test('带日期筛选的查询弹窗必须能重置回本页默认口径', () => {
  // 关键：要查**调用方传没传**，不是查弹窗文件里有没有这个 prop——
  // 第一版就是查的定义，于是把页面上的 resetValues 删掉守卫照样通过（反向验证抓到的）。
  const bad = []
  for (const f of walk(SRC, (n) => /\.tsx$/.test(n) && !/\.test\./.test(n))) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/<(\w*QueryDialog)\b([\s\S]{0,600}?)\/>/g)) {
      const [, name, props] = m
      // 找这个弹窗组件的定义文件
      const defFile = walk(SRC, (n) => n === `${name}.tsx` && !/\.test\./.test(n))[0]
      if (!defFile) continue
      const defSrc = fs.readFileSync(defFile, 'utf8')
      const hasDate = /\bstartDate\b/.test(defSrc) || /\bendDate\b/.test(defSrc)
      if (!hasDate) continue
      // PaymentQueryDialog 早已用 clearValue 表达同一语义（账款页默认跨日期看未结清），沿用不改
      if (/resetValues|clearValue/.test(props) || /clearValue/.test(defSrc)) continue
      const line = src.slice(0, m.index).split('\n').length
      bad.push(`${path.relative(SRC, f)}:${line} <${name}> 没传 resetValues（该弹窗有日期筛选，重置会跳成「今天起」）`)
    }
  }
  assert.deepEqual(bad, [], `这些列表页的「重置」与打开弹窗看到的范围会对不上：\n  ${bad.join('\n  ')}`)
})

test('只放一个图标的按钮必须有可读名称', () => {
  // 两个坑都在反向验证里踩过：
  //   1. 单行正则一处都扫不到——真实的图标按钮大多跨行书写，守卫会变成空转；
  //   2. 把 `{loading ? <Loader2/> : '保存'}` 剥掉花括号后误判成纯图标——按钮里只要
  //      出现中文（哪怕在三元里）就算读得出来。
  const bad = []
  for (const f of walk(SRC, (n) => /\.tsx$/.test(n) && !/\.test\./.test(n))) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/<Button\b([^>]*)>([\s\S]{0,300}?)<\/Button>/g)) {
      const [full, attrs, inner] = m
      if (!/<[A-Z]\w+/.test(inner)) continue           // 没有图标，不是图标按钮
      if (/[\u4e00-\u9fff]/.test(inner)) continue      // 按钮内有中文 → 读得出来
      if (/aria-label|title=/.test(attrs + inner)) continue
      const line = src.slice(0, m.index).split('\n').length
      bad.push(`${path.relative(SRC, f)}:${line}  ${full.replace(/\s+/g, ' ').slice(0, 80)}`)
    }
  }
  assert.deepEqual(bad, [], `纯图标按钮读不出是干什么的，请补 aria-label 或 title：\n  ${bad.join('\n  ')}`)
})
