const path = require('node:path')
const { Worker } = require('node:worker_threads')
const AppError = require('../../utils/AppError')
const { prepareLabelInput } = require('./labelRasterValidation')
let worker, sequence = 0
const pending = new Map()
const MAX_PENDING = 16

function stopWorker(instance, error) {
  if (worker !== instance) return
  worker = null
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error) }
  pending.clear()
  void instance.terminate()
}
function getWorker() {
  if (worker) return worker
  const instance = new Worker(path.join(__dirname, 'labelRasterWorker.js'))
  worker = instance
  instance.on('message', ({ id, result, error }) => {
    const job = pending.get(id)
    if (!job || worker !== instance) return
    clearTimeout(job.timer); pending.delete(id)
    if (pending.size === 0) instance.unref()
    if (error) job.reject(new AppError(error.message, error.statusCode, error.code))
    else job.resolve(result)
  })
  instance.on('error', () => stopWorker(instance, new AppError('标签绘制服务不可用，请稍后重试', 503, 'LABEL_RENDER_FAILED')))
  instance.on('exit', () => stopWorker(instance, new AppError('标签绘制服务已停止，请重试', 503, 'LABEL_RENDER_FAILED')))
  instance.unref()
  return instance
}
function renderLabelAsync(input) {
  input = prepareLabelInput(input)
  if (pending.size >= MAX_PENDING) return Promise.reject(new AppError('标签绘制繁忙，请稍后重试', 503, 'LABEL_RENDER_BUSY'))
  const instance = getWorker(), id = ++sequence
  instance.ref()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stopWorker(instance, new AppError('标签绘制超时，请缩短内容后重试', 503, 'LABEL_RENDER_TIMEOUT')), 15000)
    pending.set(id, { resolve, reject, timer })
    try { instance.postMessage({ id, input }) } catch (error) {
      clearTimeout(timer); pending.delete(id)
      if (pending.size === 0) instance.unref()
      reject(error)
    }
  })
}
module.exports = { renderLabelAsync }
