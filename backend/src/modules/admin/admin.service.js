const { pool } = require('../../config/db')
const inboundService = require('../inbound-tasks/inbound-tasks.service')

async function loadOperator(userId) {
  const [[user]] = await pool.query('SELECT id, username, real_name FROM sys_users WHERE id=?', [userId])
  return {
    userId: user.id,
    username: user.username,
    realName: user.real_name,
  }
}

async function executePutaway({ userId, taskId, containerId, locationId }) {
  const operator = await loadOperator(userId)
  await inboundService.putaway(taskId, { containerId, locationId }, operator)
}

module.exports = {
  executePutaway,
}
