const { fetchWavePerformanceRows } = require('./reports.query')

async function wavePerformance({ startDate = null, endDate = null } = {}) {
  const { summary, rows } = await fetchWavePerformanceRows({ startDate, endDate })
  const STATUS_NAMES = { 1: '待拣货', 2: '拣货中', 3: '待分拣', 4: '已完成', 5: '已取消' }

  const waves = rows.map(r => {
    const dur = r.duration_minutes != null ? Number(r.duration_minutes) : null
    const picked = Number(r.total_picked_qty)
    const efficiency = dur && dur > 0 ? +(picked / dur).toFixed(2) : null
    return {
      id: r.id,
      waveNo: r.wave_no,
      status: r.status,
      statusName: STATUS_NAMES[r.status] ?? String(r.status),
      taskCount: Number(r.task_count),
      operatorName: r.operator_name || '—',
      createdAt: r.created_at,
      skuCount: Number(r.sku_count),
      totalRequiredQty: Number(r.total_required_qty),
      totalPickedQty: picked,
      totalSteps: Number(r.total_steps),
      completedSteps: Number(r.completed_steps),
      lastPickAt: r.last_pick_at || null,
      durationMinutes: dur,
      efficiency,
    }
  })

  return {
    summary: {
      totalWaves: Number(summary.total_waves),
      completedWaves: Number(summary.completed_waves),
      avgDurationMinutes: summary.avg_duration_minutes != null ? +Number(summary.avg_duration_minutes).toFixed(1) : null,
      avgSkuCount: summary.avg_sku_count != null ? +Number(summary.avg_sku_count).toFixed(1) : null,
      totalPickedQty: Number(summary.total_picked_qty ?? 0),
    },
    waves,
  }
}

module.exports = {
  wavePerformance,
}
