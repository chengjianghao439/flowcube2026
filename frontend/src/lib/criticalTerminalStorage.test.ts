// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { compactTerminalAt, reserveTerminalSlot, completeTerminalSlot, matchingCompactTerminal, cancelUnsentTerminalSlot, assertTerminalReadyForPost } from './criticalTerminalStorage'
const DAY = 86400000, NOW = Date.parse('2026-10-13T12:00:00Z')
const prefix = 'pda_owned_terminal_v3:1:'
const record = (key = 'key', createdAt = NOW) => ({ action: 'stockcheck.scan.7', requestAction: 'stockcheck.scan', requestKey: key, createdAt: new Date(createdAt).toISOString(), endpoint: '/api', metadata: { checkId: 7, itemId: 3, requestBody: { scans: [{ barcode: 'SYNTHETIC', countedQty: 2 }] } } })
const marker = (state: 'success' | 'failed' | 'reserved' = 'success', createdAt = NOW) => ({ terminalVersion: 2, requestHash: 'a'.repeat(64), createdAt, state })
function locks() {
 const tails = new Map<string, Promise<unknown>>()
 Object.defineProperty(navigator, 'locks', { configurable: true, value: { request(name: string, callback: () => Promise<unknown>) { const work = (tails.get(name) ?? Promise.resolve()).then(callback); tails.set(name, work.catch(() => {})); return work } } })
}
beforeEach(() => { localStorage.clear(); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); locks(); vi.spyOn(Date, 'now').mockReturnValue(NOW) })
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
test('真实清理合同仍按原created_at七天删除；客户端不能依确认时间续期', () => {
 const scheduler = readFileSync('../backend/src/scheduler.js', 'utf8'), contract = readFileSync('../backend/src/utils/operationRequest.js', 'utf8')
 expect(scheduler).toMatch(/startCleanupSweeper\(\{ intervalMs: 6 \* 60 \* 60 \* 1000, ttlDays: 7 \}\)/)
 expect(contract).toMatch(/created_at < DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/)
})
test('大量旧完整终态原位迁移为固定墓碑，待核正文与其他命名空间字节不变', async () => {
 const pendingKey = 'pda_owned_request_v3:1:unknown', pending = JSON.stringify(record('unknown', NOW - 12 * DAY))
 localStorage.setItem(pendingKey, pending); localStorage.setItem('another-app:data', 'keep')
 for (let i=0;i<100;i++) { const r=record('old'+i); r.metadata.requestBody.scans=Array.from({length:40},(_,n)=>({barcode:'SYNTHETIC-LONG-'+n,countedQty:2})); localStorage.setItem(prefix+r.requestKey,JSON.stringify({record:r,status:'success',data:{items:'result'.repeat(100)}})) }
 const before=Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i)!)!.length).reduce((a,b)=>a+b,0)
 await reserveTerminalSlot(prefix+'new',record('new'))
 const after=Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i)!)!.length).reduce((a,b)=>a+b,0)
 expect(after).toBeLessThan(before/5);expect(localStorage.getItem(pendingKey)).toBe(pending);expect(localStorage.getItem('another-app:data')).toBe('keep')
 expect(JSON.parse(localStorage.getItem(prefix+'old0')!)).toEqual(expect.objectContaining({state:'success',createdAt:NOW}));expect(localStorage.getItem(prefix+'old0')).not.toContain('scans')
})
test('同256KiB人工quota支持100笔完成，只存摘要而非原正文或业务结果', async () => {
 const set=Storage.prototype.setItem
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k:string,v:string){let bytes=2*(k.length+v.length);for(let i=0;i<this.length;i++){const key=this.key(i)!;if(key!==k)bytes+=2*(key.length+this.getItem(key)!.length)}if(bytes>262144)throw new DOMException('synthetic capacity','QuotaExceededError');set.call(this,k,v)})
 for(let i=0;i<100;i++){const r=record('r'+i);await reserveTerminalSlot(prefix+r.requestKey,r);await completeTerminalSlot(prefix+r.requestKey,r,'success')}
 expect(Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k?.startsWith(prefix))).toHaveLength(100)
 expect(localStorage.getItem(prefix+'r1')).not.toContain('SYNTHETIC')
})
test.each(['success','failed'] as const)('仅超过原创建七天+2min回收%s，边界/年轻/未决均不删',async state=>{
 const boundary=NOW-7*DAY-120000
 localStorage.setItem(prefix+'boundary',JSON.stringify(marker(state,boundary)))
 localStorage.setItem(prefix+'older',JSON.stringify(marker(state,boundary-1)))
 localStorage.setItem(prefix+'unknown',JSON.stringify(marker('reserved',NOW-30*DAY)))
 await reserveTerminalSlot(prefix+'new',record('new'))
 expect(localStorage.getItem(prefix+'older')).toBeNull();expect(localStorage.getItem(prefix+'boundary')).not.toBeNull();expect(localStorage.getItem(prefix+'unknown')).not.toBeNull()
})
test('七天-2min起拒绝旧键POST；刚在界内允许预留且不续原createdAt',async()=>{
 const allowed=record('allowed',NOW-7*DAY+120001), expired=record('expired',NOW-7*DAY+120000)
 await reserveTerminalSlot(prefix+'allowed',allowed,true);expect(compactTerminalAt(prefix+'allowed')?.createdAt).toBe(NOW-7*DAY+120001)
 await expect(reserveTerminalSlot(prefix+'expired',expired,true)).rejects.toThrow('安全重试时限');expect(localStorage.getItem(prefix+'expired')).toBeNull()
})
test('旧完整PC终态相位不进入身份摘要，修改正文/另一结果不可冒认',async()=>{
 const key='flowcube-inventory-outbound-v1:terminal:synthetic',r={requestKey:'pc',createdAt:NOW,phase:'pending',body:{quantity:2}}
 localStorage.setItem(key,JSON.stringify({...r,phase:'success',result:{afterQty:1}}))
 await reserveTerminalSlot(prefix+'new',record('new'));expect((await matchingCompactTerminal(key,r))?.state).toBe('success')
 await expect(reserveTerminalSlot(key,r,true)).rejects.toThrow('已有确认记录');await expect(matchingCompactTerminal(key,{...r,body:{quantity:3}})).rejects.toThrow('正文不一致');await expect(completeTerminalSlot(key,r,'failed')).rejects.toThrow('结果冲突')
})
test('年轻墓碑满时不逐出，不清未知槽；共用预算锁只允许一个剩余容量预留',async()=>{
 const slotKey=prefix+'request-a',slotRaw=JSON.stringify(marker('reserved')),slotBytes=2*(slotKey.length+slotRaw.length)
 const fillerKey=prefix+'F'.repeat(Math.floor((1048576-slotBytes)/2)-prefix.length-JSON.stringify(marker()).length)
 localStorage.setItem(fillerKey,JSON.stringify(marker()))
 const results=await Promise.allSettled([reserveTerminalSlot(slotKey,record('request-a')),reserveTerminalSlot(prefix+'request-b',record('request-b'))])
 expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);expect(localStorage.getItem(fillerKey)).not.toBeNull();expect(localStorage.getItem(slotKey)).not.toBeNull()
})
test('4096个未决槽绝不驱逐，新增因自占数量/字节硬上限拒绝',async()=>{
 for(let i=0;i<4096;i++)localStorage.setItem(prefix+i,JSON.stringify(marker('reserved',NOW-30*DAY)))
 await expect(reserveTerminalSlot(prefix+'next',record('next'))).rejects.toThrow('容量已满');expect(localStorage.getItem(prefix+'0')).not.toBeNull();expect(localStorage.length).toBe(4097) // One constant-size sealed clock plus 4096 unchanged slots.
})
test('预留成功后确认写失败留原槽，重查原成功可以补齐，不换键',async()=>{
 const r=record();await reserveTerminalSlot(prefix+'key',r)
 const set=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,v){if(k===prefix+'key'&&v.includes('success'))throw Error('synthetic quota');set.call(this,k,v)})
 await expect(completeTerminalSlot(prefix+'key',r,'success')).rejects.toThrow('quota');expect(compactTerminalAt(prefix+'key')?.state).toBe('reserved')
 vi.restoreAllMocks();await completeTerminalSlot(prefix+'key',r,'success');expect(compactTerminalAt(prefix+'key')?.state).toBe('success')
})
test.each([NaN,0,NOW+120001])('异常原创建时间%s不发送且不清理恢复源',async createdAt=>{
 const r={...record(),createdAt};localStorage.setItem('pda_owned_request_v3:1:key',JSON.stringify(r))
 await expect(reserveTerminalSlot(prefix+'key',r)).rejects.toThrow();expect(localStorage.getItem('pda_owned_request_v3:1:key')).not.toBeNull()
})
test('时钟前跳回收后若又回退，旧键与新POST均停止；GET墓碑身份仍可核对',async()=>{
 const r=record();await reserveTerminalSlot(prefix+'key',r);await completeTerminalSlot(prefix+'key',r,'success')
 vi.mocked(Date.now).mockReturnValue(NOW+8*DAY);await reserveTerminalSlot(prefix+'later',record('later',NOW+8*DAY));expect(localStorage.getItem(prefix+'key')).toBeNull()
 vi.mocked(Date.now).mockReturnValue(NOW);await expect(reserveTerminalSlot(prefix+'key',r,true)).rejects.toThrow('设备时间');await expect(reserveTerminalSlot(prefix+'new',record('new'))).rejects.toThrow('设备时间')
})
test('损坏墓碑/失败本地存储不清数据，不允许新首次预留',async()=>{
 localStorage.setItem(prefix+'damaged',JSON.stringify({...marker(),createdAt:'bad'}))
 await expect(reserveTerminalSlot(prefix+'key',record())).rejects.toThrow();expect(localStorage.getItem(prefix+'damaged')).not.toBeNull()
 localStorage.removeItem(prefix+'damaged');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('synthetic denied')});await expect(reserveTerminalSlot(prefix+'key',record())).rejects.toThrow('denied');expect(localStorage.getItem(prefix+'key')).toBeNull()
})
test('只允许明确未发送时释放reserved，已成功墓碑不能由取消路径删除',async()=>{
 const r=record();await reserveTerminalSlot(prefix+'key',r);await cancelUnsentTerminalSlot(prefix+'key',r);expect(localStorage.getItem(prefix+'key')).toBeNull()
 await reserveTerminalSlot(prefix+'key',r);await completeTerminalSlot(prefix+'key',r,'success');await cancelUnsentTerminalSlot(prefix+'key',r);expect(localStorage.getItem(prefix+'key')).not.toBeNull()
})

test.each(['flowcube-ordinary-sale-v1:terminal:','flowcube-procurement-intent-v1:terminal:'])('%s 未决槽与PC/PDA共用4096上限，不靠另一个命名空间规避预算',async salePrefix=>{
 for(let i=0;i<4096;i++)localStorage.setItem(salePrefix+i,JSON.stringify(marker('reserved',NOW-30*DAY)))
 await expect(reserveTerminalSlot(prefix+'next',record('next'))).rejects.toThrow('容量已满')
 expect(localStorage.getItem(salePrefix+'0')).not.toBeNull();expect(localStorage.length).toBe(4097)
})
test.each(['flowcube-ordinary-sale-v1:terminal:','flowcube-procurement-intent-v1:terminal:'])('%s 终态按原创建七天回收；未知槽和查询身份存储均保留',async salePrefix=>{
 const queryKey=salePrefix.replace('terminal:','request:')+'unknown'
 localStorage.setItem(salePrefix+'old',JSON.stringify(marker('success',NOW-8*DAY)))
 localStorage.setItem(salePrefix+'young',JSON.stringify(marker('failed')))
 localStorage.setItem(salePrefix+'unknown',JSON.stringify(marker('reserved',NOW-30*DAY)))
 const queryRaw=JSON.stringify({action:'sale.ship:7',requestKey:'unknown'});localStorage.setItem(queryKey,queryRaw)
 await reserveTerminalSlot(prefix+'next',record('next'))
 expect(localStorage.getItem(salePrefix+'old')).toBeNull();expect(localStorage.getItem(salePrefix+'young')).not.toBeNull()
 expect(localStorage.getItem(salePrefix+'unknown')).not.toBeNull();expect(localStorage.getItem(queryKey)).toBe(queryRaw)
})

test('前跳GC后遇坏墓碑失败仍先seal；回拨不能让旧副本复活POST',async()=>{
 const r=record();await reserveTerminalSlot(prefix+'key',r);await completeTerminalSlot(prefix+'key',r,'success')
 localStorage.setItem(prefix+'bad',JSON.stringify({terminalVersion:2,createdAt:'bad'}))
 vi.mocked(Date.now).mockReturnValue(NOW+8*DAY)
 await expect(reserveTerminalSlot(prefix+'future',record('future',NOW+8*DAY))).rejects.toThrow();expect(localStorage.getItem(prefix+'key')).toBeNull()
 localStorage.removeItem(prefix+'bad');vi.mocked(Date.now).mockReturnValue(NOW)
 await expect(reserveTerminalSlot(prefix+'key',r,true)).rejects.toThrow('设备时间')
})
test('GC前clock写失败保持旧墓碑原字节，legacy确认路径也先seal',async()=>{
 const r=record(),original=JSON.stringify({record:r,status:'success',data:{value:'full-before'}});localStorage.setItem(prefix+'key',original)
 vi.mocked(Date.now).mockReturnValue(NOW+8*DAY)
 const set=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,v){if(k==='flowcube-critical-terminal-clock-v2')throw Error('synthetic clock denied');set.call(this,k,v)})
 await expect(completeTerminalSlot(prefix+'other',record('other',NOW+8*DAY),'success')).rejects.toThrow('clock denied');expect(localStorage.getItem(prefix+'key')).toBe(original)
 await expect(reserveTerminalSlot(prefix+'future',record('future',NOW+8*DAY))).rejects.toThrow('clock denied');expect(localStorage.getItem(prefix+'key')).toBe(original)
})

test.each(['null','"broken"','0'])('损坏最高时钟%s保守拒发，不GC旧记录',async clock=>{
 const old=JSON.stringify(marker('success',NOW-8*DAY));localStorage.setItem(prefix+'old',old);localStorage.setItem('flowcube-critical-terminal-clock-v2',clock)
 await expect(reserveTerminalSlot(prefix+'new',record('new'))).rejects.toThrow('设备时间');expect(localStorage.getItem(prefix+'old')).toBe(old)
})

test('异步预留后才跨七天-2min边界，最后同步守卫拒绝POST',async()=>{
 const r=record(),ticket=await reserveTerminalSlot(prefix+'key',r)
 vi.mocked(Date.now).mockReturnValue(NOW+7*DAY-120001);expect(()=>assertTerminalReadyForPost(prefix+'key',r,ticket)).not.toThrow()
 vi.mocked(Date.now).mockReturnValue(NOW+7*DAY-120000);expect(()=>assertTerminalReadyForPost(prefix+'key',r,ticket)).toThrow('安全重试时限')
})
test('异步预留后另一窗口确认成功/当前正文改变/身份摘要改变，迟到发送全部阻断',async()=>{
 const r=record(),ticket=await reserveTerminalSlot(prefix+'key',r)
 expect(()=>assertTerminalReadyForPost(prefix+'key',{...r,metadata:{...r.metadata,itemId:4}},ticket)).toThrow('已变化')
 localStorage.setItem(prefix+'key',JSON.stringify({...compactTerminalAt(prefix+'key'),requestHash:'b'.repeat(64)}));expect(()=>assertTerminalReadyForPost(prefix+'key',r,ticket)).toThrow('已变化')
 localStorage.setItem(prefix+'key',JSON.stringify({terminalVersion:2,requestHash:ticket.requestHash,createdAt:ticket.createdAt,state:'success'}));expect(()=>assertTerminalReadyForPost(prefix+'key',r,ticket)).toThrow('已变化')
})

function fullQuotaFixture() {
 const r=record('legacy');r.metadata.requestBody.scans=Array.from({length:200},(_,i)=>({barcode:`SYNTHETIC-${i}-`+'X'.repeat(64),countedQty:1}))
 const fullKey=prefix+'legacy',fullRaw=JSON.stringify({record:r,status:'success',data:{itemId:3,actualQty:200}}),pendingKey='pda_owned_request_v3:1:unknown',pendingRaw=JSON.stringify(record('unknown')),reservedKey=prefix+'reserved',reservedRaw=JSON.stringify(marker('reserved',NOW-30*DAY))
 localStorage.setItem(fullKey,fullRaw);localStorage.setItem(pendingKey,pendingRaw);localStorage.setItem(reservedKey,reservedRaw)
 const bytes=()=>Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)!).reduce((n,k)=>n+2*(k.length+localStorage.getItem(k)!.length),0),limit=bytes(),set=Storage.prototype.setItem
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k:string,v:string){const projected=bytes()-2*(this.getItem(k)==null?0:k.length+this.getItem(k)!.length)+2*(k.length+v.length);if(projected>limit)throw new DOMException('synthetic exact-full quota','QuotaExceededError');set.call(this,k,v)})
 return {r,fullKey,fullRaw,pendingKey,pendingRaw,reservedKey,reservedRaw,bytes,limit,set}
}
test('quota恰满且无CLOCK，原位终态与时间同写后可迁移预留；未决/年轻成功不删',async()=>{
 const f=fullQuotaFixture();expect(localStorage.getItem('flowcube-critical-terminal-clock-v2')).toBeNull()
 const ticket=await reserveTerminalSlot(prefix+'new',record('new'));assertTerminalReadyForPost(prefix+'new',record('new'),ticket)
 expect(f.bytes()).toBeLessThan(f.limit/5);expect(localStorage.getItem('flowcube-critical-terminal-clock-v2')).toBe(String(NOW));expect(compactTerminalAt(f.fullKey)?.state).toBe('success')
 expect((await matchingCompactTerminal(f.fullKey,f.r))?.state).toBe('success');expect(localStorage.getItem(f.pendingKey)).toBe(f.pendingRaw);expect(localStorage.getItem(f.reservedKey)).toBe(f.reservedRaw)
 await expect(reserveTerminalSlot(f.fullKey,f.r,true)).rejects.toThrow('已有确认记录')
})
test('quota bootstrap之后CLOCK仍失败，seal可跨调用阻回拨，GC不删除已成功/未决',async()=>{
 const f=fullQuotaFixture();vi.mocked(Date.now).mockReturnValue(NOW+8*DAY)
 vi.mocked(Storage.prototype.setItem).mockImplementation(function(this:Storage,k:string,v:string){if(k==='flowcube-critical-terminal-clock-v2')throw new DOMException('synthetic clock quota','QuotaExceededError');f.set.call(this,k,v)})
 await expect(reserveTerminalSlot(prefix+'future',record('future',NOW+8*DAY))).rejects.toThrow('clock quota')
 expect(compactTerminalAt(f.fullKey)).toEqual(expect.objectContaining({state:'success',createdAt:NOW,clockSeal:NOW+8*DAY}));expect(localStorage.getItem('flowcube-critical-terminal-clock-v2')).toBeNull();expect(localStorage.getItem(f.pendingKey)).toBe(f.pendingRaw);expect(localStorage.getItem(f.reservedKey)).toBe(f.reservedRaw);expect(localStorage.getItem(prefix+'future')).toBeNull()
 vi.mocked(Date.now).mockReturnValue(NOW);await expect(reserveTerminalSlot(prefix+'new',record('new'))).rejects.toThrow('设备时间');expect(localStorage.getItem(f.fullKey)).not.toBeNull()
})
test('CLOCK永久quota中断后另一调用提升seal，时间已持久才GC；旧键过期仍不能重建',async()=>{
 const f=fullQuotaFixture();vi.mocked(Date.now).mockReturnValue(NOW+8*DAY)
 vi.mocked(Storage.prototype.setItem).mockImplementation(function(this:Storage,k:string,v:string){if(k==='flowcube-critical-terminal-clock-v2')throw new DOMException('synthetic quota','QuotaExceededError');f.set.call(this,k,v)})
 await expect(reserveTerminalSlot(prefix+'future',record('future',NOW+8*DAY))).rejects.toThrow('quota');expect(localStorage.getItem(f.fullKey)).not.toBeNull()
 vi.restoreAllMocks();vi.spyOn(Date,'now').mockReturnValue(NOW+8*DAY)
 await reserveTerminalSlot(prefix+'later',record('later',NOW+8*DAY));expect(localStorage.getItem('flowcube-critical-terminal-clock-v2')).toBe(String(NOW+8*DAY));expect(localStorage.getItem(f.fullKey)).toBeNull()
 await expect(reserveTerminalSlot(f.fullKey,f.r,true)).rejects.toThrow('安全重试时限');expect(localStorage.getItem(f.pendingKey)).toBe(f.pendingRaw);expect(localStorage.getItem(f.reservedKey)).toBe(f.reservedRaw)
})
test('quota bootstrap原位seal静默未写必须停，保留全部原字节不GC',async()=>{
 const f=fullQuotaFixture();vi.mocked(Date.now).mockReturnValue(NOW+8*DAY)
 vi.mocked(Storage.prototype.setItem).mockImplementation(function(this:Storage,k:string,v:string){if(k==='flowcube-critical-terminal-clock-v2')throw new DOMException('synthetic quota','QuotaExceededError');if(k===f.fullKey&&v.includes('clockSeal'))return;f.set.call(this,k,v)})
 await expect(reserveTerminalSlot(prefix+'future',record('future',NOW+8*DAY))).rejects.toThrow('未能保存');expect(localStorage.getItem(f.fullKey)).toBe(f.fullRaw);expect(localStorage.getItem(f.pendingKey)).toBe(f.pendingRaw);expect(localStorage.getItem(f.reservedKey)).toBe(f.reservedRaw)
})
test('CLOCK静默失败不是quota，禁止借此压缩/GC；异常seal/日期同样拒发',async()=>{
 const f=fullQuotaFixture();vi.mocked(Storage.prototype.setItem).mockImplementation(function(this:Storage,k:string,v:string){if(k==='flowcube-critical-terminal-clock-v2')return;f.set.call(this,k,v)})
 await expect(reserveTerminalSlot(prefix+'new',record('new'))).rejects.toThrow('未能保存');expect(localStorage.getItem(f.fullKey)).toBe(f.fullRaw)
 vi.restoreAllMocks();localStorage.setItem(f.fullKey,JSON.stringify({...marker(),clockSeal:'bad'}));await expect(reserveTerminalSlot(prefix+'new',record('new'))).rejects.toThrow('最高时间记录损坏')
})
test('全quota只有pending/reserved或不可验证full终态，不能为CLOCK清除它们',async()=>{
 const f=fullQuotaFixture();vi.restoreAllMocks();localStorage.removeItem(f.fullKey);localStorage.setItem(f.fullKey,JSON.stringify({record:f.r,status:'pending'}))
 const used=f.bytes(),set=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,v){if(this.getItem(k)==null&&k==='flowcube-critical-terminal-clock-v2')throw new DOMException('synthetic exact full','QuotaExceededError');set.call(this,k,v)})
 await expect(reserveTerminalSlot(prefix+'new',record('new'))).rejects.toThrow('exact full');expect(f.bytes()).toBe(used);expect(localStorage.getItem(f.pendingKey)).toBe(f.pendingRaw);expect(localStorage.getItem(f.reservedKey)).toBe(f.reservedRaw)
})
test('满quota两个窗口预留共享锁，一份bootstrap保持旧成功身份与各自唯一reserved',async()=>{
 const f=fullQuotaFixture(),results=await Promise.all([reserveTerminalSlot(prefix+'a',record('a')),reserveTerminalSlot(prefix+'b',record('b'))])
 results.forEach((t,i)=>assertTerminalReadyForPost(prefix+(i?'b':'a'),record(i?'b':'a'),t));expect(compactTerminalAt(f.fullKey)?.state).toBe('success');expect(compactTerminalAt(f.fullKey)?.clockSeal).toBeUndefined();expect(localStorage.getItem(f.pendingKey)).toBe(f.pendingRaw);expect(localStorage.getItem(f.reservedKey)).toBe(f.reservedRaw)
})
test('bootstrap SHA await期间旧full变了，原位替换前必须停，当前记录不覆写',async()=>{
 const f=fullQuotaFixture(),digest=webcrypto.subtle.digest.bind(webcrypto.subtle),changed=JSON.stringify({record:f.r,status:'failed',data:null})
 vi.spyOn(webcrypto.subtle,'digest').mockImplementation(async(...args)=>{const value=await digest(...args);f.set.call(localStorage,f.fullKey,changed);return value})
 await expect(reserveTerminalSlot(prefix+'new',record('new'))).rejects.toThrow('记录已变化');expect(localStorage.getItem(f.fullKey)).toBe(changed);expect(localStorage.getItem(f.pendingKey)).toBe(f.pendingRaw);expect(localStorage.getItem('flowcube-critical-terminal-clock-v2')).toBeNull()
})

test('不允许把bootstrap时间封进reserved，取消未发送槽不能误删最高时间',async()=>{
 const r=record(),ticket=await reserveTerminalSlot(prefix+'key',r),slot=compactTerminalAt(prefix+'key')!
 localStorage.setItem(prefix+'key',JSON.stringify({...slot,clockSeal:NOW}));localStorage.removeItem('flowcube-critical-terminal-clock-v2')
 await expect(cancelUnsentTerminalSlot(prefix+'key',r)).rejects.toThrow('记录损坏');await expect(reserveTerminalSlot(prefix+'new',record('new'))).rejects.toThrow('最高时间记录损坏');expect(localStorage.getItem(prefix+'key')).not.toBeNull();expect(ticket.createdAt).toBe(NOW)
})
