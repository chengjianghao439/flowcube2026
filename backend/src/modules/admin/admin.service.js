const inboundService = require('../inbound-tasks/inbound-tasks.service')

async function executePutaway({ operator, taskId, containerId, locationId, scopeWarehouseIds = null }) {
  await inboundService.putaway(taskId, { containerId, locationId }, operator, { scopeWarehouseIds })
}

module.exports = {
  executePutaway,
}
