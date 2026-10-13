import { vi } from 'vitest'
/** 每个真实页面用例配置它所需的合成读取值，保留实际页面、hooks与查询状态转换。 */
export const readData = new Map<string, unknown>()
export const readCalls: { api: string; operation: string; args: unknown[] }[] = []
export const writeCalls: string[] = []
export function mockReadApi(original: Record<string, unknown>, api: string) {
 return Object.fromEntries(Object.entries(original).map(([name,value])=>[name,typeof value!=='function'||!name.endsWith('Api')?value:
  /^(get|list|read|search|fetch)/.test(name)?vi.fn(async(...args:unknown[])=>{
   readCalls.push({api,operation:name,args});const fixture=readData.get(api+'.'+name)??[]
   return typeof fixture==='function'?fixture(...args):structuredClone(fixture)
  }):vi.fn(()=>{writeCalls.push(api+'.'+name);throw new Error('Unexpected test write '+api+'.'+name)})]))
}
export const paged = (row: object, total=1) => ({list:[row],pagination:{total,page:1,pageSize:200},total,page:1,pageSize:200})
export function lastRead(api:string,operation:string){return readCalls.filter(c=>c.api===api&&c.operation===operation).at(-1)}
export function clearReadFixtures(){readData.clear();readCalls.length=0;writeCalls.length=0}
