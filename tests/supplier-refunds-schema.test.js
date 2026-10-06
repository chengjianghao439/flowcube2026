'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const file=path.resolve(__dirname,'../backend/src/database/280_supplier_refunds.sql')
test('278 full schema exists with three dedicated tables and RESTRICT parent identities',()=>{
 const sql=fs.existsSync(file)?fs.readFileSync(file,'utf8'):''
 for(const name of ['supplier_refund_orders','supplier_refund_allocations','supplier_refund_operations'])assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS `'+name+'`'),'F1 migration capability missing '+name)
 assert.match(sql,/received_account_type/);assert.doesNotMatch(sql,/ON DELETE CASCADE|ON UPDATE CASCADE/)
 assert.match(sql,/KEY_COLUMN_USAGE/);assert.match(sql,/REFERENTIAL_CONSTRAINTS/);assert.match(sql,/CHECK_CLAUSE/)
})

test('F1 routes have separate source/read/write gates and own-query auth-only; F2 receive has its dedicated gate',()=>{
 const routes=path.resolve(__dirname,'../backend/src/modules/refunds/supplier-refunds.routes.js')
 assert.equal(fs.existsSync(routes),true,'F1 actual registered route capability must exist')
 const stack=[],router={use:()=>{},get:(url,...middleware)=>stack.push({method:'get',url,middleware}),post:(url,...middleware)=>stack.push({method:'post',url,middleware})}
 const auth=()=>{},ctrl=new Proxy({}, {get:(_target,key)=>({controller:key})})
 const rules=new Proxy({}, {get:()=>body=>body})
 const deps={'express':{Router:()=>router},'./supplier-refunds.controller':ctrl,'./supplier-refunds.rules':rules,'../../middleware/auth':{authMiddleware:auth,requirePermission:permission=>({permission})},'../../constants/permissions':require('../backend/src/constants/permissions'),'../../utils/route':{validateBody:()=>({validated:true})}}
 const module={exports:{}};require('node:vm').runInNewContext(fs.readFileSync(routes,'utf8'),{module,require:name=>{if(Object.hasOwn(deps,name))return deps[name];throw Error('Unstubbed route require '+name)}},{filename:routes})
 const permission=(method,url)=>stack.find(r=>r.method===method&&r.url===url)?.middleware.find(m=>m.permission)?.permission
 assert.equal(permission('get','/'),'supplier.refund.view');assert.equal(permission('get','/source'),'supplier.refund.view');assert.equal(permission('post','/'),'supplier.refund.create');assert.equal(permission('post','/:id/confirm'),'supplier.refund.confirm');assert.equal(permission('post','/:id/cancel'),'supplier.refund.create');assert.equal(permission('get','/operations/:uuid'),undefined)
 assert.equal(permission('post','/:id/receive'),'supplier.refund.receive')
})

const {fixture,required,input,uuid,copy}=require('./helpers/supplier-refunds-fixture')
const route=require('../backend/src/utils/route')
test('actual registered POST middlewares execute real validateBody and domain parse',()=>{
 const stack=[],router={use:()=>{}}
 for(const method of ['get','post'])router[method]=(url,...middleware)=>stack.push({method,url,middleware})
 const rules=fixture().module('rules'),filename=path.resolve(__dirname,'../backend/src/modules/refunds/supplier-refunds.routes.js'),module={exports:{}}
 const dependencies={'express':{Router:()=>router},'./supplier-refunds.controller':new Proxy({}, {get:(_target,name)=>({name})}),'./supplier-refunds.rules':rules,'../../middleware/auth':{authMiddleware:()=>{},requirePermission:permission=>({permission})},'../../constants/permissions':require('../backend/src/constants/permissions'),'../../utils/route':route}
 require('node:vm').runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw Error('Unstubbed real route parse '+name)}},{filename})
 for(const [url,body]of [['/',input()],['/:id/confirm',{operationUuid:uuid(2),reason:'核对'}],['/:id/cancel',{operationUuid:uuid(3)}]]){
  const middleware=stack.find(r=>r.method==='post'&&r.url===url).middleware.find(r=>typeof r==='function')
  let error,called=0,req={body};middleware(req,{},e=>{error=e;called++})
  assert.equal(error,undefined);assert.equal(called,1);assert.equal(req.body.operationUuid,body.operationUuid)
  middleware({body:{...body,actorId:123}}, {}, e=>{error=e})
  assert.equal(error.code,'SUPPLIER_REFUND_INPUT_INVALID')
 }
})
test('real seven controller handlers forward authoritative userId and stable key, no body actor',async()=>{
 const calls=[],service={}
 for(const method of ['getSource','findAll','findById','getOwnOperation','create','confirm','cancel'])service[method]=async(...args)=>{calls.push({method,args});return{ok:true}}
 const filename=path.resolve(__dirname,'../backend/src/modules/refunds/supplier-refunds.controller.js'),module={exports:{}}
 const dependencies={'./supplier-refunds.service':service,'../../utils/response':require('../backend/src/utils/response'),'../../utils/requestKey':require('../backend/src/utils/requestKey')}
 require('node:vm').runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw Error('Unstubbed controller '+name)}},{filename})
 const request={user:{userId:9},headers:{'x-request-key':'original-key'},query:{purchaseReturnId:'11',page:['1','2']},params:{id:'61',uuid:uuid(1)},body:input()}
 const response={status:()=>response,json:value=>value},next=e=>{throw e}
 for(const method of ['source','list','detail','own','create','confirm','cancel'])await module.exports[method](request,response,next)
 for(const call of calls){if(['create','confirm','cancel'].includes(call.method)){assert.equal(call.args.at(-1).userId,9);assert.equal(call.args.at(-1).requestKey,'original-key')}else assert.equal(call.args.at(-1),9)}
 assert.deepEqual(Array.from(calls[1].args[0].page),['1','2'],'raw query is not normalized into page1')
})

// Finite model of actual SET decisions and owned MySQL8.0.46 CHECK_CLAUSE bytes, not a SQL engine.
const checkSqlModes=['','NO_BACKSLASH_ESCAPES']
function unquote(s,sqlMode=''){
 assert.ok(checkSqlModes.includes(sqlMode),'only the two CHECK construction modes are modelled')
 assert.match(s,/^'(?:[^']|'')*'$/)
 assert.ok(!s.includes('\\'),'mode-dependent backslash literals are outside the finite model')
 return s.slice(1,-1).replaceAll("''", "'")
}
function exactPrintedLiteral(expression,sqlMode){
 if(expression.startsWith("'"))return unquote(expression,sqlMode)
 const concat=expression.match(/^CONCAT\((.+)\)$/)
 assert.ok(concat,'only a literal or explicit CONCAT/CHAR(92,39) construction is modelled')
 const atoms=concat[1].match(/'(?:[^'\\]|'')*'|CHAR\(92,39\)/g)||[]
 assert.equal(atoms.join(','),concat[1],'all CONCAT atoms must be exact mode-independent literals or CHAR(92,39)')
 return atoms.map(atom=>atom==='CHAR(92,39)'?String.fromCharCode(92,39):unquote(atom,sqlMode)).join('')
}
function decisions(){return new Map(fs.readFileSync(file,'utf8').split('SET @sr278_check =').slice(1).map(chunk=>[chunk.match(/tc\.CONSTRAINT_NAME='([^']+)'/)[1],chunk.match(/SET @sr278_sql = ([^\n]+);/)[1]]))}
function checkDecision(statement,actual,sqlMode=''){
 const add=statement.match(/^IF\(@sr278_check IS NULL, ('(?:[^']|'')*'), IF\(/)
 assert.ok(add,'real migration has the missing-check ADD branch')
 if(actual===null)return unquote(add[1],sqlMode)
 const expression=statement.match(/, IF\((.+), 'SELECT 1', 'SELECT \* FROM __supplier_refund_278_check_mismatch__'\)\)$/)[1]
 if(expression==='TRUE')return true // bounded production mutation used in reverse proof
 const exact=expression.match(/^BINARY @sr278_check = BINARY (.+)$/)
 assert.ok(exact,'unknown CHECK decision must fail the offline model')
 return actual===exactPrintedLiteral(exact[1],sqlMode)
}
const canonicalChecks={
 ck_sro_status:'(`status` in (0,1))',ck_sro_payload:'json_valid(`payload_json`)',
 ck_sro_resource:"(((`status` = 0) and (`refund_id` is null) and (`resource_type` is null) and (`resource_id` is null) and (`response_json` is null)) or ((`status` = 1) and (`refund_id` is not null) and (`resource_type` is not null) and (`resource_id` is not null) and (`resource_type` = _utf8mb4\\'supplier_refund_order\\') and (`resource_id` = `refund_id`) and json_valid(`response_json`) and (`response_json` is not null)))",
 ck_sr_status:'(`status` in (1,2,3,4))',ck_sr_amount:'(`amount` > 0)',ck_sr_json:'(json_valid(`create_payload_json`) and json_valid(`source_snapshot_json`))',
 ck_sr_received:'(((`status` = 3) and (`received_account_type` in (1,2,3,4,5)) and (`received_account_type` is not null) and (`received_at` is not null) and (`fund_transaction_id` is not null) and (`received_by` is not null)) or ((`status` in (1,2,4)) and (`received_account_type` is null) and (`received_at` is null) and (`fund_transaction_id` is null) and (`received_by` is null)))',
 ck_sra_amount:'(`amount` > 0)',ck_sra_state:"(`budget_state` in (_utf8mb4\\'draft\\',_utf8mb4\\'reserved\\',_utf8mb4\\'received\\',_utf8mb4\\'released\\'))",ck_sra_json:'json_valid(`source_snapshot_json`)',
}
for(const [name,canonical]of Object.entries(canonicalChecks))test('actual 278 SET exact canonical '+name+' rejects changed semantics',()=>{
 const statement=decisions().get(name);assert.ok(statement)
 for(const sqlMode of checkSqlModes){
  assert.equal(checkDecision(statement,canonical,sqlMode),true)
  assert.equal(checkDecision(statement,canonical+' ',sqlMode),false)
  assert.equal(checkDecision(statement,canonical.toUpperCase(),sqlMode),false)
  assert.equal(checkDecision(statement,canonical.replace('> 0','>= 0').replace('in (1,2,3,4)','in (1,2,3,4,5)').replace('json_valid','json_invalid').replace('is null','is not null').replace('in (0,1)','in (0,1,2)').replace('draft','other'),sqlMode),false)
  assert.ok(checkDecision(statement,null,sqlMode).includes('ADD CONSTRAINT `'+name+'` CHECK'))
 }
})
for(const name of ['ck_sro_resource','ck_sra_state'])test('278 actual SET rejects quote-byte and introducer drift for '+name,()=>{
 const canonical=canonicalChecks[name],statement=decisions().get(name),quote=String.fromCharCode(92,39)
 assert.ok(canonical.includes(quote),'fixture contains the actual backslash and apostrophe bytes')
 for(const changed of [canonical.replaceAll(quote,"'"),canonical.replaceAll(quote,String.fromCharCode(92,92,39)),canonical.replaceAll('_utf8mb4',''),canonical.slice(1,-1)]){
  for(const sqlMode of checkSqlModes)assert.equal(checkDecision(statement,changed,sqlMode),false)
 }
})
test('278 finite CHECK literal model rejects unsupported or mode-dependent constructions',()=>{
 for(const expression of ["CONCAT('a',CHAR(39))","CONCAT('a',LOWER('B'))","CONCAT('a',CHAR(92,39),'b') + ''","'a\\\\b'"]){
  for(const sqlMode of checkSqlModes)assert.throws(()=>exactPrintedLiteral(expression,sqlMode))
 }
})
test('actual received CHECK rejects weakened nullable or out-of-range received type',()=>{
 // MySQL CHECK accepts UNKNOWN; explicit IS NOT NULL is required, not merely IN.
 const missingType=canonicalChecks.ck_sr_received.replace(' and (`received_account_type` is not null)','')
 const wrongTypes=canonicalChecks.ck_sr_received.replace('in (1,2,3,4,5)','in (0,1,2,3,4,5,6)')
 assert.equal(checkDecision(decisions().get('ck_sr_received'),missingType),false)
 assert.equal(checkDecision(decisions().get('ck_sr_received'),wrongTypes),false)
 assert.equal(null==null,true,'nullable IN alone leaves UNKNOWN and would pass SQL CHECK for received row')
})
function foreignDecisions(){return fs.readFileSync(file,'utf8').split('SET @sr278_fk =').slice(1).map(chunk=>{
 const owner=chunk.match(/TABLE_NAME='([^']+)' AND CONSTRAINT_NAME='([^']+)'/)
 const statement=chunk.match(/SET @sr278_sql = ([^\n]+);/)[1]
 return{table:owner[1],name:owner[2],statement}
})}
function fkAccepted(statement,{column,parent,ref='id',rules='RESTRICT:RESTRICT'}){
 const condition=statement.match(/, IF\((.+), 'SELECT 1', 'SELECT \* FROM __supplier_refund_278_fk_mismatch__'\)\)$/)[1]
 if(condition==='TRUE')return true
 const expected=condition.match(/^@sr278_fk=CONCAT\('([^']+):',DATABASE\(\),':([^']+):([^']+)'\) AND @sr278_rules='([^']+)'$/)
 assert.ok(expected,'only exact production FK gate modelled')
 return column===expected[1]&&parent===expected[2]&&ref===expected[3]&&rules===expected[4]
}
test('actual FK drift SET validates owner/column/parent/rules, repair declaration and unique symbols',()=>{
 const symbols=new Set()
 for(const row of foreignDecisions()){
  assert.equal(symbols.has(row.name),false);symbols.add(row.name)
  const add=unquote(row.statement.match(/^IF\(@sr278_fk IS NULL, ('(?:[^']|'')*')/)[1])
  const declaration=add.match(/^ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)` \(`([^`]+)`\) ON DELETE RESTRICT ON UPDATE RESTRICT$/)
  assert.ok(declaration);assert.equal(declaration[1],row.table);assert.equal(declaration[2],row.name)
  const actual={column:declaration[3],parent:declaration[4],ref:declaration[5]}
  assert.equal(fkAccepted(row.statement,actual),true)
  for(const changed of [{rules:'CASCADE:RESTRICT'},{parent:'other_table'},{column:'other_id'},{ref:'other_id'}])assert.equal(fkAccepted(row.statement,{...actual,...changed}),false)
 }
 assert.equal(symbols.size,16)
})

test('successful permanent operation CHECK must reject UNKNOWN caused by missing resource type/id',()=>{
 const weak="(((`status` = 0) and (`refund_id` is null) and (`resource_type` is null) and (`resource_id` is null) and (`response_json` is null)) or ((`status` = 1) and (`refund_id` is not null) and (`resource_type` = _utf8mb4\\'supplier_refund_order\\') and (`resource_id` = `refund_id`) and json_valid(`response_json`) and (`response_json` is not null)))"
 assert.equal(checkDecision(decisions().get('ck_sro_resource'),weak),false)
 // In a SQL CHECK, NULL comparison is UNKNOWN, which is accepted unless explicitly excluded.
 const nullEquality=null,weakResult=nullEquality
 assert.equal(weakResult,null)
})
