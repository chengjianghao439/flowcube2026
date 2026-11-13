import { expect, test, vi } from 'vitest'
import { getContainerLogsApi } from './inventory'

const get = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ payloadClient: { get } }))

test('容器追溯与抽屉使用同一份带方向的数量', async () => {
  const rows = [
    { type: 1, moveType: 1, qty: 10 },
    { type: 2, moveType: 8, qty: 3 },
    { type: 2, moveType: 8, qty: -1 },
    { type: 2, moveType: 3, qty: 1 },
    { type: 1, moveType: 3, qty: 1 },
    { type: 2, moveType: 4, qty: 2 },
    { type: 1, moveType: 5, qty: 2 },
    { type: 3, moveType: 12, qty: -0.5 },
    { type: 3, moveType: 12, qty: 0.5 },
    { type: 3, moveType: 12, qty: 0 },
  ]
  get.mockResolvedValue(rows)
  const logs = await getContainerLogsApi(14)
  expect(get).toHaveBeenCalledWith('/inventory/containers/14/logs')
  expect(logs.map(log => log.qty)).toEqual([10, -3, -1, -1, 1, -2, 2, -0.5, 0.5, 0])
  expect(rows[1].qty).toBe(3)
})
