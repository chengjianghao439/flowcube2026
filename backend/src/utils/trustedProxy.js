const proxyaddr = require('proxy-addr')

// Caddy overwrites XFF with its socket client; Nginx appends only the Caddy peer.
// Trust at most those two private proxy addresses, never a public socket caller.
function buildTrustedProxy(cidrs = ['loopback', 'uniquelocal']) {
  const isTrustedAddress = proxyaddr.compile(cidrs)
  return (address, hop) => hop < 2 && isTrustedAddress(address)
}

module.exports = { buildTrustedProxy }
