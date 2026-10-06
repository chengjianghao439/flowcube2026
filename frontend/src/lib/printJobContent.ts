/** Send only one bounded copy across IPC; Electron repeats sequentially. RAW success is OS acceptance. */
export function preparePrintJobContent(content: string, copies: unknown = 1): { content: string; copies: number } {
  if (typeof content !== 'string' || typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 100) throw new Error('打印份数必须为 1–100 的整数')
  const bytes = new TextEncoder().encode(content).byteLength
  if (bytes > 1024 * 1024 || bytes * copies > 8 * 1024 * 1024) throw new Error('打印内容超过单份 1 MiB 或整批 8 MiB 限制，请缩小标签内容或减少份数')
  if (copies > 1 && /\^PQ/i.test(content)) throw new Error('模板已设置打印份数，请将任务份数设为 1，或移除模板中的份数指令')
  return { content, copies }
}
