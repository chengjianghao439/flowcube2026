const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const sandbox = {module:{exports:{}}, require:name=>name==='../utils/AppError'?require('../backend/src/utils/AppError'):{canSelfApprove:()=>false}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/src/engine/approvalEngine.js'),'utf8'),sandbox)
const engine = sandbox.module.exports
test('审批列表以真实总数读取超过 100 条待办，批次稳定且按当前用户过滤', async () => {
  const calls=[]
  const db={query:async(sql,params)=>{calls.push({sql,params});return sql.includes('COUNT(*)')?[[{total:205}]]:[[]]}}
  assert.equal(await engine.countPendingTasks(db,{userId:7}),205)
  await engine.listPendingTasks(db,{userId:7,page:3,pageSize:100})
  assert.match(calls[1].sql,/ORDER BY i.created_at DESC, i.id DESC, t.id DESC/)
  assert.deepEqual(Array.from(calls[1].params),[7,100,200])
  assert.ok(calls.every(c=>c.sql.includes('a.user_id=? AND t.status=1 AND t.step_order=i.current_step')))
})
