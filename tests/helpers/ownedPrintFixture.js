'use strict'

/**
 * 自包含的「箱贴打印前提」夹具（批 C4 静态补齐，2026-09-29）。
 *
 * 为什么需要它：C2 起 `finishPackage` 会调 `printJobs.assertQueueReady({ jobType: 'package_label' })`，
 * 而 `print-jobs.command.js` 对 `package_label` 用 `requireBinding=true, allowBindingFallback=false`：
 * `resolvePrinterForJob` **先查用途绑定**（`print-dispatch.js` 的 `fetchBindingCandidates` 命中的是
 * 「**本仓** `b.warehouse_id = <任务仓>`」或「**公司级** `b.warehouse_id = 0`」的 `package_label` 绑定，
 * 且本仓优先）；**没有候选时**才按 `requireBinding` **拒绝回退**到未绑定的默认打印机 → 抛
 * 409 `PRINT_BINDING_MISSING`。
 *
 * 因此本夹具的用途是：在**没有任何有效 `package_label` 用途绑定的环境**里，为**本套**自包含地
 * 在**本仓**建立一条用途绑定。（注意区分：**打印机自身**的 `printers.warehouse_id IS NULL` 与
 * **绑定**的 `warehouse_id` 是两回事；公司级绑定 `warehouse_id=0` 是**允许**的。）
 *
 * 约定（**不改共享 smokeTestKit 的全局状态与清理语义**；`http` 一律来自 smokeTestKit，用 `http.delete`）：
 *   1. 进入前读取并记录本仓原有 package_label 绑定；**读失败即抛**，不静默当成"原本没有绑定"；
 *   2. 自建本套自有打印机（带工作站 clientId）并绑到本套仓库；
 *   3. 收尾**逐项尽力执行并聚合失败**，前一项异常不跳过后续项；
 *   4. 归属判定以**当前 GET 到的绑定**为准（不靠"请求是否抛错"推断）——本套自建则恢复原值/删除，
 *      **别人的指向一律保留**并记为收尾失败，绝不覆盖；
 *   5. 停用自建打印机后 **GET 该打印机断言 `status=0`**；绑定最终态断言到**原值或无绑定**；
 *      任一项未净一律 `assert` **真失败**（不只 warn）；
 *   6. 不物理删除任何打印历史（job / 回执保留）。
 *
 * 用法（`login` 之后 acquire，套件 `finally` 里 release）：
 *   const { acquireOwnPackageLabelPrinter, releaseOwnPackageLabelPrinter } =
 *     require('./helpers/ownedPrintFixture')
 *   let ownPrint = null
 *   ownPrint = await acquireOwnPackageLabelPrinter({ http, token, warehouseId: warehouse.id, assert, randomRef })
 *   // ...
 *   if (ownPrint) await releaseOwnPackageLabelPrinter(ownPrint, { http, token, assert })
 */

/**
 * 读取本仓的 package_label 绑定。**响应必须成功且 `routes` 是数组**，否则抛错
 * —— 绝不把「读不到」当成「原本没有绑定」（那会导致收尾误删别人的配置）。
 */
async function readPackageLabelBinding(http, token, warehouseId, assert) {
  const res = await http.get('/api/printer-bindings', { token })
  if (assert) assert.ok(res.ok, `读取 printer-bindings 失败：${res.status}`)
  else if (!res.ok) throw new Error(`读取 printer-bindings 失败：${res.status}`)
  const routes = res?.data?.data?.routes
  if (!Array.isArray(routes)) throw new Error('printer-bindings 响应缺少 routes 数组，不能据此判断原绑定')
  const row = routes.find(r => Number(r.warehouse_id) === Number(warehouseId) && r.print_type === 'package_label')
  return row?.printer_id != null ? Number(row.printer_id) : null
}

/**
 * 处理本仓 package_label 的归属（acquire 失败与 release 共用）：
 *   · 当前**不是**本套自建：若是原值 ⇒ 无须动作；否则说明是**他人的**指向 ⇒ 保留不覆盖并记问题；
 *   · 当前**是**本套自建（含「bind 已在后台生效但响应丢失」的情形）：有原值则恢复，无则删除。
 */
async function settleOwnBinding(http, token, wh, printerId, prevPrinterId, assert) {
  const problems = []
  try {
    const nowId = await readPackageLabelBinding(http, token, wh, assert)
    if (nowId !== printerId) {
      if (nowId !== prevPrinterId) {
        problems.push(`本仓 package_label 当前指向 ${nowId ?? '（无）'}，既非本套自建 ${printerId} 也非原值 ${prevPrinterId ?? '（无）'}；保留现状不覆盖`)
      }
      return problems // 无须恢复
    }
    if (prevPrinterId) {
      const r = await http.put('/api/printer-bindings/package_label', { token, json: { printerId: prevPrinterId, warehouseId: wh } })
      if (!r.ok) problems.push(`恢复原 package_label 绑定失败：${r.status}`)
    } else {
      const u = await http.delete(`/api/printer-bindings/package_label?warehouseId=${wh}`, { token })
      if (!u.ok) problems.push(`删除本套 package_label 绑定失败：${u.status}`)
    }
  } catch (e) { problems.push(`绑定归属处理异常：${e.message}`) }
  return problems
}

/** 停用自建打印机并回读断言 status=0；返回问题列表（不抛）。 */
async function retireOwnPrinter(http, token, printerId) {
  const problems = []
  try {
    const off = await http.put(`/api/printers/${printerId}`, { token, json: { status: 0 } })
    if (!off.ok) problems.push(`停用自建打印机失败：${off.status}`)
    const got = await http.get(`/api/printers/${printerId}`, { token })
    if (!got.ok) problems.push(`回读自建打印机失败：${got.status}`)
    else if (Number(got.data?.data?.status) !== 0) problems.push(`自建打印机未停用，status=${got.data?.data?.status}`)
  } catch (e) { problems.push(`停用自建打印机异常：${e.message}`) }
  return problems
}

async function acquireOwnPackageLabelPrinter({ http, token, warehouseId, assert, randomRef }) {
  const wh = Number(warehouseId)
  assert.ok(Number.isInteger(wh) && wh > 0, 'acquireOwnPackageLabelPrinter 需要正整数 warehouseId')

  const prevPrinterId = await readPackageLabelBinding(http, token, wh, assert)

  const clientId = `own-print-${randomRef('C')}`
  const code = `OWN-PRN-${String(randomRef('P')).replace(/[^A-Za-z0-9]/g, '').slice(-6)}`

  let printerId = null
  try {
    const created = await http.post('/api/printers', {
      token,
      json: { name: `本套自建标签机${code.slice(-4)}`, code, type: 1, warehouseId: wh, clientId },
    })
    assert.ok(created.ok, `自备打印机失败：${created.status} ${JSON.stringify(created.data).slice(0, 200)}`)
    printerId = Number(created.data?.data?.id)
    assert.ok(Number.isInteger(printerId) && printerId > 0, '自备打印机应返回 id')

    const bound = await http.put('/api/printer-bindings/package_label', { token, json: { printerId, warehouseId: wh } })
    assert.ok(bound.ok, `绑定 package_label 失败：${bound.status} ${JSON.stringify(bound.data).slice(0, 200)}`)
  } catch (e) {
    // 失败收尾：**按当前 GET 的归属**决定（bind 可能已在后台生效但响应丢失），
    // 再停用/回读；聚合问题并**保留原错误**，不吞掉任何 cleanup 失败。
    const problems = []
    if (printerId) {
      problems.push(...await settleOwnBinding(http, token, wh, printerId, prevPrinterId, assert))
      problems.push(...await retireOwnPrinter(http, token, printerId))
    }
    throw new Error(`${e.message}｜自备收尾${problems.length ? `未净：${problems.join('；')}` : '已净'}`)
  }

  return { printerId, clientId, warehouseId: wh, prevPrinterId }
}

async function releaseOwnPackageLabelPrinter(own, { http, token, assert }) {
  if (!own) return
  const { printerId, warehouseId: wh, prevPrinterId } = own
  const problems = []

  problems.push(...await settleOwnBinding(http, token, wh, printerId, prevPrinterId, assert))
  problems.push(...await retireOwnPrinter(http, token, printerId))

  // 最终态：本仓该用途必须回到原值（原值存在时）或不再指向本套自建打印机
  try {
    const afterId = await readPackageLabelBinding(http, token, wh, assert)
    if (prevPrinterId) {
      if (afterId !== prevPrinterId) problems.push(`收尾后本仓 package_label 应为原值 ${prevPrinterId}，实际 ${afterId ?? '（无）'}`)
    } else if (afterId != null) {
      // 原本无绑定 ⇒ 最终必须也是无绑定：此处出现任何指向（本套自建、或他人新指向）都计失败。
      //（他人新指向在 settleOwnBinding 已保留并记过问题，这里再兜一层最终态。）
      problems.push(`收尾后本仓 package_label 应为无绑定，实际 ${afterId}`)
    }
  } catch (e) { problems.push(`收尾核对绑定异常：${e.message}`) }

  assert.equal(problems.length, 0, `自建打印前提收尾未净：${problems.join('；')}`)
}

module.exports = { acquireOwnPackageLabelPrinter, releaseOwnPackageLabelPrinter, readPackageLabelBinding }
