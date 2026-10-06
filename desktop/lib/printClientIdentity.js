const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function createPrintClientIdentity({ userDataPath, safeStorage, hostname }) {
  const identityFile = path.join(userDataPath, 'print-client-id.json')
  let clientId
  try {
    const stored = JSON.parse(fs.readFileSync(identityFile, 'utf8')).clientId
    if (/^desktop:[a-f0-9-]{36}$/.test(stored)) clientId = stored
  } catch { /* 首次启动或损坏的非敏感身份文件，生成新身份 */ }
  const credentials = new Map()
  const keyFor = origin => {
    const url = new URL(origin)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('打印服务器地址无效')
    return url.origin
  }
  function reset() {
    clientId = `desktop:${crypto.randomUUID()}`
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(identityFile, JSON.stringify({ clientId }), { mode: 0o600 })
    credentials.clear()
    return getInfo()
  }
  if (!clientId) reset()
  const credentialFile = origin => path.join(userDataPath, `print-client-${crypto.createHash('sha256').update(keyFor(origin)).digest('hex')}.enc`)
  const canPersist = () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
  function getInfo() { return { clientId, hostname: String(hostname || '').slice(0, 200) } }
  function getCredential(origin) {
    const key = keyFor(origin)
    if (credentials.has(key)) return credentials.get(key)
    if (!canPersist()) return null
    try {
      const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile(origin))))
      if (stored.clientId === clientId && /^[a-f0-9]{64}$/.test(stored.credential)) {
        credentials.set(key, stored.credential)
        return stored.credential
      }
    } catch { /* 解密失败即未注册，不读明文或发送旧凭据 */ }
    return null
  }
  function setCredential(origin, credential) {
    if (!/^[a-f0-9]{64}$/.test(credential || '')) throw new Error('打印工作站凭据格式无效')
    const key = keyFor(origin)
    credentials.set(key, credential)
    const persisted = canPersist()
    if (persisted) {
      fs.writeFileSync(credentialFile(origin), safeStorage.encryptString(JSON.stringify({ clientId, credential })), { mode: 0o600 })
      fs.chmodSync(credentialFile(origin), 0o600)
    }
    return { persisted }
  }
  return { getInfo, getCredential, setCredential, reset }
}
module.exports = { createPrintClientIdentity }
