'use strict'
// Exact VM allowlist; never loads application/config/environment or a real database.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const AppError = require('../../backend/src/utils/AppError')
const money = require('../../backend/src/utils/decimalMoney')
const ids = require('../../backend/src/utils/sqlIdentifier')
const { PERMISSIONS } = require('../../backend/src/constants/permissions')
const base = path.resolve(__dirname, '../../backend/src')
const copy = value => JSON.parse(JSON.stringify(value))
const allPermissions = ['supplier.refund.view','supplier.refund.create','supplier.refund.confirm','supplier.refund.receive','purchase.order.view','return.order.view','payment.view']
const uuid = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
const input = (n=1) => ({operationUuid:uuid(n),purchaseReturnId:11,incomeAccountId:42,refundDate:'2026-10-01',amount:'4.0000',allocations:[{entryId:21,amount:'4.0000'}],remark:'fixture'})
function assertMandatory(table,columns,values) {
  const schema=fs.readFileSync(path.join(base,'database/280_supplier_refunds.sql'),'utf8')
  const ddl=schema.split('CREATE TABLE IF NOT EXISTS `'+table+'` (')[1].split(') ENGINE=')[0]
  for(const line of ddl.split('\n')){
    const match=line.match(/^  `([^`]+)` (.*)$/)
    if(!match || !match[2].includes('NOT NULL') || /AUTO_INCREMENT|DEFAULT/.test(match[2]))continue
    const index=columns.indexOf(match[1]);assert.ok(index>=0,'actual mandatory column '+table+'.'+match[1]);assert.notEqual(values[index],null);assert.notEqual(values[index],undefined)
  }
}
function required(object, name) { assert.equal(typeof object[name], 'function', `F1 actual ${name} capability must exist`); return object[name] }
function fixture(options = {}) {
  let data = {
    acct_companies:[{id:1,is_active:1}],sys_users:[{id:9,role_id:2,is_active:1,deleted_at:null,allow_self_approve:1,real_name:'fixture'}],sys_roles:[{id:2}],
    sys_role_permissions:allPermissions.map(permission=>({role_id:2,permission})),user_warehouse_scope:[{user_id:9,warehouse_id:8}],
    purchase_orders:[{id:10,order_no:'PO10',supplier_id:4,warehouse_id:8,deleted_at:null}],
    purchase_returns:[{id:11,return_no:'PR11',purchase_order_id:10,purchase_order_no:'PO10',supplier_id:4,supplier_name:'fixture',warehouse_id:8,warehouse_name:'fixture',status:1,total_amount:'6.0000',deleted_at:null}],
    purchase_return_items:[{id:12,return_id:11,purchase_item_id:101,product_id:3,unit:'个',quantity:'2.00',unit_price:'3.0000',amount:'6.0000'}],
    purchase_order_items:[{id:101,order_id:10,product_id:3,unit:'个',unit_price:'3.0000',quantity:'10.00'}],
    payment_records:[{id:31,type:1,order_id:10,order_no:'PO10',paid_amount:'100.0000',total_amount:'100.0000'}],
    payment_entries:[{id:21,record_id:31,amount:'100.0000',account_id:41,receipt_id:null,statement_id:null,payment_date:'2026-10-01'}],payment_receipts:[],reconciliation_statements:[],
    finance_accounts:[{id:41,company_id:1,is_active:0,deleted_at:'2026-09-01',type:1},{id:42,company_id:1,is_active:1,deleted_at:null,type:1}],
    finance_account_transactions:[{id:51,account_id:41,direction:2,amount:'100.0000',biz_type:2,biz_id:21,biz_no:'PO10',happened_at:'2026-10-01'}],
    supplier_refund_orders:[],supplier_refund_allocations:[],supplier_refund_operations:[],payment_record_events:[],warehouse_tasks:[],
  }
  options.mutate?.(data)
  let tx = null, nextId = 61
  const events=[], queries=[], fail=options.fail || {}, committed=()=>tx||data
  const conn={
    beginTransaction:async()=>{assert.equal(tx,null);tx=copy(data);events.push('begin')},
    commit:async()=>{assert.ok(tx);data=tx;tx=null;events.push('commit')},
    rollback:async()=>{tx=null;events.push('rollback')},release:()=>events.push('release'),
    query:async(raw,args=[])=>{
      const sql=raw.replace(/\s+/g,' ').trim();queries.push({sql,args:copy(args)});const state=committed()
      if(/^SET TRANSACTION|^START TRANSACTION/.test(sql)){events.push(sql);if(sql.startsWith('START'))tx=copy(data);return [{}]}
      if(sql.startsWith('INSERT INTO supplier_refund_operations')){
        const [op,action,actor,key,hash,payload]=args;assert.ok(Number.isSafeInteger(actor)&&state.sys_users.some(user=>user.id===actor),'accurate actor FK parent')
        if(state.supplier_refund_operations.some(r=>r.operation_uuid===op))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'})
        state.supplier_refund_operations.push({operation_uuid:op,action,actor_id:actor,request_key:key,payload_hash:hash,payload_json:payload,status:0,refund_id:null,resource_type:null,resource_id:null,response_json:null});events.push('op:pending');return [{affectedRows:1}]
      }
      if(sql.startsWith('INSERT INTO supplier_refund_orders')){
        if(fail.head)throw Error('head fixture failure')
        const columns=/\(([^)]+)\) VALUES/.exec(sql)[1].split(',').map(v=>v.trim());assert.equal(columns.length,args.length)
        assertMandatory('supplier_refund_orders',columns,args);const row=Object.fromEntries(columns.map((c,i)=>[c,args[i]]));row.id=nextId++;assert.equal(row.company_id,1);assert.equal(row.purchase_return_id,11);assert.equal(row.purchase_order_id,10);assert.equal(row.payment_record_id,31);assert.equal(row.income_account_id,42)
        state.supplier_refund_orders.push(row);events.push('head:insert');return [{insertId:row.id,affectedRows:1}]
      }
      if(sql.startsWith('INSERT INTO supplier_refund_allocations')){
        if(fail.alloc)throw Error('alloc fixture failure')
        const columns=/\(([^)]+)\) VALUES/.exec(sql)[1].split(',').map(v=>v.trim());assert.equal(args.length,1);assert.ok(args[0].length)
        for(const values of args[0]){assert.equal(columns.length,values.length);assertMandatory('supplier_refund_allocations',columns,values);const row=Object.fromEntries(columns.map((c,i)=>[c,values[i]]));assert.ok(state.supplier_refund_orders.some(head=>head.id===row.refund_id),'accurate own RF FK parent');assert.equal(row.payment_record_id,31);assert.equal(row.purchase_return_id,11);assert.equal(row.entry_id,21);row.id=nextId++;state.supplier_refund_allocations.push(row)}
        events.push('alloc:insert');return [{affectedRows:args[0].length}]
      }
      if(sql.startsWith('INSERT INTO payment_record_events')){
        if(fail.event)throw Error('event fixture failure');assert.equal(args[0],31);assert.ok(args[8].length<=64,'actual 076 request_id bound');assert.ok(args[2].startsWith('SUPPLIER_REFUND_'));state.payment_record_events.push(copy(args));events.push('event:insert');return [{affectedRows:1}]
      }
      if(sql.startsWith('UPDATE supplier_refund_operations')){
        if(fail.operation)throw Error('operation fixture failure');const [id,type,resource,response,op]=args
        const row=state.supplier_refund_operations.find(r=>r.operation_uuid===op&&r.status===0);assert.ok(row);assert.ok(state.supplier_refund_orders.some(head=>head.id===id),'accurate operation RF FK parent');assert.equal(type,'supplier_refund_order');assert.equal(resource,id)
        Object.assign(row,{refund_id:id,resource_type:type,resource_id:resource,response_json:response,status:1});events.push('op:complete');return [{affectedRows:1}]
      }
      if(sql.startsWith('UPDATE supplier_refund_orders SET')){
        if(fail.status)throw Error('status fixture failure');const [status,actor,id,from]=args;assert.equal(id,61);assert.ok(Number.isSafeInteger(actor)&&state.sys_users.some(user=>user.id===actor),'accurate actor FK parent')
        const row=state.supplier_refund_orders.find(r=>r.id===id&&r.status===from);if(!row)return [{affectedRows:0}];row.status=status;events.push('head:status');return [{affectedRows:1}]
      }
      if(sql.startsWith('UPDATE supplier_refund_allocations SET budget_state=')){
        const [to,id,from]=args;assert.equal(id,61);let changed=0;for(const row of state.supplier_refund_allocations)if(row.refund_id===id&&row.budget_state===from){row.budget_state=to;changed++}
        events.push('alloc:status');return [{affectedRows:changed}]
      }
      if(sql.startsWith('UPDATE purchase_returns SET')){ const [to,id,from]=args;assert.equal(id,11);const row=state.purchase_returns.find(r=>r.id===id&&r.status===from);if(!row)return [{affectedRows:0}];row.status=to;events.push('PR:status');return [{affectedRows:1}] }
      if(/^SELECT /.test(sql)){
        const m=/ FROM ([a-z_]+)(?:\s|$)/.exec(sql);assert.ok(m,sql);const table=m[1]
        if(!Object.hasOwn(state,table))throw Error('Unknown SQL '+sql)
        if(sql.includes(' FROM supplier_refund_orders rf JOIN ')){
          assert.ok(sql.includes('pr.warehouse_id=po.warehouse_id'));assert.ok(sql.includes('rf.warehouse_id=pr.warehouse_id'));
          const scoped=sql.includes('rf.warehouse_id IN (?)'), scopes=scoped?args.slice(0,3):[];if(scoped)assert.equal(scopes.length,3);
          let matches=state.supplier_refund_orders.filter(r=>{const po=state.purchase_orders.find(p=>p.id===r.purchase_order_id),pr=state.purchase_returns.find(p=>p.id===r.purchase_return_id);return po&&pr&&r.company_id===1&&po.id===pr.purchase_order_id&&pr.supplier_id===po.supplier_id&&r.supplier_id===po.supplier_id&&r.warehouse_id===pr.warehouse_id&&pr.warehouse_id===po.warehouse_id&&r.warehouse_id>0&&(!scoped||scopes.every(scope=>scope.includes(r.warehouse_id)))&&!sql.includes('1=0')}).sort((a,b)=>b.id-a.id);
          if(sql.startsWith('SELECT COUNT(*)'))return [[{total:matches.length}]];
          assert.match(sql,/LIMIT \? OFFSET \?$/);const [limit,offset]=args.slice(-2);return [matches.slice(offset,offset+limit).map(r=>Object.fromEntries(['id','refund_no','purchase_return_id','purchase_order_id','warehouse_id','refund_date','amount','status'].map(k=>[k,r[k]])))];
        }
        if(fail.scope&&table==='user_warehouse_scope')throw Error('scope unavailable')
        let rows=state[table].map(copy)
        if(/FOR UPDATE|FOR SHARE/.test(sql))events.push(table+':'+(sql.endsWith('FOR UPDATE')?'X':'S'))
        if(/WHERE id\s*=\s*\?/.test(sql)){assert.ok(Number.isSafeInteger(Number(args[0])));rows=rows.filter(r=>r.id===Number(args[0]))}
        else if(/WHERE operation_uuid=\?/.test(sql))rows=rows.filter(r=>r.operation_uuid===args[0])
        else if(/WHERE user_id\s*=\s*\?/.test(sql))rows=rows.filter(r=>r.user_id===args[0])
        else if(/WHERE role_id\s*=\s*\?/.test(sql))rows=rows.filter(r=>r.role_id===args[0])
        else if(/WHERE (?:pri\.)?return_id=\?/.test(sql)){assert.equal(args[0],11);rows=rows.filter(r=>r.return_id===args[0])}
        else if(/WHERE order_id=\?/.test(sql)){assert.equal(args[0],10);rows=rows.filter(r=>r.order_id===args[0])}
        else if(/WHERE type=1 AND order_id=\?/.test(sql)){assert.equal(args[0],10);rows=rows.filter(r=>r.type===1&&r.order_id===args[0])}
        else if(/WHERE record_id=\?/.test(sql)){assert.equal(args[0],31);rows=rows.filter(r=>r.record_id===args[0])}
        else if(/WHERE refund_id=\?/.test(sql))rows=rows.filter(r=>r.refund_id===args[0])
        else if(/WHERE return_id = \? AND task_type/.test(sql)){assert.equal(args[0],11);rows=rows.filter(r=>r.return_id===args[0]&&r.task_type==='purchase_return')}
        else if(/WHERE purchase_return_id=\?/.test(sql))rows=rows.filter(r=>r.purchase_return_id===args[0])
        else if(/WHERE payment_record_id=\?/.test(sql))rows=rows.filter(r=>r.payment_record_id===args[0])
        else if(/WHERE receipt_id IN/.test(sql))rows=rows.filter(r=>args[0].includes(r.receipt_id))
        else if(/WHERE id IN/.test(sql))rows=rows.filter(r=>args[0].includes(r.id))
        else if(/WHERE biz_type=2/.test(sql))rows=rows.filter(r=>r.biz_type===2&&(args[0].includes(r.biz_id)||args[1].includes(r.biz_no)))
        else throw Error('Unmodeled predicate '+sql)
        if(sql.includes("budget_state='reserved'"))rows=rows.filter(r=>r.budget_state==='reserved')
        if(sql.includes('amount>0'))rows=rows.filter(r=>money.moneyUnits(r.amount)>0n)
        if(sql.includes('FROM purchase_return_items pri LEFT JOIN purchase_order_items poi')){assert.equal(args[0],11);return [rows.map(r=>{const source=state.purchase_order_items.find(item=>item.id===r.purchase_item_id);return {...r,source_item_id:source?.id,source_order_id:source?.order_id,source_product_id:source?.product_id}})]}
        const projection=/^SELECT (.*?) FROM /.exec(sql)[1]
        if(projection!=='*'){
          const columns=projection.split(',').map(v=>v.trim())
          assert.ok(columns.every(c=>/^[a-z_]+$/.test(c)), 'explicit fixture projection '+projection)
          rows=rows.map(r=>Object.fromEntries(columns.map(c=>[c,r[c]])))
        }
        return [rows]
      }
      throw Error('Unknown SQL '+sql)
    }
  }
  const cache={}
  const pure={ '../../utils/backendTime':require('../../backend/src/utils/backendTime'),'../../utils/AppError':AppError,'../../utils/decimalMoney':money,'../../utils/sqlIdentifier':ids,'../../constants/permissions':{PERMISSIONS},'node:crypto':crypto,'../../config/db':{pool:{getConnection:async()=>conn}},'../../constants/documentStatusRules':require('../../backend/src/constants/documentStatusRules') }
  const domain=['rules','actor','source','operations','service','pr-gate','context']
  function module(name){if(Object.hasOwn(cache,name))return cache[name];const filename=path.join(base,`modules/refunds/supplier-refunds.${name}.js`);if(!fs.existsSync(filename))return cache[name]={};const loaded={exports:{}};cache[name]=loaded.exports
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:loaded,require:dep=>{if(Object.hasOwn(pure,dep))return pure[dep];const match=/^\.\/supplier-refunds\.(\w+(?:-\w+)?)$/.exec(dep);if(match&&domain.includes(match[1]))return module(match[1]);throw Error('Unstubbed F1 require '+dep)},Date,Buffer,console},{filename});return cache[name]=loaded.exports}
  return {module,conn,get data(){return data},events,queries,fail,options: {userId:9,requestKey:'fixed-key'},snapshot:()=>copy(data)}
}
module.exports={fixture,required,input,uuid,copy,allPermissions,AppError,money}
