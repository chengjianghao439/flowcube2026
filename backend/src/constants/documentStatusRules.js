const AppError = require('../utils/AppError')

const DOCUMENT_STATUS_RULES = Object.freeze({
  purchase: {
    entityName: '采购单',
    actions: {
      edit: { from: [1], message: '只有草稿状态的采购单可以编辑' },
      confirm: { from: [1], to: 2, message: '只有草稿状态的采购单可以提交' },
      // 撤回确认仅用于"确认早了"这种还没进入收货流程的场景；一旦有收货订单（哪怕未收货）
      // 就必须先处理/取消收货订单，不能让收货订单指向一张倒回草稿态的采购单。
      withdrawConfirm: { from: [2], to: 1, message: '只有已确认的采购单可以撤回确认' },
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
      close: { from: [2], to: 3, message: '只有已提交的采购单可以关闭剩余结案' },
      // 仅供「撤回收货」内部联动使用：收货订单撤回导致采购单不再满足全部收齐时，
      // 自动把已完成(3)的采购单退回已提交(2)，不作为用户可直接调用的入口。
      reopen: { from: [3], to: 2, message: '只有已完成的采购单可以重新打开' },
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
    // 状态：1草稿 2待出库(已派发) 3在途 4已完成 5已取消
    entityName: '调拨单',
    actions: {
      edit: { from: [1], message: '只有草稿状态的调拨单可以编辑' },
      confirm: { from: [1], to: 2, message: '只有草稿可以确认派发' },
      scanOut: { from: [2, 3], to: 3, message: '只有待出库/在途的调拨单可以扫码出库' },
      scanIn: { from: [3], to: 4, message: '只有在途的调拨单可以扫码入库' },
      cancel: {
        from: [1, 2],
        to: 5,
        message: '当前状态的调拨单不能取消',
        blocked: {
          3: '已开始出库(在途)的调拨单不能取消，请通过盘点处理差异',
          4: '已完成的调拨单不能取消',
          5: '调拨单已取消',
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
      // 撤回收货：把已收货（含已上架/已完成自动结算）的收货订单整单打回待收货，允许重新收货。
      // 只要有容器被后续动作（拣货锁定、拆分、移动等）碰过，业务层会在真正执行前另行校验拒绝。
      voidReceipt: {
        from: [2, 3, 4],
        to: 1,
        message: '只有收货中/待上架/已完成的收货订单可以撤回收货',
      },
    },
  },
  // 上架完成即自动结算应付（inbound-tasks.putaway.js 的 tryFinishTask），不再需要人工审核闸门；
  // approve 规则保留供该自动结算复用状态校验，audit_status 恒为 0→1 这一条路径（2/已退回已随人工审核一起下线，不再可达）。
  inboundTaskAudit: {
    entityName: '收货订单审核',
    actions: {
      approve: {
        from: [0],
        to: 1,
        message: '只有待结算的收货订单才能自动结算',
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
