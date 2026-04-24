const inboundService = require('../inbound-tasks/inbound-tasks.service')

async function executePutaway({ operator, taskId, containerId, locationId }) {
  await inboundService.putaway(taskId, { containerId, locationId }, operator)
}

module.exports = {
  executePutaway,
}
