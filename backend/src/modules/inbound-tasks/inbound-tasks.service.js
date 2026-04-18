const query = require('./inbound-tasks.query')
const command = require('./inbound-tasks.command')
const putaway = require('./inbound-tasks.putaway')

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
  audit: command.audit,
  receive: command.receive,
  reprint: command.reprint,
  cancel: command.cancel,
  putaway: putaway.putaway,
}
