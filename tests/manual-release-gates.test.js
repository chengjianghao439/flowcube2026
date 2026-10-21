'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const file = path.resolve(__dirname, '../scripts/manual-release/verify-gates.cjs')
const sha = 'a'.repeat(40)
function gate() { assert.ok(fs.existsSync(file), 'manual GitHub gate must exist'); return require(file) }
const job = name => ({ name, status: 'completed', conclusion: 'success', steps: [{ name: 'Audit dependencies and enforce result integrity', conclusion: 'success', status: 'completed' }] })
test('真实门禁规则拒绝测试失败/取消/未跑、audit失败/跳过/缺目标', () => {
 const { verifyJobs } = gate()
 assert.doesNotThrow(() => verifyJobs('test.yml', [job('tests')]))
 for (const conclusion of ['failure', 'cancelled', 'skipped', null]) assert.throws(() => verifyJobs('test.yml', [{...job('tests'), conclusion}]))
 const audits = ['backend', 'frontend', 'desktop', 'scripts/browser-smoke'].map(n => job(`npm audit — 依赖漏洞扫描 (${n})`))
 assert.doesNotThrow(() => verifyJobs('security-scan.yml', audits))
 for (const state of ['failure', 'skipped']) { const bad=structuredClone(audits); bad[0].steps[0].conclusion=state; assert.throws(() => verifyJobs('security-scan.yml',bad)) }
 assert.throws(() => verifyJobs('security-scan.yml',audits.slice(1)))
})
test('人工批准绑定GitHub作者ID/完整SHA/备份先后/同一审批主题', () => {
 const { verifyApproval } = gate()
 const now=Date.now(), issue='https://api.github.com/repos/fixture/repo/issues/1'
 const approval={id:7,user:{id:456},body:`发 ${sha}`,created_at:new Date(now-1000).toISOString(),issue_url:issue}
 const backup={id:6,user:{id:789},body:`备份就绪 ${sha}\n收据 SHA256 ${'b'.repeat(64)}`,created_at:new Date(now-2000).toISOString(),issue_url:issue}
 assert.equal(verifyApproval(approval,backup,{sha,actorId:'456',bossIds:['456'],operatorIds:['789'],now}).operatorId,'789')
 for (const change of [{body:'已批准'},{body:`发 ${'c'.repeat(40)}`},{user:{id:999}},{issue_url:issue+'2'},{created_at:new Date(now-3000).toISOString()}]) assert.throws(() => verifyApproval({...approval,...change},backup,{sha,actorId:'456',bossIds:['456'],operatorIds:['789'],now}))
 assert.throws(() => verifyApproval(approval,backup,{sha,actorId:'456',bossIds:['456'],operatorIds:[],now}))
})

test('完整 GitHub 门禁只接受 API 中同 SHA、main、成功测试及四项 audit，不认客户端标志',async t=>{
 const os=require('node:os'),{execFileSync}=require('node:child_process')
 const {verifyGates}=gate(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'github-release-gate-')),prior=process.cwd()
 t.after(()=>{process.chdir(prior);fs.rmSync(dir,{recursive:true,force:true})})
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 git('init','-b','main');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');fs.writeFileSync(path.join(dir,'source'),'fixture');git('add','source');git('commit','-m','fixture')
 const target=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',target);process.chdir(dir)
 const now=Date.now(),runTime=new Date(now-1000).toISOString(),issue='https://api.github.com/repos/fixture/repo/issues/1'
 const env={GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'boss',GITHUB_TRIGGERING_ACTOR:'boss',TARGET_SHA:target,GITHUB_REPOSITORY:'fixture/repo',GITHUB_TOKEN:'synthetic-only',GITHUB_ACTOR_ID:'456',GITHUB_SHA:target,GITHUB_RUN_ID:'123',APPROVAL_COMMENT_ID:'7',BACKUP_COMMENT_ID:'6',RELEASE_OPERATOR_IDS:'789',RELEASE_CHECKS_OUTPUT:path.join(dir,'checks.json')}
 for(const scenario of ['normal','test-failure','wrong-sha','audit-step-skipped','audit-target-missing','approval-after-trigger','latest-scheduled-audit-failure']){
  const seen=[]
  const fetchImpl=async url=>{
   url=String(url);seen.push(url)
   const pathName=new URL(url).pathname
   let data
   if(pathName.endsWith('/actions/runs/123'))data={event:'workflow_dispatch',run_attempt:1,actor:{id:456},head_sha:target,head_branch:'main',created_at:runTime}
   else if(pathName.endsWith('/issues/comments/7'))data={id:7,user:{id:456},body:`发 ${target}`,created_at:new Date(now+(scenario==='approval-after-trigger'?1000:-2000)).toISOString(),issue_url:issue}
   else if(pathName.endsWith('/issues/comments/6'))data={id:6,user:{id:789},body:`备份就绪 ${target}\n收据 SHA256 ${'b'.repeat(64)}`,created_at:new Date(now-3000).toISOString(),issue_url:issue}
   else if(pathName.includes('/workflows/'))data={workflow_runs:[{id:pathName.includes('test.yml')?1:2,head_sha:scenario==='wrong-sha'?'b'.repeat(40):target,head_branch:'main',event:'push',status:'completed',conclusion:scenario==='test-failure'?'failure':'success',run_attempt:1}]}
   else if(pathName.includes('/runs/1/'))data={jobs:[job('tests')]}
   else if(pathName.includes('/runs/2/')){
    data={jobs:['backend','frontend','desktop','scripts/browser-smoke'].map(n=>job(`npm audit — 依赖漏洞扫描 (${n})`))}
    if(scenario==='audit-step-skipped')data.jobs[0].steps[0].conclusion='skipped'
    if(scenario==='audit-target-missing')data.jobs.pop()
   }else throw Error('unexpected API boundary')
   if(scenario==='latest-scheduled-audit-failure'&&pathName.includes('/workflows/security-scan.yml/'))data.workflow_runs.push({...data.workflow_runs[0],id:3,event:'schedule',conclusion:'failure'})
   return {ok:true,json:async()=>data}
  }
  // Missing SHA uses the real run selector directly; do not sleep/poll in this offline test.
  if(scenario==='wrong-sha'){
   const {assessRuns}=require('../scripts/wait-release-checks');assert.equal(assessRuns((await (await fetchImpl('https://api.github.com/repos/fixture/repo/actions/workflows/test.yml/runs')).json()).workflow_runs,target).state,'pending');continue
  }
  if(scenario==='normal'){const result=await verifyGates(env,fetchImpl,{schema:1,bossIds:['456'],operatorIds:['789']});assert.equal(result.checks.length,2);assert.equal(result.approval.operatorId,'789')}
  else await assert.rejects(verifyGates(env,fetchImpl,{schema:1,bossIds:['456'],operatorIds:['789']}))
  assert.ok(seen.some(u=>u.includes('issues/comments')))
 }
})

test('评论有效时间含编辑，拒绝触发后编辑和普通协作者自批',()=>{
 const {verifyApproval}=gate(),now=Date.now(),issue='https://api.github.com/repos/fixture/repo/issues/1'
 const approval={id:7,user:{id:456},body:`发 ${sha}`,created_at:new Date(now-3000).toISOString(),updated_at:new Date(now-1000).toISOString(),issue_url:issue}
 const backup={id:6,user:{id:789},body:`备份就绪 ${sha}\n收据 SHA256 ${'b'.repeat(64)}`,created_at:new Date(now-4000).toISOString(),updated_at:new Date(now-2000).toISOString(),issue_url:issue}
 assert.throws(()=>verifyApproval(approval,backup,{sha,actorId:'456',bossIds:['999'],operatorIds:['789'],now}))
 assert.throws(()=>verifyApproval(approval,backup,{sha,actorId:'456',bossIds:['456'],operatorIds:['789'],now,triggeredAt:now-1500}))
})
test('同 SHA 最新定时audit失败不能被旧push绿灯覆盖',()=>{
 const {assessRuns}=require('../scripts/wait-release-checks')
 const runs=[{id:1,head_sha:sha,head_branch:'main',event:'push',status:'completed',conclusion:'success'},{id:2,head_sha:sha,head_branch:'main',event:'schedule',status:'completed',conclusion:'failure'}]
 assert.equal(assessRuns(runs,sha,{events:['push','workflow_dispatch','schedule']}).state,'failed')

})
