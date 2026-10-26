const path = require('node:path')
const { existsSync } = require('node:fs')
const { pathToFileURL } = require('node:url')
const AppError = require('../../utils/AppError')

const sourceRuntime = path.resolve(__dirname, '../../../../agent/src/runtime.js')
const packagedRuntime = '/opt/flowcube-agent/src/runtime.js'

// 仅允许仓库源码与镜像内的固定路径，不接受请求或环境指定模块地址。
function loadRuntimeModule() {
  return import(pathToFileURL(existsSync(sourceRuntime) ? sourceRuntime : packagedRuntime).href)
}

function currentActor(req) {
  const user = req.user
  if (!Number.isSafeInteger(Number(user?.userId)) || Number(user.userId) <= 0 || !user.username
    || !Array.isArray(user.permissions)
    || !(user.warehouseIds === null || (Array.isArray(user.warehouseIds) && user.warehouseIds.every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0)))) {
    throw new AppError('登录身份或当前授权不完整，请重新登录', 401, 'AUTH_SESSION_INVALID')
  }
  return {
    id: Number(user.userId), username: user.username, realName: user.realName,
    roleId: Number(user.roleId), roleName: user.roleName, permissions: [...user.permissions],
    warehouseIds: user.warehouseIds === null ? null : user.warehouseIds.map(Number),
    unrestrictedWarehouseScope: user.warehouseIds === null, isSuper: Number(user.roleId) === 1,
  }
}

function createAssistantService({ dataDir = process.env.AGENT_DATA_DIR || (existsSync(sourceRuntime) ? path.resolve(__dirname, '../../../../agent/data') : '/var/lib/flowcube/assistant'), loadRuntime = loadRuntimeModule } = {}) {
  let pending
  async function runtime() {
    if (!pending) pending = Promise.resolve().then(loadRuntime).then(module => ({ module, runtime: module.createAgentRuntime({ dataDir }) }))
      .catch(error => { pending = null; throw error })
    return pending
  }
  return {
    async dispatch(req, { method, pathname }) {
      try {
        const actor = currentActor(req)
        const port = Number(req.socket?.localPort)
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('本机监听端口不可用')
        const { module, runtime: active } = await runtime()
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
        if (!token) throw new AppError('请先登录极序 Flow', 401, 'AUTH_TOKEN_MISSING')
        const client = new module.FlowClient(`http://127.0.0.1:${port}`, token, { clientId: req.headers['x-client-id'] })
        return await active.dispatch({ method, pathname, body: req.body, actor, client })
      } catch (error) {
        if (error instanceof AppError) throw error
        if (error.status >= 400 && error.status < 500) throw new AppError(error.message, error.status, error.code || 'ASSISTANT_REQUEST_REJECTED')
        if (error.code === 'ASSISTANT_HISTORY_UNAVAILABLE') throw new AppError('小满的历史记录暂时无法读取，原文件已保留。请联系管理员修复后再试。', 503, error.code)
        throw new AppError('小满暂时连不上，请稍后重试；未重新提交业务操作。', 503, 'ASSISTANT_UNAVAILABLE')
      }
    },
  }
}

module.exports = { ...createAssistantService(), createAssistantService }
