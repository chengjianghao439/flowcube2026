'use strict'
// The shared fixture proves the live runner/container/volume/UUID before its first seed write.
require('./retentionReprintIsolation')
const { setup: baseSetup } = require('./retentionReprintRuntimeFixture')
const setup = label => baseSetup(label, { database: 'flowcube_changerecords20261010_test' })
module.exports = { setup }
