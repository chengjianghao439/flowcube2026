import { expect, test, vi } from 'vitest'
import { collectAllRecords } from './allRecords'

const batch = (page: number, total = 1205, pageSize = 200) => ({
  list: Array.from({length: Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize))}, (_,i) => ({id:(page-1)*pageSize+i+1})),
  pagination: {page,pageSize,total}, summary: {amount:456}, statusCounts:{pending:1205},
})
test('自动取齐超过单次上限的全部记录，保留汇总与稳定顺序', async () => {
  const fetch = vi.fn(async (page = 1) => batch(page))
  const result = await collectAllRecords(fetch)
  expect(result.list).toHaveLength(1205)
  expect(result.list[1204].id).toBe(1205)
  expect(result.summary.amount).toBe(456)
  expect(result.statusCounts.pending).toBe(1205)
  expect(fetch).toHaveBeenCalledTimes(7)
})
test('续批失败或数量变化时拒绝返回首批残缺数据', async () => {
  await expect(collectAllRecords(async page => { if(page===2) throw Error('network');return batch(page) })).rejects.toThrow('network')
  await expect(collectAllRecords(async page => batch(page,page===1?1205:1204))).rejects.toThrow('变化')
})
test('服务忽略翻页参数或提前返回空批次时明确报错', async () => {
  await expect(collectAllRecords(async () => batch(1))).rejects.toThrow()
  await expect(collectAllRecords(async page => page===1?batch(1):{...batch(page),list:[]})).rejects.toThrow()
})
test('非分页数据和空列表保持原响应', async () => {
  const detail = {id:1,items:[{id:3}]}
  expect(await collectAllRecords(async () => detail)).toBe(detail)
  expect((await collectAllRecords(async page => batch(page,0))).list).toEqual([])
})
test('中止后不再请求后续批次', async () => {
  const controller = new AbortController()
  const fetch = vi.fn(async page => {controller.abort();return batch(page)})
  await expect(collectAllRecords(fetch,controller.signal)).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
})
