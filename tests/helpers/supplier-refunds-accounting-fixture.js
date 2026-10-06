'use strict'
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const baseFixture=require('./supplier-refunds-receive-fixture')
const AppError=require('../../backend/src/utils/AppError')
const money=require('../../backend/src/utils/decimalMoney')
const voucherSource=require('../../backend/src/constants/voucherSource')
const saleMoney=require('../../backend/src/modules/accounting/voucher-sale-money')
const sqlIdentifier=require('../../backend/src/utils/sqlIdentifier')
const backendTime=require('../../backend/src/utils/backendTime')
const {PERMISSIONS}=require('../../backend/src/constants/permissions')
const base=path.resolve(__dirname,'../../backend/src')
const copy=value=>JSON.parse(JSON.stringify(value))
const rfDdl=fs.readFileSync(path.join(base,'database/280_supplier_refunds.sql'),'utf8').split('CREATE TABLE IF NOT EXISTS `supplier_refund_orders` (')[1].split(') ENGINE=')[0]
const rfColumns=new Set([...rfDdl.matchAll(/^  `([^`]+)` /gm)].map(m=>m[1]))
const errorWidth=Number(/`voucher_generate_error` VARCHAR\((\d+)\)/.exec(rfDdl)[1])
const schemaError=(code,message)=>Object.assign(Error(message),{code,rfSchemaViolation:true})
const modelErrors=[]
function assertNoModelErrors(){assert.deepEqual(modelErrors.splice(0),[],'No swallowed unknown import/SQL or fixture assertion')}
function required(object,name){assert.equal(typeof object[name],'function','F3 actual '+name+' capability must exist');return object[name]}
async function fixture(amount='4.0000',gross='100.0000',options={}) {
  const f=baseFixture.fixture({mutate:data=>{
    if(options.accountType)data.finance_accounts.find(a=>a.id===42).type=options.accountType
    if(options.receipt){
      data.payment_entries[0].account_id=null;data.payment_entries[0].receipt_id=21;data.payment_entries[0].amount='80.0000';data.payment_records[0].paid_amount='80.0000'
      data.payment_receipts=[{id:21,type:1,party_id:4,receipt_no:'PY21',account_id:41,amount:'100.0000',payment_date:'2026-10-01',settled_amount:'80.0000',balance:'20.0000'}]
      data.finance_account_transactions[0].biz_id=21;data.finance_account_transactions[0].biz_no='PY21'
    }
  }})
  const body=baseFixture.input(301)
  body.amount=amount;body.allocations[0].amount=amount
  if(options.refundDate)body.refundDate=options.refundDate
  f.data.purchase_returns[0].total_amount=gross
  f.data.purchase_return_items[0].quantity='1.00'
  f.data.purchase_return_items[0].unit_price=gross
  f.data.purchase_order_items[0].unit_price=gross
  if(options.creatorId)f.data.sys_users.push({...f.data.sys_users[0],id:options.creatorId,real_name:'creator'})
  const created=await f.module('service').create(body,{...f.options,...(options.creatorId?{userId:options.creatorId}:{})})
  await f.module('service').confirm(created.id,{operationUuid:baseFixture.uuid(302)},f.options)
  const receiveBody={operationUuid:baseFixture.uuid(303),...(options.receiveReason===undefined?{}:{reason:options.receiveReason})}
  const ack=options.prepareOnly?{id:created.id}:await f.module('service').receive(created.id,receiveBody,{...f.options,postCommit:async()=>{}})
  Object.assign(f.data,{
    acct_accounts:[{id:1,company_id:1,code:'1001',name:'库存现金'},{id:2,company_id:1,code:'1002',name:'银行存款'},{id:3,company_id:1,code:'2202',name:'应付账款'}],
    acct_vouchers:[],acct_voucher_entries:[],acct_periods:[],
  })
  f.data.sys_role_permissions.push({role_id:2,permission:PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE})
  for(const row of f.data.supplier_refund_orders)row.voucher_id=null // Actual nullable 278 default.
  const queries=[],events=[],schemaViolations=[],fail={},original=f.conn.query.bind(f.conn)
  f.conn.query=async(raw,args=[])=>{
    try {
    const sql=raw.replace(/\s+/g,' ').trim(),state=f.state
    queries.push({sql,args:copy(args)})
    if(sql.startsWith('UPDATE supplier_refund_orders SET ')){
      const assignments=sql.split(' SET ')[1].split(' WHERE ')[0].split(',')
      for(const assignment of assignments){
        const column=assignment.split('=')[0].trim()
        if(!rfColumns.has(column))throw schemaError('ER_BAD_FIELD_ERROR',`Unknown column '${column}' in supplier_refund_orders`)
      }
    }
    if(fail.match&&sql.includes(fail.match))throw Error(fail.errorMessage||'fixture write failure '+fail.match)
    if(sql.includes('supplier-refund-facts')){
      assert.match(sql,/LEFT JOIN finance_accounts/);assert.match(sql,/LEFT JOIN supplier_refund_orders/)
      assert.equal(args[0],1);assert.equal(args[1],1)
      assert.ok(sql.includes('WHERE t.biz_type=6 AND (a.company_id=? OR r.company_id=? OR a.id IS NULL OR r.id IS NULL)'))
      let rows=state.finance_account_transactions.filter(t=>{
        if(t.biz_type!==6)return false
        const account=state.finance_accounts.find(a=>a.id===t.account_id)
        const refund=state.supplier_refund_orders.find(r=>r.fund_transaction_id===t.id)
        return !account||!refund||account.company_id===args[0]||refund.company_id===args[1]
      })
      if(sql.includes('t.id=?'))rows=rows.filter(t=>t.id===args[2])
      if(sql.includes('DATE_FORMAT')){const period=args.at(-1);rows=rows.filter(t=>String(t.voucher_date_override||t.happened_at).replaceAll('-','').slice(0,6)===period)}
      return [rows.map(copy)]
    }
    // Finite original domains have no rows in this accounting projection fixture.
    if(sql.startsWith('SELECT f.source_id AS id, COALESCE(SUM(f.tax_amount),0) tax FROM fin_invoices f')){assert.match(sql,/f.company_id = \?/);assert.equal(args.length,1);return [[]]}
    if(sql.startsWith('SELECT pr.order_id AS poId,')){assert.match(sql,/FROM payment_records pr JOIN purchase_orders po/);return [[]]}
    if(sql.startsWith('SELECT t.id AS txnId,')){assert.match(sql,/WHERE t.biz_type IN \(1, 2, 3, 5\)$/);return [[]]}
    if(sql.startsWith('SELECT id, return_no, supplier_id, supplier_name, total_amount, updated_at AS vdate FROM purchase_returns')){assert.match(sql,/WHERE status = 3 AND deleted_at IS NULL/);return [[]]}
    if(sql.startsWith('SELECT sr.id, sr.return_no, sr.customer_id,')){assert.match(sql,/WHERE sr.status = 3 AND sr.deleted_at IS NULL/);return [[]]}
    if(sql.startsWith('SELECT COUNT(*) AS missing FROM sale_return_items sri'))return [[{missing:0}]]
    if(sql.startsWith('SELECT ic.id, ic.check_no,')){assert.match(sql,/WHERE ic.status = 2 AND ic.deleted_at IS NULL/);return [[]]}
    if(sql.startsWith('SELECT pr.id, pr.order_no, pr.party_name,')){assert.match(sql,/pr.order_id IS NULL AND pr.debit_account_code IS NOT NULL$/);return [[]]}
    if(sql==='SELECT source_id,source_no,voucher_date FROM acct_vouchers WHERE company_id=? AND source_type=? AND source_id IS NOT NULL'){assert.equal(args[1],'purchase_settle');return [[]]}
    if(sql==='SELECT period FROM acct_periods WHERE company_id=? AND status=2 FOR UPDATE')return [state.acct_periods.filter(p=>p.company_id===args[0]&&p.status===2).map(p=>({period:p.period}))]
    if(sql.startsWith('SELECT a.code, a.name, a.category, a.balance_dir,')){assert.match(sql,/a.category IN \(5, 6\)/);return [[]]}
    if(sql==='SELECT id, source_hash, status FROM acct_vouchers WHERE source_type = ? AND source_id = ? AND company_id = ?'){assert.equal(args[0],'period_close');return [[]]}
    if(sql.startsWith('INSERT INTO acct_periods (company_id, period, status,')){assert.equal(args[0],1);assert.equal(args[1],'202610');state.acct_periods.push({company_id:args[0],period:args[1],status:2});return [{affectedRows:1}]}
    // Historical reconciliation SQL is intentionally unchanged; expose exact old gross facts.
    if(sql.includes('COALESCE(SUM(IF(v.is_reversal=1,-e.amount,e.amount)),0) s')){assert.match(sql,/source_type IN \('receipt_in','payment_out','expense_pay'\)/);return [[{s:'100.00'}]]}
    if(sql==='SELECT COALESCE(SUM(t.amount),0) s FROM finance_account_transactions t WHERE t.biz_type IN (1,2,3)')return [[{s:'100.00'}]]
    if(sql.startsWith('SELECT COALESCE(SUM(CASE WHEN direction=')){assert.ok(!sql.includes('supplier_refund_in'));return [[{s:'100.00'}]]}
    if(sql==='SELECT COALESCE(SUM(total_amount),0) s FROM payment_records WHERE type=1'||sql==='SELECT COALESCE(SUM(total_amount),0) s FROM payment_records WHERE type=2 AND order_id IS NOT NULL')return [[{s:'100.00'}]]
    if(sql.startsWith('SELECT COALESCE(SUM(CASE WHEN pr.debit_account_code IS NULL'))return [[{total:0,unclassified:0,unclassified_count:0,uncovered:0,uncovered_count:0}]]
    if(sql==='SELECT * FROM finance_account_transactions WHERE backfill_id IN (?) ORDER BY id'){
      assert.equal(args.length,1)
      assert.ok(Array.isArray(args[0])&&args[0].length>0)
      assert.ok(args[0].every(id=>Number.isSafeInteger(id)&&id>0))
      assert.deepEqual(copy(args[0]),[...new Set(args[0])].sort((a,b)=>a-b),'exact sorted application identities')
      return [state.finance_account_transactions.filter(t=>args[0].includes(t.backfill_id)).map(copy)]
    }
    const select=/^SELECT \* FROM ([a-z_]+) WHERE ([a-z_]+) IN \(\?\) ORDER BY id$/.exec(sql)
    if(select){
      const [_,table,column]=select
      const allowed={supplier_refund_orders:['id','payment_record_id'],supplier_refund_allocations:['payment_record_id'],purchase_returns:['id'],purchase_orders:['id'],purchase_return_items:['return_id'],purchase_order_items:['order_id'],payment_records:['id'],payment_entries:['record_id','receipt_id'],payment_receipts:['id'],finance_accounts:['id'],finance_account_transactions:['id'],supplier_refund_operations:['refund_id']}
      assert.ok(allowed[table]?.includes(column),'finite batch field '+sql)
      assert.ok(Array.isArray(args[0])&&args[0].length>0)
      return [state[table].filter(r=>args[0].includes(Number(r[column]))).map(copy)]
    }
    if(sql.startsWith('SELECT * FROM supplier_refund_orders WHERE company_id=? AND status=3')){assert.equal(args[0],1);return [state.supplier_refund_orders.filter(r=>r.company_id===args[0]&&r.status===3&&(args.length===1||r.fund_transaction_id===args[1])).map(copy)]}
    if(sql==='SELECT * FROM supplier_refund_orders WHERE id IN (?) OR fund_transaction_id IN (?) ORDER BY id')return [state.supplier_refund_orders.filter(r=>args[0].includes(r.id)||args[1].includes(r.fund_transaction_id)).map(copy)]
    if(sql==='SELECT * FROM finance_account_transactions WHERE biz_type=6 AND biz_id IN (?) ORDER BY id')return [state.finance_account_transactions.filter(t=>t.biz_type===6&&args[0].includes(t.biz_id)).map(copy)]
    if(sql==='SELECT * FROM finance_account_transactions WHERE biz_type=2 AND (biz_id IN (?) OR biz_no IN (?)) ORDER BY id')return [state.finance_account_transactions.filter(t=>t.biz_type===2&&(args[0].includes(t.biz_id)||args[1].includes(t.biz_no))).map(copy)]
    if(sql==='SELECT id, code, name FROM acct_accounts WHERE company_id = ? AND deleted_at IS NULL')return [state.acct_accounts.filter(a=>a.company_id===args[0]).map(({id,code,name})=>({id,code,name}))]
    if(sql==='SELECT id FROM acct_companies WHERE id = ? FOR UPDATE'){
      assert.equal(args[0],1);events.push('company:X');fail.companyGate?.(state);return [[{id:1}]]
    }
    if(sql==='SELECT status FROM acct_periods WHERE period = ? AND company_id = ? FOR SHARE'||sql==='SELECT status FROM acct_periods WHERE period = ? AND company_id = ? FOR UPDATE')return [state.acct_periods.filter(p=>p.period===args[0]&&p.company_id===args[1]).map(p=>({status:p.status}))]
    if(sql==='SELECT id, voucher_no, source_hash, status, period FROM acct_vouchers WHERE company_id = ? AND source_type = ? AND source_id = ? AND source_period = ? FOR UPDATE')return [state.acct_vouchers.filter(v=>v.company_id===args[0]&&v.source_type===args[1]&&v.source_id===args[2]&&v.source_period===args[3]).map(copy)]
    if(sql==='SELECT * FROM acct_vouchers WHERE company_id=? AND source_type=? AND source_id IN (?) ORDER BY id')return [state.acct_vouchers.filter(v=>v.company_id===args[0]&&v.source_type===args[1]&&args[2].includes(v.source_id)).map(copy)]
    if(sql==='SELECT * FROM acct_voucher_entries WHERE voucher_id IN (?) ORDER BY voucher_id, line_no')return [state.acct_voucher_entries.filter(e=>args[0].includes(e.voucher_id)).map(copy)]
    if(sql.includes("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(voucher_no,'-',-1) AS UNSIGNED)), 0) AS mx"))return [[{mx:0}]]
    if(sql.startsWith('INSERT INTO acct_vouchers')){
      assert.equal(args[0],1);assert.equal(args[4],'supplier_refund_in');assert.ok(state.supplier_refund_orders.some(r=>r.fund_transaction_id===args[5]&&r.status===3))
      const id=501+state.acct_vouchers.length
      const columns=['company_id','voucher_no','voucher_date','period','source_type','source_id','source_period','source_no','summary','total_debit','total_credit','source_hash','created_by']
      state.acct_vouchers.push({id,status:1,is_reversal:0,...Object.fromEntries(columns.map((k,i)=>[k,args[i]]))})
      return [{insertId:id,affectedRows:1}]
    }
    if(sql.startsWith('INSERT INTO acct_voucher_entries')){
      const keys=['voucher_id','line_no','account_id','account_code','account_name','direction','amount','summary','aux_type','aux_id','aux_name']
      state.acct_voucher_entries.push({id:601+state.acct_voucher_entries.length,...Object.fromEntries(keys.map((k,i)=>[k,args[i]]))});return [{affectedRows:1}]
    }
    if(sql==='UPDATE supplier_refund_orders SET voucher_id=?,voucher_generate_error=? WHERE id=? AND status=3'){
      assert.equal(args.length,3)
      const [voucherId,error,id]=args,row=state.supplier_refund_orders.find(r=>r.id===id)
      assert.ok(row);assert.equal(row.status,3)
      if(error!==null&&(typeof error!=='string'||[...error].length>errorWidth))throw schemaError('ER_DATA_TOO_LONG','voucher_generate_error exceeds actual 278 VARCHAR width')
      if(voucherId!==null){
        assert.ok(Number.isSafeInteger(voucherId)&&voucherId>0)
        assert.ok(state.acct_vouchers.some(v=>v.id===voucherId&&v.company_id===row.company_id&&v.source_type==='supplier_refund_in'&&v.source_id===row.fund_transaction_id),'accurate proved voucher identity')
        assert.equal(error,null)
      }
      row.voucher_id=voucherId;row.voucher_generate_error=error
      return [{affectedRows:1}]
    }
    // Original F1/F2 SQL remains bound to its audited strict fixture, never a database fallback.
    return await original(raw,args)
    }catch(error){if(error.rfSchemaViolation)schemaViolations.push({code:error.code,message:error.message,sql,args:copy(args)});else if(!String(error.message).startsWith('fixture write failure'))modelErrors.push(error.message);throw error}
  }
  const cache={}
  const files={
    builder:'modules/accounting/voucher-supplier-refunds.js',engine:'modules/accounting/voucher-engine.js',
    period:'modules/accounting/accounting.period.service.js',periodLock:'modules/accounting/accounting.period-lock.js',
    accounting:'modules/refunds/supplier-refunds.accounting.js',postcommit:'modules/refunds/supplier-refunds.postcommit.js',
    vouchers:'modules/accounting/accounting.voucher.service.js',
  }
  const pure={crypto,'node:crypto':crypto,'../../utils/sqlIdentifier':sqlIdentifier,'../../utils/AppError':AppError,'../../utils/decimalMoney':money,'../../utils/backendTime':backendTime,
    '../refunds/supplier-refunds.backfill-rules':null,'../../constants/voucherSource':voucherSource,'../../constants/permissions':{PERMISSIONS},'../../utils/logger':{info(){},warn(){}},
    '../../config/db':{pool:{getConnection:async()=>f.conn,query:(sql,args)=>f.conn.query(sql,args)}},
    './voucher-sale-money':saleMoney,
    './voucher-sale-periods':{SALE_TYPES:['sale_revenue','sale_cogs'],loadSaleShipmentFacts:async()=>({orders:[]}),projectSaleShipments:()=>[],reconcileSalePeriods:async()=>[]},
    '../inbound-tasks/inbound-purchase-source':{assertPurchaseSettlementSources:async()=>{throw Error('unexpected old PO source in empty boundary')}},
    './voucher-sale-returns':{loadCommercialReturnVoucherAmounts:async()=>new Map()},
    './voucher-source-revisions':{reviseSourceVoucher:()=>{throw Error('unexpected old source revision')}},
  }
  const aliases={'./voucher-supplier-refunds':'builder','../accounting/voucher-supplier-refunds':'builder','./voucher-engine':'engine','../accounting/voucher-engine':'engine','./accounting.period.service':'period','./accounting.period-lock':'periodLock','../accounting/accounting.period-lock':'periodLock','./supplier-refunds.accounting':'accounting'}
  function load(name){
    if(Object.hasOwn(cache,name))return cache[name]
    const filename=path.join(base,files[name])
    if(!fs.existsSync(filename)){assert.ok(['builder','accounting'].includes(name));return cache[name]={}}
    const module={exports:{}};cache[name]=module.exports
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,Date,Buffer,console,require:dep=>{
      if(dep==='../refunds/supplier-refunds.backfill-rules')return f.module('backfill-rules')
      if(Object.hasOwn(pure,dep))return pure[dep]
      if(Object.hasOwn(aliases,dep))return load(aliases[dep])
      const domain=/^(?:\.\/|\.\.\/refunds\/)supplier-refunds\.(rules|actor|operations)$/.exec(dep)
      if(domain)return f.module(domain[1])
      modelErrors.push('Unstubbed F3 require '+dep);throw Error('Unstubbed F3 require '+dep)
    }},{filename})
    return cache[name]=module.exports
  }
  return {f,ack,body,load,queries,events,schemaViolations,fail,get data(){return f.data},required,copy}
}
module.exports={fixture,required,assertNoModelErrors,money,uuid:baseFixture.uuid,copy}
