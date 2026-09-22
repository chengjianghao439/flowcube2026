'use strict'
// Exercise the shipped Nginx config over HTTP, including inherited headers on errors.
// Requires Docker; DOCKER_CONTEXT may select the local test runtime.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 }).trim()

test('every public location retains security headers alongside its cache policy', async () => {
  fs.mkdirSync(path.join(root, 'output'), { recursive: true })
  const dir = fs.mkdtempSync(path.join(root, 'output/nginx-headers-'))
  fs.chmodSync(dir, 0o755)
  const name = `flowcube-nginx-headers-${process.pid}`
  let created = false
  try {
    for (const sub of ['html/assets', 'downloads/current', 'downloads/versions/v-test', 'snippets']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    for (const file of ['html/index.html', 'html/assets/test.js', 'downloads/latest.json', 'downloads/current/test.txt', 'downloads/versions/v-test/test.txt']) fs.writeFileSync(path.join(dir, file), '{}')
    const server = fs.readFileSync(path.join(root, 'docker/nginx.conf'), 'utf8')
      .replaceAll('/usr/share/nginx/html', '/test/html').replaceAll('/usr/share/nginx/downloads', '/test/downloads')
      .replaceAll('/etc/nginx/snippets/', '/test/snippets/')
    fs.writeFileSync(path.join(dir, 'server.conf'), server)
    const snippet = path.join(root, 'docker/nginx-security-headers.conf')
    if (fs.existsSync(snippet)) fs.copyFileSync(snippet, path.join(dir, 'snippets/security-headers.conf'))
    fs.writeFileSync(path.join(dir, 'nginx.conf'), 'events {}\nhttp { map $http_x_forwarded_proto $fc_forwarded_proto { default $scheme; } include /test/server.conf; }')
    docker('create', '--name', name, '--add-host', 'backend:127.0.0.1', '-p', '127.0.0.1::80',
      '--entrypoint', 'nginx', process.env.NGINX_TEST_IMAGE || 'nginx:alpine', '-c', '/test/nginx.conf', '-g', 'daemon off;')
    created = true
    docker('cp', dir + '/.', name + ':/test')
    docker('start', name)
    const port = docker('port', name, '80/tcp').split(':').at(-1)
    const base = `http://127.0.0.1:${port}`
    for (let i = 0; i < 30; i++) {
      try { await fetch(base); break } catch (error) { if (i === 29) throw error; await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    const expected = {
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      'x-xss-protection': '1; mode=block', 'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    }
    for (const [url, status, cache] of [
      ['/', 200, 'no-store'], ['/index.html', 200, 'no-store'], ['/a/deep/route', 200, 'no-store'],
      ['/assets/test.js', 200, 'immutable'], ['/assets/missing.js', 404, 'immutable'],
      ['/latest.json', 200, 'no-store'], ['/current/test.txt', 200, 'no-store'], ['/current/missing', 404, 'no-store'],
      ['/versions/v-test/test.txt', 200, null], ['/downloads/latest.json', 200, null], ['/api/health', 502, null],
    ]) {
      const response = await fetch(base + url)
      await response.arrayBuffer()
      assert.equal(response.status, status, url)
      for (const [header, value] of Object.entries(expected)) assert.equal(response.headers.get(header), value, `${url}: ${header}`)
      if (cache) assert.ok(response.headers.get('cache-control')?.includes(cache), `${url}: cache policy`)
    }
  } catch (error) {
    if (created) console.error(docker('logs', name))
    throw error
  } finally {
    if (created) { docker('rm', '-f', name); assert.equal(docker('ps', '-aq', '--filter', `name=^/${name}$`), '') }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
