#!/usr/bin/env node
'use strict'
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
require('./helpers/testEnvironment').configureTestEnvironment()
process.env.SENTRY_DSN = ''
process.env.LOKI_URL = ''
const { pool } = require('../backend/src/config/db')
const express = require('../backend/node_modules/express')
const jwt = require('../backend/node_modules/jsonwebtoken')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
const { WT_STATUS } = require('../backend/src/constants/warehouseTaskStatus')
const tables = { warehouses: 'inventory_warehouses', locations: 'warehouse_locations', racks: 'warehouse_racks', 'sorting-bins': 'sorting_bins' }
async function main() {
  const mark = `WM${randomBytes(4).toString('hex')}`, owned = new Map(), counts = {}, failures = []
  let server, actor, reader, denied, scoped
  const ids = table => owned.get(table) || []
  const remember = (table, id) => { if (!owned.has(table)) owned.set(table, []); if (!ids(table).includes(Number(id))) ids(table).push(Number(id)); return Number(id) }
  const insert = async (table, row) => { const [r] = await pool.query(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, Object.values(row)); return remember(table, r.insertId) }
  const check = (mod, label, actual, expected = true) => {
    counts[mod] = (counts[mod] || 0) + 1
    try { assert.deepEqual(actual, expected); console.log(`PASS [${mod}] ${label}`) }
    catch { failures.push(`${mod}: ${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); console.log(`FAIL [${mod}] ${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`) }
  }
  try {
    const [[target]] = await pool.query('SELECT DATABASE() AS db, @@session.time_zone AS timezone')
    assert.equal(target.db, process.env.DB_NAME)
    console.log('[warehouse-masterdata] target', { host: process.env.DB_HOST, port: process.env.DB_PORT, ...target })
    const [used] = await pool.query('SELECT id FROM sys_roles UNION SELECT role_id AS id FROM sys_users UNION SELECT role_id AS id FROM sys_role_permissions')
    const roles = Array.from({ length: 254 }, (_, i) => 255-i).filter(id => !used.some(r => Number(r.id) === id)).slice(0, 4)
    assert.equal(roles.length, 4)
    const users = []
    for (const [index, id] of roles.entries()) {
      await insert('sys_roles', { id, code: `${mark}R${index}`, name: mark, is_system: 0 })
      users.push(await insert('sys_users', { username: `${mark}U${index}`, password: 'fixture-no-password-login', real_name: mark, role_id: id, role_name: mark }))
      if (index === 2) continue
      for (const prefix of ['WAREHOUSE', 'LOCATION', 'RACK', 'SORTING_BIN']) {
        const actions = index === 1 ? ['VIEW'] : prefix === 'SORTING_BIN' ? ['VIEW', 'MANAGE'] : ['VIEW', 'CREATE', 'UPDATE', 'DELETE']
        for (const action of actions) await pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)', [id, PERMISSIONS[`${prefix}_${action}`]])
      }
    }
    ;[actor, reader, denied, scoped] = users
    const app = express(); app.use(express.json())
    for (const mod of Object.keys(tables)) app.use(`/api/${mod}`, require(`../backend/src/modules/${mod}/${mod}.routes`))
    app.use(require('../backend/src/middleware/errorHandler'))
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const req = async (mod, path='', method='GET', body, user=actor) => {
      const headers = { 'Content-Type': 'application/json' }
      if (user) headers.Authorization = `Bearer ${jwt.sign({ userId: user, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '10m' })}`
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/${mod}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
      const payload = await r.json()
      if (method === 'POST' && path === '' && payload.data?.id) remember(tables[mod], payload.data.id)
      if (mod === 'sorting-bins' && path === '/batch' && Array.isArray(payload.data)) for (const row of payload.data) remember(tables[mod], row.id)
      return { status: r.status, ...payload }
    }
    const expect = async (mod, label, path, method, body, status, user=actor) => { const r=await req(mod,path,method,body,user); check(mod,`${label} HTTP`,r.status,status); check(mod,`${label} 信封`,r.success,status<400); return r.data }
    const create = (mod, body) => expect(mod,'创建','', 'POST',body,mod==='sorting-bins'?200:201)
    for (const mod of Object.keys(tables)) {
      await expect(mod,'未登录','', 'GET',undefined,401,null)
      await expect(mod,'无权限','', 'GET',undefined,403,denied)
      await expect(mod,'只读可读','', 'GET',undefined,200,reader)
      for (const [method,path] of [['POST',''],[mod==='sorting-bins'?'PATCH':'PUT','/2147483647'],['DELETE','/2147483647']]) await expect(mod,`只读拒绝${method}`,path,method,{},403,reader)
    }
    const whBody = { name: `${mark}A`, type: 1, manager: '测试', phone: '13800000000', address: mark, remark: mark }
    const whA = await create('warehouses', whBody), whB = await create('warehouses',{...whBody,name:`${mark}B`})
    assert.ok(whA?.id && whB?.id)
    await pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)',[scoped,whA.id])
    const whEmpty = await create('warehouses',{...whBody,name:`${mark}Empty`})
    const wdetail = await expect('warehouses','详情',`/${whA.id}`,'GET',undefined,200)
    check('warehouses','编码服务端生成且字段持久化',[whA.code.startsWith('WH'),wdetail.name,wdetail.type,wdetail.manager],[true,whBody.name,1,'测试'])
    for (const bad of [{name:''},{type:0},{type:5}]) await expect('warehouses','字段校验','','POST',{...whBody,...bad},400)
    await expect('warehouses','更新',`/${whA.id}`,'PUT',{...whBody,isActive:false},200)
    check('warehouses','停用列表排除',!(await req('warehouses','/active')).data.some(r=>r.id===whA.id))
    await expect('warehouses','重新启用',`/${whA.id}`,'PUT',{...whBody,isActive:true},200)
    await pool.query("UPDATE inventory_warehouses SET created_at='2026-09-13 00:00:00' WHERE id IN (?)",[[whA.id,whB.id,whEmpty.id]])
    const wp1=(await req('warehouses',`?keyword=${mark}&pageSize=1&page=1`)).data
    const wp2=(await req('warehouses',`?keyword=${mark}&pageSize=1&page=2`)).data
    check('warehouses','同时间分页稳定',[wp1.list[0].id,wp2.list[0].id,wp1.pagination.total],[whEmpty.id,whB.id,3])
    check('warehouses','名称筛选',(await req('warehouses',`?keyword=${mark}`)).data.pagination.total,3)
    check('warehouses','限仓列表',(await req('warehouses',`?keyword=${mark}`,'GET',undefined,scoped)).data.list.map(r=>r.id),[whA.id])
    check('warehouses','限仓启用列表',(await req('warehouses','/active','GET',undefined,scoped)).data.map(r=>r.id),[whA.id])
    await expect('warehouses','越仓详情',`/${whB.id}`,'GET',undefined,403,scoped)
    await expect('warehouses','越仓更新',`/${whB.id}`,'PUT',{...whBody,name:`${mark}B`,isActive:true},403,scoped)
    await expect('warehouses','越仓删除',`/${whEmpty.id}`,'DELETE',undefined,403,scoped)

    const rackBody={warehouseId:whA.id,zone:mark,code:`${mark}R`,name:mark,maxLevels:3,maxPositions:4,remark:mark}
    const rackA=await create('racks',rackBody),rackB=await create('racks',{...rackBody,warehouseId:whB.id})
    assert.ok(rackA?.id&&rackB?.id)
    check('racks','H条码及配置持久化',[rackA.barcode, rackA.maxLevels,rackA.maxPositions],[`H${String(rackA.id).padStart(6,'0')}`,3,4])
    await expect('racks','同仓重码','','POST',rackBody,400)
    await expect('racks','空编码','','POST',{...rackBody,code:''},400)
    await expect('racks','同编码跨仓更新合法',`/${rackA.id}`,'PUT',{code:rackBody.code,name:`${mark}改`},200)
    await expect('racks','省略可选文本保留',`/${rackA.id}`,'PUT',{maxLevels:4},200)
    check('racks','省略备注保持',(await req('racks',`/${rackA.id}`)).data.remark,mark)
    await expect('racks','空串清空可选文本',`/${rackA.id}`,'PUT',{name:'',remark:''},200)
    check('racks','空串清空持久化',[(await req('racks',`/${rackA.id}`)).data.name,(await req('racks',`/${rackA.id}`)).data.remark],['',null])
    await expect('racks','停用货架',`/${rackA.id}`,'PUT',{status:2},200)
    check('racks','启用列表排除停用',!(await req('racks',`/active?warehouseId=${whA.id}`)).data.some(r=>r.id===rackA.id))
    await expect('racks','重新启用货架',`/${rackA.id}`,'PUT',{status:1},200)
    check('racks','限仓列表',(await req('racks',`?keyword=${mark}`,'GET',undefined,scoped)).data.list.map(r=>r.id),[rackA.id])
    check('racks','筛选仓库及区域',(await req('racks',`?warehouseId=${whA.id}&zone=${mark}`)).data.list.map(r=>r.id),[rackA.id])
    check('racks','限仓active',(await req('racks','/active','GET',undefined,scoped)).data.map(r=>r.id),[rackA.id])
    await expect('racks','越仓详情',`/${rackB.id}`,'GET',undefined,403,scoped)
    await expect('racks','越仓更新',`/${rackB.id}`,'PUT',{name:mark},403,scoped)
    await expect('racks','越仓删除',`/${rackB.id}`,'DELETE',undefined,403,scoped)
    await expect('racks','越仓创建','','POST',{...rackBody,warehouseId:whB.id,code:`${mark}X`},403,scoped)
    await expect('racks','越仓扫码提示','/scan-hint','POST',{warehouseId:whB.id,rackCode:rackBody.code,scanRaw:rackB.barcode},403,scoped)
    const hint=await expect('racks','本仓H重复提示','/scan-hint','POST',{warehouseId:whA.id,rackCode:rackBody.code,scanRaw:rackA.barcode},200,scoped)
    check('racks','H重复提示语义',hint?.kind,'warn')
    check('racks','本仓提示不暴露其他仓H编码',(await expect('racks','本仓查询他仓条码','/scan-hint','POST',{warehouseId:whA.id,rackCode:rackBody.code,scanRaw:rackB.barcode},200,scoped))?.kind,'ok')
    await expect('racks','独立打印权限',`/${rackA.id}/print-label`,'POST',{},403,reader)

    const locBody={warehouseId:whA.id,zone:'A',aisle:'1',rack:rackBody.code,level:'1',position:'1',name:mark,remark:mark,status:1}
    const locA=await create('locations',locBody),locB=await create('locations',{...locBody,warehouseId:whB.id,position:'2'})
    assert.ok(locA?.id&&locB?.id)
    check('locations','R条码及补零',[locA.barcode,locA.aisle,locA.level],[`R${String(locA.id).padStart(6,'0')}`,'01','01'])
    await expect('locations','同仓重码','','POST',locBody,400)
    await expect('locations','缺编码字段','','POST',{warehouseId:whA.id},400)
    check('locations','限仓列表',(await req('locations',`?keyword=${mark}`,'GET',undefined,scoped)).data.list.map(r=>r.id),[locA.id])
    check('locations','本仓下拉',(await req('locations',`/by-warehouse/${whA.id}`,'GET',undefined,scoped)).data.map(r=>r.id),[locA.id])
    check('locations','筛选区域状态仓库',(await req('locations',`?warehouseId=${whA.id}&zone=A&status=1&keyword=${mark}`)).data.list.map(r=>r.id),[locA.id])
    await expect('locations','越仓详情',`/${locB.id}`,'GET',undefined,403,scoped)
    await expect('locations','越仓更新',`/${locB.id}`,'PUT',locBody,403,scoped)
    await expect('locations','越仓删除',`/${locB.id}`,'DELETE',undefined,403,scoped)
    await expect('locations','越仓创建','','POST',{...locBody,warehouseId:whB.id,position:'4'},403,scoped)
    await expect('locations','越仓移动目标',`/${locA.id}`,'PUT',{...locBody,warehouseId:whB.id,position:'3'},403,scoped)
    // 红灯越仓写成功时恢复本任务库位，避免后续用例被污染。
    await pool.query('UPDATE warehouse_locations SET warehouse_id=?,code=?,position=? WHERE id=?',[whA.id,locA.code,'01',locA.id])
    await expect('locations','越仓按仓下拉',`/by-warehouse/${whB.id}`,'GET',undefined,403,scoped)
    await expect('locations','越仓扫码',`/code/${locB.barcode}`,'GET',undefined,403,scoped)
    check('locations','本仓扫码返回归属',(await expect('locations','本仓扫码',`/code/${locA.barcode}`,'GET',undefined,200,scoped))?.id,locA.id)
    await expect('locations','停用',`/${locA.id}`,'PUT',{...locBody,status:2},200)
    await expect('locations','停用拒绝扫码',`/code/${locA.barcode}`,'GET',undefined,400)
    await expect('locations','重新启用',`/${locA.id}`,'PUT',locBody,200)
    const product=await insert('product_items',{code:mark,name:mark})
    const container=await insert('inventory_containers',{barcode:mark,product_id:product,warehouse_id:whA.id,location_id:locA.id,remaining_qty:1,status:1})
    await expect('locations','真实容器引用禁止删除',`/${locA.id}`,'DELETE',undefined,409)
    await expect('racks','真实库位绑定禁止删除',`/${rackA.id}`,'DELETE',undefined,400)
    const inventoryHint=await expect('racks','商品实际在库提示','/scan-hint','POST',{warehouseId:whA.id,rackCode:rackBody.code,scanRaw:`P${product}`},200)
    check('racks','在库提示语义',inventoryHint?.kind,'binding')
    await pool.query('DELETE FROM inventory_containers WHERE id=?',[container])

    const binA=await create('sorting-bins',{warehouseId:whA.id,code:`${mark}A`,remark:mark}),binB=await create('sorting-bins',{warehouseId:whB.id,code:`${mark}B`,remark:mark})
    assert.ok(binA?.id&&binB?.id)
    await expect('sorting-bins','同仓重码','','POST',{warehouseId:whA.id,code:binA.code},400)
    await expect('sorting-bins','字段校验','','POST',{warehouseId:whA.id,code:''},400)
    await expect('sorting-bins','越仓创建','','POST',{warehouseId:whB.id,code:`${mark}X`},403,scoped)
    const prefix=mark.slice(-5)
    await expect('sorting-bins','越仓批量','/batch','POST',{warehouseId:whB.id,prefix,from:1,to:2},403,scoped)
    await expect('sorting-bins','批次范围拒绝','/batch','POST',{warehouseId:whA.id,prefix,from:2,to:1},400)
    const batch=await expect('sorting-bins','批量创建','/batch','POST',{warehouseId:whA.id,prefix,from:1,to:2},200)
    check('sorting-bins','批量补零',batch?.map(r=>r.code),[`${prefix}01`,`${prefix}02`])
    check('sorting-bins','批量跳过既有',(await expect('sorting-bins','批量重放','/batch','POST',{warehouseId:whA.id,prefix,from:1,to:2},200))?.length,0)
    await expect('sorting-bins','越仓下拉',`/warehouse/${whB.id}`,'GET',undefined,403,scoped)
    await expect('sorting-bins','越仓更新',`/${binB.id}`,'PATCH',{remark:mark},403,scoped)
    await expect('sorting-bins','越仓释放',`/${binB.id}/release`,'POST',{},403,scoped)
    await expect('sorting-bins','越仓删除',`/${binB.id}`,'DELETE',undefined,403,scoped)
    await expect('sorting-bins','容量校验',`/${binA.id}`,'PATCH',{capacity:0},400)
    await expect('sorting-bins','更新容量备注',`/${binA.id}`,'PATCH',{capacity:10,remark:`${mark}改`},200)
    const binRow=async()=>{ const r=await req('sorting-bins',`?warehouseId=${whA.id}&keyword=${binA.code}`);return {...r,data:r.data.filter(b=>b.id===binA.id)} }
    check('sorting-bins','更新持久化',[(await binRow()).data[0].capacity,(await binRow()).data[0].remark],[10,`${mark}改`])
    await expect('sorting-bins','容量null清空',`/${binA.id}`,'PATCH',{capacity:null,remark:mark},200)
    check('sorting-bins','容量null持久化',(await binRow()).data[0].capacity,null)
    const task=await insert('warehouse_tasks',{task_no:mark,warehouse_id:whB.id,warehouse_name:mark,customer_name:mark,status:WT_STATUS.SORTING,sorting_bin_id:binB.id,sorting_bin_code:binB.code})
    await insert('warehouse_task_items',{task_id:task,product_id:product,product_code:mark,product_name:mark,unit:'件',required_qty:1})
    await pool.query('UPDATE sorting_bins SET status=2,current_task_id=? WHERE id=?',[task,binB.id])
    check('sorting-bins','占用状态筛选',(await req('sorting-bins',`?warehouseId=${whB.id}&status=2&keyword=${mark}`)).data.map(r=>r.id),[binB.id])
    check('sorting-bins','限仓主列表',(await req('sorting-bins',`?keyword=${mark}`,'GET',undefined,scoped)).data.every(r=>r.warehouseId===whA.id))
    check('sorting-bins','模糊扫描同样受限',(await req('sorting-bins',`/scan?code=${mark.slice(1)}`,'GET',undefined,scoped)).data,null)
    check('sorting-bins','跨仓商品扫描不泄漏',(await req('sorting-bins',`/scan?code=${mark}`,'GET',undefined,scoped)).data,null)
    check('sorting-bins','不限仓扫码返回真实任务',(await req('sorting-bins',`/scan?code=${mark}`)).data?.taskId,task)
    await expect('sorting-bins','占用禁止删除',`/${binB.id}`,'DELETE',undefined,400)
    await expect('sorting-bins','释放真实绑定',`/${binB.id}/release`,'POST',{},200)
    const [[released]]=await pool.query('SELECT sorting_bin_id,sorting_bin_code FROM warehouse_tasks WHERE id=?',[task])
    check('sorting-bins','释放清空任务引用',[released.sorting_bin_id,released.sorting_bin_code],[null,null])
    const releasedBin=(await req('sorting-bins',`?keyword=${binB.code}`)).data[0]
    check('sorting-bins','释放清空分拣格占用',[releasedBin.status,releasedBin.currentTaskId],[1,null])

    // 每种仓库引用独立存在，防止早期守卫掩盖后续守卫。
    const guardWh=await create('warehouses',{...whBody,name:`${mark}Guard`})
    const refs=[['warehouse_locations',{warehouse_id:guardWh.id,code:`${mark}Guard`,name:mark}],['warehouse_racks',{warehouse_id:guardWh.id,code:mark}],['sorting_bins',{warehouse_id:guardWh.id,code:mark}],['inventory_containers',{warehouse_id:guardWh.id,product_id:product,barcode:`${mark}Guard`,remaining_qty:1}],['inventory_stock',{warehouse_id:guardWh.id,product_id:product}],['inventory_logs',{warehouse_id:guardWh.id,product_id:product}],['warehouse_tasks',{warehouse_id:guardWh.id,warehouse_name:mark,task_no:`${mark}Guard`,customer_name:mark}]]
    for(const [table,row] of refs){ const ref=await insert(table,row); await expect('warehouses',`${table}独立引用拒删`,`/${guardWh.id}`,'DELETE',undefined,409); await pool.query(`DELETE FROM ${table} WHERE id=?`,[ref]) }
    await expect('warehouses','无引用删除',`/${guardWh.id}`,'DELETE',undefined,200)
    for (const [mod,id] of [['locations',locA.id],['racks',rackA.id],['sorting-bins',binA.id]]) {
      await expect(mod,'无引用删除',`/${id}`,'DELETE',undefined,200)
      await expect(mod,'重复删除404',`/${id}`,'DELETE',undefined,404)
      if(mod!=='sorting-bins')await expect(mod,'删除后详情404',`/${id}`,'GET',undefined,404)
    }
    await expect('warehouses','删除后详情404',`/${guardWh.id}`,'GET',undefined,404)
    for(const mod of ['warehouses','locations','racks']){
      check(mod,'分页上限',(await req(mod,'?pageSize=999999')).data.pagination.pageSize,500)
      check(mod,'筛选参数化',(await req(mod,`?keyword=${encodeURIComponent("' OR 1=1 --")}`)).data.pagination.total,0)
    }
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve))
    try {
      for(const [table,col,values] of [['auth_audit_logs','user_id',ids('sys_users')],['user_warehouse_scope','user_id',ids('sys_users')],['sys_role_permissions','role_id',ids('sys_roles')]])if(values.length){await pool.query(`DELETE FROM ${table} WHERE ${col} IN (?)`,[values]);const [[r]]=await pool.query(`SELECT COUNT(*) n FROM ${table} WHERE ${col} IN (?)`,[values]);assert.equal(Number(r.n),0)}
      for(const table of ['warehouse_task_items','warehouse_tasks','sorting_bins','inventory_containers','inventory_stock','inventory_logs','warehouse_locations','warehouse_racks','product_items','inventory_warehouses','sys_users','sys_roles'])if(ids(table).length){await pool.query(`DELETE FROM ${table} WHERE id IN (?)`,[ids(table)]);const [[r]]=await pool.query(`SELECT COUNT(*) n FROM ${table} WHERE id IN (?)`,[ids(table)]);assert.equal(Number(r.n),0,`cleanup ${table}`)}
      console.log('[warehouse-masterdata] cleanup verified: all owned IDs removed; no whole-table delete; sequences preserved')
    } finally {await pool.end()}
  }
  console.log('[warehouse-masterdata] assertion counts',counts)
  assert.equal(failures.length,0,failures.join('\n'))
}
main().catch(error=>{console.error(error);process.exitCode=1})
