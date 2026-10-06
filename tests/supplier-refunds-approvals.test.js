'use strict'
const {test,afterEach}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {fixture,required}=require('./helpers/supplier-refunds-fixture')
const {PERMISSIONS:P}=require('../backend/src/constants/permissions')
const allUnknown=[]
afterEach(()=>{assert.deepEqual(allUnknown,[]);allUnknown.length=0})
function ownedFixture(options){const f=fixture(options),query=f.conn.query,load=f.module;f.conn.query=async(...args)=>{try{return await query(...args)}catch(e){if(/Unknown SQL|Unknown require|Unexpected SQL/.test(e.message))allUnknown.push(e.message);throw e}};f.module=name=>{try{return load(name)}catch(e){if(/Unknown SQL|Unknown require|Unexpected SQL/.test(e.message))allUnknown.push(e.message);throw e}};return f}
function pending({permissions=Object.values(P),self=0,rows=[],scope=[8],role=2,fail=false,currentScope=scope,currentRole=role,currentPermissions=permissions}={}) {
 const calls=[],events=[],unknown=[]
 const filterRows=sql=>{const b=branch(sql);return rows.filter(r=>r.biz_type!=='supplier_refund'||!!b&&!b.includes('1=0')&&r.status===1&&(self===1||r.applicant_id!==9)&&(!currentScope.length||[r.rfWarehouse??8,r.poWarehouse??8,r.prWarehouse??8].every(w=>currentScope.includes(w)))&&r.sourceValid!==false)}
 const conn={query:async(sql,args=[])=>{calls.push({sql,args:JSON.parse(JSON.stringify(args))});if(/^SET |^START /.test(sql))return[[]];if(sql.includes('SELECT permission FROM sys_role_permissions')&&!sql.includes('ORDER BY'))return[permissions.map(permission=>({permission}))];if(sql.includes('SELECT allow_self_approve'))return[[{allow_self_approve:self}]];if(sql.startsWith('SELECT id, role_id, real_name'))return[[{id:9,role_id:currentRole,real_name:'fixture',is_active:1,deleted_at:null,allow_self_approve:self}]];if(sql.startsWith('SELECT id FROM sys_roles'))return[[{id:currentRole}]];if(sql.startsWith('SELECT permission FROM sys_role_permissions WHERE role_id=? ORDER BY'))return[currentPermissions.map(permission=>({permission}))];if(sql.startsWith('SELECT warehouse_id FROM user_warehouse_scope'))return[currentScope.map(warehouse_id=>({warehouse_id}))];if(sql.includes('COUNT(*)'))return[[{total:filterRows(sql).length}]];if(sql.includes('LIMIT ? OFFSET ?')){if(fail)throw Error('page failed');return[filterRows(sql).slice(args.at(-1),args.at(-1)+args.at(-2))]}unknown.push(sql);allUnknown.push(sql);throw Error('Unknown SQL '+sql)},commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release')}
 const base=path.resolve(__dirname,'../backend/src'),allow=new Set(['../../constants/permissions','../../utils/AppError','../../utils/sqlIdentifier'])
 const sandbox={module:{exports:{}},require:name=>{if(name==='../../config/db')return{pool:{getConnection:async()=>conn}};if(name==='../../engine/approvalEngine')return{};if(name==='../refunds/supplier-refunds.actor')return ownedFixture().module('actor');if(name==='../../utils/warehouseScope')return{scopeFilter:(scope,col)=>scope===null?{sql:'',params:[]}:scope.length?{sql:` AND ${col} IN (?)`,params:[scope]}:{sql:' AND 1=0',params:[]},assertInScope:()=>{throw Error('unexpected history scope')}};if(!allow.has(name)){allUnknown.push('Unknown require '+name);throw Error('Unknown require '+name)};return require(path.resolve(base,'modules/approvals',name))}}
 vm.runInNewContext(fs.readFileSync(path.join(base,'modules/approvals/approvals.service.js'),'utf8'),sandbox)
 return{calls,events,unknown,run:()=>sandbox.module.exports.listPending({page:1,pageSize:5},{userId:9,roleId:role,warehouseIds:scope})}
}
const rfRow={source_kind:'document',biz_type:'supplier_refund',biz_id:61,no:'RF61',title:'核对准确原付款',status:1,applicant_id:8,applicant_name:'原经办人',amount:'0.0049',created_at:'2026-10-01 10:00:00',submitted_at:null,time_kind:'created'}
function branch(sql){return sql.split("'document' AS source_kind").find(p=>p.includes('supplier_refund_orders'))}
test('RF1独立document metadata进入同一RR/count/limit，六引擎不扩、金额四位与confirm identity',async()=>{
 const f=pending({rows:[rfRow]}),r=await f.run(),queries=f.calls.filter(c=>c.sql.includes('FROM ('))
 assert.ok(branch(queries[0].sql),'supplier refund document must join unified pending read')
 assert.equal((queries[0].sql.match(/WHERE a.user_id=\?/g)||[]).length,6)
 assert.equal(r.list[0].entryKey,'document:supplier_refund:61:confirm');assert.equal(r.list[0].amount,0.0049)
 for(const k of ['taskId','instanceId','flowId','currentStep'])assert.equal(r.list[0][k],null)
 const from=s=>s.slice(s.indexOf('FROM (')).split('\n      ORDER BY')[0];assert.equal(from(queries[0].sql),from(queries[1].sql))
 assert.match(f.calls[0].sql,/REPEATABLE READ/);assert.match(f.calls[1].sql,/CONSISTENT SNAPSHOT, READ ONLY/)
 assert.deepEqual(f.events,['commit','release'])
})
test('RF完整VIEW/CONFIRM/PO/PR/PAYMENT及全部来源scope、自批在COUNT/LIMIT前且无role1自批豁免',async()=>{
 const rights=[P.SUPPLIER_REFUND_VIEW,P.SUPPLIER_REFUND_CONFIRM,P.PURCHASE_ORDER_VIEW,P.RETURN_ORDER_VIEW,P.PAYMENT_VIEW]
 for(const missing of [null,...rights]){
  const f=pending({permissions:rights.filter(p=>p!==missing)});await f.run();const b=branch(f.calls.find(c=>c.sql.includes('COUNT(*)')).sql);assert.ok(b,'RF document branch');assert.equal(b.includes('1=0'),missing!==null)
  assert.match(b,/d\.status=\?/);assert.match(b,/d\.created_by<>\?/);assert.match(b,/po\.warehouse_id/);assert.match(b,/pr\.warehouse_id/);assert.match(b,/d\.warehouse_id/)
 }
 const f=pending({role:1,permissions:[],self:0});await f.run();assert.match(branch(f.calls.find(c=>c.sql.includes('COUNT(*)')).sql),/d\.created_by<>\?/);assert.ok(f.calls.find(c=>c.sql.includes('COUNT(*)')).args.includes(0))
 const withdrawn=pending({scope:[8],currentScope:[9],rows:[rfRow]});assert.equal((await withdrawn.run()).pagination.total,0);assert.ok(withdrawn.calls.find(c=>c.sql.includes('COUNT(*)')).args.some(v=>Array.isArray(v)&&v.includes(9)))
})
test('RF source supplies canonical original rows/current paid and precise allocation without supplier guessing',async()=>{
 const f=ownedFixture(),r=await required(f.module('service'),'getSource')(11,9)
 assert.equal(r.paymentRecordId,31);assert.equal(r.currentPaidAmount,'100.0000');assert.equal(r.items[0].id,12);assert.equal(r.items[0].purchaseItemId,101);assert.equal(r.items[0].quantity,'2.00');assert.equal(r.items[0].unitPrice,'3.0000')
 assert.equal(r.entries[0].entryId,21);assert.equal(r.entries[0].receiptId,null)
})
test('SQLthrow releases snapshot without partial pending list',async()=>{
 const f=pending({fail:true});await assert.rejects(f.run(),/page failed/);assert.deepEqual(f.events,['rollback','release'])
})

test('有限数据集合：四态/本人flag/缺权/三头范围或关系不符从COUNT与page同集合去掉；middleware旧role/scope不可放宽',async()=>{
 const rows=[rfRow,...[2,3,4].map(status=>({...rfRow,biz_id:status+70,status})),{...rfRow,biz_id:80,applicant_id:9},{...rfRow,biz_id:81,poWarehouse:9},{...rfRow,biz_id:82,prWarehouse:9},{...rfRow,biz_id:83,rfWarehouse:9},{...rfRow,biz_id:84,sourceValid:false}]
 const normal=pending({rows});const r=await normal.run();assert.equal(r.pagination.total,1);assert.deepEqual(Array.from(r.list,x=>x.bizId),[61]);assert.deepEqual(normal.unknown,[])
 const self=pending({rows,self:1});assert.equal((await self.run()).pagination.total,2)
 const role=pending({rows,role:1,currentRole:2,currentPermissions:[]});assert.equal((await role.run()).pagination.total,0)
 for(const scope of [[9],[8,9]]){const f=pending({rows,currentScope:scope});const r=await f.run();assert.equal(r.pagination.total,scope.length===1?0:4);assert.deepEqual(f.unknown,[])}
})
test('detail confirmAllowed由同事务当前flag与CONFIRM推导，role1自己flag0不豁免、原字段保持',async()=>{
 for(const own of [true,false])for(const flag of [0,1])for(const role of [1,2])for(const permission of [true,false]){
  const f=ownedFixture();const svc=f.module('service');await svc.create(require('./helpers/supplier-refunds-fixture').input(),f.options);const reader=own?9:8;if(!own){f.data.sys_users.push({...f.data.sys_users[0],id:8});f.data.user_warehouse_scope.push({user_id:8,warehouse_id:8})}const user=f.data.sys_users.find(u=>u.id===reader);user.allow_self_approve=flag;user.role_id=role;f.data.sys_roles=[{id:role}];f.data.sys_role_permissions=f.data.sys_role_permissions.filter(r=>r.permission!==P.SUPPLIER_REFUND_CONFIRM);if(permission)f.data.sys_role_permissions.push({role_id:role,permission:P.SUPPLIER_REFUND_CONFIRM});if(role===1)f.data.sys_role_permissions=[]
  const r=await svc.findById(61,reader);assert.equal(r.confirmAllowed,(role===1||permission)&&(!own||flag===1));assert.equal(r.refund_no,f.data.supplier_refund_orders[0].refund_no);assert.equal(r.amount,'4.0000');assert.equal(r.allocations[0].entry_id,21)
 }
})
