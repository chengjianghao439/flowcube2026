/**
 * 在线打印客户端内存缓存（单例）
 * 避免多次 require controller 导致 Map 实例不一致
 */
const onlineClients = new Map() // clientId -> { clientId, hostname, printers, registeredAt, lastSeen }
const CLIENT_TIMEOUT_MS = 5 * 60 * 1000 // 5分钟无心跳视为离线

function setClient(clientId, data) {
  onlineClients.set(clientId, {
    ...data,
    lastSeen: Date.now(),
    registeredAt: onlineClients.get(clientId)?.registeredAt || new Date().toISOString(),
  })
}

function getOnlineClients() {
  const now = Date.now()
  const result = []
  for (const [id, c] of onlineClients.entries()) {
    if (now - c.lastSeen < CLIENT_TIMEOUT_MS) {
      result.push(c)
    } else {
      onlineClients.delete(id)
    }
  }
  return result
}

module.exports = { setClient, getOnlineClients }
