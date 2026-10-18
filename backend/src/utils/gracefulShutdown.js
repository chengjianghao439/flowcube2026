'use strict'

/** The deadline stays referenced: an unfinished task without handles must fail too. */
function createGracefulShutdown({ lifecycle, getServer, closePool, logger,
  waitForStartup = () => Promise.resolve(), waitForHttpHandlers = () => Promise.resolve(), exit = code => process.exit(code),
  timeoutMs = 25_000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  let completion = null, exitCode = 0, finished = false
  return function shutdown(reason, error = null, requestedCode = 0) {
    if (requestedCode !== 0) exitCode = 1
    if (completion) return completion
    let resolve
    completion = new Promise(done => { resolve = done })
    lifecycle.beginDrain()
    logger.info('进程进入优雅退出', { reason, exitCode }, 'PROCESS')
    if (error) logger.error('退出由异常触发', error, { reason }, 'PROCESS')
    const finish = (code, failure = null) => {
      if (finished) return
      finished = true
      clearTimeoutFn(timer)
      if (failure) logger.error('优雅退出失败', failure, { reason, exitCode: code }, 'PROCESS')
      else logger.info('HTTP、后台任务及连接池已关闭', { reason, exitCode: code }, 'PROCESS')
      resolve(code)
      exit(code)
    }
    const timer = setTimeoutFn(() => finish(1, new Error('优雅退出超时')), timeoutMs)
    // Stop accepting connections before stopping loops; both happen synchronously.
    const httpClosed = new Promise((done, reject) => {
      const server = getServer()
      if (!server) return done()
      server.close(err => err ? reject(err) : done())
      server.closeIdleConnections?.()
    })
    lifecycle.stopTasks()
    void (async () => {
      await Promise.all([httpClosed, lifecycle.waitForTasks(), waitForStartup()])
      if (finished) return
      await waitForHttpHandlers()
      if (finished) return
      await closePool()
      if (!finished) finish(exitCode)
    })().catch(err => finish(1, err))
    return completion
  }
}
module.exports = { createGracefulShutdown }
