import type { InboundTask } from '@/types/inbound-tasks'

export interface InboundClosureCopy {
  stageLabel: string
  ownerLabel: 'ERP' | 'PDA' | 'ERP / PDA'
  description: string
  nextAction: string
  actionMode: 'submit' | 'receive' | 'putaway' | 'audit' | 'exception' | 'done' | 'cancelled'
  primaryActionLabel: string
}

export function getInboundClosureCopy(task?: Partial<InboundTask> | null): InboundClosureCopy {
  const exceptionFlags = task?.exceptionFlags
  const receiptKey = task?.receiptStatus?.key
  const putawayKey = task?.putawayStatus?.key
  const auditKey = task?.auditFlowStatus?.key

  if (Number(task?.status) === 5) {
    return {
      stageLabel: '已取消',
      ownerLabel: 'ERP',
      description: '该收货订单已取消，不再进入 PDA 收货、打印或上架流程。',
      nextAction: '如需继续收货，请重新创建收货订单。',
      actionMode: 'cancelled',
      primaryActionLabel: '返回列表',
    }
  }

  if (auditKey === 'approved') {
    return {
      stageLabel: '收货闭环已完成',
      ownerLabel: 'ERP',
      description: '收货、打印、上架、审核都已完成，这张收货订单已经正式闭环。',
      nextAction: '后续仅需按需查看打印记录、时间线或补打历史条码。',
      actionMode: 'done',
      primaryActionLabel: '查看时间线',
    }
  }

  if (auditKey === 'rejected') {
    return {
      stageLabel: '审核退回待处理',
      ownerLabel: 'ERP',
      description: '该收货订单已被审核退回，异常处理、补录与重新审核都以 ERP 收货详情为主入口。',
      nextAction: '先按退回原因补打、补录或复核，再在 ERP 中重新审核通过。',
      actionMode: 'exception',
      primaryActionLabel: '处理退回并重新审核',
    }
  }

  if ((exceptionFlags?.failedPrintJobs ?? 0) > 0 || (exceptionFlags?.timeoutPrintJobs ?? 0) > 0) {
    return {
      stageLabel: '打印异常待处理',
      ownerLabel: 'ERP',
      description: '库存条码存在打印失败或超时待确认，后续上架与审核前需要先收口打印异常。',
      nextAction: '先在 ERP 打开打印批次与补打区处理条码异常，再继续 PDA 上架或 ERP 审核。',
      actionMode: 'exception',
      primaryActionLabel: '处理打印异常',
    }
  }

  if ((exceptionFlags?.overduePutawayContainers ?? 0) > 0) {
    return {
      stageLabel: '待上架超时',
      ownerLabel: 'PDA',
      description: '库存条码已经打印，但仍有箱未在时限内完成上架，需要优先回到 PDA 现场收口。',
      nextAction: '先在 PDA 扫描库存条码与货架条码完成上架，再回 ERP 继续审核。',
      actionMode: 'putaway',
      primaryActionLabel: '前往 PDA 扫码上架',
    }
  }

  if (auditKey === 'pending' || exceptionFlags?.pendingAuditOverdue) {
    return {
      stageLabel: exceptionFlags?.pendingAuditOverdue ? '待审核超时' : '待审核',
      ownerLabel: 'ERP',
      description: '现场收货和上架已经结束，下一步由 ERP 完成审核收口。',
      nextAction: '确认打印、补打和上架都无异常后，在 ERP 收货详情中完成审核。',
      actionMode: 'audit',
      primaryActionLabel: '在 ERP 完成审核',
    }
  }

  if (putawayKey === 'waiting' || putawayKey === 'putting_away' || Number(task?.status) === 3) {
    return {
      stageLabel: '待上架',
      ownerLabel: 'PDA',
      description: '收货已完成并已生成库存条码，当前阶段应由 PDA 执行扫码上架。',
      nextAction: '前往 PDA 扫描库存条码和货架条码，完成待上架箱的现场上架。',
      actionMode: 'putaway',
      primaryActionLabel: '前往 PDA 扫码上架',
    }
  }

  if (receiptKey === 'receiving' || receiptKey === 'submitted' || Number(task?.status) === 2) {
    return {
      stageLabel: receiptKey === 'submitted' ? '待开始收货' : '收货中',
      ownerLabel: 'PDA',
      description: 'ERP 已提交收货订单，现场收货、打印库存条码和作业反馈以 PDA 为主入口。',
      nextAction: '在 PDA 按商品逐箱收货，系统会同步生成库存条码并进入打印任务中心。',
      actionMode: 'receive',
      primaryActionLabel: '前往 PDA 收货',
    }
  }

  return {
    stageLabel: '待提交到 PDA',
    ownerLabel: 'ERP',
    description: '当前仍是 ERP 草稿收货订单，尚未进入现场作业阶段。',
    nextAction: '先在 ERP 提交到 PDA，再由 PDA 承接收货、打印库存条码和上架。',
    actionMode: 'submit',
    primaryActionLabel: '在 ERP 提交到 PDA',
  }
}
