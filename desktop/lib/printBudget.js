const MAX_CONTENT_BYTES = 1024 * 1024
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024
function validatePrintBudget(content, copies = 1) {
  if (typeof content !== 'string' || typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 100) throw new Error('打印内容须为文字，打印份数须为 1–100 的整数')
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_CONTENT_BYTES || bytes * copies > MAX_EXPANDED_BYTES) throw new Error('打印内容超过单份 1 MiB 或整批 8 MiB 限制，请缩小标签内容或减少份数')
  if (copies > 1 && /\^PQ/i.test(content)) throw new Error('模板已设置打印份数，请将任务份数设为 1，或移除模板中的份数指令')
  return { content, copies }
}
async function printBoundedBatch(opts, printCopy) {
  const batch = validatePrintBudget(opts?.content, opts?.copies)
  for (let i = 0; i < batch.copies; i += 1) {
    try { await printCopy({ printerName: opts.printerName, content: batch.content }) }
    catch (e) { throw new Error(`${e?.message || 'RAW 打印失败'}；已提交 ${i} 份，当前份结果需核对，请人工核对后再补打`) }
  }
}
module.exports = { validatePrintBudget, printBoundedBatch, MAX_CONTENT_BYTES, MAX_EXPANDED_BYTES }
