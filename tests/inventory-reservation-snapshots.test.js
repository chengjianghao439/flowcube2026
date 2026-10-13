const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const filename = path.join(__dirname, '../backend/src/modules/inventory/reservation.snapshots.js')
function store(options) {
  if (!fs.existsSync(filename)) assert.fail('Stable reservation snapshot store is not implemented')
  const m = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: m, Buffer,
    require: id => id === 'node:crypto' ? require(id) : require(path.resolve(path.dirname(filename), id)) }, { filename })
  return m.exports.createReservationSnapshots(options)
}
function result(n = 3) {
  return { productId: 7, warehouseId: 8, summary: { reserved: 25 },
    pagination: { total: n }, list: Array.from({ length: n }, (_, i) => ({
      saleOrderId: i + 1, orderNo: 'SO-' + i, reservationQuantity: 5,
      bindings: [{ bindingId: i + 100, saleOrderItemId: i + 200, quantity: 1, purchase: { purchaseOrderId: 90 } }],
    })) }
}
const plain = v => JSON.parse(JSON.stringify(v))
test('snapshot keeps bounded immutable flat rows and stable metadata across batches', () => {
  let clock = 1000
  const s = store({ now: () => clock, batchSize: 2 })
  const original = result(), first = s.save('owner-A', original, 9, clock)
  original.summary.reserved = 99; original.list[0].orderNo = 'changed'
  clock += 20
  const next = s.read(first.snapshot.snapshotId, 'owner-A', 2)
  assert.equal(next.summary.reserved, 25)
  assert.deepEqual(plain(first.rows.map(x => x.id)), ['sale:1', 'binding:100'])
  assert.deepEqual(plain(next.rows.map(x => x.id)), ['sale:2', 'binding:101'])
  assert.equal(next.snapshot.readAt, first.snapshot.readAt)
  assert.equal(next.snapshot.expiresAt, first.snapshot.expiresAt)
  assert.equal(next.snapshot.totalRows, 6)
  assert.equal(next.snapshot.totalSources, 3)
  assert.equal(s.read(first.snapshot.snapshotId, 'owner-A', 4).snapshot.nextOffset, null)
})
test('TTL is fixed and owner/invalid cursor cannot read or restart with different data', () => {
  let clock = 1000
  const s = store({ now: () => clock, ttlMs: 100, batchSize: 2 })
  const first = s.save('A', result(), 9, clock), id = first.snapshot.snapshotId
  for (const [binding, offset] of [['B', 2], ['A', 1], ['A', 8], ['A', -1]]) {
    assert.throws(() => s.read(id, binding, offset), e => e.code === 'INVENTORY_RESERVATION_SNAPSHOT_RESTART')
  }
  clock = 1099; assert.equal(s.read(id, 'A', 2).snapshot.nextOffset, 4)
  clock = 1100; assert.throws(() => s.read(id, 'A', 4), e => e.code === 'INVENTORY_RESERVATION_SNAPSHOT_RESTART')
})
test('empty snapshot is explicitly complete; snapshot does not invent a first source', () => {
  const s = store()
  const value = s.save('A', result(0), 9, Date.now())
  assert.equal(value.rows.length, 0); assert.equal(value.snapshot.totalRows, 0)
  assert.equal(value.snapshot.totalSources, 0); assert.equal(value.snapshot.nextOffset, null)
})
test('source, binding and byte limits reject instead of truncating', () => {
  assert.throws(() => store({ maxSources: 2 }).save('A', result(3), 9, Date.now()), e => e.statusCode === 413)
  assert.throws(() => store({ maxBindings: 2 }).save('A', result(3), 9, Date.now()), e => e.statusCode === 413)
  assert.throws(() => store({ maxSnapshotBytes: 20 }).save('A', result(), 9, Date.now()), e => e.statusCode === 413)
})
test('cache admission does not evict another actor, expiry releases capacity', () => {
  let clock = 1000
  const s = store({ now: () => clock, ttlMs: 100, maxSnapshots: 1 })
  const first = s.save('A', result(1), 9, clock)
  assert.throws(() => s.save('B', result(1), 10, clock), e => e.statusCode === 503)
  assert.equal(s.read(first.snapshot.snapshotId, 'A', 0).rows.length, 2)
  clock = 1100; assert.equal(s.save('B', result(1), 10, clock).snapshot.totalRows, 2)
})
test('same actor refresh has a bounded two-snapshot lifetime', () => {
  const s = store({ maxPerActor: 2 })
  const first = s.save('A', result(1), 9, Date.now())
  s.save('A', result(1), 9, Date.now()); s.save('A', result(1), 9, Date.now())
  assert.throws(() => s.read(first.snapshot.snapshotId, 'A', 0), e => e.statusCode === 409)
})
test('pending builds are bounded per actor and globally; release is idempotent', () => {
  const s = store({ maxBuilders: 2 })
  const finish = s.begin(9), finish2 = s.begin(10)
  assert.throws(() => s.begin(9), e => e.statusCode === 503)
  assert.throws(() => s.begin(11), e => e.statusCode === 503)
  finish(); finish(); const finish3 = s.begin(11); finish2(); finish3()
})
test('a missing source or duplicate binding identity refuses false completeness', () => {
  const wrong = result(); wrong.pagination.total = 5
  assert.throws(() => store().save('A', wrong, 9, Date.now()), e => e.code === 'INVENTORY_RESERVATION_SNAPSHOT_INVALID')
  const duplicate = result(); duplicate.list[1].bindings[0].bindingId = 100
  assert.throws(() => store().save('A', duplicate, 9, Date.now()), e => e.code === 'INVENTORY_RESERVATION_SNAPSHOT_INVALID')
})

test('aggregate serialized byte admission is bounded across different actors',()=>{
  const s=store({maxCacheBytes:1000,maxSnapshots:20}),accepted=[]
  for(let actor=1;actor<=8;actor++){
    try{accepted.push(s.save('owner-'+actor,result(1),actor,Date.now()))}
    catch(e){assert.equal(e.statusCode,503);break}
  }
  assert(accepted.length>0 && accepted.length<8)
  for(let n=0;n<accepted.length;n++)assert.equal(s.read(accepted[n].snapshot.snapshotId,'owner-'+(n+1),0).rows.length,2)
})
