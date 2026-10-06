'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
// Node base layers (169914880) + lock-matched platform-independent production
// dependencies (93677374) + the Linux musl canvas package (31015095). This is a
// measured lower bound: fonts, npm cache, and other build layers need more space.
const measuredBackendLayerBytes = 294607349
for (const scenario of ['success', 'scanner-fails', 'invalid-sbom', 'undersized-cache']) test('image SBOM CLI isolates scanner and fails closed: ' + scenario, t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-sbom-contract-'))
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
 fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'bin'))
 for (const name of ['generate-image-sbom.sh', 'write-image-provenance.cjs']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(dir, 'scripts', name))
 if (scenario === 'undersized-cache') {
  const file = path.join(dir, 'scripts', 'generate-image-sbom.sh')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/size=\d+[mg]\b/i, 'size=256m'))
 }
 for (const service of ['backend', 'frontend']) {
  fs.mkdirSync(path.join(dir, service)); fs.writeFileSync(path.join(dir, service, 'package-lock.json'), '{}')
  fs.writeFileSync(path.join(dir, 'Dockerfile.' + service), 'FROM fixture@sha256:' + 'a'.repeat(64))
 }
 const mock = `#!${process.execPath}
const fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),cmd=p.basename(process.argv[1]);
fs.appendFileSync(process.env.CALLS,JSON.stringify([cmd,...a])+'\\n');
if(cmd==='git')console.log('a'.repeat(40));
if(cmd==='docker'){
 if(a[0]==='save')process.stdout.write('synthetic image archive');
 if(a[0]==='image')console.log('sha256:'+'b'.repeat(64));
 if(a[0]==='run'){
  const tmpfs=a[a.indexOf('--tmpfs')+1]||'',match=/size=([0-9]+)([mg])(?:,|$)/i.exec(tmpfs);
  const bytes=match?Number(match[1])*1024**(match[2].toLowerCase()==='g'?3:2):0;
  if(bytes<${measuredBackendLayerBytes}){console.error('image layer cache exceeds tmpfs budget');process.exit(1);}
  if(process.env.SCENARIO==='scanner-fails')process.exit(1);
  const output=a.find(x=>x.endsWith(':/out')).slice(0,-5),name=a.find(x=>x.startsWith('cyclonedx-json=')).split('/').pop();
  fs.writeFileSync(p.join(output,name),JSON.stringify({bomFormat:'CycloneDX',components:process.env.SCENARIO==='invalid-sbom'?[]:[{name:'synthetic-package',version:'1.0.0'}]}));
 }
}
`
 for (const name of ['docker', 'git']) fs.writeFileSync(path.join(dir, 'bin', name), mock, { mode: 0o755 })
 const archive = path.join(dir, 'images.tar.gz'), reports = path.join(dir, 'reports'), log = path.join(dir, 'calls.jsonl')
 fs.writeFileSync(archive, 'synthetic final archive')
 const result = spawnSync('bash', ['scripts/generate-image-sbom.sh', archive], { cwd: dir, encoding: 'utf8', timeout: 10_000, env: { PATH: path.join(dir, 'bin') + ':' + process.env.PATH, GITHUB_SHA: 'a'.repeat(40), GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'fixture/flowcube', RUNNER_TEMP: dir, FLOWCUBE_IMAGE_REPORT_DIR: reports, CALLS: log, SCENARIO: scenario } })
 assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stderr)
 assert.equal(fs.existsSync(path.join(reports, 'provenance.json')), scenario === 'success')
 if (scenario === 'undersized-cache') assert.match(result.stderr, /image layer cache exceeds tmpfs budget/)
 assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('flowcube-sbom.')).length, 0)
 const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse), scans = calls.filter(c => c[0] === 'docker' && c[1] === 'run')
 assert.ok(scans.length > 0)
 for (const args of scans) {
  assert.ok(args.includes('--network=none') && args.includes('--read-only') && args.includes('--cap-drop=ALL'))
  assert.ok(args.includes('--security-opt=no-new-privileges'))
  assert.ok(args.includes('--memory=2g') && args.includes('--memory-swap=2g') && args.includes('--cpus=2'))
  assert.ok(args.includes(scenario === 'undersized-cache' ? '/tmp:rw,noexec,nosuid,size=256m' : '/tmp:rw,noexec,nosuid,size=1g'))
  assert.ok(args.some(a => a.endsWith(':/scan:ro')))
  assert.ok(!args.some(a => a.includes('docker.sock') || a.includes('TOKEN')))
 }
})
