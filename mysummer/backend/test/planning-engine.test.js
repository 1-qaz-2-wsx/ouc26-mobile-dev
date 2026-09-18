const test = require('node:test')
const assert = require('node:assert/strict')
const { buildRulePlan, orderPlan, scheduleItems } = require('../src/planning/rule-planner')
const { checkHardConstraints } = require('../src/planning/hard-constraints')
const { validatePlan } = require('../src/planning/plan-schema')
const { createPlanningService } = require('../src/planning/service')

test('explicit carrier target moves activities after arrival, preserves snapshots and blocks a conflicting lock', () => {
  const input = request([item('a', '目标地点', 0, 43, 125, 60, { preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-18T20:00:00+08:00' } })])
  input.transportDemand.targetMenuItemId = 'a'
  const plan = buildRulePlan({ request: input, transportQuotes: [overnightQuote], now: () => Date.parse('2026-09-15T10:00:00Z') })
  assert.ok(Date.parse(plan.items[0].startAt) >= Date.parse(plan.legs[0].arrivalAt))
  assert.equal(plan.inputSnapshot.menuItems[0].preferredWindow.startAt, input.menuItems[0].preferredWindow.startAt)
  validatePlan(plan)
  const tampered = structuredClone(plan)
  tampered.items[0].startAt = '2026-09-16T10:00:00+08:00'; tampered.items[0].endAt = '2026-09-16T11:00:00+08:00'
  assert.throws(() => validatePlan(tampered), { code: 'INVALID_PLAN' })
  input.locks = [{ lockId: 'early', targetId: 'a', kind: 'time', value: { startAt: '2026-09-16T10:00:00+08:00', endAt: '2026-09-16T11:00:00+08:00' }, source: 'user', createdAt: '2026-09-15T08:00:00+08:00' }]
  const blocked = buildRulePlan({ request: input, transportQuotes: [overnightQuote], now: () => Date.parse('2026-09-15T10:00:00Z') })
  assert.equal(blocked.feasibility, 'blocked')
  assert.equal(Date.parse(blocked.items[0].startAt), Date.parse(input.locks[0].value.startAt))
  assert.ok(blocked.validation.errors.some(row => row.code === 'TRANSPORT_ARRIVAL_TARGET_CONFLICT'))
})

test('navigation arrivals reflow consecutive activities and return transfer without becoming confirmed transport', async () => {
  const service = createPlanningService({ evidenceForRoutes: async ({ demands }) => demands.map((demand, index) => {
    const minutes = index === 0 ? 120 : 30
    return { demandId: demand.demandId, legs: [{ legId: 'nav-' + index, from: demand.from, to: demand.to, mode: 'car',
      serviceDate: '2026-09-16', departureAt: demand.readyAt, arrivalAt: new Date(Date.parse(demand.readyAt) + minutes * 60000).toISOString(),
      durationMinutes: minutes, routeGeometry: { source: 'fixture' }, quoteRef: null, status: 'unknown',
      assumptions: ['DEPARTURE_AT_READY_TIME'], provenance: { provider: 'tencent-map', sourceType: 'estimate', environment: 'test',
        sourceRef: 'fixture-navigation', fetchedAt: '2026-09-15T10:00:00Z' } }] }
  }) })
  const input = request([item('a', '景点一', 0, 43, 125, 60), item('b', '景点二', 1, 43.1, 125.1, 60)],
    { optimizeOrder: false, lodgingPreferences: { rooms: 1, required: false } })
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: 'navigation-reflow', request: input })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  const result = done.result
  assert.equal(Date.parse(result.plan.items[0].startAt), Date.parse('2026-09-16T10:00:00+08:00'))
  assert.equal(Date.parse(result.plan.items[1].startAt), Date.parse('2026-09-16T11:30:00+08:00'))
  assert.equal(Date.parse(result.routeAudit.legs[2].departureAt), Date.parse('2026-09-16T12:30:00+08:00'))
  assert.equal(result.routeAudit.errors.length, 0)
  assert.equal(result.plan.feasibility, 'needs_review')
  assert.ok(result.routeAudit.legs.every(leg => leg.status === 'unknown' && leg.provenance.sourceType === 'estimate'))
  assert.equal(result.plan.inputSnapshot.menuItems[0].preferredWindow.startAt, input.menuItems[0].preferredWindow.startAt)
  assert.ok(!result.plan.costSummary.unknownCategories.includes('lodging'))
  assert.ok(!result.plan.validation.warnings.some(row => row.code === 'HOTEL_QUOTE_MISSING'))
})

test('city activity scheduling is connected to the job result with original source references', async () => {
  const city = item('city', '长春', 0, 43.82, 125.32)
  city.placeRef.type = 'city'; city.stayDays = 1
  const provenance = { sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: '2026-09-15T10:00:00Z' }
  const service = createPlanningService({
    evidenceForCity: async () => ({ fetchedAt: provenance.fetchedAt, environment: 'test', sourceRef: 'fixture',
      places: [{ providerId: 'museum', name: '博物馆', objectType: 'poi', latitude: 43.8, longitude: 125.3, adcode: '220102' }] }),
    evidenceForPoiSchedules: async ({ candidates }) => candidates.map(candidate => ({ candidateId: candidate.candidateId,
      provenance, visitDurationMinutes: 60, openWindows: [{ startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T17:00:00+08:00', provenance }],
      inboundTransfers: [{ fromCandidateId: 'city-arrival', readyAt: '2026-09-16T08:00:00+08:00', durationMinutes: 30, provenance }] }))
  })
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: 'city-preview', request: request([city]) })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(done.result.cityExpansions[0].activityPreview.activities.length, 1)
  assert.deepEqual(done.result.cityExpansions[0].activityPreview.activities[0].sourceMenuItemIds, ['city'])
  assert.equal(done.result.cityExpansions[0].scheduled, false)
  assert.equal(done.result.plan.feasibility, 'needs_review')
})

test('server transport evidence enters the job quote and leg models without inventing full coverage', async () => {
  const service = createPlanningService({ evidenceForTransport: async () => ({ status: 'available', quotes: [overnightQuote] }) })
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: 'transport-evidence', request: request([item('a', '地点', 0, 43, 125)]) })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(done.result.transportStatus, 'available')
  assert.equal(done.result.plan.legs.length, 1)
  assert.equal(done.result.plan.quotes[0].environment, 'test')
  assert.equal(done.result.plan.feasibility, 'needs_review')
  assert.equal(done.result.plan.dataCoverage.lodgingQuote, false)
})

test('route timing conflicts block the job plan and preserve the user schedule', async () => {
  const service = createPlanningService({ evidenceForRoutes: async ({ demands }) => [{ demandId: demands[0].demandId,
    legs: [{ legId: 'late-transfer', from: demands[0].from, to: demands[0].to, mode: 'car',
      serviceDate: '2026-09-16', departureAt: '2026-09-16T08:00:00+08:00', arrivalAt: '2026-09-16T12:00:00+08:00',
      durationMinutes: 240, routeGeometry: { source: 'mock' }, status: 'available', quoteRef: null,
      provenance: { sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: '2026-09-15T10:00:00Z' } }] }] })
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: 'late-transfer', request: request([item('a', '景点', 0, 43, 125, 60, { preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T10:00:00+08:00' } })]) })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(done.taskStatus, 'partial')
  assert.equal(done.result.plan.feasibility, 'blocked')
  assert.ok(done.result.plan.validation.errors.some(error => error.code === 'ROUTE_ARRIVES_TOO_LATE'))
  assert.equal(Date.parse(done.result.plan.items[0].startAt), Date.parse('2026-09-16T09:00:00+08:00'))
  validatePlan(done.result.plan)
})

test('route arrival reflows an unlocked activity but retains its original constraints', async () => {
  const service = createPlanningService({ evidenceForRoutes: async ({ demands }) => [{ demandId: demands[0].demandId,
    legs: [{ legId: 'transfer', from: demands[0].from, to: demands[0].to, mode: 'car',
      serviceDate: '2026-09-16', departureAt: '2026-09-16T08:00:00+08:00', arrivalAt: '2026-09-16T12:00:00+08:00',
      durationMinutes: 240, routeGeometry: { source: 'mock' }, status: 'available', quoteRef: null,
      provenance: { sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: '2026-09-15T10:00:00Z' } }] }] })
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: 'reflow', request: request([item('a', '景点', 0, 43, 125)]) })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(done.result.plan.feasibility, 'needs_review')
  assert.equal(done.result.routeAudit.reflow.changed, true)
  assert.equal(Date.parse(done.result.plan.items[0].startAt), Date.parse('2026-09-16T12:00:00+08:00'))
  assert.equal(done.result.plan.inputSnapshot.menuItems[0].preferredWindow.startAt, '2026-09-16T09:00:00+08:00')
  validatePlan(done.result.plan)
})

test('local planning job binds city candidates to original occurrences without rewriting locks', async () => {
  const city = item('city', '长春', 0, 43.82, 125.32)
  city.placeRef.type = 'city'
  const input = request([city], { optimizeOrder: false })
  let reads = 0
  const service = createPlanningService({ evidenceForCity: async () => {
    reads++
    return { fetchedAt: '2026-09-15T10:00:00Z', environment: 'test', sourceRef: '/maps/search',
      places: [{ providerId: 'museum', name: '博物馆', objectType: 'poi', latitude: 43.8, longitude: 125.3, adcode: '220102' },
        { providerId: 'other', name: '异地', objectType: 'poi', latitude: 45, longitude: 126, adcode: '230102' }] }
  } })
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: 'city-job', request: input })
  input.menuItems[0].placeRef.name = '外部修改'
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(done.taskStatus, 'partial')
  assert.deepEqual(done.providerCalls, {})
  assert.equal(done.result.plan.inputSnapshot.menuItems[0].placeRef.name, '长春')
  assert.deepEqual(done.result.plan.plannedOrder, ['city'])
  const expansion = done.result.cityExpansions[0]
  assert.equal(expansion.candidates.length, 1)
  assert.deepEqual(expansion.candidates[0].sourceMenuItemIds, ['city'])
  assert.equal(expansion.sourceOccurrenceId, 'city-occurrence')
  assert.equal(expansion.scheduled, false)
  assert.ok(expansion.gaps.includes('CANDIDATE_CITY_MEMBERSHIP_UNCONFIRMED'))
  validatePlan(done.result.plan)
  done.result.plan.plannedOrder.length = 0
  assert.deepEqual(service.jobs.get({ ownerId: 'a', jobId: created.job.id }).result.plan.plannedOrder, ['city'])
  await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(reads, 1)
  assert.throws(() => service.jobs.get({ ownerId: 'b', jobId: created.job.id }))
})

test('city evidence failure degrades truthfully and cancelled jobs never read evidence', async () => {
  const city = item('city', '城市', 0, 43, 125)
  city.placeRef.type = 'city'
  let reads = 0
  const service = createPlanningService({ evidenceForCity: async () => { reads++; throw new Error('private provider error') } })
  const first = service.jobs.create({ ownerId: 'a', idempotencyKey: 'fail', request: request([city]) })
  const done = await service.jobs.run({ ownerId: 'a', jobId: first.job.id })
  assert.deepEqual(done.result.cityExpansions[0].gaps, ['MAP_EVIDENCE_UNAVAILABLE'])
  assert.ok(!JSON.stringify(done).includes('private provider error'))
  const second = service.jobs.create({ ownerId: 'a', idempotencyKey: 'cancel', request: request([city]) })
  service.jobs.cancel({ ownerId: 'a', jobId: second.job.id })
  assert.equal((await service.jobs.run({ ownerId: 'a', jobId: second.job.id })).taskStatus, 'cancelled')
  assert.equal(reads, 1)
})

test('repeated city occurrences keep distinct expansion identities and missing evidence stays partial', async () => {
  const a = item('a', '长春', 0, 43, 125)
  const b = item('b', '长春', 1, 43, 125)
  a.placeRef.type = b.placeRef.type = 'city'
  const service = createPlanningService()
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: 'repeat', request: request([a, b]) })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(done.result.cityExpansions.length, 2)
  assert.deepEqual(done.result.cityExpansions.map(value => value.sourceOccurrenceId), ['a-occurrence', 'b-occurrence'])
  assert.ok(done.result.cityExpansions.every(value => value.gaps.includes('MAP_EVIDENCE_MISSING')))
  assert.equal(done.taskStatus, 'partial')
})

function place(id, name, lat, lng, adcode = '220100') {
  return { provider: 'tencent-map', providerPlaceId: id, name, type: 'poi', coordinate: { lat, lng }, coordinateSystem: 'GCJ-02', adcode }
}

function item(id, name, inputOrder, lat, lng, duration = 120, extra = {}) {
  return {
    menuItemId: id,
    occurrenceId: `${id}-occurrence`,
    placeRef: place(id, name, lat, lng),
    role: 'must_visit',
    inputOrder,
    required: true,
    stayRequirement: 'must_visit',
    visitDuration: { minutes: duration },
    preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T20:00:00+08:00' },
    ...extra
  }
}

function request(items, overrides = {}) {
  return {
    schemaVersion: 'real-travel-plan-request.v1',
    clientRequestId: 'engine-001',
    origin: place('origin', '长春站', 43.8171, 125.3235, '220100'),
    endDestination: place('destination', '哈尔滨站', 45.7733, 126.6572, '230100'),
    startAt: '2026-09-16T08:00:00+08:00',
    endBy: '2026-09-18T23:00:00+08:00',
    timezone: 'Asia/Shanghai',
    travelers: { adults: 2, children: [8] },
    budget: { amountMinor: 500000, currency: 'CNY', basis: 'party', includedCategories: ['transport', 'lodging'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true, maxTransfers: 1, seatType: 'hard_sleeper', cabin: 'economy' },
    transportDemand: { mode: 'train', serviceDate: '2026-09-16', departure: { name: '长春', code: 'CCT' }, arrival: { name: '南岔', code: 'NCB' } },
    lodgingPreferences: { rooms: 1, roomType: 'standard', bedType: 'double', breakfast: false },
    interests: ['人文'],
    pace: 'balanced',
    menuItems: items,
    optimizeOrder: true,
    locks: [],
    confirmedConstraints: [],
    sourceInput: { type: 'manual_menu' },
    ...overrides
  }
}

const overnightQuote = {
  provider: 'juhe', providerId: '817', providerName: '聚合数据·火车订票查询', environment: 'test', mode: 'train',
  productId: 'K1393', serviceNo: 'K1393', quoteId: 'juhe-train-817:2026-09-16:K1393',
  from: '长春', to: '南岔', fromCode: 'CCT', toCode: 'NCB',
  departureDate: '2026-09-16', departureTime: '18:53', arrivalDate: '2026-09-17', arrivalTime: '03:23',
  amountMinor: 14400, currency: 'CNY', priceBasis: 'per_person', taxIncluded: null, availability: 'available',
  fetchedAt: '2026-09-15T10:17:53.110Z', supplierExpiresAt: null,
  bookingTarget: { kind: 'manual', label: '请在官方平台复核后预订' },
  provenance: { sourceType: 'live', provider: 'juhe', sourceRef: '817', fetchedAt: '2026-09-15T10:17:53.110Z', validForDate: '2026-09-16', fieldScope: ['schedule', 'seat_options', 'reference_price', 'availability'], environment: 'test' }
}

test('final validation rechecks original preferred window rather than output fields', () => {
  const plan = buildRulePlan({ request: request([item('a', 'A', 0, 43.82, 125.32, 60, { preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T10:00:00+08:00' } })]) })
  plan.items[0].startAt = '2026-09-16T12:00:00+08:00'
  plan.items[0].endAt = '2026-09-16T13:00:00+08:00'
  assert.throws(() => validatePlan(plan))
})

test('departure window limits departure only and unknown budget categories stay unknown', () => {
  const input = request([item('a', 'A', 0, 43.82, 125.32)])
  input.transportDemand.departureWindow = { startAt: '2026-09-16T18:00:00+08:00', endAt: '2026-09-16T20:00:00+08:00' }
  input.budget = { amountMinor: 100, currency: 'CNY', basis: 'party', includedCategories: ['ticket'], strict: true }
  const plan = buildRulePlan({ request: input, transportQuotes: [overnightQuote] })
  assert.equal(plan.legs.length, 1)
  assert.equal(plan.costSummary.budgetComparison.status, 'unknown_included_categories')
  assert.ok(plan.costSummary.unknownCategories.includes('ticket'))
  input.transportDemand.departureWindow.endAt = '2026-09-16T18:30:00+08:00'
  assert.equal(buildRulePlan({ request: input, transportQuotes: [overnightQuote] }).legs.length, 0)
})

test('rule planner preserves explicit order when optimizeOrder is false', () => {
  const items = [item('far', '远处景点', 0, 45.8, 126.6), item('near-a', '近处 A', 1, 43.82, 125.32), item('near-b', '近处 B', 2, 43.83, 125.33)]
  const plan = buildRulePlan({ request: request(items, { optimizeOrder: false }), now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-strict' })
  assert.deepEqual(plan.originalOrder, ['far', 'near-a', 'near-b'])
  assert.deepEqual(plan.plannedOrder, ['far', 'near-a', 'near-b'])
  assert.deepEqual(plan.orderChanges, [])
})

test('rule planner changes order only when the deterministic score improves', () => {
  const items = [item('far', '远处景点', 0, 45.8, 126.6), item('near-a', '近处 A', 1, 43.82, 125.32), item('near-b', '近处 B', 2, 43.83, 125.33)]
  const order = orderPlan(items, request(items))
  assert.deepEqual(order.planned.map(value => value.menuItemId), ['near-a', 'near-b', 'far'])
  assert.equal(order.changes.length, 3)
  const plan = buildRulePlan({ request: request(items), now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-optimized' })
  assert.deepEqual(plan.plannedOrder, ['near-a', 'near-b', 'far'])
  // B1：报价缺失属于 info 级缺口，不再单独把可执行性降为 needs_review。
  assert.equal(plan.feasibility, 'valid')
})

test('order locks and time locks are hard constraints with explicit conflicts', () => {
  const items = [item('far', '远处景点', 0, 45.8, 126.6), item('near-a', '近处 A', 1, 43.82, 125.32), item('near-b', '近处 B', 2, 43.83, 125.33)]
  const locked = request(items, { locks: [{ lockId: 'order-lock', targetId: 'near-a', kind: 'order', value: { position: 2 }, source: 'user', createdAt: '2026-09-15T08:00:00+08:00' }] })
  const lockedPlan = buildRulePlan({ request: locked, now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-lock' })
  assert.equal(lockedPlan.plannedOrder[2], 'near-a')
  assert.equal(lockedPlan.validation.errors.length, 0)

  const conflict = request([item('fixed', '固定项目', 0, 43.82, 125.32, 180)], {
    locks: [{ lockId: 'time-lock', targetId: 'fixed', kind: 'time', value: { startAt: '2026-09-18T23:00:00+08:00', endAt: '2026-09-19T01:00:00+08:00' }, source: 'confirmed_booking', createdAt: '2026-09-15T08:00:00+08:00' }]
  })
  const conflictPlan = buildRulePlan({ request: conflict, now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-conflict' })
  assert.equal(conflictPlan.feasibility, 'blocked')
  assert.equal(conflictPlan.validation.errors[0].code, 'LOCKED_TIME_CONFLICT')
})

test('rule planner preserves a cross-midnight train leg without overstating unknown child pricing', () => {
  const items = [item('museum', '博物馆', 0, 43.82, 125.32)]
  const plan = buildRulePlan({ request: request(items), transportQuotes: [overnightQuote], now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-train' })
  assert.equal(plan.legs.length, 1)
  assert.equal(plan.legs[0].serviceNo, 'K1393')
  assert.equal(plan.legs[0].serviceDate, '2026-09-16')
  assert.equal(plan.legs[0].arrivalAt, '2026-09-16T19:23:00.000Z')
  assert.equal(plan.legs[0].routeGeometry.display, '供应商未返回路线几何，不绘制连线')
  assert.equal(plan.legs[0].provenance.environment, 'test')
  assert.equal(plan.quotes[0].transportDetail.serviceNo, 'K1393')
  assert.equal(plan.quotes[0].transportDetail.fromCode, 'CCT')
  assert.equal(plan.costSummary.knownTotal, null)
  assert.equal(plan.costSummary.knownSubtotalMinor, 28800)
  assert.equal(plan.costSummary.estimatedRange.maxMinor, 43200)
  assert.deepEqual(plan.costSummary.unknownCategories, ['transport', 'lodging', 'local_transfer'])
  assert.equal(plan.dataMode, 'mixed')
  assert.equal(plan.validation.warnings.some(item => item.code === 'HOTEL_QUOTE_MISSING'), true)
})

test('rule planner returns a reviewable manual plan when no live quote is available', () => {
  const plan = buildRulePlan({ request: request([item('museum', '博物馆', 0, 43.82, 125.32)]), now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-manual' })
  assert.equal(plan.dataMode, 'manual')
  // B1：没有报价时只有 TRANSPORT_QUOTE_MISSING / TRANSFER_QUOTE_MISSING 这类 info 缺口，
  // 方案仍是 valid，缺口通过 display.notes 呈现而不是降级可执行性。
  assert.equal(plan.feasibility, 'valid')
  assert.equal(plan.legs.length, 0)
  assert.equal(plan.costSummary.knownTotal, null)
  assert.equal(plan.validation.warnings.some(item => item.code === 'TRANSPORT_QUOTE_MISSING'), true)
})

test('rule planner never backfills a later item into an earlier date', () => {
  const items = [
    item('day-two', '第二天项目', 0, 43.82, 125.32, 60, { preferredWindow: { startAt: '2026-09-17T09:00:00+08:00', endAt: '2026-09-17T20:00:00+08:00' } }),
    item('day-one', '第一天项目', 1, 43.83, 125.33, 60, { preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T20:00:00+08:00' } })
  ]
  const plan = buildRulePlan({ request: request(items, { optimizeOrder: false }), now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-no-backfill' })
  const first = plan.items.find(value => value.itemId === 'day-two')
  const second = plan.items.find(value => value.itemId === 'day-one')
  assert.ok(Date.parse(second.startAt) >= Date.parse(first.endAt))
  assert.equal(plan.validation.errors.some(error => error.code === 'TIME_ORDER_CONFLICT'), true)
  assert.equal(plan.feasibility, 'blocked')
})

test('rule planner keeps same-day items non-overlapping while advancing across multiple days', () => {
  const items = [
    item('same-a', '同日 A', 0, 43.82, 125.32, 120),
    item('same-b', '同日 B', 1, 43.83, 125.33, 60),
    item('day-three', '第三天项目', 2, 43.84, 125.34, 60, { preferredWindow: { startAt: '2026-09-18T09:00:00+08:00', endAt: '2026-09-18T20:00:00+08:00' } })
  ]
  const plan = buildRulePlan({ request: request(items, { optimizeOrder: false }), now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-monotonic-multi-day' })
  const ordered = plan.plannedOrder.map(id => plan.items.find(value => value.itemId === id))
  for (let index = 1; index < ordered.length; index += 1) assert.ok(Date.parse(ordered[index].startAt) >= Date.parse(ordered[index - 1].endAt))
  assert.equal(ordered[2].startAt, '2026-09-18T01:00:00.000Z')
  assert.equal(plan.validation.errors.length, 0)
})

test('fixed time locks keep exact boundaries and report cursor, duration, and duplicate-lock conflicts', () => {
  const items = [item('fixed', '固定项目', 0, 43.82, 125.32, 120)]
  const exact = buildRulePlan({
    request: request(items, { locks: [{ lockId: 'fixed-time', targetId: 'fixed', kind: 'time', value: { startAt: '2026-09-16T10:00:00+08:00', endAt: '2026-09-16T12:00:00+08:00' }, source: 'confirmed_booking', createdAt: '2026-09-15T08:00:00+08:00' }] }),
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-fixed-exact'
  })
  assert.equal(exact.items[0].startAt, '2026-09-16T02:00:00.000Z')
  assert.equal(exact.items[0].endAt, '2026-09-16T04:00:00.000Z')
  assert.equal(exact.validation.errors.length, 0)

  const cursorConflict = buildRulePlan({
    request: request([item('before', '前项', 0, 43.82, 125.32, 120), item('locked', '锁定项目', 1, 43.83, 125.33, 120)], {
      optimizeOrder: false,
      locks: [{ lockId: 'locked-time', targetId: 'locked', kind: 'time', value: { startAt: '2026-09-16T10:00:00+08:00', endAt: '2026-09-16T12:00:00+08:00' }, source: 'confirmed_booking', createdAt: '2026-09-15T08:00:00+08:00' }]
    }),
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-fixed-cursor'
  })
  const locked = cursorConflict.items.find(value => value.itemId === 'locked')
  assert.equal(locked.startAt, '2026-09-16T02:00:00.000Z')
  assert.equal(locked.endAt, '2026-09-16T04:00:00.000Z')
  assert.equal(cursorConflict.validation.errors.some(error => error.code === 'LOCKED_TIME_CONFLICT'), true)

  const durationConflict = buildRulePlan({
    request: request([item('duration-mismatch', '时长不一致', 0, 43.82, 125.32, 60)], {
      locks: [{ lockId: 'duration-lock', targetId: 'duration-mismatch', kind: 'time', value: { startAt: '2026-09-16T10:00:00+08:00', endAt: '2026-09-16T12:00:00+08:00' }, source: 'confirmed_booking', createdAt: '2026-09-15T08:00:00+08:00' }]
    }),
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-fixed-duration'
  })
  assert.equal(durationConflict.items[0].durationMinutes, 120)
  assert.equal(durationConflict.items[0].requestedDurationMinutes, 60)
  assert.equal(durationConflict.validation.errors.some(error => error.code === 'TIME_LOCK_DURATION_CONFLICT'), true)

  const duplicateLock = buildRulePlan({
    request: request(items, { locks: [
      { lockId: 'lock-a', targetId: 'fixed', kind: 'time', value: { startAt: '2026-09-16T10:00:00+08:00', endAt: '2026-09-16T12:00:00+08:00' }, source: 'user', createdAt: '2026-09-15T08:00:00+08:00' },
      { lockId: 'lock-b', targetId: 'fixed', kind: 'time', value: { startAt: '2026-09-16T11:00:00+08:00', endAt: '2026-09-16T13:00:00+08:00' }, source: 'user', createdAt: '2026-09-15T08:00:00+08:00' }
    ] }),
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-fixed-duplicate'
  })
  assert.equal(duplicateLock.validation.errors.some(error => error.code === 'TIME_LOCK_CONFLICT'), true)
})

test('optimizer falls back to a feasible baseline when the candidate violates a narrow window', () => {
  const items = [
    item('far', '远处景点', 0, 45.8, 126.6, 60, { preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T10:00:00+08:00' } }),
    item('near-a', '近处 A', 1, 43.82, 125.32, 60),
    item('near-b', '近处 B', 2, 43.83, 125.33, 60)
  ]
  const plan = buildRulePlan({ request: request(items), now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-feasible-baseline' })
  assert.deepEqual(plan.plannedOrder, ['far', 'near-a', 'near-b'])
  assert.equal(plan.validation.errors.length, 0)
  assert.equal(plan.validation.warnings.some(warning => warning.code === 'OPTIMIZATION_FALLBACK_TO_FEASIBLE_BASELINE'), true)
})

test('cost rules compare the declared budget basis and never infer child prices', () => {
  const adultsOnly = request([item('museum', '博物馆', 0, 43.82, 125.32)], {
    travelers: { adults: 2, children: [] },
    budget: { amountMinor: 20000, currency: 'CNY', basis: 'person', includedCategories: ['transport'], strict: true }
  })
  const within = buildRulePlan({ request: adultsOnly, transportQuotes: [overnightQuote], now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-budget-person' })
  assert.equal(within.costSummary.knownTotal, 28800)
  assert.equal(within.costSummary.budgetComparison.status, 'known_within_partial_scope')
  assert.equal(within.feasibility, 'needs_review')

  const personHard = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { travelers: { adults: 2, children: [] }, budget: { amountMinor: 10000, currency: 'CNY', basis: 'person', includedCategories: ['transport'], strict: true } }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-budget-person-hard'
  })
  assert.equal(personHard.costSummary.budgetComparison.status, 'hard_exceeded')
  assert.equal(personHard.feasibility, 'blocked')

  const hard = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { budget: { amountMinor: 10, currency: 'CNY', basis: 'party', includedCategories: ['transport'], strict: true } }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-budget-hard'
  })
  assert.equal(hard.costSummary.budgetComparison.status, 'hard_exceeded')
  assert.equal(hard.validation.errors.some(error => error.code === 'BUDGET_EXCEEDED'), true)
  assert.equal(hard.feasibility, 'blocked')
})

test('quote selection rejects unmatched, expired, and non-bookable quotes instead of selecting the first available row', () => {
  const unmatched = { ...overnightQuote, quoteId: 'unmatched', from: '沈阳', fromCode: 'SHP' }
  const expired = { ...overnightQuote, quoteId: 'expired', supplierExpiresAt: '2026-09-14T10:00:00.000Z' }
  const nonBookable = { ...overnightQuote, quoteId: 'non-bookable', serviceCanBook: false, selectedSeat: { typeCode: '3', rawAvailability: '有' } }
  const plan = buildRulePlan({ request: request([item('museum', '博物馆', 0, 43.82, 125.32)]), transportQuotes: [unmatched, expired, nonBookable], now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-reject-quotes' })
  assert.equal(plan.legs.length, 0)
  assert.equal(plan.costSummary.knownTotal, null)
  assert.equal(plan.validation.warnings.filter(warning => warning.code === 'TRANSPORT_QUOTE_REJECTED').length, 3)
  assert.deepEqual(new Set(plan.validation.warnings.filter(warning => warning.code === 'TRANSPORT_QUOTE_REJECTED').map(warning => warning.reason)), new Set(['departure_station_mismatch', 'quote_expired', 'service_not_bookable']))
})

test('shared hard constraints prevent baseline fallback from violating an order lock', () => {
  const items = [
    item('far', '远处景点', 0, 45.8, 126.6, 60, { preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T10:00:00+08:00' } }),
    item('near-a', '近处 A', 1, 43.82, 125.32, 60),
    item('near-b', '近处 B', 2, 43.83, 125.33, 60)
  ]
  const lockedRequest = request(items, { locks: [{ lockId: 'far-position', targetId: 'far', kind: 'order', value: { position: 2 }, source: 'user', createdAt: '2026-09-15T08:00:00+08:00' }] })
  const order = orderPlan(items, lockedRequest)
  const baselineHard = checkHardConstraints({ request: lockedRequest, orderedItems: order.original, schedule: scheduleItems(lockedRequest, order.original, lockedRequest.locks) })
  const candidateHard = checkHardConstraints({ request: lockedRequest, orderedItems: order.planned, schedule: scheduleItems(lockedRequest, order.planned, lockedRequest.locks) })
  assert.equal(baselineHard.errors.some(error => error.code === 'ORDER_LOCK_VIOLATION'), true)
  assert.equal(candidateHard.errors.some(error => error.code === 'TIME_WINDOW_CONFLICT'), true)

  const plan = buildRulePlan({ request: lockedRequest, now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-order-lock-window-combination' })
  assert.deepEqual(plan.plannedOrder, ['near-a', 'near-b', 'far'])
  assert.equal(plan.feasibility, 'blocked')
  assert.equal(plan.validation.warnings.some(warning => warning.code === 'OPTIMIZATION_FALLBACK_TO_FEASIBLE_BASELINE'), false)
  assert.equal(plan.validation.independentChecks.find(check => check.check === 'hard_constraints').status, 'failed')
})

test('scheduleItems uses the intersection of a cross-day preferred window and each day window', () => {
  const planned = buildRulePlan({
    request: request([item('cross-day', '跨日窗口项目', 0, 43.82, 125.32, 120, { preferredWindow: { startAt: '2026-09-16T21:00:00+08:00', endAt: '2026-09-17T20:00:00+08:00' } })], { optimizeOrder: false }),
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-cross-day-window'
  })
  assert.equal(planned.items[0].startAt, '2026-09-17T00:00:00.000Z')
  assert.equal(planned.items[0].endAt, '2026-09-17T02:00:00.000Z')
  assert.equal(planned.validation.errors.length, 0)
})

test('transport quote selection enforces request time bounds, explicit departure windows, and overnight preference', () => {
  const narrow = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { startAt: '2026-09-16T20:00:00+08:00', endBy: '2026-09-16T23:00:00+08:00' }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-transport-time-bounds'
  })
  assert.equal(narrow.legs.length, 0)
  assert.equal(narrow.costSummary.knownTotal, null)
  assert.equal(narrow.validation.warnings.some(warning => warning.reason === 'departure_before_allowed_window'), true)

  const offsetEquivalent = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { startAt: '2026-09-16T12:00:00Z', endBy: '2026-09-16T15:00:00Z' }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-transport-offset-equivalent'
  })
  assert.equal(offsetEquivalent.legs.length, 0)
  assert.equal(offsetEquivalent.validation.warnings.some(warning => warning.reason === 'departure_before_allowed_window'), true)

  const explicitWindow = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { transportDemand: { mode: 'train', serviceDate: '2026-09-16', departure: { name: '长春', code: 'CCT' }, arrival: { name: '南岔', code: 'NCB' }, departureWindow: { startAt: '2026-09-16T19:00:00+08:00', endAt: '2026-09-16T23:00:00+08:00' } } }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-transport-explicit-window'
  })
  assert.equal(explicitWindow.legs.length, 0)
  assert.equal(explicitWindow.validation.warnings.some(warning => warning.reason === 'departure_before_allowed_window'), true)

  const overnightBlocked = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { transportPreferences: { modes: ['train'], allowNightTrain: false, maxTransfers: 1, seatType: 'hard_sleeper', cabin: 'economy' } }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-overnight-blocked'
  })
  assert.equal(overnightBlocked.legs.length, 0)
  assert.equal(overnightBlocked.validation.warnings.some(warning => warning.reason === 'overnight_not_allowed'), true)

  const overnightAllowed = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)]),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-overnight-allowed'
  })
  assert.equal(overnightAllowed.legs.length, 1)
})

test('budget comparison only includes declared categories while retaining the complete cost breakdown', () => {
  const lodgingOnly = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { travelers: { adults: 2, children: [] }, budget: { amountMinor: 10000, currency: 'CNY', basis: 'party', includedCategories: ['lodging'], strict: true } }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-budget-lodging-only'
  })
  assert.equal(lodgingOnly.costSummary.knownTotal, 28800)
  assert.deepEqual(lodgingOnly.costSummary.categoryBreakdown.map(row => row.category), ['transport', 'lodging', 'local_transfer'])
  assert.equal(lodgingOnly.costSummary.budgetComparison.status, 'unknown_included_categories')
  assert.equal(lodgingOnly.validation.errors.some(error => error.code === 'BUDGET_EXCEEDED'), false)
  assert.equal(lodgingOnly.feasibility, 'needs_review')

  const mixedScope = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { travelers: { adults: 2, children: [] }, budget: { amountMinor: 50000, currency: 'CNY', basis: 'party', includedCategories: ['transport', 'lodging'], strict: true } }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-budget-mixed-scope'
  })
  assert.equal(mixedScope.costSummary.budgetComparison.status, 'unknown_included_categories')
  assert.equal(mixedScope.validation.errors.some(error => error.code === 'BUDGET_EXCEEDED'), false)

  const emptyScope = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { budget: { amountMinor: 1, currency: 'CNY', basis: 'party', includedCategories: [], strict: true } }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-budget-empty-scope'
  })
  assert.equal(emptyScope.costSummary.budgetComparison.status, 'not_in_scope')
  assert.equal(emptyScope.validation.errors.some(error => error.code === 'BUDGET_EXCEEDED'), false)
})

test('plan contract rejects wrong day ownership and unknown source menu references independently', () => {
  const base = buildRulePlan({ request: request([item('museum', '博物馆', 0, 43.82, 125.32)]), now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-day-source-base' })
  const wrongDay = structuredClone(base)
  wrongDay.days[0].itemIds = []
  wrongDay.days[1].itemIds = ['museum']
  assert.throws(() => validatePlan(wrongDay), error => error.code === 'INVALID_PLAN')

  const wrongSource = structuredClone(base)
  wrongSource.items[0].sourceMenuItemIds = ['nonexistent-menu-item']
  assert.throws(() => validatePlan(wrongSource), error => error.code === 'INVALID_PLAN')
})

test('combined locks, time windows, overnight policy, and category scope produce independent truthful results', () => {
  const items = [
    item('far', '远处景点', 0, 45.8, 126.6, 60, { preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T10:00:00+08:00' } }),
    item('near-a', '近处 A', 1, 43.82, 125.32, 60),
    item('near-b', '近处 B', 2, 43.83, 125.33, 60)
  ]
  const plan = buildRulePlan({
    request: request(items, {
      locks: [{ lockId: 'far-position-combined', targetId: 'far', kind: 'order', value: { position: 2 }, source: 'user', createdAt: '2026-09-15T08:00:00+08:00' }],
      transportPreferences: { modes: ['train'], allowNightTrain: false, maxTransfers: 1, seatType: 'hard_sleeper', cabin: 'economy' },
      budget: { amountMinor: 1, currency: 'CNY', basis: 'party', includedCategories: ['lodging'], strict: true }
    }),
    transportQuotes: [overnightQuote],
    now: () => Date.parse('2026-09-15T10:00:00Z'),
    planId: 'plan-combined-r2'
  })
  assert.deepEqual(plan.plannedOrder, ['near-a', 'near-b', 'far'])
  assert.equal(plan.feasibility, 'blocked')
  assert.equal(plan.validation.errors.some(error => error.code === 'TIME_WINDOW_CONFLICT'), true)
  assert.equal(plan.validation.errors.some(error => error.code === 'BUDGET_EXCEEDED'), false)
  assert.equal(plan.validation.warnings.some(warning => warning.reason === 'overnight_not_allowed'), true)
  assert.equal(plan.validation.warnings.some(warning => warning.code === 'OPTIMIZATION_FALLBACK_TO_FEASIBLE_BASELINE'), false)
})

test('plan contract rejects duplicate ids, dangling references, empty order, and inconsistent feasibility', () => {
  const base = buildRulePlan({ request: request([item('museum', '博物馆', 0, 43.82, 125.32)]), now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-contract-base' })
  const duplicate = structuredClone(base)
  duplicate.items.push(structuredClone(base.items[0]))
  assert.throws(() => validatePlan(duplicate), error => error.code === 'INVALID_PLAN')

  const emptyOrder = structuredClone(base)
  emptyOrder.plannedOrder = []
  assert.throws(() => validatePlan(emptyOrder), error => error.code === 'INVALID_PLAN')

  const inconsistent = structuredClone(base)
  inconsistent.validation.errors = [{ code: 'FAKE_ERROR' }]
  inconsistent.feasibility = 'valid'
  assert.throws(() => validatePlan(inconsistent), error => error.code === 'INVALID_PLAN')

  const withLeg = buildRulePlan({ request: request([item('museum', '博物馆', 0, 43.82, 125.32)]), transportQuotes: [overnightQuote], now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-contract-leg' })
  withLeg.legs[0].quoteRef = 'missing-quote'
  assert.throws(() => validatePlan(withLeg), error => error.code === 'INVALID_PLAN')

  const invalidQuote = buildRulePlan({ request: request([item('museum', '博物馆', 0, 43.82, 125.32)]), transportQuotes: [overnightQuote], now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-contract-quote' })
  invalidQuote.quotes[0].amountMinor = -1
  assert.throws(() => validatePlan(invalidQuote), error => error.code === 'INVALID_PLAN')

  const invalidLeg = buildRulePlan({ request: request([item('museum', '博物馆', 0, 43.82, 125.32)]), transportQuotes: [overnightQuote], now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'plan-contract-leg-fields' })
  invalidLeg.legs[0].arrivalAt = invalidLeg.legs[0].departureAt
  assert.throws(() => validatePlan(invalidLeg), error => error.code === 'INVALID_PLAN')

  const duration = structuredClone(base)
  duration.items[0].endAt = new Date(Date.parse(duration.items[0].endAt) + 60000).toISOString()
  assert.throws(() => validatePlan(duration), error => error.code === 'INVALID_PLAN')
})
