'use strict'
// Pure real helper calls only: no config/db, sockets, auth or environment load.
// B7_ORDINARY_RETURN_MUTANT=gross deliberately removes the net allocation;
// B7_ORDINARY_RETURN_MUTANT=early_tail moves a tail to an earlier return.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
const filename=path.resolve(__dirname,'../backend/src/modules/sale/sale.ordinary-return-money.js')
const nativeRequire=require('node:module').createRequire(filename)
let source=fs.readFileSync(filename,'utf8')
if(process.env.B7_ORDINARY_RETURN_MUTANT==='gross')source=source.replace('return halfUp(basis.net * gross, basis.originalGross)','return halfUp(basis.gross * gross, basis.originalGross)')
if(process.env.B7_ORDINARY_RETURN_MUTANT==='early_tail')source=source.replace('after===endpoint?cumulativeNet(basis,endpoint)-priorFinancial:basis.net*batchGross/basis.originalGross','cumulativeNet(basis,after)-priorFinancial')
if(process.env.B7_ORDINARY_RETURN_MUTANT==='close_snapshot')source=source.replace("const basis=await readBasis(conn,order.id,' FOR UPDATE')","const basis=await readBasis(conn,order.id)")
if(process.env.B7_ORDINARY_RETURN_MUTANT==='post_stock_scan')source=source.replace("const previous=basis.previous\n  if(!previous)review('缺少库存动作前已核对的实际退货回执')\n  return { basis, returnedFinancial","const previous=await receipts(conn,basis)\n  if(!previous)review('缺少库存动作前已核对的实际退货回执')\n  return { basis, returnedFinancial")
if(process.env.B7_ORDINARY_RETURN_MUTANT==='nested_snapshot')source=source.replace(/async function assertTrackedReturns[\s\S]*?(?=async function assertCloseRemainder)/,`async function assertTrackedReturns(conn,orderId){
  const [bad]=await conn.query(\`SELECT sr.id FROM sale_returns sr WHERE sr.sale_order_id=? AND sr.status=3 AND sr.deleted_at IS NULL
    AND (sr.ordinary_net_basis_order_id IS NULL OR sr.ordinary_net_basis_order_id<>sr.sale_order_id
      OR EXISTS (SELECT 1 FROM sale_return_items sri WHERE sri.return_id=sr.id AND NOT EXISTS (SELECT 1 FROM sale_ordinary_return_receipts r WHERE r.return_item_id=sri.id))) LIMIT 1 FOR SHARE\`,[orderId])
  if(bad.length)review('旧已执行退货缺少准确净额意图或回执，保留原账款待核')
}
`)

if(process.env.B7_ORDINARY_RETURN_MUTANT==='missed_winner')source=source.replace('const winner=await readBasis(conn,order.id,lock)','const winner=null')
const mod={exports:{}}
vm.runInNewContext(source,{module:mod,require:name=>{assert.ok(!name.includes('config/db'));return nativeRequire(name)}},{filename})
const m=mod.exports
function basis({legacy=true,gross='100.0000',discount='10.0000',lines=[{id:1,product_id:7,warehouse_id:2,quantity:'10.00',unit_price:'10.00000000',amount:'100.0000',unit:'个'}]}={}){
 const b=m.deriveBasis({id:9,warehouse_id:2,total_amount:gross,discount_amount:discount},lines,'first_real_ship')
 if(!legacy)return b
 const old={...b,source_snapshot:{...b.snapshot,version:1}};for(const k of ['cashPolicy','cashGross','cashNet','budgets'])delete old[k]
 return m.parseSnapshot(old)
}
const amount=p=>Number(p.financial)/10000
test('100/10 original net frozen90; full return neither gross100 nor negativeAR',()=>{
 const b=basis(),[p]=m.project(b,0n,[{quantity:10,unitPrice:10}]);assert.equal(amount(p),90)
 assert.equal(m.receivableTotal(b,'100','90'),0)
})
test('partial / successive returns sum exactly frozen net; original basis unchanged',()=>{
 const b=basis(),snap=JSON.stringify(b.snapshot)
 const a=m.project(b,0n,[{quantity:3,unitPrice:10}])[0]
 const c=m.project(b,a.gross,[{quantity:4,unitPrice:10}],a.financial)[0]
 const d=m.project(b,a.gross+c.gross,[{quantity:3,unitPrice:10}],a.financial+c.financial)[0]
 assert.deepEqual([amount(a),amount(c),amount(d)],[27,36,27]);assert.equal(a.financial+c.financial+d.financial,b.net)
 assert.equal(JSON.stringify(b.snapshot),snap)
})
test('different original line prices weight money; no current price/cost consulted',()=>{
 const b=basis({lines:[{id:1,product_id:7,warehouse_id:2,quantity:2,unit_price:25,amount:50},{id:2,product_id:8,warehouse_id:2,quantity:10,unit_price:5,amount:50}]})
 const p=m.project(b,0n,[{quantity:1,unitPrice:25},{quantity:2,unitPrice:5}]);assert.deepEqual(Array.from(p,amount),[22.5,9])
})
test('legacy v1 four-place per-batch floor retains strict final tail, .0033/.0033/.0034 totals .0100',()=>{
 const b=basis({gross:'0.03',discount:'0.02',lines:[{id:1,product_id:7,warehouse_id:2,quantity:3,unit_price:'0.01',amount:'0.03'}]})
 const p=[];let gross=0n,financial=0n;for(let n=0;n<3;n++){const one=m.project(b,gross,[{quantity:1,unitPrice:'0.01'}],financial)[0];p.push(one);gross+=one.gross;financial+=one.financial}
 assert.deepEqual(Array.from(p,amount),[.0033,.0033,.0034]);assert.equal(p.reduce((n,x)=>n+x.financial,0n),100n)
})
test('100% discount and fully rejected QA have zero money, source remains valid',()=>{
 const b=basis({discount:100}),p=m.project(b,0n,[{quantity:0,unitPrice:10},{quantity:10,unitPrice:10}]);assert.deepEqual(Array.from(p,amount),[0,0])
})
test('cumulative refund cannot exceed original gross or net by .0001',()=>{
 assert.throws(()=>m.project(basis(),0n,[{quantity:'10.01',unitPrice:10}]),e=>e.code===m.REVIEW)
 assert.throws(()=>m.receivableTotal(basis(),'100','90.0001'),e=>e.code===m.REVIEW)
})
test('legacy v1 raw-price/head mismatch cannot be reinterpreted as a frozen old proof',()=>{
 assert.throws(()=>basis({gross:1,discount:'0.1',lines:[{id:1,product_id:7,warehouse_id:2,quantity:3,unit_price:'0.3333',amount:1}]}),e=>e.code===m.REVIEW)
})
test('duplicate or missing frozen source identity fails closed',()=>{
 const line={id:1,product_id:7,warehouse_id:2,quantity:5,unit_price:10,amount:50}
 assert.throws(()=>basis({lines:[line,line]}),e=>e.code===m.REVIEW)
 const b=basis();assert.throws(()=>m.parseSnapshot({...b,source_snapshot:'broken'}),e=>e.code===m.REVIEW)
})
test('nonnegative monotone cumulative projection at four-place cash tails',()=>{
 const b=basis({gross:'0.02',discount:'0.01',lines:[{id:1,product_id:7,warehouse_id:2,quantity:200,unit_price:'0.0001',amount:'0.02'}]})
 let previous=0n;for(let i=0n;i<=20000n;i++){const v=m.cumulativeNet(b,i*10000n);assert.ok(v>=previous);assert.ok(v<=b.net);previous=v}assert.equal(previous,b.net)
})
function legacyConnection({total='0.0001',closed=false,old=false,shipped=1}={}){
 const log=[],writes=[]
 const order={id:9,warehouse_id:2,total_amount:'0.0002',discount_amount:'0.0001'}
 const conn={query:async(sql,p=[])=>{log.push(sql)
  if(sql.startsWith('SELECT * FROM sale_ordinary_return_bases'))return [[]]
  if(sql.includes('FROM sale_order_items'))return [[{id:1,product_id:7,warehouse_id:2,quantity:2,shipped_qty:shipped,unit_price:'0.0001',amount:'0.0002',unit:'个'}]]
  if(sql.includes('FROM sale_order_events'))return [closed?[{id:1}]:[]]
  if(sql.includes('FROM sale_returns sr'))return [old?[{id:2}]:[]]
  if(sql.includes('FROM payment_records'))return [[{total_amount:total}]]
  if(sql.startsWith('INSERT')){writes.push([sql,p]);return [{insertId:9}]}
  throw Error('Unexpected SQL '+sql)
 }};return{conn,order,log,writes}
}
test('legacy partial original AR .0000 versus new .0001 refuses without rewrite',async()=>{
 const f=legacyConnection({total:'0.0000'});await assert.rejects(m.prepareCreate(f.conn,f.order,[]),e=>e.code===m.REVIEW||e.code==='CASH_LEGACY_PRECISION_REVIEW_REQUIRED');assert.equal(f.writes.length,0)
})
test('legacy closed remaining or old gross-executed discount return refuses without insert',async()=>{
 for(const options of [{closed:true},{old:true}]){const f=legacyConnection(options);await assert.rejects(m.prepareCreate(f.conn,f.order,[]),e=>e.code===m.REVIEW||e.code==='CASH_LEGACY_PRECISION_REVIEW_REQUIRED');assert.equal(f.writes.length,0)}
})
test('legacy fractional shipment fails closed without freezing or rewriting guessed source',async()=>{
 const f=legacyConnection({total:'0.0000'});await assert.rejects(m.prepareShipment(f.conn,f.order),e=>e.code==='CASH_LEGACY_PRECISION_REVIEW_REQUIRED');assert.equal(f.writes.length,0)
})
test('kit create bypasses ordinary cash source and does no SQL',async()=>{
 const conn={query:()=>{throw Error('No SQL expected')}}
 assert.equal(await m.prepareCreate(conn,{id:1,commercial_model:'kit-v1'},[]),null)
})
test('concurrent creator after SOI wait reads current requested quantity, not pre-wait RR quota',async()=>{
 const file=path.resolve(__dirname,'../backend/src/modules/returns/returns-sale.service.js'),module={exports:{}}
 let code=fs.readFileSync(file,'utf8')
 if(process.env.B7_ORDINARY_RETURN_MUTANT==='quota_snapshot')code=code.replace('ORDER BY sri.id FOR SHARE','ORDER BY sri.id')
 vm.runInNewContext(code+'\nmodule.exports.__validate=validateSaleReturnItems',{module,require:()=>({})},{filename:file})
 const queries=[],conn={query:async sql=>{queries.push(sql)
  if(sql.startsWith('SELECT id FROM sale_order_items'))return [[]]
  if(sql.includes('AS shipped_qty'))return [[{id:1,product_id:7,unit_price:10,shipped_qty:10,returned_qty:0}]]
  if(sql.includes('FROM sale_return_items sri'))return [sql.endsWith('FOR SHARE')?[{sale_item_id:1,quantity:6}]:[]]
  throw Error('Unexpected SQL '+sql)
 }}
 // Replace only the standard error dependency; all business code above is real.
 const realModule={exports:{}}
 vm.runInNewContext(code+'\nmodule.exports.__validate=validateSaleReturnItems',{module:realModule,require:name=>name==='../../utils/AppError'?nativeRequire(name):{}},{filename:file})
 await assert.rejects(realModule.exports.__validate(conn,9,[{sourceItemId:1,productId:7,productName:'P',quantity:6}]),e=>e.statusCode===409)
 assert.ok(queries[0].includes('FOR UPDATE'))
})
test('legacy confirmed NULL net intent and a mismatched source marker refuse execution',async()=>{
 for(const marker of [null,10]){
  const b=basis(),conn={query:async sql=>{
   if(sql.includes('FROM return_tasks rt'))return [[{id:3,sale_order_id:9,ordinary_net_basis_order_id:marker}]]
   if(sql.startsWith('SELECT * FROM sale_ordinary_return_bases'))return [[b]]
   if(sql==='SELECT commercial_model FROM sale_orders WHERE id=?')return [[{}]]
   if(sql==='SELECT * FROM sale_orders WHERE id=? FOR SHARE')return [[{id:9,status:4,warehouse_id:2}]]
   if(sql.includes('FROM sale_order_items'))return [[{id:1,product_id:7,warehouse_id:2,quantity:10,shipped_qty:10,unit_price:10}]]
   if(sql.startsWith('SELECT sr.id')||sql.includes('FROM sale_ordinary_return_receipts'))return [[]]
   if(sql==='SELECT id,sale_order_id,ordinary_net_basis_order_id,cash_policy FROM sale_returns WHERE id=? FOR UPDATE')return [[{id:3,sale_order_id:9,ordinary_net_basis_order_id:marker}]]
   throw Error('Unexpected SQL '+sql)
  }}
  await assert.rejects(m.lockReturn(conn,{taskId:4}),e=>e.code===m.REVIEW)
 }
})
test('source X and original SR X are acquired before the caller can acquire RT/stock',async()=>{
 const b=basis(),log=[],conn={query:async(sql,p)=>{log.push(sql)
  if(sql.includes('FROM return_tasks rt'))return [[{id:3,sale_order_id:9,ordinary_net_basis_order_id:9}]]
  if(sql.startsWith('SELECT * FROM sale_ordinary_return_bases'))return [[b]]
   if(sql==='SELECT commercial_model FROM sale_orders WHERE id=?')return [[{}]]
   if(sql==='SELECT * FROM sale_orders WHERE id=? FOR SHARE')return [[{id:9,status:4,warehouse_id:2}]]
   if(sql.includes('FROM sale_order_items'))return [[{id:1,product_id:7,warehouse_id:2,quantity:10,shipped_qty:10,unit_price:10}]]
  if(sql.startsWith('SELECT sr.id')||sql.includes('FROM sale_ordinary_return_receipts'))return [[]]
  if(sql==='SELECT id,sale_order_id,ordinary_net_basis_order_id,cash_policy FROM sale_returns WHERE id=? FOR UPDATE'){assert.equal(p[0],3);return [[{id:3,sale_order_id:9,ordinary_net_basis_order_id:9,cash_policy:'cash-cents-v1'}]]}
  throw Error('Unexpected SQL '+sql)
 }}
 assert.equal((await m.lockReturn(conn,{taskId:4})).orderId,9)
 assert.ok(log.findIndex(s=>s.includes('sale_ordinary_return_bases')&&s.endsWith('FOR UPDATE'))<log.findIndex(s=>s.includes('sale_returns WHERE id=? FOR UPDATE')))
})
test('legacy v1 nonterminal .02/.03 refunds floor twice then final actual balance .0068',()=>{
 const b=basis({gross:'0.03',discount:'0.01',lines:[{id:1,product_id:7,warehouse_id:2,quantity:3,unit_price:'0.01',amount:'0.03'}]})
 const values=[];let gross=0n,financial=0n
 for(let n=0;n<3;n++){const p=m.project(b,gross,[{quantity:1,unitPrice:'0.01'}],financial)[0];values.push(amount(p));gross+=p.gross;financial+=p.financial}
 assert.deepEqual(values,[.0066,.0066,.0068]);assert.equal(financial,200n)
})
test('legacy v1 accurate closed endpoint uses earned net, never entire original unshipped budget',()=>{
 const b=basis({gross:'0.03',discount:'0.01',lines:[{id:1,product_id:7,warehouse_id:2,quantity:3,unit_price:'0.01',amount:'0.03'}]})
 b.terminalGross=100000000n
 const [p]=m.project(b,0n,[{quantity:1,unitPrice:'0.01'}]);assert.equal(amount(p),.0067)
 assert.throws(()=>m.project(b,0n,[{quantity:2,unitPrice:'0.01'}]),e=>e.code===m.REVIEW)
 assert.throws(()=>m.project(b,b.terminalGross,[{quantity:0,unitPrice:'0.01'}],66n),e=>e.code===m.REVIEW)
})

test('shipment current source and prior receipts are acquired before stock; money uses only same-connection context',async()=>{
 const b=basis({legacy:false}),log=[],conn={query:async(sql,p)=>{log.push(sql)
  if(sql.startsWith('SELECT * FROM sale_ordinary_return_bases'))return [[b]]
  if(sql.includes('FROM sale_order_items'))return [[{id:1,product_id:7,warehouse_id:2,quantity:10,shipped_qty:10,unit_price:10}]]
  if(sql.startsWith('SELECT sr.id')||sql.includes('FROM sale_ordinary_return_receipts'))return [[]]
  throw Error('Unexpected SQL '+sql)
 }}
 const ctx=await m.prepareShipment(conn,{id:9,discount_amount:10,cash_policy:'cash-cents-v1'}),before=log.length
 const money=await m.orderMoney(conn,9,ctx);assert.equal(money.returnedFinancial,0);assert.equal(log.length,before)
 assert.ok(log[0].includes('sale_order_items')&&log[0].endsWith('FOR SHARE'))
 assert.ok(log.findIndex(s=>s.includes('sale_order_items'))<log.findIndex(s=>s.includes('sale_ordinary_return_bases')&&s.endsWith('FOR SHARE')))
 assert.deepEqual(JSON.parse(JSON.stringify(await m.currentShippedGross(conn,ctx))),{vector:[{id:1,quantity:'10.00'}]})
 assert.ok(log.at(-1).includes('WHERE id IN (?)')&&log.at(-1).endsWith('FOR SHARE'))
 await assert.rejects(m.orderMoney({query:()=>{throw Error('No SQL')}},9,ctx),e=>e.code===m.REVIEW)
})
test('close ignores early RR missing basis and current-reads source before source X',async()=>{
 const b=basis({legacy:false}),log=[],conn={query:async sql=>{log.push(sql)
  if(sql.includes('FROM sale_order_items'))return [[{id:1,product_id:7,warehouse_id:2,quantity:10,shipped_qty:4,unit_price:10}]]
  if(sql.startsWith('SELECT * FROM sale_ordinary_return_bases'))return [sql.endsWith('FOR UPDATE')?[b]:[]]
  if(sql.includes('FROM sale_order_events'))return [[{id:1}]]
  if(sql.startsWith('SELECT sr.id')||sql.includes('FROM sale_ordinary_return_receipts'))return [[]]
  throw Error('Unexpected SQL '+sql)
 }}
 const ctx=await m.assertCloseRemainder(conn,{id:9,status:3,warehouse_id:2,total_amount:100,discount_amount:10})
 assert.equal(ctx.orderId,9);assert.equal(ctx.terminalGross,400000000000n)
 assert.ok(log[0].includes('sale_order_items'));assert.ok(log.find(sql=>sql.includes('sale_ordinary_return_bases')&&sql.endsWith('FOR UPDATE')))
 assert.equal((await m.orderMoney(conn,9,ctx)).returnedFinancial,0)
})

test('pre-stock completeness uses one joined current read, preserving newly committed prior receipt in early RR',async()=>{
 const b=basis({legacy:false}),log=[],conn={query:async sql=>{log.push(sql)
  if(sql.startsWith('SELECT * FROM sale_ordinary_return_bases'))return [[b]]
  if(sql.includes('FROM sale_order_items'))return [[{id:1,product_id:7,warehouse_id:2,quantity:10,shipped_qty:10,unit_price:10}]]
  if(sql.startsWith('SELECT sr.id'))return [sql.includes('NOT EXISTS')?[{id:3}]:[{id:3,sale_order_id:9,ordinary_net_basis_order_id:9,return_item_id:2,receipt_id:4}]]
  if(sql.includes('FROM sale_ordinary_return_receipts'))return [[]]
  throw Error('Unexpected SQL '+sql)
 }}
 assert.equal((await m.prepareShipment(conn,{id:9,discount_amount:10,cash_policy:'cash-cents-v1'})).orderId,9)
 const proof=log.find(sql=>sql.startsWith('SELECT sr.id'));assert.ok(proof.includes('LEFT JOIN sale_ordinary_return_receipts'));assert.ok(proof.endsWith('FOR SHARE'));assert.ok(!proof.includes('NOT EXISTS'))
})

test('early RR missing source carries current winner through ship/create/legacy-confirm without gross fallback or reinsert',async()=>{
 for(const entry of ['ship','create','confirm']){
  const b=basis({legacy:false}),log=[],order={id:9,status:4,warehouse_id:2,total_amount:100,discount_amount:10,cash_policy:'cash-cents-v1'}
  const actual={id:8,order_id:9,return_item_id:5,return_task_item_id:6,qualified_qty:4,gross_amount:40,financial_amount:36,cash_execution_basis:JSON.stringify({version:2,cashPolicy:'cash-cents-v1',shipped:[{id:1,quantity:'10.00'}],priorQualified:[{id:1,quantity:'0.00'}],priorFinancial:'0.00'})}
  const conn={query:async sql=>{log.push(sql)
   if(sql.startsWith('SELECT * FROM sale_ordinary_return_bases'))return [sql.includes('FOR ')?[b]:[]]
   if(sql.includes('FROM sale_order_items'))return [[{id:1,product_id:7,warehouse_id:2,quantity:10,shipped_qty:10,unit_price:10,amount:100,unit:'个'}]]
   if(sql.includes('FROM sale_order_events'))return [[]]
   if(sql.startsWith('SELECT sr.id'))return [[{id:3,sale_order_id:9,ordinary_net_basis_order_id:9,return_item_id:5,receipt_id:8}]]
   if(sql.includes('FROM payment_records'))return [[{total_amount:54,paid_amount:0,balance:54}]]
   if(sql.includes('FROM sale_ordinary_return_receipts'))return [[actual]]
   if(sql.includes('FROM return_task_items'))return [[{id:6,task_id:7,return_item_id:5,checked_qty:4,rejected_qty:0,putaway_qty:4,sale_item_id:1,product_id:7,unit_price:10,sale_order_id:9,ordinary_net_basis_order_id:9,status:3,cash_policy:'cash-cents-v1'}]]
   if(sql==='SELECT commercial_model FROM sale_orders WHERE id=?')return [[{}]]
   if(sql==='SELECT * FROM sale_orders WHERE id=? FOR SHARE')return [[order]]
   if(sql.startsWith('SELECT id,sale_order_id,ordinary_net_basis_order_id'))return [[{id:12,sale_order_id:9,ordinary_net_basis_order_id:null}]]
   throw Error('Unexpected SQL '+sql)
  }}
  const result=entry==='ship'?await m.prepareShipment(conn,order):entry==='create'?await m.prepareCreate(conn,order,[{sourceItemId:1,productId:7,quantity:6}]):await m.lockReturn(conn,{returnId:12,initializeLegacy:true})
  assert.equal(entry==='create'?result.basis.orderId:result.orderId,9)
  if(entry==='create')assert.equal(result.total,54)
  else assert.equal(Number(result.previous.financial),3600)
  assert.ok(log.some(s=>s.includes('payment_records')));assert.ok(!log.some(s=>s.startsWith('INSERT')))
 }
})
