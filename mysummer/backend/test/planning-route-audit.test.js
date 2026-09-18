const test = require('node:test')
const assert = require('node:assert/strict')
const { auditRoutes, routeDemands } = require('../src/planning/route-audit')
const p = id => ({ provider: 'tencent-map', providerPlaceId: id })
const at = time => `2026-09-16T${time}:00+08:00`
function fixture() {
  const plan = { inputSnapshot: { origin: p('origin'), endDestination: p('end'), startAt: at('08:00'), endBy: at('20:00'),
    menuItems: [{ menuItemId: 'a', placeRef: p('a') }] },
    plannedOrder: ['a'], items: [{ itemId: 'a', startAt: at('10:00'), endAt: at('11:00') }], legs: [] }
  const demands = routeDemands(plan)
  const leg = (id, from, to, start, end, minutes) => ({ legId: id, from: p(from), to: p(to), mode: 'bus',
    serviceDate: '2026-09-16', departureAt: at(start), arrivalAt: at(end), durationMinutes: minutes,
    routeGeometry: { source: 'mock', display: '测试证据' }, status: 'available', quoteRef: null,
    provenance: { sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: at('07:00') } })
  const evidence = [{ demandId: demands[0].demandId, legs: [leg('1', 'origin', 'station', '08:00', '08:30', 30), leg('2', 'station', 'a', '08:40', '09:20', 40)] },
    { demandId: demands[1].demandId, legs: [leg('3', 'a', 'end', '11:00', '12:00', 60)] }]
  return { plan, evidence }
}
test('multi-leg local route checks waiting time without changing the source plan', () => {
  const { plan, evidence } = fixture()
  const before = structuredClone(plan)
  const result = auditRoutes(plan, evidence)
  assert.equal(result.status, 'checked')
  assert.equal(result.legs.length, 3)
  assert.equal(result.legs[0].provenance.environment, 'test')
  assert.deepEqual(plan, before)
})
test('missing routes never count as zero time', () => {
  const result = auditRoutes(fixture().plan)
  assert.equal(result.status, 'needs_review')
  assert.equal(result.gaps.length, 2)
  assert.equal(result.legs.length, 0)
})
test('disconnected endpoints, overlap, late arrival and false duration are blocked', () => {
  for (const [change, code] of [
    [leg => { leg.from = p('wrong') }, 'ROUTE_ENDPOINT_DISCONNECTED'],
    [leg => { leg.departureAt = at('08:20'); leg.durationMinutes = 60 }, 'ROUTE_TIME_CONFLICT'],
    [leg => { leg.arrivalAt = at('10:20'); leg.durationMinutes = 100 }, 'ROUTE_ARRIVES_TOO_LATE'],
    [leg => { leg.durationMinutes = 1 }, 'ROUTE_DURATION_MISMATCH'],
    [leg => { leg.provenance = null }, 'ROUTE_PROVENANCE_MISSING'],
    [leg => { leg.mode = 'train' }, 'ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED']
  ]) {
    const { plan, evidence } = fixture()
    change(evidence[0].legs[1])
    const result = auditRoutes(plan, evidence)
    assert.equal(result.status, 'blocked')
    assert.ok(result.errors.some(error => error.code === code), code)
  }
})
test('duplicate chain ids and unknown demand references are rejected', () => {
  const { plan, evidence } = fixture()
  evidence[1].legs[0].legId = '1'
  evidence.push({ demandId: 'unknown', legs: [] })
  const result = auditRoutes(plan, evidence)
  assert.ok(result.errors.some(error => error.code === 'ROUTE_LEG_ID_DUPLICATE'))
  assert.ok(result.errors.some(error => error.code === 'ROUTE_DEMAND_UNKNOWN'))
})

// ---------------------------------------------------------------- B3-4：carrier binding

const CARRIER_DEMAND_ID = JSON.stringify(['origin', 'item:a'])
const OTHER_DEMAND_ID = JSON.stringify(['item:a', 'item:b'])

// carrier leg 的 from/to 是真实车站，与 route demand 的地点不是同一个 endpoint（§3.2）。
function carrierLeg(overrides = {}) {
  return {
    legId: 'leg:carrier', from: p('station-cct'), to: p('station-syt'), mode: 'train', serviceNo: 'K1',
    serviceDate: '2026-09-16', departureAt: at('08:30'), arrivalAt: at('09:30'), demandId: CARRIER_DEMAND_ID,
    toItemId: 'a', quoteRef: 'quote:carrier', durationMinutes: 60,
    routeGeometry: { source: 'provider_geometry_not_returned' }, status: 'available',
    provenance: { sourceType: 'live', environment: 'production', sourceRef: 'juhe-train-817', fetchedAt: at('07:00') },
    ...overrides
  }
}

function carrierQuote(overrides = {}) {
  return {
    provider: 'juhe', productId: 'K1', quoteId: 'quote:carrier', demandId: CARRIER_DEMAND_ID,
    amountMinor: 14400, currency: 'CNY', priceBasis: 'per_person', availability: 'available',
    fetchedAt: at('07:00'), environment: 'production', bookingTarget: { kind: 'manual' },
    provenance: { sourceType: 'live', provider: 'juhe', fetchedAt: at('07:00') },
    ...overrides
  }
}

function carrierPlan({ leg = {}, quote = {}, legs = null } = {}) {
  return {
    inputSnapshot: { origin: p('origin'), endDestination: p('end'), startAt: at('08:00'), endBy: at('20:00'),
      menuItems: [{ menuItemId: 'a', placeRef: p('a') }, { menuItemId: 'b', placeRef: p('b') }] },
    plannedOrder: ['a', 'b'],
    items: [{ itemId: 'a', startAt: at('10:00'), endAt: at('11:00') },
      { itemId: 'b', startAt: at('13:00'), endAt: at('14:00') }],
    legs: legs || [carrierLeg(leg)],
    quotes: [carrierQuote(quote)]
  }
}

function localRouteLeg(id, from, to, start, end, minutes, mode = 'car') {
  return { legId: id, from: p(from), to: p(to), mode, serviceDate: '2026-09-16',
    departureAt: at(start), arrivalAt: at(end), durationMinutes: minutes,
    routeGeometry: { source: 'mock' }, status: 'available', quoteRef: null,
    provenance: { sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: at('07:00') } }
}

test('a correctly bound carrier is verified through quote, leg and demand and only reports the station transfer gap', () => {
  const result = auditRoutes(carrierPlan(), [])
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.gaps.filter(gap => gap.demandId === CARRIER_DEMAND_ID),
    [{ code: 'STATION_TRANSFERS_UNCONFIRMED', demandId: CARRIER_DEMAND_ID, legId: 'leg:carrier' }])
  // 没有 carrier 的 demand 仍然按「缺少接驳证据」处理，不被 carrier 结论覆盖。
  assert.ok(result.gaps.some(gap => gap.code === 'TRANSFER_EVIDENCE_MISSING' && gap.demandId === OTHER_DEMAND_ID))
  assert.equal(result.status, 'needs_review')
})

test('a carrier leg never needs its station endpoints to equal the route demand places', () => {
  const plan = carrierPlan()
  assert.notDeepEqual(plan.legs[0].from, plan.inputSnapshot.origin)
  assert.notDeepEqual(plan.legs[0].to, plan.inputSnapshot.menuItems[0].placeRef)
  const result = auditRoutes(plan, [])
  assert.equal(result.errors.some(error => error.code === 'ROUTE_ENDPOINT_DISCONNECTED'), false)
})

test('carrier binding failures are reported per contract and never fake a station transfer gap', () => {
  for (const [override, code] of [
    [{ leg: { demandId: JSON.stringify(['nope', 'item:a']) } }, 'ROUTE_DEMAND_UNKNOWN'],
    [{ leg: { demandId: null } }, 'ROUTE_DEMAND_UNKNOWN'],
    [{ leg: { quoteRef: 'missing-quote' } }, 'ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED'],
    [{ quote: { demandId: null } }, 'ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED'],
    [{ quote: { demandId: JSON.stringify(['origin', 'item:b']) } }, 'ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED'],
    [{ leg: { toItemId: 'b' } }, 'ROUTE_DESTINATION_MISMATCH'],
    [{ leg: { departureAt: at('07:00') } }, 'ROUTE_TIME_CONFLICT'],
    [{ leg: { arrivalAt: at('12:30') } }, 'ROUTE_ARRIVES_TOO_LATE'],
    [{ leg: { status: 'blocked' } }, 'ROUTE_LEG_BLOCKED']
  ]) {
    const result = auditRoutes(carrierPlan(override), [])
    assert.equal(result.status, 'blocked', code)
    assert.ok(result.errors.some(error => error.code === code), code)
    assert.equal(result.gaps.some(gap => gap.code === 'STATION_TRANSFERS_UNCONFIRMED'), false, code)
  }
})

test('two selected carrier legs for one demand are ambiguous instead of being added together', () => {
  const plan = carrierPlan({ legs: [carrierLeg(), carrierLeg({ legId: 'leg:carrier-2' })] })
  const result = auditRoutes(plan, [])
  assert.equal(result.status, 'blocked')
  assert.ok(result.errors.some(error => error.code === 'ROUTE_CHAIN_AMBIGUOUS' && error.demandId === CARRIER_DEMAND_ID))
  assert.equal(result.gaps.some(gap => gap.code === 'STATION_TRANSFERS_UNCONFIRMED'), false)
})

test('a bound carrier plus a full local route chain is ambiguous rather than summed', () => {
  const result = auditRoutes(carrierPlan(), [{ demandId: CARRIER_DEMAND_ID,
    legs: [localRouteLeg('local-1', 'origin', 'a', '08:00', '09:00', 60)] }])
  assert.equal(result.status, 'blocked')
  assert.ok(result.errors.some(error => error.code === 'ROUTE_CHAIN_AMBIGUOUS' && error.demandId === CARRIER_DEMAND_ID))
  assert.equal(result.gaps.some(gap => gap.code === 'STATION_TRANSFERS_UNCONFIRMED'), false)
})

test('an isolated carrier-like route evidence leg keeps the compatibility code', () => {
  const result = auditRoutes(carrierPlan(), [{ demandId: OTHER_DEMAND_ID,
    legs: [localRouteLeg('x1', 'a', 'b', '11:00', '12:00', 60, 'train')] }])
  const row = result.errors.find(error => error.code === 'ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED')
  assert.ok(row)
  assert.equal(row.demandId, OTHER_DEMAND_ID)
})

test('local route chains with a bound carrier elsewhere keep their original audit result', () => {
  // carrierAudit:false 只用于 route-schedule 的局部 relaxed 审计，必须等价于 B3 之前的行为。
  const plan = carrierPlan()
  const evidence = [{ demandId: OTHER_DEMAND_ID, legs: [localRouteLeg('x1', 'a', 'b', '11:00', '12:00', 60)] }]
  const withCarriers = auditRoutes(plan, evidence, { carrierAudit: false })
  assert.deepEqual(withCarriers.errors, [])
  assert.equal(withCarriers.gaps.some(gap => gap.code === 'STATION_TRANSFERS_UNCONFIRMED'), false)
  assert.equal(withCarriers.legs.length, 1)
})
