const query = require('./inbound-tasks.query')
const command = require('./inbound-tasks.command')
const putaway = require('./inbound-tasks.putaway')
const voidModule = require('./inbound-tasks.void')

module.exports = {
  findAll: query.findAll,
  findById: query.findById,
  findPurchasableItems: query.findPurchasableItems,
  listContainers: query.listContainers,
  listWaitingContainers: query.listWaitingContainers,
  listStoredContainers: query.listStoredContainers,
  refreshPutawayOverdueMarks: query.refreshPutawayOverdueMarks,
  listAllPendingPutawayContainers: query.listAllPendingPutawayContainers,
  createFromPoId: command.createFromPoId,
  createManualTask: command.createManualTask,
  submit: command.submit,
  receive: command.receive,
  reprint: command.reprint,
  cancel: command.cancel,
  putaway: putaway.putaway,
  voidReceipt: voidModule.voidReceipt,
}
