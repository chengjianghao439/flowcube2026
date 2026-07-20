const query = require('./warehouse-tasks.query')
const command = require('./warehouse-tasks.command')
const pick = require('./warehouse-tasks.pick')
const sort = require('./warehouse-tasks.sort')
const check = require('./warehouse-tasks.check')
const pack = require('./warehouse-tasks.pack')
const ship = require('./warehouse-tasks.ship')
const closures = require('./warehouse-tasks.helpers')
const cancelReturn = require('./warehouse-tasks.cancel-return')

module.exports = {
  findAll: query.findAll,
  findById: query.findById,
  findEvents: query.findEvents,
  getDebugSnapshot: query.getDebugSnapshot,
  findMyTasks: query.findMyTasks,
  findMyTaskSkuSummary: query.findMyTaskSkuSummary,
  getTaskStats: query.getTaskStats,

  createForSaleOrder: command.createForSaleOrder,
  createForPurchaseReturn: command.createForPurchaseReturn,
  assign: command.assign,
  updatePriority: command.updatePriority,
  cancel: command.cancel,

  startPicking: pick.startPicking,
  updatePickedQty: pick.updatePickedQty,
  readyToShip: pick.readyToShip,
  readyToShipWithinTransaction: pick.readyToShipWithinTransaction,
  getPickSuggestions: pick.getPickSuggestions,
  getPickRoute: pick.getPickRoute,

  sortTask: sort.sortTask,
  sortTaskWithinTransaction: sort.sortTaskWithinTransaction,

  checkDone: check.checkDone,
  checkDoneWithinTransaction: check.checkDoneWithinTransaction,
  checkItems: check.checkItems,

  packDone: pack.packDone,
  packDoneWithinTransaction: pack.packDoneWithinTransaction,

  ship: ship.ship,
  shipWithinTransaction: ship.shipWithinTransaction,
  getShipContext: ship.getShipContext,

  assertTaskPickScanClosure: closures.assertTaskPickScanClosure,
  assertTaskCheckScanClosure: closures.assertTaskCheckScanClosure,
  assertTaskPackagingClosure: closures.assertTaskPackagingClosure,
  assertTaskPackagePrintClosure: closures.assertTaskPackagePrintClosure,

  listPendingCancelReturns: cancelReturn.listPendingCancelReturns,
  getCancelReturnDetail: cancelReturn.getCancelReturnDetail,
  finalizeCancelWithinTransaction: cancelReturn.finalizeCancelWithinTransaction,
  checkCancelReturnClearedAndFinalize: cancelReturn.checkCancelReturnClearedAndFinalize,
}
