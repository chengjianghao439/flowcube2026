import type { PackageShipInfo } from '@/api/packages'
import type { WarehouseTask } from '@/api/warehouse-tasks'

type PackageSummary = {
  totalPackages: number
  openPackages: number
  donePackages: number
  totalItems: number
}

type PrintSummary = {
  totalPackages: number
  successCount: number
  failedCount: number
  timeoutCount: number
  processingCount: number
  recentError: string | null
  recentPrinter: string | null
}

type TaskLike = Pick<WarehouseTask, 'status' | 'statusName' | 'taskNo' | 'customerName'> & {
  packageSummary?: PackageSummary
  printSummary?: PrintSummary
}

function summarizeShipInfo(info: PackageShipInfo | null) {
  if (!info) {
    return {
      packageSummary: null,
      printSummary: null,
    }
  }
  const packages = Array.isArray(info.packages) ? info.packages : []
  const totalItems = packages.reduce((sum, pkg) => sum + (Array.isArray(pkg.items) ? pkg.items.reduce((s, item) => s + Number(item.qty || 0), 0) : 0), 0)
  return {
    packageSummary: {
      totalPackages: packages.length,
      openPackages: packages.filter(pkg => pkg.status !== 2).length,
      donePackages: packages.filter(pkg => pkg.status === 2).length,
      totalItems,
    },
    printSummary: info.printSummary ?? null,
  }
}

export function getOutboundClosureCopy(task: TaskLike | null) {
  const packageSummary = task?.packageSummary ?? null
  const printSummary = task?.printSummary ?? null

  if (!task) {
    return {
      stageLabel: '待选择任务',
      description: '先选择具体出库任务或扫描物流条码，再继续打包、打印与出库。',
      nextAction: '先打开具体任务',
    }
  }

  if ((printSummary?.failedCount ?? 0) > 0 || (printSummary?.timeoutCount ?? 0) > 0) {
    return {
      stageLabel: '待补打',
      description: '当前出库箱贴存在失败或超时任务，建议先补打，再继续打包或出库确认。',
      nextAction: '优先处理出库打印异常',
    }
  }

  if (task.status === 5) {
    const openPackages = packageSummary?.openPackages ?? 0
    return {
      stageLabel: '待打包',
      description: openPackages > 0
        ? `当前还有 ${openPackages} 箱未完成打包，需先装箱并完成箱贴打印。`
        : '当前任务正在打包阶段，可继续创建箱子、装箱并打印箱贴。',
      nextAction: '完成装箱并确认箱贴打印',
    }
  }

  if (task.status === 6) {
    return {
      stageLabel: '待出库',
      description: '打包已完成，等待现场扫描物流条码并完成出库确认。',
      nextAction: '扫描物流条码并确认出库',
    }
  }

  if (task.status === 7) {
    return {
      stageLabel: '已出库',
      description: '该任务已完成出库，仍可回看装箱与打印记录。',
      nextAction: '可复盘打印与出库执行记录',
    }
  }

  if (task.status === 4) {
    return {
      stageLabel: '待打包前置',
      description: '当前任务仍在复核阶段，需先完成复核，才能进入装箱与物流标签闭环。',
      nextAction: '先完成复核，再进入打包',
    }
  }

  return {
    stageLabel: task.statusName,
    description: '当前任务仍在出库前置阶段，可继续推进主链后再进入装箱与出库。',
    nextAction: '继续推进当前仓库任务',
  }
}

export function getPackageShipClosureCopy(info: PackageShipInfo | null) {
  if (!info) {
    return {
      stageLabel: '待扫描',
      description: '扫描物流条码后，系统会自动带出整张任务的装箱与出库信息。',
      nextAction: '先扫描物流条码',
      ...summarizeShipInfo(info),
    }
  }

  const derived = getOutboundClosureCopy({
    status: info.taskStatus as TaskLike['status'],
    statusName: info.taskStatusName ?? '待出库',
    taskNo: info.taskNo,
    customerName: info.customerName,
    ...summarizeShipInfo(info),
  })

  return {
    ...derived,
    ...summarizeShipInfo(info),
  }
}
