const test = require('node:test')
const assert = require('node:assert/strict')
const { decodePolyline, normalizeDirection, createDirectionEvidenceReader } = require('../src/planning/providers/tencent-route')
const place = id => ({ provider: 'tencent-map', providerPlaceId: id, name: id, type: 'poi', coordinate: { lat: 39, lng: 116 }, coordinateSystem: 'GCJ02' })
const demand = { demandId: 'a-b', from: place('a'), to: place('b'), readyAt: '2026-09-16T23:50:00+08:00', arriveBy: '2026-09-17T02:00:00+08:00' }
const route = { mode: 'DRIVING', duration: 37.2, distance: 1000, restriction: { status: 0 }, polyline: [39, 116, 14, 112] }
const normalize = routes => normalizeDirection({ response: { status: 0, result: { routes } }, demand, mode: 'car', fetchedAt: '2026-09-16T10:00:00Z', environment: 'test', timezone: 'Asia/Shanghai' })

test('direction preserves minute units and timezone with estimated status and no invented quote', () => {
  const row = normalize([route])
  const leg = row.legs[0]
  assert.equal(leg.durationMinutes, 38)
  assert.equal(leg.arrivalAt, '2026-09-16T16:28:00.000Z')
  assert.equal(leg.serviceDate, '2026-09-16')
  assert.equal(leg.status, 'unknown')
  assert.equal(leg.quoteRef, null)
  assert.equal(leg.provenance.sourceType, 'estimate')
  assert.deepEqual(leg.routeGeometry.points[1], { lat: 39.000014, lng: 116.000112 })
})

test('direction rejects restricted, missing restriction, mismatched modes and invalid geometry or durations', () => {
  for (const changed of [{ restriction: { status: 1 } }, { restriction: null }, { mode: 'TRANSIT' }, { duration: '37' }, { duration: 0 }, { polyline: [39, 116, 0.5, 1] }, { polyline: [40, 116, 0, 0] }]) {
    assert.equal(normalize([{ ...route, ...changed }]), null)
  }
  for (const values of [[91, 116, 0, 0], [39, 116, 1], [39, 116, Infinity, 0]]) assert.throws(() => decodePolyline(values))
})

test('direction reader never converts unsupported transit preferences into driving and stops on cancellation', async () => {
  let calls = 0
  const controller = new AbortController()
  const reader = createDirectionEvidenceReader({ modes: ['bus', 'train'], timezone: 'Asia/Shanghai', queryDirection: async () => { calls++; return {} } })
  assert.deepEqual(await reader({ demands: [demand], signal: controller.signal }), [])
  assert.equal(calls, 0)
  controller.abort()
  await assert.rejects(reader({ demands: [demand], signal: controller.signal }))
})

test('direction reader accepts the existing GCJ-02 spelling without accepting WGS84', async () => {
  let calls = 0
  const reader = createDirectionEvidenceReader({ modes: ['car'], timezone: 'Asia/Shanghai', clock: () => Date.parse('2026-09-16T10:00:00Z'),
    queryDirection: async () => { calls++; return { status: 0, result: { routes: [route] } } } })
  const aliased = structuredClone(demand)
  aliased.from.coordinateSystem = aliased.to.coordinateSystem = 'GCJ-02'
  assert.equal((await reader({ demands: [aliased], signal: new AbortController().signal })).length, 1)
  aliased.from.coordinateSystem = 'WGS84'
  assert.deepEqual(await reader({ demands: [aliased], signal: new AbortController().signal }), [])
  assert.equal(calls, 1)
})
