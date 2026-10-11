// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { TextEncoder } from 'node:util'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { useInboundTaskCreateRecovery, inboundCreateFingerprint } from './useInboundTaskCreateRecovery'
import { useAuthStore } from '@/store/authStore'
import { setApiClientBaseURL } from '@/api/client'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import type { User } from '@/types'
const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/api/inbound-tasks', () => ({ createInboundTaskApi: api.post }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.get }))
vi.mock('@/hooks/useInvalidate', () => ({ useInvalidate: () => api.invalidate }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined, active = true, uid = 82000
const hooks: ReturnType<typeof useInboundTaskCreateRecovery>[] = []
const body = () => ({ supplierId: 5, supplierName: '合成供', remark: '原正文', freightType: 2 as const, freightAmount: 0, items: [{ purchaseItemId: 31, qty: 1.25 }] })
const keys = () => Object.keys(localStorage).filter(k => k.startsWith('flowcube-inbound-create-v1:request:'))
const bytes = () => keys().map(k => [k, localStorage.getItem(k)])
const login = (id = uid, permissions = [P.INBOUND_ORDER_CREATE, P.INBOUND_ORDER_VIEW]) => act(() => useAuthStore.getState().login('synthetic', null, { id, roleId: 99, permissions } as User))
function Probe({ index }: { index: number }) { hooks[index] = useInboundTaskCreateRecovery(active); return null }
async function mount() { root = createRoot(document.createElement('div')); await act(async () => root!.render(<><Probe index={0} /><Probe index={1} /></>)) }
async function remount() { await act(async () => root?.unmount()); await mount() }
const submit = async (index = 0) => act(async () => { await hooks[index].submit(body(), 2) })
const query = async () => act(async () => { await hooks[0].queryOriginal() })
const retry = async () => act(async () => { await hooks[0].retry() })
const success = () => ({ taskId: 81, taskNo: 'IT81', warehouseId: 2, requestFingerprint: hooks[0].pendingRecord!.fingerprint })
beforeEach(() => { uid++; active = true; localStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder); setApiClientBaseURL('/api'); api.post.mockReset().mockRejectedValue(new Error('丢失响应')); api.get.mockReset().mockResolvedValue({ status: 'not_found', data: null }); api.invalidate.mockClear(); login() })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; act(() => useAuthStore.getState().logout()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
test('首发真实POST前持久化原body/key；刷新/重开只恢复，不自动POST，查询成功只一张', async () => {
 await mount(); await submit(); const original = hooks[0].pendingRecord!, saved = bytes(); expect(api.post).toHaveBeenCalledWith(original.body, expect.objectContaining({automaticReplay:false}), original.requestKey)
 await remount(); expect(bytes()).toEqual(saved); expect(hooks[0].pendingRecord).toEqual(original); expect(api.post).toHaveBeenCalledTimes(1)
 api.get.mockResolvedValue({status:'success',resourceType:'inbound_task',resourceId:81,data:success()});await query();expect(api.post).toHaveBeenCalledTimes(1);expect(keys()).toHaveLength(0)
})
test('未主动查询不得重试；新鲜not_found才显式同key同body；重试前再次GET', async () => {
 await mount();await submit();const original=hooks[0].pendingRecord!;await retry();expect(api.post).toHaveBeenCalledTimes(1)
 await query();expect(hooks[0].canRetry).toBe(true);api.post.mockResolvedValue(success());await retry();expect(api.get).toHaveBeenCalledTimes(2);expect(api.post.mock.calls[1]).toEqual([original.body,expect.objectContaining({baseURL:original.baseURL,automaticReplay:false}),original.requestKey]);expect(keys()).toHaveLength(0)
})
test('提交正文在任何await前深拷贝，后改表单不能改变原请求', async () => {
 await mount();const payload=body();await act(async()=>{const p=hooks[0].submit(payload,2);payload.items[0].qty=99;payload.remark='后改';await p});expect(hooks[0].pendingRecord!.body).toEqual(body())
})
test('同tick两hook只发一笔；另一提交不能另造新key', async () => {
 await mount();await act(async()=>{await Promise.all([hooks[0].submit(body(),2),hooks[1].submit({...body(),remark:'另一表单'},2)])});expect(api.post).toHaveBeenCalledTimes(1);expect(keys()).toHaveLength(1)
})
test.each([400,403,409,500])('无事务未执行证明%s始终冻结，不能新key盲重试', async status=>{
 await mount();api.post.mockRejectedValue({status,message:'拒绝/未知'});await submit();const original=bytes();await submit();expect(bytes()).toEqual(original);expect(api.post).toHaveBeenCalledTimes(1)
})
test('明确首发已回滚允许修改后新创建；恢复重试同类4xx不能否定原未知',async()=>{
 await mount();api.post.mockRejectedValue({status:400,data:{inboundCreateNotExecuted:true},message:'已回滚'});await submit();const key=api.post.mock.calls[0][2];expect(keys()).toHaveLength(0);expect(hooks[0].settledRecord?.phase).toBe('failed');await act(async()=>{expect(hooks[0].consumeTerminal(key)).toBe(true)})
 api.post.mockRejectedValue(new Error('丢响应'));await submit();expect(hooks[0].pendingRecord!.requestKey).not.toBe(key);await query();api.post.mockRejectedValue({status:400,data:{inboundCreateNotExecuted:true}});await retry();expect(hooks[0].pendingRecord).not.toBeNull()
})
test('创建权撤回保留查看查询；查看权撤回不读服务器、不再创建',async()=>{
 await mount();await submit();const original=bytes();login(uid,[P.INBOUND_ORDER_VIEW]);await submit();await query();expect(api.post).toHaveBeenCalledTimes(1);expect(api.get).toHaveBeenCalledTimes(1);expect(hooks[0].canRetry).toBe(false);expect(bytes()).toEqual(original)
 login(uid,[]);await query();expect(api.get).toHaveBeenCalledTimes(1);expect(bytes()).toEqual(original)
})
test('不同账号/服务器不读旧body，不发送原POST；返回原身份重挂仍能查',async()=>{
 await mount();await submit();const original=bytes();login(uid+1);await query();expect(api.get).not.toHaveBeenCalled();expect(hooks[0].pendingRecord).toBeNull();expect(bytes()).toEqual(original)
 login();setApiClientBaseURL('http://127.0.0.1:59999/api');await query();expect(api.get).not.toHaveBeenCalled();setApiClientBaseURL('/api');await remount();await query();expect(api.get).toHaveBeenCalledTimes(1);expect(bytes()).toEqual(original)
})
test('未知或failed回执、不匹配仓库/指纹/资源都保留，不生成新身份',async()=>{
 await mount();await submit();for(const receipt of [{status:'pending'},{status:'failed'}, {status:'success',resourceType:'inbound_task',resourceId:81,data:{...success(),warehouseId:9}}, {status:'success',resourceType:'inbound_task',resourceId:81,data:{...success(),requestFingerprint:'f'.repeat(64)}}]){api.get.mockResolvedValue(receipt);await query();expect(keys()).toHaveLength(1);expect(hooks[0].canRetry).toBe(false)}expect(api.post).toHaveBeenCalledTimes(1)
})
test('七天过期、存储损坏、同域多份原记录均阻断，保留原证据',async()=>{
 await mount();await submit();const key=keys()[0],record=hooks[0].pendingRecord!;localStorage.setItem(key,JSON.stringify({...record,createdAt:Date.now()-8*86400000}));await remount();await query();expect(hooks[0].canRetry).toBe(false);expect(hooks[0].error).toContain('已过期')
 localStorage.setItem(key,'broken');await remount();await submit();expect(api.post).toHaveBeenCalledTimes(1);expect(localStorage.getItem(key)).toBe('broken')
 localStorage.setItem(key,JSON.stringify(record));const second={...record,requestKey:'other-key'},other='flowcube-inbound-create-v1:request:'+encodeURIComponent(JSON.stringify([record.userId,record.baseURL,second.requestKey]));localStorage.setItem(other,JSON.stringify(second));await remount();await query();expect(hooks[0].error).toContain('多笔');expect(keys()).toHaveLength(2)
})
test('首发存储失败不POST；成功终态清理失败重挂只清理，不新建',async()=>{
 await mount();const originalSet=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this: Storage,k,v){if(k.startsWith('flowcube-inbound-create'))throw Error('磁盘');return originalSet.call(this,k,v)});await submit();expect(api.post).not.toHaveBeenCalled();vi.restoreAllMocks();await remount();await submit()
 api.get.mockResolvedValue({status:'success',resourceType:'inbound_task',resourceId:81,data:success()});const remove=Storage.prototype.removeItem;vi.spyOn(Storage.prototype,'removeItem').mockImplementation(function(this: Storage,k){if(k.startsWith('flowcube-inbound-create'))throw Error('清理');return remove.call(this,k)});await query();expect(hooks[0].pendingRecord?.phase).toBe('confirmed');vi.restoreAllMocks();await remount();await query();expect(keys()).toHaveLength(0);expect(api.post).toHaveBeenCalledTimes(1)
})
test('隐藏/取消挂载后迟到回执不能导航或删原记录；重新进入查询确认',async()=>{
 await mount();let release!:(v:unknown)=>void;api.post.mockImplementation(()=>new Promise(r=>{release=r}));let pending!:Promise<unknown>;await act(async()=>{pending=hooks[0].submit(body(),2)});await act(async()=>{await vi.waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1))});const record=hooks[0].pendingRecord!;active=false;await act(async()=>root!.render(<Probe index={0}/>));await act(async()=>{release({taskId:81,taskNo:'IT81',warehouseId:2,requestFingerprint:record.fingerprint});await pending});expect(keys()).toHaveLength(1);expect(api.invalidate).not.toHaveBeenCalled();active=true;await remount();expect(api.post).toHaveBeenCalledTimes(1)
})
test('指纹按实际JSON键排序稳定并与后端规则相同',async()=>{expect(await inboundCreateFingerprint(body())).toBe('73b915f962047ac7f32861ecfad24143d77f2a3ccfa4b5d457f52767c78954b8');expect(await inboundCreateFingerprint({...body(),items:body().items})).toBe(await inboundCreateFingerprint(body()))})

test('原结果已完成而页面尚未消费时持续阻断；消费只关联原key',async()=>{
 await mount();await submit();const original=hooks[0].pendingRecord!;api.get.mockResolvedValue({status:'success',resourceType:'inbound_task',resourceId:81,data:success()});await query()
 expect(keys()).toHaveLength(0);expect(hooks[1].settledRecord?.requestKey).toBe(original.requestKey);expect(hooks[1].blocked).toBe(true);await submit(1);expect(api.post).toHaveBeenCalledTimes(1)
 await act(async()=>{expect(hooks[1].consumeTerminal('other-key')).toBe(false);expect(hooks[1].consumeTerminal(original.requestKey)).toBe(true)});expect(hooks[1].blocked).toBe(false)
 expect(Object.keys(localStorage).some(k=>k.startsWith('flowcube-inbound-create-v1:terminal:'))).toBe(true)
})
test('完成记录与原正文不一致或损坏时不能消费，保留原证据且阻断',async()=>{
 await mount();await submit();const original=hooks[0].pendingRecord!,key=keys()[0],terminalKey=key.replace(':request:',':terminal:')
 await act(async()=>{localStorage.setItem(terminalKey,JSON.stringify({...original,fingerprint:'f'.repeat(64),phase:'failed'}));localStorage.removeItem(key);window.dispatchEvent(new StorageEvent('storage',{key:terminalKey}))})
 expect(hooks[0].blocked).toBe(true);await act(async()=>{expect(hooks[0].consumeTerminal(original.requestKey)).toBe(false)});await submit();expect(api.post).toHaveBeenCalledTimes(1);expect(localStorage.getItem(terminalKey)).not.toBeNull()
})
test('终态保存失败保留confirmed请求；恢复后只清理，不发第二个POST',async()=>{
 await mount();await submit();const original=hooks[0].pendingRecord!,set=Storage.prototype.setItem;api.get.mockResolvedValue({status:'success',resourceType:'inbound_task',resourceId:81,data:success()})
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,v){if(k.startsWith('flowcube-inbound-create-v1:terminal:'))throw Error('终态磁盘故障');return set.call(this,k,v)});await query();expect(hooks[0].pendingRecord?.phase).toBe('confirmed');expect(hooks[0].blocked).toBe(true)
 vi.restoreAllMocks();await remount();await query();await act(async()=>{expect(hooks[0].consumeTerminal(original.requestKey)).toBe(true)});expect(keys()).toHaveLength(0);expect(api.post).toHaveBeenCalledTimes(1)
})
test('未消费终态期间换账号/服务器不可应用，回原身份才能消费',async()=>{
 await mount();await submit();const original=hooks[0].pendingRecord!;api.get.mockResolvedValue({status:'success',resourceType:'inbound_task',resourceId:81,data:success()});await query()
 login(uid+1);expect(hooks[0].settledRecord).toBeNull();await act(async()=>{expect(hooks[0].consumeTerminal(original.requestKey)).toBe(false)});login();await act(async()=>setApiClientBaseURL('http://127.0.0.1:59999/api'));expect(hooks[0].settledRecord).toBeNull();await act(async()=>{expect(hooks[0].consumeTerminal(original.requestKey)).toBe(false)})
 await act(async()=>setApiClientBaseURL('/api'));await act(async()=>{expect(hooks[0].consumeTerminal(original.requestKey)).toBe(true)});expect(api.post).toHaveBeenCalledTimes(1)
})
