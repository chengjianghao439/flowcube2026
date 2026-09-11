const { parentPort } = require('node:worker_threads')
const { renderLabel } = require('./labelRaster')
parentPort.on('message', ({ id, input }) => {
  try { parentPort.postMessage({ id, result: renderLabel(input) }) }
  catch (error) { parentPort.postMessage({ id, error: { message: error.message, statusCode: error.statusCode || 500, code: error.code || 'LABEL_RENDER_FAILED' } }) }
})
