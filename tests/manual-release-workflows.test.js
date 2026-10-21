'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'..'),yaml=require('../frontend/node_modules/js-yaml')
const workflow=n=>yaml.load(fs.readFileSync(path.join(root,'.github/workflows',n),'utf8'))
function verifyManual(wf) {
 assert.deepEqual(Object.keys(wf.on),['workflow_dispatch'])
 assert.equal(wf.on.workflow_dispatch.inputs.checkout_ref.required,true)
 assert.equal(wf.on.workflow_dispatch.inputs.approval_comment_id.required,true)
 const entry=wf.jobs['resolve-release-target'];assert.match(entry.if,/github.event_name == 'workflow_dispatch'/)
 assert.match(entry.if,/github.ref == 'refs\/heads\/main'/)
 assert.match(entry.if,/github.run_attempt == 1/)
 for(const [id,job]of Object.entries(wf.jobs)){
  if(id==='build'||id==='build-pda')assert.doesNotMatch(JSON.stringify(job),/secrets\.|id-token|SSH_PRIVATE_KEY/)
  for(const step of job.steps||[])if(step.uses?.startsWith('actions/checkout'))assert.equal(step.with['persist-credentials'],false)
 }
}
for(const name of ['deploy-browser.yml','build-pda-apk.yml'])test(`${name} 合并、push、workflow_run/call、PR 均不能自动发布，撤门反证`,()=>{
 const wf=workflow(name);verifyManual(wf)
 for(const event of ['push','workflow_run','workflow_call','pull_request']){const changed=structuredClone(wf);changed.on[event]={};assert.throws(()=>verifyManual(changed))}
 const changed=structuredClone(wf);changed.jobs['resolve-release-target'].if="github.ref == 'refs/heads/main'";assert.throws(()=>verifyManual(changed))
})
test('网页/PDA 发布是 fresh runner，仅发版阶段有秘密和 OIDC，只有受限上传命令',()=>{
 for(const [file,pub]of [['deploy-browser.yml','deploy'],['build-pda-apk.yml','publish-pda']]){
  const wf=workflow(file),job=wf.jobs[pub]
  assert.equal(job.environment,'manual-release');assert.equal(job.permissions['id-token'],'write')
  assert.equal(job.concurrency.group,'flowcube-server-deploy');assert.equal(job.concurrency['cancel-in-progress'],false)
  const steps=job.steps,validation=steps.findIndex(s=>s.run?.includes('verify-local.py')),secret=steps.findIndex(s=>JSON.stringify(s.env||{}).includes('secrets.'))
  assert.ok(validation>=0&&secret>validation)
  assert.match(steps[secret].run,/send-bundle.py/);assert.doesNotMatch(JSON.stringify(job),/SSH_PRIVATE_KEY|transfer-release-asset|receive-deploy-artifact|local-release-relay|git pull|docker pull|workflow run/)
  assert.ok(steps.some(s=>s.run?.includes('verify-gates.cjs')))
  assert.ok(steps.some(s=>s.with?.['artifact-ids']))
 }
})
test('PDA 不再等待自动网页工作流，发布前由服务器核同一已成功应用 SHA',()=>{
 const wf=workflow('build-pda-apk.yml')
 assert.equal(wf.jobs['wait-browser'],undefined)
 assert.doesNotMatch(JSON.stringify(wf),/REQUIRE_BROWSER_DEPLOY|requireBrowser|workflow_run/)
 assert.equal(Object.values(wf.jobs).filter(j=>j.concurrency?.group==='flowcube-server-deploy').length,1)
})
test('无Secrets构建与fresh发布总预算保留上传/加载/备份/迁移/页面窗口',()=>{
 const wf=workflow('deploy-browser.yml'),update=fs.readFileSync(path.join(root,'scripts/server-update.sh'),'utf8')
 const backup=update.match(/bounded (\d+) bash -c '([^']+)'/);assert.equal(Number(backup[1]),300);assert.match(backup[2],/create/);assert.match(backup[2],/verify/)
 assert.ok(wf.jobs.deploy['timeout-minutes']*60>=7200)
 const receiver=fs.readFileSync(path.join(root,'scripts/manual-release/receive.py'),'utf8')
 assert.match(receiver,/'7200'/);assert.ok(7200>=1800+1800+300+300+2*900+2*30*7+120);assert.ok(wf.jobs.deploy['timeout-minutes']*60>=1800+10800+300)
})
