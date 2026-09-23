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

test('达到取数上限即停并如实标记，不因拉不满而报错', async () => {
  // 3.8 万条日志表：上限 400 时只取 2 页就停，不再串行拉完 190+ 页
  const fetch = vi.fn(async (page: number, pageSize?: number) => batch(page, 38554, pageSize))
  const result = await collectAllRecords(fetch, undefined, 400) as { truncated?: boolean; list: unknown[]; pagination: { total: number } }

  expect(result.list).toHaveLength(400)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(result.pagination.total, '真实总数仍如实返回，便于页面提示用户').toBe(38554)
  expect(result.truncated).toBe(true)
})

test('未达上限时标记为非截断', async () => {
  const result = await collectAllRecords(async (page, pageSize) => batch(page, 1205, pageSize), undefined, 5000) as { truncated?: boolean; list: unknown[] }
  expect(result.list).toHaveLength(1205)
  expect(result.truncated).toBe(false)
})

test('部分跨页重叠即失败，即使总数和整页签名不同', async () => {
  await expect(collectAllRecords(async page => ({
    list: (page === 1 ? [1, 2] : [2, 3]).map(id => ({ id, name: `page ${page}` })),
    pagination: { page, pageSize: 2, total: 4 },
  }))).rejects.toThrow('重复')
})

test('库存复合身份不同可以同商品出现，复合身份相同跨页即失败', async () => {
  const fetch = (overlap: boolean) => async (page: number) => ({
    list: [{ productId: 1, warehouseId: overlap ? 1 : page, quantity: page }],
    pagination: { page, pageSize: 1, total: 2 },
  })
  expect((await collectAllRecords(fetch(false))).list).toHaveLength(2)
  await expect(collectAllRecords(fetch(true))).rejects.toThrow('重复')
})

test('相同文本不等于相同记录，没有稳定身份时不凭内容拒绝合法行', async () => {
  const result = await collectAllRecords(async page => ({
    list: [{ text: '同名事项' }], pagination: { page, pageSize: 1, total: 2 },
  }))
  expect(result.list).toEqual([{ text: '同名事项' }, { text: '同名事项' }])
})

test('同一批次的重复身份也不能伪装成完整列表', async () => {
  await expect(collectAllRecords(async page => ({
    list: [{ id: 1 }, { id: 1 }], pagination: { page, pageSize: 2, total: 2 },
  }))).rejects.toThrow('重复')
})


test('显式行身份覆盖默认 id，保留合法复合行并拒绝字段变化后的重复身份', async () => {
  const identity = (value: unknown) => {
    const row = value as { id: number; warehouseId: number }
    return JSON.stringify([row.id, row.warehouseId])
  }
  const fetch = (overlap: boolean) => async (page: number) => ({
    list: [{ id: 9, warehouseId: overlap ? 1 : page, quantity: page }],
    pagination: { page, pageSize: 1, total: 2 },
  })
  expect((await collectAllRecords(fetch(false), undefined, undefined, identity)).list).toHaveLength(2)
  await expect(collectAllRecords(fetch(true), undefined, undefined, identity)).rejects.toThrow('重复')
})

test('采购预览续页传递并核对首批 snapshotId，禁止混合不同计算结果', async () => {
  const fetch = vi.fn(async (page: number, pageSize?: number, snapshotId?: string) => {
    if (page > 1) expect(snapshotId).toBe('preview-1')
    return { ...batch(page, 3, pageSize ?? 2), snapshotId: 'preview-1' }
  })
  expect((await collectAllRecords(fetch)).list).toHaveLength(3)
  await expect(collectAllRecords(async page => ({ ...batch(page, 3, 2), snapshotId: page === 1 ? 'preview-1' : 'preview-2' }))).rejects.toThrow('变化')
})
