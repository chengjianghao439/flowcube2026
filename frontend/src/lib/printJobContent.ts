/** 一次提交完整批次；RAW 返回成功只表示系统接收，不能据此判断实际出纸份数。 */
export function preparePrintJobContent(content: string, copies: unknown = 1): string {
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 100) {
    throw new Error('打印份数必须为 1–100 的整数')
  }
  if (copies === 1) return content
  // 保留旧模板单份任务的原始指令；多份不能与模板自带的数量相乘。
  if (/\^PQ/i.test(content)) {
    throw new Error('模板已设置打印份数，请将任务份数设为 1，或移除模板中的份数指令')
  }
  return Array.from({ length: copies }, () => content).join('\n')
}
