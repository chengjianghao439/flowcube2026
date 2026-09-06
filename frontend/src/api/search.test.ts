import {expect,test,vi,beforeEach} from 'vitest'
import {searchGlobalApi} from './search'
import {payloadClient} from './client'
vi.mock('./client',()=>({payloadClient:{get:vi.fn()}}))
vi.mock('@/store/authStore',()=>({useAuthStore:{getState:()=>({sessionGeneration:4})}}))
beforeEach(()=>vi.mocked(payloadClient.get).mockReset())
test('搜索自动读完所有类别游标，保持关键词和登录范围',async()=>{
  vi.mocked(payloadClient.get).mockResolvedValueOnce({items:[{id:30,type:'customer'}],nextCursors:{customer:30,sale:15}})
    .mockResolvedValueOnce({items:[{id:20,type:'customer'}],nextCursors:{customer:20}})
    .mockResolvedValueOnce({items:[{id:10,type:'customer'}],nextCursors:{customer:null}})
    .mockResolvedValueOnce({items:[{id:1,type:'sale'}],nextCursors:{sale:null}})
  const response=await searchGlobalApi('客户')
  expect(response.items).toHaveLength(4)
  expect(response.nextCursors).toEqual({})
  expect(payloadClient.get).toHaveBeenCalledTimes(4)
  for(const [,config] of vi.mocked(payloadClient.get).mock.calls){expect(config?.params.q).toBe('客户');expect(config?._authSessionGeneration).toBe(4)}
})
test('续批失败或游标未推进，不返回残缺结果',async()=>{
  vi.mocked(payloadClient.get).mockResolvedValueOnce({items:[{id:30}],nextCursors:{customer:30}}).mockRejectedValueOnce(new Error('网络失败'))
  await expect(searchGlobalApi('客户')).rejects.toThrow('网络失败')
  vi.mocked(payloadClient.get).mockResolvedValueOnce({items:[{id:30}],nextCursors:{customer:30}}).mockResolvedValueOnce({items:[{id:30}],nextCursors:{customer:30}})
  await expect(searchGlobalApi('客户')).rejects.toThrow('变化')
})
