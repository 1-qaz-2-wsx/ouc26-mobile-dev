// B3-3：按 demandId 分组选票、多 carrier legs、多 arrival 约束与多段费用聚合。
// 覆盖 specs/agent-tasks/round-03-workbuddy-b3-3.md §10 的必测场景。
// B3-3-R1 追加：plan 内 quote 段级唯一身份、quote/leg demandId 一致性、quoteRef ↔ demandId 交叉约束。
// 全部使用本地 fixture：不调用真实聚合火车或航班接口，不消耗任何真实额度。
const test = require('node:test')
const assert = require('node:assert/strict')
const { applyTransportEvidence, buildRulePlan, scopedTransportQuoteId } = require('../src/planning/rule-planner')
const { arrivalConstraints, arrivalConstrainedRequest, arrivalErrors } = require('../src/planning/transport-arrival')
const { routeDemands } = require('../src/planning/route-audit')
const { validatePlan, validateQuote, validateLeg } = require('../src/planning/plan-schema')

const NOW = Date.parse('2026-09-18T02:00:00Z')
const AT = time => `2026-10-${time}`

// 多段 plan quote 身份 = provider raw quoteId + demand 作用域。
// 测试用同一实现计算期望值，另有专门用例把字面量格式钉死，避免只做镜像断言。
const scoped = (rawQuoteId, demandId) => scopedTransportQuoteId(rawQuoteId, demandId)

// ---------------------------------------------------------------- fixtures

function place(providerPlaceId, name, lat, lng, adcode) {
  return { provider: 'tencent-map', providerPlaceId, name, type: 'city', coordinate: { lat, lng }, coordinateSystem: 'GCJ-02', adcode }
}

function menuItem(menuItemId, name, inputOrder, lat, lng, adcode, duration = 120) {
  return {
    menuItemId,
    occurrenceId: `${menuItemId}-occ`,
    placeRef: place(`${menuItemId}-place`, name, lat, lng, adcode),
    role: 'attraction',
    inputOrder,
    required: true,
    stayRequirement: 'must_visit',
    visitDuration: { minutes: duration },
    preferredWindow: { startAt: AT('02T08:00:00+08:00'), endAt: AT('03T20:00:00+08:00') }
  }
}

// 三个显式交通需求：origin -> museum / museum -> park / park -> endDestination
function mainRequest(overrides = {}) {
  return {
    schemaVersion: 'real-travel-plan-request.v1',
    clientRequestId: 'b3-3-multi',
    origin: place('origin', '长春站', 43.8171, 125.3235, '220100'),
    endDestination: place('destination', '漠河站', 52.9723, 124.1122, '232700'),
    startAt: AT('01T08:00:00+08:00'),
    endBy: AT('04T23:00:00+08:00'),
    timezone: 'Asia/Shanghai',
    travelers: { adults: 2, children: [] },
    budget: { amountMinor: 500000, currency: 'CNY', basis: 'party', includedCategories: ['transport'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true, maxTransfers: 1 },
    transportDemands: [
      { mode: 'train', serviceDate: AT('02'), departure: { name: '长春', code: 'CCT' }, arrival: { name: '沈阳', code: 'SYT' }, targetMenuItemId: 'museum' },
      { mode: 'train', serviceDate: AT('03'), departure: { name: '沈阳', code: 'SYT' }, arrival: { name: '哈尔滨', code: 'HGH' }, targetMenuItemId: 'park' },
      { mode: 'train', serviceDate: AT('04'), departure: { name: '哈尔滨', code: 'HGH' }, arrival: { name: '漠河', code: 'MHX' } }
    ],
    lodgingPreferences: { rooms: 1, required: false },
    interests: ['人文'],
    pace: 'balanced',
    menuItems: [menuItem('museum', '沈阳故宫', 0, 41.8, 123.43, '210100'), menuItem('park', '中央大街', 1, 45.79, 126.58, '230100')],
    optimizeOrder: false,
    locks: [],
    confirmedConstraints: [],
    sourceInput: { type: 'manual_menu' },
    ...overrides
  }
}

const provenance = { sourceType: 'live', provider: 'juhe', sourceRef: '817', fetchedAt: '2026-09-18T02:00:00.000Z', environment: 'test' }

function trainQuote(quoteId, from, to, fromCode, toCode, departureDate, departureTime, arrivalDate, arrivalTime, amountMinor, overrides = {}) {
  return {
    provider: 'juhe', mode: 'train', productId: quoteId.split(':').pop(), serviceNo: quoteId.split(':').pop(), quoteId,
    from, to, fromCode, toCode, departureDate, departureTime, arrivalDate, arrivalTime,
    amountMinor, currency: 'CNY', priceBasis: 'per_person', availability: 'available', environment: 'test',
    fetchedAt: '2026-09-18T02:00:00.000Z', provenance,
    ...overrides
  }
}

// 段 A：长春 -> 沈阳，10-02 08:00 发车、14:00 到达（到达晚于 museum 的原始窗口起点，用于验证顺延）
const quoteA = (amountMinor = 20000, overrides = {}) =>
  trainQuote('juhe:2026-10-02:K7001', '长春', '沈阳', 'CCT', 'SYT', AT('02'), '08:00', AT('02'), '14:00', amountMinor, overrides)
// 段 B：沈阳 -> 哈尔滨，10-03 05:00 发车、07:00 到达（早于 park 的原始窗口起点，不触发顺延）
const quoteB = (amountMinor = 30000, overrides = {}) =>
  trainQuote('juhe:2026-10-03:K7002', '沈阳', '哈尔滨', 'SYT', 'HGH', AT('03'), '05:00', AT('03'), '07:00', amountMinor, overrides)
// 段 C：哈尔滨 -> 漠河（到终点，没有目标活动）
const quoteC = (amountMinor = 40000, overrides = {}) =>
  trainQuote('juhe:2026-10-04:K7003', '哈尔滨', '漠河', 'HGH', 'MHX', AT('04'), '08:00', AT('04'), '18:00', amountMinor, overrides)

const KEYS = ['museum', 'park', 'destination']

function basePlan(request) {
  return buildRulePlan({ request, transportQuotes: [], now: () => NOW, planId: 'plan-b3-3' })
}

// 按 route demand 顺序构造 evidence；每个 quote 注入它所属段的 demandId（与 pipeline 行为一致）。
function evidenceWith(base, spec = {}) {
  return routeDemands(base).map((demand, index) => {
    const key = KEYS[index]
    const row = spec[key] || {}
    const quotes = (Array.isArray(row.quotes) ? row.quotes : []).map(quote => ({ ...quote, demandId: demand.demandId }))
    return {
      demandId: demand.demandId,
      targetMenuItemId: key === 'destination' ? null : key,
      targetStopId: key === 'destination' ? 'destination' : `item:${key}`,
      mode: 'train',
      serviceDate: row.serviceDate || null,
      status: row.status || (quotes.length ? 'queried' : 'no_quotes'),
      providerStatus: null,
      diagnostic: null,
      quotes
    }
  })
}

const allSegments = { museum: { quotes: [quoteA()] }, park: { quotes: [quoteB()] }, destination: { quotes: [quoteC()] } }

function run(request = mainRequest(), spec = allSegments) {
  const base = basePlan(request)
  const evidence = evidenceWith(base, spec)
  const plan = applyTransportEvidence({ plan: base, request, transportEvidence: evidence, now: NOW })
  return { request, base, evidence, plan, demands: routeDemands(base) }
}

const legFor = (plan, demandId) => plan.legs.find(leg => leg.demandId === demandId)
const itemFor = (plan, itemId) => plan.items.find(item => item.itemId === itemId)
const transportRow = plan => plan.costSummary.categoryBreakdown.find(row => row.category === 'transport')

// ---------------------------------------------------------------- 分组选票

test('two demands each select from their own pool and never across pools', () => {
  const { plan, demands } = run(mainRequest(), {
    museum: { quotes: [quoteA(60000)] },
    park: { quotes: [quoteB(10000)] }
  })
  const museumLeg = legFor(plan, demands[0].demandId)
  const parkLeg = legFor(plan, demands[1].demandId)
  assert.equal(museumLeg.quoteRef, scoped('juhe:2026-10-02:K7001', demands[0].demandId))
  assert.equal(parkLeg.quoteRef, scoped('juhe:2026-10-03:K7002', demands[1].demandId))
  assert.notEqual(museumLeg.quoteRef, parkLeg.quoteRef)
})

test('a cheaper quote in another demand pool never wins a segment', () => {
  const { plan, demands } = run(mainRequest(), {
    museum: { quotes: [quoteA(60000), quoteA(70000, { quoteId: 'juhe:2026-10-02:K7999' })] },
    park: { quotes: [quoteB(10000)] }
  })
  const museumLeg = legFor(plan, demands[0].demandId)
  // 全局最低价是 B 段的 10000，但 museum 段只能在自己池内选。
  assert.equal(museumLeg.quoteRef, scoped('juhe:2026-10-02:K7001', demands[0].demandId))
  assert.equal(plan.quotes.find(quote => quote.quoteId === museumLeg.quoteRef).amountMinor, 60000)
})

test('every selected quote keeps the demandId of its own pool', () => {
  const { plan, demands } = run()
  for (const demand of demands) {
    const selected = plan.legs.find(leg => leg.demandId === demand.demandId)
    assert.ok(selected, `缺少 ${demand.demandId} 的 carrier leg`)
    const quote = plan.quotes.find(value => value.quoteId === selected.quoteRef)
    assert.equal(quote.demandId, demand.demandId)
  }
  assert.ok(plan.quotes.every(quote => typeof quote.demandId === 'string' && quote.demandId.length > 0))
})

test('a carrier leg carries exactly the demandId of its selected quote', () => {
  const { plan, demands } = run()
  assert.equal(plan.legs.length, 3)
  for (const leg of plan.legs) {
    const quote = plan.quotes.find(value => value.quoteId === leg.quoteRef)
    assert.equal(leg.demandId, quote.demandId)
    // legId 与 quoteRef 必须由同一个 plan 内 scoped quoteId 派生，不允许各自拼装。
    assert.equal(leg.legId, `leg:${leg.quoteRef}`)
  }
  assert.equal(new Set(plan.legs.map(leg => leg.demandId)).size, 3)
  const rawIds = [quoteA().quoteId, quoteB().quoteId, quoteC().quoteId]
  assert.deepEqual(plan.legs.map(leg => leg.quoteRef), rawIds.map((raw, index) => scoped(raw, demands[index].demandId)))
})

test('quotes stamped with another demand id are rejected instead of being used', () => {
  const request = mainRequest()
  const base = basePlan(request)
  const evidence = evidenceWith(base, { museum: { quotes: [quoteA()] }, park: { quotes: [quoteB()] } })
  // 把 B 段的报价塞进 A 段的候选池：它带着 B 的 demandId，必须被拒绝而不是跨池使用。
  evidence[0].quotes = [{ ...quoteA(), demandId: evidence[1].demandId }]
  const plan = applyTransportEvidence({ plan: base, request, transportEvidence: evidence, now: NOW })
  assert.equal(legFor(plan, evidence[0].demandId), undefined)
  assert.ok(legFor(plan, evidence[1].demandId))
  assert.ok(plan.validation.warnings.some(row => row.code === 'TRANSPORT_QUOTE_MISSING' && row.demandId === evidence[0].demandId))
  // 被拒报价不属于本 plan，诊断里保留 provider 原始身份，不伪造 scoped 身份。
  const rejected = plan.validation.warnings.find(row => row.code === 'TRANSPORT_QUOTE_REJECTED' && row.reason === 'quote_demand_id_mismatch')
  assert.ok(rejected)
  assert.equal(rejected.quoteId, quoteA().quoteId)
})

test('evidence without a demandId is never guessed into a segment', () => {
  const request = mainRequest()
  const base = basePlan(request)
  const unbound = { demandId: null, targetMenuItemId: null, targetStopId: 'item:museum', mode: 'train', serviceDate: AT('02'), status: 'unbound', quotes: [{ ...quoteA(), demandId: null }] }
  const plan = applyTransportEvidence({ plan: base, request, transportEvidence: [unbound], now: NOW })
  assert.equal(plan.legs.length, 0)
  // 没有归属的 evidence 只保留受控的“未绑定”诊断，不猜任何 demandId。
  assert.equal(plan.validation.warnings.filter(row => row.code === 'TRANSPORT_QUOTE_UNBOUND').length, 1)
  // 三条显式需求都没有证据：状态是 not_queried，不是「查过但没有票」。
  assert.equal(plan.validation.warnings.filter(row => row.code === 'TRANSPORT_NOT_QUERIED').length, 3)
  assert.equal(plan.feasibility, 'needs_review')
})

// ---------------------------------------------------------------- 缺口与部分成功

test('a segment without quotes keeps the other segments and never fabricates a leg', () => {
  const { plan, demands } = run(mainRequest(), {
    museum: { quotes: [quoteA()] },
    park: { status: 'no_quotes' },
    destination: { quotes: [quoteC()] }
  })
  assert.ok(legFor(plan, demands[0].demandId))
  assert.equal(legFor(plan, demands[1].demandId), undefined)
  assert.ok(legFor(plan, demands[2].demandId))
  assert.equal(plan.legs.length, 2)
  // B3-4 §5：no_quotes 必须是独立受控状态，不能塌缩成泛化的「尚未取得报价」。
  assert.ok(plan.validation.warnings.some(row => row.code === 'TRANSPORT_NO_QUOTES' && row.demandId === demands[1].demandId))
  assert.equal(plan.validation.warnings.some(row => row.code === 'TRANSPORT_QUOTE_MISSING' && row.demandId === demands[1].demandId), false)
})

test('an unavailable segment does not erase the successful segments', () => {
  const { plan, demands } = run(mainRequest(), {
    museum: { quotes: [quoteA()] },
    park: { status: 'unavailable' },
    destination: { quotes: [quoteC()] }
  })
  assert.equal(plan.legs.length, 2)
  assert.equal(plan.legs[0].demandId, demands[0].demandId)
  assert.equal(plan.feasibility, 'needs_review')
  assert.equal(plan.validation.errors.length, 0)
})

test('two successful segments produce two uniquely identified carrier legs', () => {
  const request = mainRequest()
  request.transportDemands = request.transportDemands.slice(0, 2)
  const { plan, demands } = run(request, { museum: { quotes: [quoteA()] }, park: { quotes: [quoteB()] } })
  assert.equal(plan.legs.length, 2)
  assert.equal(new Set(plan.legs.map(leg => leg.legId)).size, 2)
  assert.deepEqual(plan.legs.map(leg => leg.demandId), demands.slice(0, 2).map(demand => demand.demandId))
  validatePlan(plan)
})

test('carrier legs keep real stations and never fake a station geometry', () => {
  const { plan } = run()
  for (const leg of plan.legs) {
    assert.equal(leg.from.type, 'train_station')
    assert.equal(leg.to.type, 'train_station')
    assert.equal(leg.from.provider, 'juhe')
    assert.equal(leg.routeGeometry.type, 'none')
    assert.equal(leg.routeGeometry.source, 'provider_geometry_not_returned')
  }
})

// ---------------------------------------------------------------- arrival 约束

test('a target activity is deferred to after its own carrier arrival', () => {
  const { plan, demands, request } = run()
  const museum = itemFor(plan, 'museum')
  const leg = legFor(plan, demands[0].demandId)
  assert.ok(Date.parse(museum.startAt) >= Date.parse(leg.arrivalAt))
  // 原始请求快照不得被就地修改。
  assert.equal(plan.inputSnapshot.menuItems[0].preferredWindow.startAt, request.menuItems[0].preferredWindow.startAt)
})

test('two different targets are each constrained by their own carrier arrival', () => {
  const request = mainRequest()
  request.transportDemands[1].serviceDate = AT('03')
  const { plan, demands } = run(request, {
    museum: { quotes: [quoteA()] },
    park: { quotes: [quoteB(30000, { departureDate: AT('03'), departureTime: '09:00', arrivalDate: AT('03'), arrivalTime: '12:00', quoteId: 'juhe:2026-10-03:K7004' })] },
    destination: { quotes: [quoteC()] }
  })
  const museum = itemFor(plan, 'museum')
  const park = itemFor(plan, 'park')
  assert.ok(Date.parse(museum.startAt) >= Date.parse(legFor(plan, demands[0].demandId).arrivalAt))
  assert.ok(Date.parse(park.startAt) >= Date.parse(legFor(plan, demands[1].demandId).arrivalAt))
  assert.equal(park.startAt, new Date(`${AT('03')}T12:00:00+08:00`).toISOString())
  assert.equal(plan.validation.errors.length, 0)
})

test('the endDestination segment never moves any activity', () => {
  const withDestination = run(mainRequest(), { museum: { quotes: [quoteA()] }, park: { quotes: [quoteB()] }, destination: { quotes: [quoteC()] } })
  const withoutDestination = run(mainRequest(), { museum: { quotes: [quoteA()] }, park: { quotes: [quoteB()] }, destination: { status: 'no_quotes' } })
  assert.equal(withDestination.plan.legs.length, 3)
  assert.equal(withoutDestination.plan.legs.length, 2)
  const snapshot = plan => plan.items.map(item => [item.itemId, item.startAt, item.endAt])
  assert.deepEqual(snapshot(withDestination.plan), snapshot(withoutDestination.plan))
  assert.equal(legFor(withDestination.plan, withDestination.demands[2].demandId).toItemId, null)
  assert.equal(legFor(withDestination.plan, withDestination.demands[2].demandId).fromItemId, null)
})

test('an earlier carrier arriving after the next carrier departure stays a hard conflict', () => {
  const request = mainRequest()
  request.transportDemands[0].serviceDate = AT('02')
  request.transportDemands[1].serviceDate = AT('02')
  const { plan, demands } = run(request, {
    museum: { quotes: [quoteA(20000, { departureDate: AT('02'), departureTime: '08:00', arrivalDate: AT('02'), arrivalTime: '20:00' })] },
    park: { quotes: [quoteB(30000, { departureDate: AT('02'), departureTime: '15:00', arrivalDate: AT('02'), arrivalTime: '18:00', quoteId: 'juhe:2026-10-02:K7005' })] },
    destination: { quotes: [quoteC()] }
  })
  const conflicts = plan.validation.errors.filter(error => error.code === 'TRANSPORT_LEG_SEQUENCE_CONFLICT')
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].legId, legFor(plan, demands[1].demandId).legId)
  assert.equal(plan.feasibility, 'blocked')
  // 后一班车的固定发车时刻必须保持原值，不允许自动换车。
  assert.equal(legFor(plan, demands[1].demandId).departureAt, new Date(`${AT('02')}T15:00:00+08:00`).toISOString())
  assert.equal(legFor(plan, demands[0].demandId).arrivalAt, new Date(`${AT('02')}T20:00:00+08:00`).toISOString())
})

test('a time lock conflicting with the carrier arrival blocks the plan', () => {
  const request = mainRequest()
  request.locks = [{ lockId: 'early-museum', targetId: 'museum', kind: 'time', value: { startAt: `${AT('02')}T09:00:00+08:00`, endAt: `${AT('02')}T11:00:00+08:00` }, source: 'user', createdAt: '2026-09-17T08:00:00+08:00' }]
  const { plan, demands } = run(request)
  assert.equal(plan.feasibility, 'blocked')
  assert.ok(plan.validation.errors.some(error => error.code === 'TRANSPORT_ARRIVAL_TARGET_CONFLICT' && error.itemId === 'museum'))
  assert.ok(plan.validation.errors.some(error => error.code === 'LOCKED_TIME_CONFLICT'))
  assert.equal(itemFor(plan, 'museum').startAt, new Date(`${AT('02')}T09:00:00+08:00`).toISOString())
  assert.ok(legFor(plan, demands[0].demandId))
})

test('duplicate arrival constraints on one target defer the activity exactly once', () => {
  const request = mainRequest()
  const demandId = JSON.stringify(['origin', 'item:museum'])
  const legs = [
    { legId: 'leg:first', demandId, mode: 'train', departureAt: `${AT('02')}T06:00:00+08:00`, arrivalAt: `${AT('02')}T12:00:00+08:00` },
    { legId: 'leg:second', demandId, mode: 'train', departureAt: `${AT('02')}T13:00:00+08:00`, arrivalAt: `${AT('02')}T18:00:00+08:00` }
  ]
  const constraints = arrivalConstraints(request, legs)
  assert.equal(constraints.constraints.length, 1)
  assert.equal(constraints.constraints[0].arrivalAt, Date.parse(`${AT('02')}T18:00:00+08:00`))
  assert.deepEqual(constraints.constraints[0].legIds, ['leg:first', 'leg:second'])
  assert.equal(constraints.diagnostics.length, 1)
  assert.equal(constraints.diagnostics[0].code, 'TRANSPORT_ARRIVAL_TARGET_DUPLICATED')
  const constrained = arrivalConstrainedRequest(request, legs)
  assert.equal(constrained.menuItems[0].preferredWindow.startAt, new Date(`${AT('02')}T18:00:00+08:00`).toISOString())
  assert.equal(request.menuItems[0].preferredWindow.startAt, AT('02T08:00:00+08:00'))
})

test('a cross-midnight carrier keeps its real arrival date', () => {
  const { plan, demands } = run(mainRequest(), {
    museum: { quotes: [quoteA(20000, { departureDate: AT('02'), departureTime: '22:00', arrivalDate: AT('03'), arrivalTime: '03:00' })] },
    park: { quotes: [quoteB()] },
    destination: { quotes: [quoteC()] }
  })
  const leg = legFor(plan, demands[0].demandId)
  assert.equal(leg.serviceDate, AT('02'))
  assert.equal(leg.departureAt, '2026-10-02T14:00:00.000Z')
  assert.equal(leg.arrivalAt, '2026-10-02T19:00:00.000Z')
  assert.ok(Date.parse(itemFor(plan, 'museum').startAt) >= Date.parse(leg.arrivalAt))
  assert.equal(plan.validation.errors.length, 0)
})

test('plannedOrder is inherited from the base plan and never re-optimized', () => {
  const request = mainRequest()
  const { base, plan } = run(request)
  assert.deepEqual(plan.plannedOrder, base.plannedOrder)
  assert.deepEqual(plan.originalOrder, base.originalOrder)
  assert.deepEqual(plan.orderChanges, base.orderChanges)
  assert.ok(plan.validation.assumptions.some(row => row.code === 'TRANSPORT_ARRIVAL_LOWER_BOUND'))
})

// ---------------------------------------------------------------- 多段费用

test('multi segment adult tickets sum into a fully known transport subtotal', () => {
  const { plan } = run()
  const row = transportRow(plan)
  assert.equal(plan.costSummary.knownSubtotalMinor, 180000)
  assert.equal(plan.costSummary.knownTotal, 180000)
  assert.equal(row.amountMinor, 180000)
  assert.equal(row.status, 'known')
  assert.equal(plan.costSummary.unknownCategories.includes('transport'), false)
  assert.equal(plan.costSummary.budgetComparison.status, 'known_within_partial_scope')
})

test('per_person segments with children keep an adult-only subtotal and sum the range', () => {
  const request = mainRequest()
  request.travelers = { adults: 2, children: [8] }
  const { plan } = run(request)
  assert.equal(plan.costSummary.knownSubtotalMinor, 180000)
  // 儿童价未知：不得冒充精确总价，只给保守上界。
  assert.equal(plan.costSummary.knownTotal, null)
  assert.equal(transportRow(plan).status, 'partial')
  assert.ok(plan.costSummary.unknownCategories.includes('transport'))
  assert.equal(plan.costSummary.estimatedRange.minMinor, 180000)
  assert.equal(plan.costSummary.estimatedRange.maxMinor, 270000)
  assert.equal(plan.costSummary.estimatedRange.basis, 'children_price_unknown_upper_bound_assumes_adult_price')
})

test('a segment with an unknown amount is never counted as zero', () => {
  const { plan } = run(mainRequest(), {
    museum: { quotes: [quoteA()] },
    park: { quotes: [quoteB()] },
    destination: { quotes: [quoteC(null)] }
  })
  assert.equal(plan.legs.length, 3)
  assert.equal(plan.costSummary.knownSubtotalMinor, 100000)
  assert.equal(plan.costSummary.knownTotal, null)
  assert.equal(transportRow(plan).status, 'partial')
  // 区间不能只按已知段求和，否则等于把未知段当 0。
  assert.equal(plan.costSummary.estimatedRange, null)
  assert.notEqual(plan.costSummary.knownSubtotalMinor, 0)
})

test('a missing explicit demand keeps the known subtotal but never full knowledge', () => {
  const { plan, demands } = run(mainRequest(), {
    museum: { quotes: [quoteA()] },
    park: { quotes: [quoteB()] },
    destination: { status: 'budget_exhausted' }
  })
  assert.equal(plan.legs.length, 2)
  assert.equal(plan.costSummary.knownSubtotalMinor, 100000)
  assert.equal(plan.costSummary.knownTotal, null)
  assert.equal(transportRow(plan).status, 'partial')
  assert.equal(transportRow(plan).amountMinor, 100000)
  assert.equal(plan.costSummary.budgetComparison.status !== 'hard_exceeded', true)
  // 额度用尽必须与「无票」「未查询」区分开，且不是 blocked。
  const row = plan.validation.warnings.find(warning => warning.code === 'TRANSPORT_QUERY_BUDGET_EXHAUSTED' && warning.demandId === demands[2].demandId)
  assert.ok(row)
  assert.equal(plan.feasibility, 'needs_review')
})

test('a foreign currency segment is never presented as comparable with the budget', () => {
  const { plan } = run(mainRequest(), {
    museum: { quotes: [quoteA()] },
    park: { quotes: [quoteB(30000, { currency: 'USD' })] },
    destination: { quotes: [quoteC()] }
  })
  assert.equal(plan.costSummary.budgetComparison.status, 'unknown_currency')
  assert.equal(plan.costSummary.budgetComparison.knownMinor, null)
  assert.ok(plan.costSummary.budgetComparison.quoteCurrencies.includes('USD'))
  assert.equal(plan.feasibility, 'needs_review')
})

test('the known lower bound still triggers a strict budget block when every segment is comparable', () => {
  const request = mainRequest()
  request.budget = { amountMinor: 100000, currency: 'CNY', basis: 'party', includedCategories: ['transport'], strict: true }
  const { plan } = run(request)
  assert.equal(plan.costSummary.budgetComparison.status, 'hard_exceeded')
  assert.ok(plan.validation.errors.some(error => error.code === 'BUDGET_EXCEEDED'))
  assert.equal(plan.feasibility, 'blocked')
})

// ---------------------------------------------------------------- B3-4-R1：destination carrier 展示语义

test('a destination carrier reports station transfer instead of placement unconfirmed', () => {
  const { plan, demands } = run()
  // mainRequest 的第三段没有 targetMenuItemId —— 按 B3-1-R1 冻结语义明确表示 endDestination。
  const destinationDemandId = demands[2].demandId
  assert.equal(destinationDemandId, JSON.stringify(['item:park', 'destination']))
  const destinationLeg = legFor(plan, destinationDemandId)
  assert.ok(destinationLeg)
  assert.equal(destinationLeg.toItemId, null)

  const stationWarnings = plan.validation.warnings.filter(row => row.code === 'STATION_TRANSFERS_UNCONFIRMED')
  // 三个 selected 段（两个 item target + 一个 endDestination）都必须报 station transfer。
  assert.equal(stationWarnings.length, 3)
  assert.equal(plan.validation.warnings.some(row => row.code === 'TRANSPORT_PLACEMENT_UNCONFIRMED'), false)
  for (const demand of demands) {
    const leg = legFor(plan, demand.demandId)
    assert.ok(leg, demand.demandId)
    const warning = stationWarnings.find(row => row.legId === leg.legId)
    assert.ok(warning, `段 ${demand.demandId} 缺少 station transfer 警告`)
    assert.equal(warning.demandId, demand.demandId)
  }
  // 合法 destination carrier 不构成 blocked，只是需要人工确认车站接驳。
  assert.equal(plan.validation.errors.length, 0)
  assert.equal(plan.feasibility, 'needs_review')
})

test('a selected segment without any server demandId never claims a station placement', () => {
  // 防御性用例：没有 server-owned demandId 的段不会建立 selection，因此不产生任何交通结论。
  const { plan } = run(mainRequest(), { museum: { quotes: [] }, park: { quotes: [quoteB()] }, destination: { quotes: [quoteC()] } })
  const codes = plan.validation.warnings.map(row => row.code)
  assert.equal(codes.includes('TRANSPORT_PLACEMENT_UNCONFIRMED'), false)
  assert.equal(codes.filter(code => code === 'STATION_TRANSFERS_UNCONFIRMED').length, 2)
  assert.ok(codes.includes('TRANSPORT_NO_QUOTES'))
})

// ---------------------------------------------------------------- legacy 兼容

test('a legacy single transportDemand keeps its leg and gains a server-owned demandId', () => {
  const request = mainRequest()
  delete request.transportDemands
  request.menuItems = [menuItem('museum', '沈阳故宫', 0, 41.8, 123.43, '210100')]
  request.transportDemand = { mode: 'train', serviceDate: AT('02'), departure: { name: '长春', code: 'CCT' }, arrival: { name: '沈阳', code: 'SYT' }, targetMenuItemId: 'museum' }
  const plan = buildRulePlan({ request, transportQuotes: [quoteA()], now: () => NOW, planId: 'plan-legacy' })
  assert.equal(plan.legs.length, 1)
  assert.equal(plan.legs[0].toItemId, 'museum')
  assert.equal(plan.legs[0].demandId, routeDemands(plan)[0].demandId)
  // legacy 单段保持 provider 原始 quoteId（不追加作用域后缀），但 selected quote
  // 必须与它的 carrier leg 同源：同一个 server-owned demandId。
  assert.equal(plan.quotes.length, 1)
  assert.equal(plan.quotes[0].quoteId, 'juhe:2026-10-02:K7001')
  assert.equal(plan.quotes[0].quoteId.includes('@'), false)
  assert.equal(plan.quotes[0].demandId, plan.legs[0].demandId)
  assert.equal(plan.legs[0].quoteRef, plan.quotes[0].quoteId)
  assert.equal(plan.validation.errors.length, 0)
  assert.ok(Date.parse(itemFor(plan, 'museum').startAt) >= Date.parse(plan.legs[0].arrivalAt))
})

test('a legacy single transportDemand without a target keeps no arrival constraint', () => {
  const request = mainRequest()
  delete request.transportDemands
  request.menuItems = [menuItem('museum', '沈阳故宫', 0, 41.8, 123.43, '210100')]
  request.transportDemand = { mode: 'train', serviceDate: AT('02'), departure: { name: '长春', code: 'CCT' }, arrival: { name: '沈阳', code: 'SYT' } }
  const plan = buildRulePlan({ request, transportQuotes: [quoteA()], now: () => NOW, planId: 'plan-legacy-destination' })
  assert.equal(plan.legs.length, 1)
  assert.equal(plan.legs[0].toItemId, null)
  // 缺省 targetMenuItemId 表示“到 endDestination”，对应的是最后一段 route demand。
  assert.equal(plan.legs[0].demandId, routeDemands(plan)[1].demandId)
  // 没有目标活动时同样要求 selected quote 与 leg 同源。
  assert.equal(plan.quotes.length, 1)
  assert.equal(plan.quotes[0].quoteId, 'juhe:2026-10-02:K7001')
  assert.equal(plan.quotes[0].demandId, plan.legs[0].demandId)
  assert.equal(itemFor(plan, 'museum').startAt, new Date(`${AT('02')}T08:00:00+08:00`).toISOString())
})

// ---------------------------------------------------------------- 段级身份（B3-3-R1）

test('a scoped plan quote id is deterministic, readable and demand specific', () => {
  const museum = JSON.stringify(['origin', 'item:museum'])
  const park = JSON.stringify(['item:museum', 'item:park'])
  // 字面量钉死格式：provider raw quoteId 作为可读前缀保留，作用域后缀来自 demand 两端 stop id。
  assert.equal(scopedTransportQuoteId('juhe:2026-10-02:K7001', museum), 'juhe:2026-10-02:K7001@origin>item:museum')
  // deterministic：同样输入重复执行得到同一身份。
  assert.equal(scopedTransportQuoteId('juhe:2026-10-02:K7001', museum), scopedTransportQuoteId('juhe:2026-10-02:K7001', museum))
  // 不同 demand 一定得到不同身份。
  assert.notEqual(scopedTransportQuoteId('juhe:2026-10-02:K7001', museum), scopedTransportQuoteId('juhe:2026-10-02:K7001', park))
  // demandId 不可用时退化为 provider 原始身份（legacy 单段路径）。
  assert.equal(scopedTransportQuoteId('juhe:2026-10-02:K7001', null), 'juhe:2026-10-02:K7001')
  assert.equal(scopedTransportQuoteId('', museum), null)
})

test('two demands sharing one raw provider quoteId both survive with distinct plan quote ids', () => {
  const sharedRawId = 'juhe:2026-10-02:K7001'
  // Juhe quoteId 只由日期 + 车次组成：同一车次被两个 demand 查询时 raw 身份完全相同。
  const { plan, demands } = run(mainRequest(), {
    museum: { quotes: [quoteA(20000, { quoteId: sharedRawId })] },
    park: { quotes: [quoteB(30000, { quoteId: sharedRawId })] }
  })
  const museumLeg = legFor(plan, demands[0].demandId)
  const parkLeg = legFor(plan, demands[1].demandId)
  // 两段都必须保留：不得因为 raw quoteId 相同而静默丢弃后一段。
  assert.ok(museumLeg, 'A 段不得被去重丢弃')
  assert.ok(parkLeg, 'B 段不得被去重丢弃')
  assert.equal(plan.legs.length, 2)
  assert.notEqual(museumLeg.quoteRef, parkLeg.quoteRef)
  // 两段都留在 plan.quotes 中，且各自带着自己的 raw 前缀。
  assert.equal(plan.quotes.length, 2)
  assert.equal(plan.quotes.filter(quote => quote.quoteId.startsWith(`${sharedRawId}@`)).length, 2)
  for (const [leg, demand] of [[museumLeg, demands[0]], [parkLeg, demands[1]]]) {
    const matches = plan.quotes.filter(quote => quote.quoteId === leg.quoteRef)
    assert.equal(matches.length, 1, 'quoteRef 必须唯一解析到一条 plan quote')
    assert.equal(matches[0].demandId, demand.demandId)
    assert.equal(leg.demandId, demand.demandId)
  }
  // 交叉约束成立时方案不得因此报错。
  assert.equal(plan.validation.errors.length, 0)
})

test('scoped identity never changes within-pool candidate ordering', () => {
  // 两个候选金额与 fetchedAt 完全相同，只能由 raw quoteId 决胜。
  // 这里刻意选一组「raw 下较短者在前、scoped 后缀下顺序会翻转」的 id
  // （前缀相等，差异位是 '-' 与 '@' 的排序关系），
  // 因此本用例能真正锁住「候选排序基准是 provider 原始身份，不是 scoped 身份」。
  const museumDemandId = JSON.stringify(['origin', 'item:museum'])
  const shorterId = 'juhe-train-817:2026-10-02:K7001'
  const suffixedId = 'juhe-train-817:2026-10-02:K7001-2'
  assert.ok(shorterId.localeCompare(suffixedId) < 0)
  assert.ok(scoped(shorterId, museumDemandId).localeCompare(scoped(suffixedId, museumDemandId)) > 0)
  const { plan, demands } = run(mainRequest(), {
    museum: { quotes: [quoteA(20000, { quoteId: suffixedId }), quoteA(20000, { quoteId: shorterId })] },
    park: { quotes: [quoteB()] }
  })
  assert.equal(demands[0].demandId, museumDemandId)
  const museumLeg = legFor(plan, demands[0].demandId)
  assert.equal(museumLeg.quoteRef, scoped(shorterId, demands[0].demandId))
})

test('validatePlan rejects a leg whose demandId disagrees with its referenced quote', () => {
  const { plan } = run()
  const mismatched = structuredClone(plan)
  assert.notEqual(mismatched.legs[0].demandId, mismatched.legs[1].demandId)
  mismatched.legs[0].demandId = mismatched.legs[1].demandId
  assert.throws(() => validatePlan(mismatched), error => error.code === 'INVALID_PLAN'
    && error.fieldErrors.some(row => /demandId 不一致/.test(row.message)))
})

test('validatePlan rejects a demandId-bearing leg that references a demandId-less quote', () => {
  const { plan } = run()
  const stripped = structuredClone(plan)
  const index = stripped.quotes.findIndex(quote => quote.quoteId === stripped.legs[0].quoteRef)
  assert.ok(index >= 0)
  delete stripped.quotes[index].demandId
  assert.throws(() => validatePlan(stripped), error => error.code === 'INVALID_PLAN'
    && error.fieldErrors.some(row => /缺少 server-owned demandId/.test(row.message)))
  // 反向保护：非交通 / legacy 无 demandId 的 leg 不因缺少 quote.demandId 被牵连。
  const legacyLeg = structuredClone(plan).legs[0]
  delete legacyLeg.demandId
  assert.doesNotThrow(() => validatePlan({ ...structuredClone(plan), legs: [legacyLeg] }))
})

test('the input evidence rows are never rewritten by segment scoping', () => {
  const request = mainRequest()
  const base = basePlan(request)
  const evidence = evidenceWith(base, allSegments)
  const before = JSON.stringify(evidence)
  applyTransportEvidence({ plan: base, request, transportEvidence: evidence, now: NOW })
  assert.equal(JSON.stringify(evidence), before)
})

// ---------------------------------------------------------------- 契约与纯度

test('plan schema rejects a malformed demandId on quotes and legs', () => {
  const { plan } = run()
  const badQuote = structuredClone(plan)
  badQuote.quotes[0].demandId = ''
  assert.throws(() => validatePlan(badQuote), { code: 'INVALID_PLAN' })
  const badQuoteType = structuredClone(plan)
  badQuoteType.quotes[0].demandId = 42
  assert.throws(() => validatePlan(badQuoteType), { code: 'INVALID_PLAN' })
  const badLeg = structuredClone(plan)
  badLeg.legs[0].demandId = '   '
  assert.throws(() => validatePlan(badLeg), { code: 'INVALID_PLAN' })
  const badLegType = structuredClone(plan)
  badLegType.legs[0].demandId = null
  assert.throws(() => validatePlan(badLegType), { code: 'INVALID_PLAN' })
})

test('plan schema still rejects a dangling quoteRef and a duplicated leg id', () => {
  const { plan } = run()
  const dangling = structuredClone(plan)
  dangling.legs[0].quoteRef = 'missing-quote'
  assert.throws(() => validatePlan(dangling), { code: 'INVALID_PLAN' })
  const duplicated = structuredClone(plan)
  duplicated.legs[1].legId = duplicated.legs[0].legId
  assert.throws(() => validatePlan(duplicated), { code: 'INVALID_PLAN' })
})

test('validateQuote and validateLeg accept an omitted demandId but reject an empty one', () => {
  const legacyLeg = { legId: 'leg:x', from: { provider: 'juhe', providerPlaceId: 'CCT' }, to: { provider: 'juhe', providerPlaceId: 'SYT' },
    mode: 'train', serviceDate: AT('02'), departureAt: `${AT('02')}T08:00:00+08:00`, arrivalAt: `${AT('02')}T14:00:00+08:00`,
    routeGeometry: { type: 'none' }, status: 'available' }
  assert.doesNotThrow(() => validateLeg(legacyLeg, 0))
  assert.throws(() => validateLeg({ ...legacyLeg, demandId: '' }, 0), { code: 'INVALID_PLAN' })
  const legacyQuote = { provider: 'juhe', productId: 'K7001', quoteId: 'q1', amountMinor: 100, currency: 'CNY', priceBasis: 'per_person',
    availability: 'available', fetchedAt: '2026-09-18T02:00:00.000Z', supplierExpiresAt: null, refreshAfter: null, taxIncluded: null,
    environment: 'test', bookingTarget: { kind: 'manual' },
    provenance: { sourceType: 'live', provider: 'juhe', fetchedAt: '2026-09-18T02:00:00.000Z' } }
  assert.doesNotThrow(() => validateQuote(legacyQuote))
  assert.throws(() => validateQuote({ ...legacyQuote, demandId: '' }), { code: 'INVALID_PLAN' })
  assert.throws(() => validateQuote({ ...legacyQuote, demandId: 7 }), { code: 'INVALID_PLAN' })
})

test('the input base plan and request object are never mutated', () => {
  const request = mainRequest()
  const base = basePlan(request)
  const before = JSON.stringify(base)
  const beforeRequest = JSON.stringify(request)
  applyTransportEvidence({ plan: base, request, transportEvidence: evidenceWith(base, allSegments), now: NOW })
  assert.equal(JSON.stringify(base), before)
  assert.equal(JSON.stringify(request), beforeRequest)
  assert.equal(base.legs.length, 0)
  assert.equal(base.quotes.length, 0)
})

test('the same evidence produces a deterministic plan', () => {
  const request = mainRequest()
  const base = basePlan(request)
  const evidence = evidenceWith(base, allSegments)
  const first = applyTransportEvidence({ plan: base, request, transportEvidence: evidence, now: NOW })
  const second = applyTransportEvidence({ plan: base, request, transportEvidence: evidence, now: NOW })
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test('arrivalErrors reports one conflict per offending target', () => {
  const request = mainRequest()
  // 固定时间锁把两个地点钉在各自 carrier 到达之前：这是唯一会产生到达冲突的真实场景。
  request.locks = [
    { lockId: 'museum-lock', targetId: 'museum', kind: 'time', value: { startAt: `${AT('02')}T09:00:00+08:00`, endAt: `${AT('02')}T11:00:00+08:00` }, source: 'user', createdAt: '2026-09-17T08:00:00+08:00' },
    { lockId: 'park-lock', targetId: 'park', kind: 'time', value: { startAt: `${AT('03')}T07:00:00+08:00`, endAt: `${AT('03')}T09:00:00+08:00` }, source: 'user', createdAt: '2026-09-17T08:00:00+08:00' }
  ]
  const { plan, demands } = run(request, {
    museum: { quotes: [quoteA()] },
    park: { quotes: [quoteB(30000, { departureDate: AT('03'), departureTime: '05:00', arrivalDate: AT('03'), arrivalTime: '08:00' })] },
    destination: { status: 'no_quotes' }
  })
  const conflicts = arrivalErrors(plan)
  assert.deepEqual(conflicts.map(error => error.itemId).sort(), ['museum', 'park'])
  assert.ok(conflicts.every(error => error.code === 'TRANSPORT_ARRIVAL_TARGET_CONFLICT'))
  assert.ok(conflicts.every(error => typeof error.legId === 'string'))
  assert.equal(plan.legs.length, 2)
  assert.equal(legFor(plan, demands[2].demandId), undefined)
  assert.equal(plan.feasibility, 'blocked')
})
