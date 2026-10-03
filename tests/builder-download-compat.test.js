'use strict';

// Real local downloads cover the compatibility boundary, official get cache and
// SHASUMS, and the installed builder's retry/extraction call path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const desktop = path.resolve(__dirname, '../desktop');
const desktopRequire = createRequire(path.join(desktop, 'package.json'));
const get = desktopRequire('@electron/get');
const { HttpProxyAgent } = desktopRequire('http-proxy-agent');
const { HttpsProxyAgent } = desktopRequire('https-proxy-agent');
const { getGlobalDispatcher } = desktopRequire('undici');
const adapterPath = path.join(desktop, 'build-support/builder-downloader.cjs');
const patchPath = path.join(desktop, 'build-support/patch-builder-download.cjs');
const originalHash = '3452ca5b9a2f29dd6460f0cc9937be2dc1bbbf36809f410649a015b35a607b48';
const originalLine = 'const configWithProgress = { ...config, downloadOptions };';
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function downloader() {
  return require(adapterPath).builderDownloader;
}

async function fixture(t, handler, protocol = 'http') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowcube-builder-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let certFile;
  let server;
  if (protocol === 'https') {
    const keyFile = path.join(dir, 'test.key');
    certFile = path.join(dir, 'test.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', keyFile, '-out', certFile], { stdio: 'ignore', timeout: 5000 });
    server = require('node:https').createServer({ key: await fs.readFile(keyFile), cert: await fs.readFile(certFile) }, handler);
  } else server = http.createServer(handler);
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { dir, server, sockets, certFile, url: `${protocol}://127.0.0.1:${server.address().port}`, target: path.join(dir, 'asset.zip') };
}

async function proxyFixture(t) {
  const proxy = await fixture(t, (_req, res) => { res.writeHead(500); res.end(); });
  let connections = 0;
  const tunnels = new Set();
  t.after(() => { for (const socket of tunnels) socket.destroy(); });
  proxy.server.on('connect', (req, client, head) => {
    connections++;
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port), host);
    tunnels.add(upstream);
    upstream.on('close', () => tunnels.delete(upstream));
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
  });
  return { ...proxy, get connections() { return connections; } };
}

async function assertProxyClosed(proxy) {
  for (let i = 0; proxy.sockets.size && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(proxy.sockets.size, 0, 'private proxy connection must be destroyed');
}

async function downloadWithTestCA(url, target, agentProtocol, proxyUrl, certFile) {
  // A fresh child reads this test CA at startup. Certificate/hostname validation
  // stays enabled; no global dispatcher or production trust settings are changed.
  await promisify(execFile)(process.execPath, ['-e', `
    const [adapterPath, url, target, protocol, proxy] = process.argv.slice(1);
    const localRequire = require('node:module').createRequire(adapterPath);
    const Constructor = protocol === 'http' ? localRequire('http-proxy-agent').HttpProxyAgent : localRequire('https-proxy-agent').HttpsProxyAgent;
    const agent = new Constructor(proxy);
    (async () => {
      try {
        await require(adapterPath).builderDownloader.download(url, target, {
          quiet: true, timeout: { request: 1500 }, agent: { [protocol]: agent }, headers: { 'x-test': 'preserved' },
        });
      } finally { agent.destroy(); }
    })().catch(error => { console.error(error.code, error.message); process.exitCode = 1; });
  `, adapterPath, url, target, agentProtocol, proxyUrl], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certFile }, timeout: 5000,
  });
}

for (const configuredProtocol of ['http', 'https']) {
  const otherProtocol = configuredProtocol === 'http' ? 'https' : 'http';
  test(`explicit ${configuredProtocol}-only agent downloads ${otherProtocol} directly`, async t => {
    const proxy = await proxyFixture(t);
    const tls = await fixture(t, (req, res) => { assert.equal(req.headers['x-test'], 'preserved'); res.end('secure'); }, 'https');
    const origin = otherProtocol === 'https' ? tls : await fixture(t, (req, res) => {
      assert.equal(req.headers['x-test'], 'preserved'); res.end('direct');
    });
    await downloadWithTestCA(origin.url, origin.target, configuredProtocol, proxy.url, tls.certFile);
    assert.equal(await fs.readFile(origin.target, 'utf8'), otherProtocol === 'https' ? 'secure' : 'direct');
    assert.equal(proxy.connections, 0, 'unconfigured protocol must not fall back to the other proxy');
    await assertProxyClosed(proxy);
  });

  test(`redirect from ${configuredProtocol} to ${otherProtocol} chooses each hop's explicit agent`, async t => {
    const proxy = await proxyFixture(t);
    let targetUrl;
    const tls = await fixture(t, (req, res) => {
      assert.equal(req.headers['x-test'], 'preserved');
      if (configuredProtocol === 'https') { res.writeHead(302, { location: targetUrl }); res.end(); }
      else res.end('redirected');
    }, 'https');
    const plain = await fixture(t, (req, res) => {
      assert.equal(req.headers['x-test'], 'preserved');
      if (configuredProtocol === 'http') { res.writeHead(302, { location: targetUrl }); res.end(); }
      else res.end('redirected');
    });
    targetUrl = configuredProtocol === 'http' ? tls.url : plain.url;
    const sourceUrl = configuredProtocol === 'http' ? plain.url : tls.url;
    await downloadWithTestCA(sourceUrl, plain.target, configuredProtocol, proxy.url, tls.certFile);
    assert.equal(await fs.readFile(plain.target, 'utf8'), 'redirected');
    assert.equal(proxy.connections, 1, 'configured first hop must proxy; unconfigured redirected hop must be direct');
    await assertProxyClosed(proxy);
  });
}

test('real download preserves content, progress callback and quiet', async t => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-length': 6 });
    res.write('abc');
    res.end('def');
  });
  const progress = [];
  await (await downloader()).download(f.url, f.target, { quiet: true, getProgressCallback: value => progress.push(value) });
  assert.equal(await fs.readFile(f.target, 'utf8'), 'abcdef');
  assert.equal(progress.at(-1).percent, 1);
  assert.equal(progress.at(-1).transferred, 6);
  assert.equal(progress.at(-1).total, 6);
});

for (const status of [503, 404]) {
  test(`real HTTP ${status} exposes response.statusCode for builder retry classification`, async t => {
    const f = await fixture(t, (_req, res) => { res.writeHead(status); res.end('failed'); });
    await assert.rejects((await downloader()).download(f.url, f.target, { quiet: true }), error => {
      assert.equal(error.response.statusCode, status);
      return true;
    });
  });
}

test('real request timeout is ETIMEDOUT and next request has a fresh deadline', async t => {
  const f = await fixture(t, (req, res) => { if (req.url === '/ok') res.end('ok'); });
  const adapter = await downloader();
  await assert.rejects(adapter.download(`${f.url}/stall`, f.target, {
    quiet: true, timeout: { request: 30 }, signal: AbortSignal.timeout(300),
  }), error => error.code === 'ETIMEDOUT');
  await adapter.download(`${f.url}/ok`, f.target, { quiet: true, timeout: { request: 500 } });
  assert.equal(await fs.readFile(f.target, 'utf8'), 'ok');
});

test('external cancellation retains its reason instead of masquerading as timeout', async t => {
  const f = await fixture(t, () => {});
  const controller = new AbortController();
  const reason = new Error('user cancelled');
  const timer = setTimeout(() => controller.abort(reason), 20);
  try {
    await assert.rejects((await downloader()).download(f.url, f.target, {
      quiet: true, timeout: { request: 200 }, signal: controller.signal,
    }), error => { assert.equal(error, reason); assert.notEqual(error.code, 'ETIMEDOUT'); return true; });
  } finally { clearTimeout(timer); }
});

test('real socket reset is retryable through the original ECONNRESET classification', async t => {
  const f = await fixture(t, (req, _res) => req.socket.destroy());
  await assert.rejects((await downloader()).download(f.url, f.target, { quiet: true }), error => {
    assert.equal(error.code, 'ECONNRESET');
    assert.equal(error.cause.code, 'UND_ERR_SOCKET');
    return true;
  });
});

test('network TypeError cause codes reach the existing retry contract; TLS errors stay TLS errors', async t => {
  const f = await fixture(t, (_req, res) => res.end('unused'));
  // DNS and certificate errors cannot be produced portably on all CI platforms.
  // Stub only the native fetch boundary; exercise the real adapter error mapping.
  const nativeFetch = global.fetch;
  t.after(() => { global.fetch = nativeFetch; });
  for (const code of ['ENOTFOUND', 'ECONNRESET', 'EPIPE', 'CERT_HAS_EXPIRED']) {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
    global.fetch = async () => { throw error; };
    await assert.rejects((await downloader()).download(f.url, f.target, { quiet: true }), actual => {
      assert.equal(actual, error);
      assert.equal(actual.code, code);
      return true;
    });
  }
});

test('unsupported legacy options and custom agents fail before starting the download', async t => {
  let hits = 0;
  const f = await fixture(t, (_req, res) => { hits++; res.end('bad'); });
  for (const options of [{ retry: { limit: 3 } }, { timeout: { connect: 3 } },
    { https: { rejectUnauthorized: false } }, { agent: { http: new http.Agent() } },
    { agent: { http: { proxy: new URL(f.url) } } },
    { agent: { http: new (class CustomProxyAgent extends HttpProxyAgent {})(f.url) } },
    { agent: { http: new HttpProxyAgent(f.url, { headers: { Custom: 'value' } }) } },
    { agent: { https: new HttpsProxyAgent(f.url, { rejectUnauthorized: false }) } }]) {
    t.after(() => { for (const agent of Object.values(options.agent || {})) agent.destroy?.(); });
    await assert.rejects((await downloader()).download(f.url, f.target, { quiet: true, signal: AbortSignal.timeout(300), ...options }), /Unsupported/);
  }
  assert.equal(hits, 0);
});

for (const protocol of ['http', 'https']) test(`real legacy ${protocol.toUpperCase()} proxy is used and private dispatcher sockets close in finally`, async t => {
  const origin = await fixture(t, (_req, res) => res.end('proxied'), protocol);
  const proxy = await proxyFixture(t);
  const originalDispatcher = getGlobalDispatcher();
  const proxyKey = protocol === 'http' ? 'HTTP_PROXY' : 'HTTPS_PROXY';
  const previousProxy = process.env[proxyKey];
  let agents;
  try {
    process.env[proxyKey] = proxy.url;
    agents = desktopRequire('builder-util').buildGotProxyAgent();
  } finally {
    if (previousProxy === undefined) delete process.env[proxyKey];
    else process.env[proxyKey] = previousProxy;
  }
  try {
    const request = (await downloader()).download(origin.url, origin.target, { quiet: true, agent: agents, timeout: { request: 500 } });
    if (protocol === 'https') await assert.rejects(request, error => {
      assert.equal(error.code, 'DEPTH_ZERO_SELF_SIGNED_CERT');
      assert.notEqual(error.code, 'ETIMEDOUT');
      return true;
    });
    else {
      await request;
      assert.equal(await fs.readFile(origin.target, 'utf8'), 'proxied');
    }
    assert.equal(proxy.connections, 1);
    assert.equal(getGlobalDispatcher(), originalDispatcher);
    // The client dispatcher is destroyed before download settles; the remote
    // peer observes its TCP close asynchronously, especially after TLS failure.
    await assertProxyClosed(proxy);
  } finally { for (const agent of Object.values(agents)) agent.destroy(); }
});

test('official get downloads SHASUMS through the same adapter and rejects a wrong digest', async t => {
  const requests = [];
  const f = await fixture(t, (req, res) => {
    requests.push(req.url);
    res.end(req.url.endsWith('SHASUMS256.txt') ? `${'0'.repeat(64)} *payload.zip\n` : 'payload');
  });
  await assert.rejects(get.downloadArtifact({
    version: '44.3.0', artifactName: 'payload.zip', isGeneric: true,
    cacheRoot: path.join(f.dir, 'cache'), tempDirectory: f.dir,
    downloader: await downloader(), downloadOptions: { quiet: true, timeout: { request: 500 } },
    mirrorOptions: { resolveAssetURL: async details => `${f.url}/${details.artifactName}` },
  }), /checksum|sum check/i);
  assert.deepEqual(requests, ['/payload.zip', '/SHASUMS256.txt']);
});

test('patch is exact, idempotent, and rejects source/version drift in owned copies', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowcube-builder-patch-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const installed = path.dirname(desktopRequire.resolve('app-builder-lib/package.json'));
  const source = await fs.readFile(path.join(installed, 'out/util/electronGet.js'), 'utf8');
  // Undo only the exact injection in memory, never alter the installed module.
  const patchModule = await fs.stat(patchPath).then(() => require(patchPath), () => null);
  assert.ok(patchModule, 'patch script must exist');
  const original = source.replace(patchModule.PATCHED_LINE, originalLine);
  assert.equal(sha256(original), originalHash);
  await fs.mkdir(path.join(temp, 'out/util'), { recursive: true });
  const file = path.join(temp, 'out/util/electronGet.js');
  const versionFile = path.join(temp, 'package.json');
  await fs.writeFile(versionFile, JSON.stringify({ version: '26.15.3' }));
  await fs.writeFile(file, original);
  patchModule.patchBuilderDownload(temp);
  const patched = await fs.readFile(file, 'utf8');
  assert.equal(patched, original.replace(originalLine, patchModule.PATCHED_LINE));
  patchModule.patchBuilderDownload(temp);
  assert.equal(await fs.readFile(file, 'utf8'), patched);
  await fs.writeFile(file, `${patched}\n// drift`);
  assert.throws(() => patchModule.patchBuilderDownload(temp), /SHA-256|hash/i);
  await fs.writeFile(file, `${original}\n// drift`);
  assert.throws(() => patchModule.patchBuilderDownload(temp), /SHA-256|hash/i);
  await fs.writeFile(file, original);
  await fs.writeFile(versionFile, JSON.stringify({ version: '26.15.4' }));
  assert.throws(() => patchModule.patchBuilderDownload(temp), /version/i);
});

test('installed app-builder-lib retries real 503, rejects 404, and preserves cache/hash', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url.includes('missing')) { missingHits++; res.writeHead(404); res.end(); return; }
    if (hits++ === 0) { res.writeHead(503); res.end(); return; }
    res.end(zip);
  });
  // Stored ZIP containing payload.txt = "builder-ok"; no external archive tool.
  const zip = Buffer.from('UEsDBBQAAAAAAGm4Q13NYA8ECgAAAAoAAAALAAAAcGF5bG9hZC50eHRidWlsZGVyLW9rUEsBAhQDFAAAAAAAabhDXc1gDwQKAAAACgAAAAsAAAAAAAAAAAAAAIABAAAAAHBheWxvYWQudHh0UEsFBgAAAAABAAEAOQAAADMAAAAAAA==', 'base64');
  let hits = 0; let missingHits = 0;
  const beforeCache = process.env.ELECTRON_BUILDER_CACHE;
  process.env.ELECTRON_BUILDER_CACHE = path.join(f.dir, 'builder-cache');
  t.after(() => {
    if (beforeCache === undefined) delete process.env.ELECTRON_BUILDER_CACHE;
    else process.env.ELECTRON_BUILDER_CACHE = beforeCache;
  });
  assert.match(await fs.readFile(desktopRequire.resolve('app-builder-lib/out/util/electronGet.js'), 'utf8'), /builder-downloader\.cjs/);
  const builder = desktopRequire('app-builder-lib/out/util/electronGet.js');
  const options = { releaseName: `test-${path.basename(f.dir)}`, filenameWithExt: 'payload.zip',
    checksums: { 'payload.zip': sha256(zip) }, overrideUrl: f.url };
  const dir = await builder.downloadBuilderToolset(options);
  assert.equal(await fs.readFile(path.join(dir, 'payload.txt'), 'utf8'), 'builder-ok');
  assert.equal(hits, 2);
  assert.equal(await builder.downloadBuilderToolset(options), dir);
  assert.equal(hits, 2, 'validated archive cache must avoid another network download');
  await assert.rejects(builder.downloadBuilderToolset({ ...options, filenameWithExt: 'missing.zip' }),
    error => error.response.statusCode === 404);
  assert.equal(missingHits, 1);
});

test('postinstall, pinned get/undici and minimum Node contract are configured', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(desktop, 'package.json')));
  assert.equal(pkg.scripts.postinstall, 'node build-support/patch-builder-download.cjs');
  assert.equal(pkg.overrides['@electron/get'], '5.1.0');
  assert.equal(pkg.engines.node, '>=22.12.0');
  assert.equal(pkg.devDependencies.undici, '7.29.1');
  assert.equal(pkg.devDependencies.electron, '44.3.0');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.equal(pkg.build.win.signExecutable, false);
});
