'use strict'
// Actual backfills/guard/RF/F3 modules; exact VM requires and finite SQL, no real IO.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const accountingFixture=require('./supplier-refunds-accounting-fixture')
const AppError=require('../../backend/src/utils/AppError')
const {PERMISSIONS:P}=require('../../backend/src/constants/permissions')
const time=require('../../backend/src/utils/backendTime'),operator=require('../../backend/src/utils/operator')
const base=path.resolve(__dirname,'../../backend/src')
const copy=v=>JSON.parse(JSON.stringify(v))
const modelErrors=[]
const schema=fs.readFileSync(path.join(base,'database/258_finance_period_backfills.sql'),'utf8')+'\n'+fs.readFileSync(path.join(base,'database/260_period_backfill_approval.sql'),'utf8')
const appColumns=new Set([...schema.matchAll(/`([^`]+)` (?:[a-z]+|[A-Z]+)(?:\(| |$)/g)].map(m=>m[1]))
const appErrorWidth=Number(/`voucher_generate_error` VARCHAR\((\d+)\)/.exec(schema)[1])
const capability=(object,name)=>{assert.equal(typeof object[name],'function','F4 actual '+name+' capability must exist');return object[name]}
function assertNoModelErrors(){accountingFixture.assertNoModelErrors();assert.deepEqual(modelErrors.splice(0),[],'F4 swallowed unknown require/SQL')}
async function fixture(amount='4.0000',options={}){
  const a=await accountingFixture.fixture(amount,'100.0000',{prepareOnly:true,refundDate:'2026-09-01',...options}),f=a.f
  f.data.finance_period_backfills=[]
  f.data.acct_periods=[{company_id:1,period:'202609',status:2},{company_id:1,period:'202610',status:0},{company_id:1,period:'202611',status:0}]
  f.data.sys_users.push({id:10,role_id:3,is_active:1,deleted_at:null,allow_self_approve:0,real_name:'approver'})
  f.data.sys_roles.push({id:3})
  f.data.sys_role_permissions.push({role_id:2,permission:P.FINANCE_PERIOD_BACKFILL},{role_id:3,permission:P.FINANCE_PERIOD_BACKFILL_APPROVE})
  f.data.user_warehouse_scope.push({user_id:10,warehouse_id:8})
  const approvedDate='2026-10-31',events=[],queries=[],fail={},original=f.conn.query.bind(f.conn)
  const begin=f.conn.beginTransaction.bind(f.conn),commit=f.conn.commit.bind(f.conn),rollback=f.conn.rollback.bind(f.conn)
  f.conn.beginTransaction=async()=>{queries.push({sql:'BEGIN',args:[]});return begin()}
  f.conn.commit=async()=>{queries.push({sql:'COMMIT',args:[]});if(fail.commit==='before')throw Error('fixture F4 commit uncertain');const result=await commit();if(fail.commit==='after')throw Error('fixture F4 commit uncertain');return result}
  f.conn.rollback=async()=>{queries.push({sql:'ROLLBACK',args:[]});return rollback()}
  f.conn.query=async(raw,args=[])=>{
    try{
      const sql=raw.replace(/\s+/g,' ').trim(),state=f.state;queries.push({sql,args:copy(args)})
      if((fail.match&&sql.includes(fail.match))||(fail.exact||[]).some(rule=>rule.sql===sql&&(rule.id==null||args[0]===rule.id||args.at(-1)===rule.id)))throw Error(fail.errorMessage||'fixture F4 write failure '+fail.match)
      if(sql.startsWith('SELECT status FROM acct_periods WHERE ')){
        const periodFirst=sql.includes('WHERE period ='),period=periodFirst?args[0]:args[1],company=periodFirst?args[1]:args[0]
        assert.equal(company,1);assert.match(String(period),/^\d{6}$/);events.push('period:'+period+(sql.includes('FOR UPDATE')?':X':sql.includes('FOR SHARE')?':S':':read'))
        return [state.acct_periods.filter(r=>r.period===period&&r.company_id===company).map(r=>({status:r.status}))]
      }
      if(sql.startsWith('INSERT INTO finance_period_backfills')){
        const columns=/\(([^)]+)\) VALUES/.exec(sql)[1].split(',').map(c=>c.trim());assert.equal(columns.length,args.length+1);assert.ok(columns.every(c=>appColumns.has(c)),'actual258/260 insert columns')
        const row=Object.fromEntries(columns.map((c,i)=>[c,i===columns.length-1?0:args[i]]))
        assert.equal(row.biz_type,'supplier_refund');assert.equal(row.company_id,1);assert.equal(row.applicant_id,9);assert.ok(row.request_key.length<=64);assert.ok(row.reason.length<=300)
        if(state.finance_period_backfills.some(r=>r.biz_type===row.biz_type&&r.company_id===row.company_id&&r.request_key===row.request_key))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'})
        row.executed_at=null;row.approved_at=null;row.approver_id=null;row.id=81;row.created_at='2026-10-30';row.voucher_generated_at=null;row.voucher_generate_error=null
        state.finance_period_backfills.push(row);events.push('application:insert');return [{insertId:row.id,affectedRows:1}]
      }
      if(sql.startsWith('SELECT t.id AS txn_id, t.biz_type, t.amount,')){
        assert.equal(args[0],1);assert.ok([81,82].includes(args[1]));assert.match(sql,/WHERE t.backfill_id = \?/);assert.ok(sql.includes('supplier_refund_in'))
        return [state.finance_account_transactions.filter(t=>t.backfill_id===args[1]).map(t=>{const v=state.acct_vouchers.find(v=>v.source_id===t.id),legs=state.acct_voucher_entries.filter(e=>e.voucher_id===v?.id);return {txn_id:t.id,biz_type:t.biz_type,amount:t.amount,root_id:v?.id||null,root_no:v?.voucher_no,root_status:v?.status,voucher_id:v?.status===3?null:v?.id,voucher_no:v?.voucher_no,period:v?.period,entry_count:legs.length,debit_sum:legs.filter(e=>e.direction===1).reduce((n,e)=>n+Number(e.amount),0),credit_sum:legs.filter(e=>e.direction===2).reduce((n,e)=>n+Number(e.amount),0)}})]
      }
      if(sql==='SELECT id FROM finance_account_transactions WHERE backfill_id=? AND biz_type=6 ORDER BY id')return [state.finance_account_transactions.filter(t=>t.backfill_id===args[0]&&t.biz_type===6).map(t=>({id:t.id}))]
      if(sql==='SELECT * FROM finance_account_transactions WHERE backfill_id=? ORDER BY id'){return [state.finance_account_transactions.filter(t=>t.backfill_id===args[0]).map(copy)]}
      if(sql==='SELECT id, company_id, posting_period, biz_type FROM finance_period_backfills WHERE executed_at IS NOT NULL AND voucher_generated_at IS NULL ORDER BY id LIMIT ?')return [state.finance_period_backfills.filter(r=>r.executed_at&&!r.voucher_generated_at).sort((a,b)=>a.id-b.id).slice(0,args[0]).map(r=>({id:r.id,company_id:r.company_id,posting_period:r.posting_period,biz_type:r.biz_type}))]
      if(sql.startsWith('SELECT ')&&sql.includes('FROM finance_period_backfills')){
        let rows=state.finance_period_backfills.map(copy)
        if(sql.includes('WHERE company_id = ? AND biz_type = ? AND request_key = ?'))rows=rows.filter(r=>r.company_id===args[0]&&r.biz_type===args[1]&&r.request_key===args[2])
        else if(sql.includes('WHERE id = ? AND company_id = ?'))rows=rows.filter(r=>r.id===args[0]&&r.company_id===args[1])
        else if(sql.includes('WHERE id IN (?)'))rows=rows.filter(r=>args[0].includes(r.id))
        else if(sql.includes('WHERE id = ?'))rows=rows.filter(r=>r.id===args[0])
        else if(sql.includes('WHERE company_id = ?'))rows=rows.filter(r=>r.company_id===args.at(-1)||r.company_id===args[0])
        else throw Error('Unknown F4 application predicate '+sql)
        if(sql.includes('FOR UPDATE'))events.push('application:X')
        rows=rows.map(r=>({...r,...(sql.includes('AS application_no')?{application_no:'BF-20261030-0081'}:{}),...(sql.includes('AS approved_date')?{approved_date:r.approved_at?String(r.approved_at).slice(0,10):null}:{})}))
        if(sql.startsWith('SELECT COUNT(*)'))return [[{total:rows.length,pending:rows.filter(r=>r.status===0).length,pendingExecution:rows.filter(r=>r.status===1&&!r.executed_at).length,voucherPending:rows.filter(r=>r.executed_at&&!r.voucher_generated_at).length}]]
        if(sql.includes('LIMIT ? OFFSET ?'))rows=rows.slice(args.at(-1),args.at(-1)+args.at(-2))
        if(fail.applicationDetail && sql.includes(' AS application_no, company_id, period, business_date,') && sql.endsWith('request_snapshot FROM finance_period_backfills WHERE id = ? AND company_id = ?')) {
          assert.deepEqual(copy(args),[81,1]);
          if(fail.applicationDetail==='query')throw new AppError('fixture F4 write failure application detail query',503,'FIXTURE_APPLICATION_DETAIL');
          assert.equal(fail.applicationDetail,'fmt');
          rows=rows.map(row=>({...row,request_snapshot:'{broken-only-detail'}));
        }
        return [rows]
      }
      if(sql.startsWith('UPDATE finance_period_backfills')){
        if(sql.includes('SET status = ?,')){
          const [to,approver,name,remark,id,from]=args,row=state.finance_period_backfills.find(r=>r.id===id&&r.status===from)
          if(!row)return [{affectedRows:0}];Object.assign(row,{status:to,approver_id:approver,approver_name:name,approved_at:approvedDate+' 23:59:59',approve_remark:remark});events.push('approved');return [{affectedRows:1}]
        }
        if(sql.includes('SET executed_at = NOW()')){
          const [bizId,period,actor,name,id]=args,row=state.finance_period_backfills.find(r=>r.id===id&&r.status===1&&!r.executed_at)
          if(!row)return [{affectedRows:0}];Object.assign(row,{executed_at:'2026-11-01',executed_biz_id:bizId,posting_period:period,operator_id:actor,operator_name:name});events.push('executed');return [{affectedRows:1}]
        }
        const id=args.at(-1),row=state.finance_period_backfills.find(r=>r.id===id);assert.ok(row)
        const assignments=sql.split(' SET ')[1].split(' WHERE ')[0].split(',').map(c=>c.trim());let i=0
        const valid=new Set(['voucher_generated_at','voucher_generate_error']);assert.ok([...valid].every(c=>appColumns.has(c)))
        for(const field of assignments){const [name,value]=field.split(' = ').length===2?field.split(' = '):field.split('=');assert.ok(valid.has(name),'actual 260 result field');row[name]=value==='NOW()'?'2026-11-01':value==='NULL'?null:args[i++]}
        if(row.voucher_generate_error!=null&&[...row.voucher_generate_error].length>appErrorWidth)throw Object.assign(Error('actual260 width'),{code:'ER_DATA_TOO_LONG'})
        events.push('application:result');return [{affectedRows:1}]
      }
      return await original(raw,args)
    }catch(error){if(!['ER_DUP_ENTRY','ER_DATA_TOO_LONG'].includes(error.code)&&!/^fixture (?:F4 )?write failure/.test(String(error.message)))modelErrors.push(error.message);throw error}
  }
  const pool={getConnection:async()=>{events.push('pool:get');return f.conn},query:(sql,args)=>f.conn.query(sql,args)}
  const files={service:'modules/accounting/finance-backfills.service.js',guard:'modules/accounting/finance-period.guard.js',backfill:'modules/refunds/supplier-refunds.backfill.js',backfillRules:'modules/refunds/supplier-refunds.backfill-rules.js',operation:'utils/operationRequest.js',controller:'modules/refunds/supplier-refunds.controller.js',routes:'modules/refunds/supplier-refunds.routes.js',applicationController:'modules/accounting/finance-backfills.controller.js'}
  const cache={},routes=[]
  const router={use(...handlers){routes.push({method:'use',handlers})}}
  for(const method of ['get','post'])router[method]=(url,...handlers)=>routes.push({method,url,handlers})
  const pure={express:{Router:()=>router},'../../utils/route':require('../../backend/src/utils/route'),'../../utils/response':require('../../backend/src/utils/response'),'../../utils/requestKey':require('../../backend/src/utils/requestKey'),'node:crypto':crypto,crypto,'../../utils/AppError':AppError,'./AppError':AppError,'../../config/db':{pool},'../config/db':{pool},'../../constants/permissions':{PERMISSIONS:P},'../../utils/backendTime':time,'../../utils/operator':operator,'../../utils/logger':{info(){},warn(){}},'../../middleware/auth':{authMiddleware:(_q,_s,n)=>n(),requirePermission:code=>Object.assign((_q,_s,n)=>n(),{permission:code}),hasPermission:()=>{throw Error('unexpected request auth')}},
    '../payments/payments.service':{recordPayment:async(_id,_body,_actor,_key,opts)=>({entryId:21,legacyPeriod:opts.backfill.postingPeriod})},'../payments/payment-receipts.service':{create:()=>{throw Error('unexpected old receipt')},settle:async(id,body,actor,key,opts)=>{assert.equal(options.oldSettlement,true);assert.equal(id,22);assert.deepEqual(copy(body),{});assert.equal(key,'old-fixed');return{id:22,legacyPeriod:opts.backfill.postingPeriod}}},'../refunds/refund-orders.service':{execute:()=>{throw Error('unexpected customer refund')}},'./accounting.voucher.service':{generatePeriodVouchers:()=>{if(options.oldPayment)throw new AppError('fixture F4 write failure old payment generator',503,'FIXTURE_OLD_GENERATOR');throw Error('unexpected whole-period generation for RF')}}}
  const aliases={'./finance-backfills.service':'service','./finance-period.guard':'guard','../accounting/finance-period.guard':'guard','../../utils/operationRequest':'operation','../refunds/supplier-refunds.backfill':'backfill','./supplier-refunds.backfill-rules':'backfillRules','../refunds/supplier-refunds.backfill-rules':'backfillRules'}
  function load(name){
    if(Object.hasOwn(cache,name))return cache[name]
    const filename=path.join(base,files[name]);if(!fs.existsSync(filename)){assert.ok(['backfill','backfillRules'].includes(name));return cache[name]={}}
    const module={exports:{}};cache[name]=module.exports
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,Date,Buffer,require:dep=>{
      if(Object.hasOwn(pure,dep))return pure[dep]
      if(Object.hasOwn(aliases,dep))return load(aliases[dep])
      if(dep==='./accounting.period-lock')return a.load('periodLock')
      if(dep==='./supplier-refunds.accounting')return a.load('accounting')
      if(dep==='../accounting/voucher-supplier-refunds')return a.load('builder')
      if(dep==='../accounting/voucher-engine')return a.load('engine')
      if(dep==='./supplier-refunds.receive')return f.module('receive')
      if(dep==='./supplier-refunds.service')return f.module('service')
      if(dep==='./supplier-refunds.controller')return load('controller')
      if(dep==='../refunds/supplier-refunds.rules')return f.module('rules')
      const match=/^\.\/supplier-refunds\.(rules|actor|source|operations|context)$/.exec(dep)
      if(match)return f.module(match[1])
      modelErrors.push('Unstubbed F4 require '+dep);throw Error('Unstubbed F4 require '+dep)
    }},{filename});return cache[name]=module.exports
  }
  f.installBackfillBoundary(load('backfill'))
  return {a,f,load,routes,events,queries,fail,approvedDate,body:{operationUuid:accountingFixture.uuid(901),reason:'收到原退款'},options:{userId:9,requestKey:'refund-backfill-fixed'},get data(){return f.data},get state(){return f.state}}
}
module.exports={fixture,capability,assertNoModelErrors,copy,uuid:accountingFixture.uuid,P}
