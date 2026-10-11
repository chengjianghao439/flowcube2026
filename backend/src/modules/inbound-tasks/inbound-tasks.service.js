const query = require('./inbound-tasks.query')
const command = require('./inbound-tasks.command')
const edit = require('./inbound-tasks.edit')
const putaway = require('./inbound-tasks.putaway')
const voidModule = require('./inbound-tasks.void')

module.exports = {
  findAll: query.findAll,
  updateDraft: edit.updateDraft,
  getEditContext: edit.getEditContext,
  findEditPurchasableItems: edit.findEditPurchasableItems,
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
  closeReceiving: command.closeReceiving,
  putaway: putaway.putaway,
  voidReceipt: voidModule.voidReceipt,
}
