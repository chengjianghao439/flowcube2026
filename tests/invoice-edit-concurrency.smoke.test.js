#!/usr/bin/env node
'use strict'

/**
 * 发票编辑的乐观锁回归（2026-09-27，迁移 263）。
 *
 * 命题（业务语义）：
 *   ① **并发编辑同一张发票** ⇒ 恰好一个成功、另一个 409 `INVOICE_CONCURRENT_MODIFIED`；
 *      最终值 = 成功者的那份，**不会**出现"两次都成功、后者静默覆盖前者"。
 *   ② **缺版本号** ⇒ 400 `INVOICE_REVISION_REQUIRED`（明确要求，而不是悄悄放过）。
 *   ③ 成功编辑后 `revision` **+1**；用**新** revision 可以继续编辑（顺序编辑不受影响）。
 *   ④ 这两件事**别混称**：`status` CAS 只说明"这张票当前可编辑"，`revision` 才说明
 *      "你手里那份是不是最新的"——本条测试保护的正是后者。
 *
 * 必须跑在显式隔离库：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-repro-downloads node tests/invoice-edit-concurrency.smoke.test.js
 */

const { createLogger, prepareSmokeContext, dbQuery, login, randomRef } = require('./helpers/smokeTestKit')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { http, pool } = ctx
  const created = []
  let token = null

  const mkInvoice = async (label) => {
    const mk = await http.post('/api/accounting/invoices', {
      token,
      json: {
        invoiceType: 2, invoiceCode: 'EDIT-C', invoiceNo: `E${randomRef(label).slice(0, 12)}`,
        partyName: '并发编辑客户', amountNoTax: round2(1000 / 1.13), taxRate: 0.13,
        taxAmount: round2(1000 - 1000 / 1.13), amountWithTax: 1000, invoiceDate: '2026-08-09',
        remark: '初始',
      },
    })
    const id = Number(mk.data?.data?.id)
    if (!Number.isInteger(id)) throw new Error(`建票失败: ${JSON.stringify(mk.data)}`)
    created.push(id)
    return id
  }
  const put = (id, amount, remark, revision) => http.put(`/api/accounting/invoices/${id}`, {
    token,
    json: {
      amountWithTax: amount, amountNoTax: round2(amount / 1.13), taxAmount: round2(amount - amount / 1.13),
      remark, ...(revision === undefined ? {} : { revision }),
    },
  })
  const revOf = async (id) => {
    const [r] = await dbQuery(pool, 'SELECT revision FROM fin_invoices WHERE id=?', [id])
    return Number(r?.revision)
  }

  try {
    const loginRes = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    token = loginRes.token
    if (!token) throw new Error('登录失败')

    // ① 并发编辑：确定性地一个成功、一个 409
    {
      const id = await mkInvoice('RACE')
      const rev = await revOf(id)
      const [ra, rb] = await Promise.all([
        put(id, 2000, '甲改', rev),
        put(id, 3000, '乙改', rev),   // 同一个 revision ⇒ 必有一个过期
      ])
      const codes = [ra.status, rb.status].sort((a, b) => a - b)
      const conflict = [ra, rb].find(r => r.status === 409)
      log.assert(
        '★ 并发编辑同一发票：恰好一个成功、另一个 409（不再"两次都成功、后者静默覆盖"）',
        codes[0] === 200 && codes[1] === 409,
        `状态=${codes.join('/')} 码=${conflict?.data?.code ?? '-'} 消息=${conflict?.message ?? '-'}`,
      )
      log.assert(
        '★ 冲突用明确错误码 INVOICE_CONCURRENT_MODIFIED',
        conflict?.data?.code === 'INVOICE_CONCURRENT_MODIFIED',
        String(conflict?.data?.code),
      )
      const winnerAmount = ra.status === 200 ? 2000 : 3000
      const winnerRemark = ra.status === 200 ? '甲改' : '乙改'
      const [row] = await dbQuery(pool, 'SELECT amount_with_tax, remark, revision FROM fin_invoices WHERE id=?', [id])
      log.assert(
        '★ 最终值等于**成功者**那一次（失败方分文未落）',
        Number(row.amount_with_tax) === winnerAmount && row.remark === winnerRemark,
        `金额=${row.amount_with_tax} 备注=${row.remark}（期望 ${winnerAmount}/${winnerRemark}）`,
      )
      log.assert('★ 成功一次后 revision 恰好 +1', Number(row.revision) === rev + 1, `revision=${row.revision}（原 ${rev}）`)
    }

    // ② 缺版本号 ⇒ 明确拒绝（不放行、也不静默）
    {
      const id = await mkInvoice('NOREV')
      const r = await put(id, 1500, '缺版本')
      log.assert(
        '★ 缺 revision 的编辑被明确拒绝（400 INVOICE_REVISION_REQUIRED）',
        r.status === 400 && r.data?.code === 'INVOICE_REVISION_REQUIRED',
        `status=${r.status} code=${r.data?.code}`,
      )
      const [row] = await dbQuery(pool, 'SELECT amount_with_tax FROM fin_invoices WHERE id=?', [id])
      log.assert('★ 被拒后金额未被改动', Number(row.amount_with_tax) === 1000, `金额=${row.amount_with_tax}`)
    }

    // ③ 前端真正依赖的**读契约**：GET 详情/列表要返回 revision，且原样回传才能成功
    {
      const id = await mkInvoice('READ')
      const det = await http.get(`/api/accounting/invoices/${id}`, { token })
      const rev = det.data?.data?.revision
      log.assert('★ GET 详情返回 revision（前端读取版本所依赖的契约）', Number.isInteger(Number(rev)), `revision=${rev}`)

      const ok = await put(id, 1800, '用详情返回的版本提交', Number(rev))
      log.assert('★ 用 GET 返回的 revision 原样提交可成功', ok.status === 200, `status=${ok.status} msg=${ok.message}`)

      const stale = await put(id, 1900, '再用同一个已过期的版本提交', Number(rev))
      log.assert(
        '★ 再用同一个（已过期）版本提交被 409 拒绝（能拿到"先刷新再重试"的正确语义）',
        stale.status === 409 && stale.data?.code === 'INVOICE_CONCURRENT_MODIFIED',
        `status=${stale.status} code=${stale.data?.code}`,
      )

      const list = await http.get('/api/accounting/invoices?page=1&pageSize=5', { token })
      const first = list.data?.data?.list?.[0]
      log.assert(
        '★ GET 列表每行也带 revision（列表→编辑同一读契约）',
        first == null || Number.isInteger(Number(first.revision)),
        `首行 revision=${first?.revision}`,
      )
    }

    // ④ 顺序编辑（用最新 revision）不受影响
    {
      const id = await mkInvoice('SEQ')
      const r1 = await put(id, 1600, '第一次', await revOf(id))
      const r2 = await put(id, 1700, '第二次', await revOf(id))
      log.assert(
        '★ 顺序编辑（每次带最新 revision）两次都成功',
        r1.status === 200 && r2.status === 200,
        `status=${r1.status}/${r2.status}`,
      )
      const [row] = await dbQuery(pool, 'SELECT amount_with_tax, revision FROM fin_invoices WHERE id=?', [id])
      log.assert(
        '★ 两次成功 ⇒ revision 累加 2、值为最后一次',
        Number(row.amount_with_tax) === 1700 && Number(row.revision) === 3,
        `金额=${row.amount_with_tax} revision=${row.revision}`,
      )
    }
  } finally {
    for (const id of created) {
      try { await pool.query('DELETE FROM fin_invoices WHERE id=?', [id]) } catch (e) { console.error(`[清理告警] ${e.message}`) }
    }
    try {
      const [left] = created.length
        ? await dbQuery(pool, 'SELECT COUNT(*) n FROM fin_invoices WHERE id IN (?)', [created])
        : [{ n: 0 }]
      log.assert('★ 本轮自建发票已全部清除（按 ID 复查为 0）', Number(left.n) === 0, `残留=${left.n}（本轮建 ${created.length} 张）`)
    } catch (e) {
      log.assert('★ 清理复查本身未抛错', false, e.message)
    }
    await ctx.close()
  }

  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('[INVOICE-EDIT-CONCURRENCY] 未捕获异常：', e); process.exit(1) })
