const { enqueueContainerLabelJob } = require('../print-jobs/print-jobs.service')

// 与收货入库共用标签队列。只在调用方事务内入队，不触发物理打印；暂无设备保留业务回执。
async function queueReturnLabels(conn, { taskId, warehouseId, productName, containers, userId, phase }) {
  const printJobIds = []
  let noPrinterCount = 0
  for (const container of containers) {
    const job = await enqueueContainerLabelJob({
      conn,
      containerId: container.containerId,
      warehouseId,
      data: { container_code: container.barcode, product_name: productName, qty: container.qty },
      createdBy: userId ?? null,
      jobUniqueKey: `return_${phase}:${taskId}:${container.containerId}:${container.status}:${container.qty}`,
    })
    // unprintable：没有可用打印机，只留下打印记录（打印记录页可见、可补打）
    if (job?.id && !job.unprintable) printJobIds.push(Number(job.id))
    else noPrinterCount++
  }
  return { printJobIds, noPrinterCount }
}

module.exports = { queueReturnLabels }
