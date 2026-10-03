'use strict';

// Only electron-builder's got-specific request boundary is adapted. Official
// @electron/get still owns streaming, progress, TLS, artifact cache and SHASUMS.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  throw new Error('Builder download compatibility requires Node >=22.12.0');
}
const { FetchDownloader, HTTPError } = require('@electron/get');
const { Agent, EnvHttpProxyAgent } = require('undici');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { isDeepStrictEqual } = require('node:util');
const supportedOptions = new Set([
  'quiet', 'getProgressCallback', 'timeout', 'agent', 'signal', 'headers',
  'method', 'redirect', 'credentials', 'cache', 'mode', 'referrer',
  'referrerPolicy', 'integrity', 'keepalive',
]);

function proxyOptions(agent) {
  if (agent === undefined) return {};
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
    throw new TypeError('Unsupported download agent');
  }
  for (const name of Object.keys(agent)) {
    const Expected = name === 'http' ? HttpProxyAgent : name === 'https' ? HttpsProxyAgent : null;
    if (!Expected || agent[name]?.constructor !== Expected || !(agent[name].proxy instanceof URL)) {
      throw new TypeError(`Unsupported download agent.${name}`);
    }
    if (!['http:', 'https:'].includes(agent[name].proxy.protocol)) {
      throw new TypeError(`Unsupported download agent.${name} proxy protocol`);
    }
    const baseline = new Expected(agent[name].proxy);
    try {
      if (!isDeepStrictEqual(agent[name].connectOpts, baseline.connectOpts) ||
          !isDeepStrictEqual(agent[name].proxyHeaders, baseline.proxyHeaders) ||
          agent[name].keepAlive !== baseline.keepAlive) {
        throw new TypeError(`Unsupported download agent.${name} custom options`);
      }
    } finally { baseline.destroy(); }
  }
  // Explicit got agents bypass NO_PROXY and apply only to their own protocol.
  // Empty strings suppress environment inheritance. EnvHttpProxyAgent still
  // falls back from an absent HTTPS proxy to HTTP; createDispatcher routes any
  // unconfigured protocol through a separate direct Agent to avoid that fallback.
  return { httpProxy: agent.http?.proxy.href || '', httpsProxy: agent.https?.proxy.href || '', noProxy: '' };
}

function createDispatcher(agent) {
  const proxied = new EnvHttpProxyAgent(proxyOptions(agent));
  if (agent === undefined) return proxied;
  const direct = new Agent();
  const configuredProtocols = new Set(Object.keys(agent).map(protocol => `${protocol}:`));
  return {
    dispatch(options, handler) {
      // Native Fetch reuses this dispatcher for redirects. Select from each
      // hop's actual origin, not the first URL passed to download().
      const protocol = new URL(options.origin).protocol;
      return (configuredProtocols.has(protocol) ? proxied : direct).dispatch(options, handler);
    },
    async destroy() {
      await Promise.all([proxied.destroy(), direct.destroy()]);
    },
  };
}

class BuilderDownloader {
  async download(url, target, options = {}) {
    for (const key of Object.keys(options)) {
      if (!supportedOptions.has(key)) throw new TypeError(`Unsupported download option: ${key}`);
    }
    const { timeout, agent, signal, ...fetchOptions } = options;
    let requestTimeout;
    if (timeout !== undefined) {
      if (!timeout || typeof timeout !== 'object' || Array.isArray(timeout) ||
          Object.keys(timeout).some(key => key !== 'request') ||
          !Number.isFinite(timeout.request) || timeout.request <= 0 || timeout.request > 2147483647) {
        throw new TypeError('Unsupported download timeout; expected { request: positive milliseconds }');
      }
      requestTimeout = timeout.request;
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Unsupported download signal');
    const dispatcher = createDispatcher(agent);
    const controller = new AbortController();
    const timeoutError = Object.assign(new Error('Builder download request timed out'), { code: 'ETIMEDOUT' });
    let timer;
    try {
      if (requestTimeout !== undefined) timer = setTimeout(() => controller.abort(timeoutError), requestTimeout);
      await new FetchDownloader().download(url, target, {
        ...fetchOptions, dispatcher,
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
    } catch (error) {
      // External cancellation never becomes a transient network failure.
      if (signal?.aborted) throw signal.reason;
      if (controller.signal.aborted) throw timeoutError;
      if (error instanceof HTTPError) error.response.statusCode = error.response.status;
      if (error instanceof TypeError && typeof error.cause?.code === 'string') {
        // Undici's socket reset and connection deadline are the Fetch forms of
        // got's retryable network failures; preserve all other codes (incl TLS).
        error.code = ({ UND_ERR_SOCKET: 'ECONNRESET', UND_ERR_CONNECT_TIMEOUT: 'ETIMEDOUT' })[error.cause.code] || error.cause.code;
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // destroy also cancels an unread HTTP error body or an aborted pipeline;
      // close can otherwise wait for an unconsumed response indefinitely.
      await dispatcher.destroy();
    }
  }
}

module.exports = { builderDownloader: new BuilderDownloader() };
