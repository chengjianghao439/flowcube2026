// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { beforeEach, afterEach, expect, test } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useWorkspaceSearchParams, useWorkspacePath } from './useWorkspaceSearchParams'
let host: HTMLDivElement, root: Root, navigate: NavigateFunction
const observed: string[] = []
function Probe({ name }: { name: string }) {
 const [params,setParams] = useWorkspaceSearchParams(); const path=useWorkspacePath()
 useEffect(() => { observed.push(name+':'+params.toString()) },[name,params])
 return <section data-name={name}><output>{path+'|'+params.toString()}</output><button onClick={()=>setParams(prev=>{prev.set('keyword',name);return prev})}>change {name}</button><button onClick={()=>setParams({range:'all'})}>reset {name}</button></section>
}
function Harness({ scoped = true }: { scoped?: boolean }) {
 const location=useLocation();navigate=useNavigate()
 return <><output data-location>{location.pathname+location.search}</output>{scoped ? <><TabPathContext.Provider value={location.pathname==='/purchase'?location.pathname+location.search:'/purchase?keyword=PO'}><SectionVisibilityContext.Provider value={location.pathname==='/purchase'}><Probe name="purchase"/></SectionVisibilityContext.Provider></TabPathContext.Provider><TabPathContext.Provider value="/transfer?keyword=TR"><SectionVisibilityContext.Provider value={false}><Probe name="transfer"/></SectionVisibilityContext.Provider></TabPathContext.Provider></> : <Probe name="fallback"/>}</>
}
const click=async(label:string)=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!.click())
const current=()=>host.querySelector('[data-location]')!.textContent
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});observed.length=0;host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
test('隐藏列表不读取其他标签的query、不写其他URL，参数对象不无谓变化',async()=>{
 await act(async()=>root.render(<MemoryRouter initialEntries={['/purchase?keyword=PO']}><Harness/></MemoryRouter>));observed.length=0
 await act(async()=>navigate('/transfer/42?keyword=other'));expect(observed).toEqual([])
 expect(host.querySelector('[data-name="purchase"] output')!.textContent).toBe('/purchase?keyword=PO|keyword=PO')
 expect(host.querySelector('[data-name="transfer"] output')!.textContent).toBe('/transfer?keyword=TR|keyword=TR')
 await click('change purchase');await click('reset transfer');expect(current()).toBe('/transfer/42?keyword=other')
 await act(async()=>navigate('/purchase?keyword=PO'));await click('change purchase');expect(current()).toBe('/purchase?keyword=purchase')
 await click('reset purchase');expect(current()).toBe('/purchase?range=all')
})
test('没有上下文时保留Router更新、明确重置、前进和后退',async()=>{
 await act(async()=>root.render(<MemoryRouter initialEntries={['/purchase?keyword=first']}><Harness scoped={false}/></MemoryRouter>));await click('change fallback');expect(current()).toBe('/purchase?keyword=fallback')
 await click('reset fallback');expect(current()).toBe('/purchase?range=all')
 await act(async()=>navigate(-1));expect(current()).toBe('/purchase?keyword=fallback');await act(async()=>navigate(-1));expect(current()).toBe('/purchase?keyword=first')
 await act(async()=>navigate(1));expect(current()).toBe('/purchase?keyword=fallback')
})
