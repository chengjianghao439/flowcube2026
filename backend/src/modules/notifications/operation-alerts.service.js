// 独立只读查询：只提醒当前作业异常，不复用站内历史失败/经营计数。
async function buildOperationAlerts(exec, { printTimeoutMinutes = 10 } = {}) {
  const [prints] = await exec.query(
    `SELECT j.id, j.status, wt.task_no, p.barcode, wh.name AS warehouse_name,
            TIMESTAMPDIFF(MINUTE,j.updated_at,NOW()) AS idle_minutes,
            DATE_FORMAT(j.updated_at,'%Y-%m-%d %H:%i:%s') AS activity_token,
            COUNT(*) OVER () AS total_count
     FROM print_jobs j
     JOIN packages p ON p.id=j.ref_id AND j.ref_type='package'
     JOIN warehouse_tasks wt ON wt.id=p.warehouse_task_id
     JOIN inventory_warehouses wh ON wh.id=wt.warehouse_id
     WHERE wt.deleted_at IS NULL AND wt.task_type='sale_out' AND wt.status IN (5,6)
       AND wt.cancel_requested_at IS NULL AND wt.adjustment_requested_at IS NULL
       AND p.status IN (1,2)
       AND (j.status=3 OR (j.status IN (0,1) AND TIMESTAMPDIFF(MINUTE,j.updated_at,NOW())>=?))
       AND NOT EXISTS (
         SELECT 1 FROM print_jobs newer
         WHERE newer.ref_type='package' AND newer.ref_id=j.ref_id AND newer.id > j.id
       )
     ORDER BY j.updated_at DESC,j.id DESC LIMIT 50`,
    [printTimeoutMinutes],
  )
  // 最近作业包含任务更新时间和成功扫码；不能把创建很久但仍在扫码的波次报成停滞。
  const [waves] = await exec.query(
    `SELECT w.id,w.wave_no,w.status,wh.name AS warehouse_name,
            TIMESTAMPDIFF(MINUTE,
              GREATEST(w.updated_at,MAX(wt.updated_at),COALESCE(MAX(sl.scanned_at),w.updated_at)),NOW()) AS idle_minutes,
            DATE_FORMAT(GREATEST(w.updated_at,MAX(wt.updated_at),COALESCE(MAX(sl.scanned_at),w.updated_at)),
              '%Y-%m-%d %H:%i:%s') AS activity_token,
            COUNT(*) OVER () AS total_count
     FROM picking_waves w
     JOIN inventory_warehouses wh ON wh.id=w.warehouse_id
     JOIN picking_wave_tasks pwt ON pwt.wave_id=w.id
     JOIN warehouse_tasks wt ON wt.id=pwt.task_id AND wt.deleted_at IS NULL
     LEFT JOIN scan_logs sl ON sl.task_id=wt.id
     WHERE w.status IN (2,3)
     GROUP BY w.id,w.wave_no,w.status,wh.name,w.updated_at
     HAVING SUM(CASE WHEN wt.status IN (2,3) AND wt.cancel_requested_at IS NULL
                     AND wt.adjustment_requested_at IS NULL THEN 1 ELSE 0 END)>0
       AND idle_minutes >= CASE WHEN w.status=2 THEN 480 ELSE 240 END
     ORDER BY activity_token DESC,w.id DESC LIMIT 50`,
  )
  return [
    ...prints.map(r => ({ key: 'print:' + r.id, fingerprint: r.status + ':' + r.activity_token,
      kind: 'print', total: Number(r.total_count), title: Number(r.status) === 3 ? '出库打印失败' : '出库打印排队超时',
      documentNo: r.task_no, warehouse: r.warehouse_name, minutes: Number(r.idle_minutes), barcode: r.barcode,
      action: '系统 → 条码打印查询 → 出库条码，用箱码查找并核对/补打',
      path: '/settings/barcode-print-query?category=outbound&keyword=' + encodeURIComponent(r.barcode) })),
    ...waves.map(r => ({ key: 'wave:' + r.id, fingerprint: r.status + ':' + r.activity_token,
      kind: 'wave', total: Number(r.total_count), title: Number(r.status) === 2 ? '拣货波次停滞' : '分拣波次超时',
      documentNo: r.wave_no, warehouse: r.warehouse_name, minutes: Number(r.idle_minutes),
      action: '仓储 → 批次拣货，用批次号核对作业进度与待处理任务',
      path: '/picking-waves?waveId=' + r.id + '&focus=wave-progress' })),
  ]
}

const safeText = value => String(value ?? '').replace(/[\r\n\t]/g, ' ').replace(/[\\*_`[\]<>]/g, '').slice(0, 160)

function createOperationAlertWorker({ query, send, now = () => Math.floor(Date.now() / 1000), publicUrl = () => '' }) {
  // 资源级去重；重启会清空，因此重启后当前异常可再提醒一次。发送失败不确认。
  const sent = new Map()
  return async () => {
    const current = await query(), time = now()
    for (const [key, record] of sent) if (time - record.at > 7 * 86400) sent.delete(key)
    const targets = current.filter(item => {
      const previous = sent.get(item.key)
      return !previous || previous.fingerprint !== item.fingerprint || time - previous.at >= 86400
    })
    for (let offset = 0; offset < targets.length; offset += 10) {
      const batch = targets.slice(offset, offset + 10)
      const base = String(publicUrl() || '').replace(/\/$/, '')
      const lines = batch.map(item => {
        const location = item.barcode ? `；箱码 ${safeText(item.barcode)}` : ''
        const link = base ? `\n处理入口：[打开系统](${base}/#${item.path})` : ''
        return `**${safeText(item.title)}｜${safeText(item.documentNo)}**\n仓库：${safeText(item.warehouse)}${location}\n持续：${Math.max(0, Math.floor(item.minutes))} 分钟\n处理位置：${safeText(item.action)}${link}`
      })
      const clipped = current.some(item => item.total > 50) ? '\n\n每类最多展示最近50项，完整情况请在上述作业页面核对。' : ''
      const ok = await send('⚠️ 极序 Flow 作业异常预警',
        `### 作业异常预警\n\n${lines.join('\n\n')}${clipped}\n\n请先核对现场状态，再处理。`)
      if (!ok) break
      for (const item of batch) sent.set(item.key, { fingerprint: item.fingerprint, at: time })
    }
  }
}

module.exports = { buildOperationAlerts, createOperationAlertWorker }
