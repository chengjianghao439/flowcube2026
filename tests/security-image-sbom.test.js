'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
for (const scenario of ['success', 'scanner-fails', 'invalid-sbom']) test('image SBOM CLI isolates scanner and fails closed: ' + scenario, t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-sbom-contract-'))
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
 fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'bin'))
 for (const name of ['generate-image-sbom.sh', 'write-image-provenance.cjs']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(dir, 'scripts', name))
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
 assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('flowcube-sbom.')).length, 0)
 const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse), scans = calls.filter(c => c[0] === 'docker' && c[1] === 'run')
 assert.ok(scans.length > 0)
 for (const args of scans) {
  assert.ok(args.includes('--network=none') && args.includes('--read-only') && args.includes('--cap-drop=ALL'))
  assert.ok(args.some(a => a.endsWith(':/scan:ro')))
  assert.ok(!args.some(a => a.includes('docker.sock') || a.includes('TOKEN')))
 }
})
