const AppError = require('../utils/AppError')

const DOCUMENT_STATUS_RULES = Object.freeze({
  purchase: {
    entityName: '采购单',
    actions: {
      confirm: { from: [1], to: 2, message: '只有草稿状态的采购单可以提交' },
      createInboundTask: { from: [2], message: '只有已确认的采购单可创建入库任务' },
      cancel: {
        from: [1, 2],
        to: 4,
        message: '当前状态的采购单不能取消',
        blocked: {
          3: '已完成的采购单不能取消',
          4: '采购单已取消',
        },
      },
      complete: { from: [2], to: 3, message: '只有已提交的采购单可以完成' },
    },
  },
  sale: {
    entityName: '销售单',
    actions: {
      edit: { from: [1], message: '只有草稿状态的销售单可以编辑' },
      reserve: { from: [1], to: 2, message: '只有草稿状态可以占用库存' },
      release: { from: [2], to: 1, message: '只有已占库的订单可以取消占库' },
      ship: { from: [2], to: 3, message: '只有已占库的销售单可以发起出库' },
      completeShip: { from: [3], to: 4, message: '只有拣货中的销售单可以完成出库' },
      cancel: {
        from: [1, 2, 3],
        to: 5,
        message: '当前状态的订单不能取消',
        blocked: {
          4: '已出库的订单不能取消',
          5: '订单已取消',
        },
      },
      delete: { from: [5], message: '只有已取消的订单可以删除' },
    },
  },
  transfer: {
    entityName: '调拨单',
    actions: {
      confirm: { from: [1], to: 2, message: '只有草稿可以确认' },
      execute: { from: [2], to: 3, message: '只有已确认的调拨单可以执行' },
      cancel: {
        from: [1, 2],
        to: 4,
        message: '当前状态的调拨单不能取消',
        blocked: {
          3: '已执行的调拨单不能取消',
          4: '调拨单已取消',
        },
      },
    },
  },
  purchaseReturn: {
    entityName: '采购退货单',
    actions: {
      confirm: { from: [1], to: 2, message: '只有草稿状态可以确认' },
      execute: { from: [2], to: 3, message: '只有已确认的退货单可以执行' },
      cancel: {
        from: [1, 2],
        to: 4,
        message: '当前状态的采购退货单不能取消',
        blocked: {
          3: '已退货的单据不能取消',
          4: '已取消',
        },
      },
    },
  },
  saleReturn: {
    entityName: '销售退货单',
    actions: {
      confirm: { from: [1], to: 2, message: '只有草稿状态可以确认' },
      execute: { from: [2], to: 3, message: '只有已确认的退货单可以执行' },
      cancel: {
        from: [1, 2],
        to: 4,
        message: '当前状态的销售退货单不能取消',
        blocked: {
          3: '该状态不能取消',
          4: '该状态不能取消',
        },
      },
    },
  },
  stockcheck: {
    entityName: '盘点单',
    actions: {
      edit: { from: [1], message: '只有进行中的盘点单才能修改明细' },
      submit: { from: [1], to: 2, message: '只有进行中的盘点单才能提交' },
      cancel: {
        from: [1],
        to: 3,
        message: '当前状态的盘点单不能取消',
        blocked: {
          2: '已完成的盘点单不能取消',
          3: '盘点单已取消',
        },
      },
    },
  },
  inboundTask: {
    entityName: '收货订单',
    actions: {
      submit: {
        from: [1, 2, 3, 4],
        message: '已取消的收货订单不能提交到 PDA',
        blocked: { 5: '已取消的收货订单不能提交到 PDA' },
      },
      receive: {
        from: [1, 2],
        message: '当前状态的任务不能继续收货',
        blocked: {
          3: '任务已全部收货，请执行上架',
          4: '任务已完成或已取消',
          5: '任务已完成或已取消',
        },
      },
      receiveStart: { from: [1], to: 2, message: '只有待收货状态才能开始收货' },
      receiveComplete: { from: [2, 3], to: 3, message: '当前状态不能推进到待上架' },
      putaway: {
        from: [2, 3],
        message: '当前状态的任务不能执行上架',
        blocked: {
          1: '任务尚未开始收货，无法上架',
          4: '任务已完成或已取消',
          5: '任务已完成或已取消',
        },
      },
      finish: { from: [3], to: 4, message: '只有待上架状态才能完成收货订单' },
      cancel: {
        from: [1],
        to: 5,
        message: '仅待收货状态的任务可取消',
      },
      audit: {
        from: [4],
        message: '只有已上架完成的收货订单才能审核',
      },
    },
  },
  inboundTaskAudit: {
    entityName: '收货订单审核',
    actions: {
      approve: {
        from: [0, 2],
        to: 1,
        message: '只有待审核或已退回的收货订单才能审核通过',
      },
      reject: {
        from: [0, 2],
        to: 2,
        message: '只有待审核或已退回的收货订单才能审核退回',
      },
    },
  },
})

function getStatusRule(machine, action) {
  const machineRules = DOCUMENT_STATUS_RULES[machine]
  if (!machineRules) throw new Error(`Unknown status machine: ${machine}`)
  const rule = machineRules.actions?.[action]
  if (!rule) throw new Error(`Unknown action "${action}" for machine "${machine}"`)
  return { ...rule, entityName: machineRules.entityName }
}

function assertStatusAction(machine, action, currentStatus) {
  const rule = getStatusRule(machine, action)
  const normalized = Number(currentStatus)
  if (rule.from.includes(normalized)) return rule
  if (rule.blocked && rule.blocked[normalized]) {
    throw new AppError(rule.blocked[normalized], 400)
  }
  throw new AppError(rule.message || `${rule.entityName}当前状态不允许执行 ${action}`, 400)
}

module.exports = {
  DOCUMENT_STATUS_RULES,
  getStatusRule,
  assertStatusAction,
}
