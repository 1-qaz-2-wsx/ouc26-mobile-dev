// B3-2：多段 transport evidence 查询与 quota 编排测试。
// 覆盖 specs/agent-tasks/round-03-workbuddy-b3-2.md §5 的必测场景。
// 全部使用 mock/stub reader：不调用真实聚合火车或航班接口，不消耗任何真实额度。
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const {
  collectTransportEvidence,
  compatTransportStatus,
  createPlanningExecutor,
  transportEvidenceStatus,
  TRANSPORT_EVIDENCE_STATUSES,
  TRANSPORT_STATUS_COMPAT
} = require('../src/planning/pipeline')
const { routeDemands } = require('../src/planning/route-audit')
const { createPlanningService } = require('../src/planning/service')

// ---------------------------------------------------------------- fixtures

function place(providerPlaceId, name, lat, lng, adcode) {
  return { provider: 'tencent-map', providerPlaceId, name, type: 'city', coordinate: { lat, lng }, coordinateSystem: 'GCJ-02', adcode }
}

const AT = time => `2026-10-01T${time}:00+08:00`

// 三个 server route demand：origin -> item:museum / item:museum -> item:park / item:park -> destination
function routePlan() {
  return {
    inputSnapshot: {
      origin: place('origin', '长春', 43.8171, 125.3235, '220100'),
      endDestination: place('destination', '漠河', 52.9723, 124.1122, '232700'),
      startAt: AT('08:00'),
      endBy: AT('20:00'),
      menuItems: [
        { menuItemId: 'museum', placeRef: place('museum-place', '伪满皇宫博物院', 43.9, 125.35, '220100') },
        { menuItemId: 'park', placeRef: place('park-place', '太阳岛', 45.79, 126.58, '230100') }
      ]
    },
    plannedOrder: ['museum', 'park'],
    items: [
      { itemId: 'museum', startAt: AT('10:00'), endAt: AT('12:00') },
      { itemId: 'park', startAt: AT('15:00'), endAt: AT('18:00') }
    ],
    legs: []
  }
}

function demands() {
  return routeDemands(routePlan())
}

function segment(targetMenuItemId, serviceDate = '2026-10-02') {
  return {
    mode: 'train',
    serviceDate,
    departure: { name: '长春', code: 'CCT' },
    arrival: { name: '哈尔滨', code: 'HGH' },
    ...(targetMenuItemId === undefined ? {} : { targetMenuItemId })
  }
}

function trainQuote(serviceNo = 'K1393', amountMinor = 14400) {
  return {
    provider: 'juhe', mode: 'train', productId: serviceNo, serviceNo, quoteId: `juhe-train-817:2026-10-02:${serviceNo}`,
    from: '长春', to: '哈尔滨', fromCode: 'CCT', toCode: 'HGH',
    departureDate: '2026-10-02', departureTime: '18:53', arrivalDate: '2026-10-03', arrivalTime: '03:23',
    amountMinor, currency: 'CNY', priceBasis: 'per_person', availability: 'available', environment: 'test',
    fetchedAt: '2026-09-18T02:00:00.000Z',
    provenance: { sourceType: 'live', provider: 'juhe', sourceRef: '817', fetchedAt: '2026-09-18T02:00:00.000Z', environment: 'test' }
  }
}

// 计数 + 可控返回/抛错的 reader stub。返回 Error 即抛错。
function stubReader(behaviour) {
  const calls = []
  return {
    calls,
    async fetch({ demand, signal }) {
      calls.push(demand)
      const next = typeof behaviour === 'function' ? behaviour(calls.length, demand, signal) : behaviour
      if (next instanceof Error) throw next
      return next === undefined ? { status: 'unknown', quotes: [] } : structuredClone(next)
    }
  }
}

const run = (transportDemands, reader, signal = new AbortController().signal) =>
  collectTransportEvidence({ transportDemands, demands: demands(), evidenceForTransport: reader && reader.fetch, signal })

// ---------------------------------------------------------------- 逐段查询与 demandId

test('two bound train segments query the reader independently and keep their own demandId', async () => {
  const reader = stubReader({ status: 'available', quotes: [trainQuote()] })
  const requested = [segment('museum'), segment('park')]
  const evidence = await run(requested, reader)
  assert.equal(reader.calls.length, 2)
  assert.deepEqual(evidence.map(entry => entry.status), ['queried', 'queried'])
  assert.deepEqual(evidence.map(entry => entry.demandId), [demands()[0].demandId, demands()[1].demandId])
  assert.notEqual(evidence[0].demandId, evidence[1].demandId)
  // reader 收到的是 demand 克隆，不是请求对象本身。
  assert.notEqual(reader.calls[0], requested[0])
  assert.deepEqual(reader.calls[0], requested[0])
  assert.equal(evidence[0].targetStopId, 'item:museum')
  assert.equal(evidence[1].targetStopId, 'item:park')
})

test('every returned quote carries the demandId of its own segment and never shares one pool', async () => {
  const reader = stubReader((call) => ({ status: 'available', quotes: [trainQuote(call === 1 ? 'K1393' : 'G1234')] }))
  const evidence = await run([segment('museum'), segment('park')], reader)
  const quoteDemandIds = evidence.flatMap(entry => entry.quotes.map(quote => quote.demandId))
  assert.equal(quoteDemandIds.length, 2)
  assert.deepEqual(quoteDemandIds, [evidence[0].demandId, evidence[1].demandId])
  assert.equal(new Set(quoteDemandIds).size, 2)
  assert.ok(evidence.every(entry => entry.quotes.every(quote => quote.demandId === entry.demandId)))
})

test('a destination segment binds to the final item -> destination route demand', async () => {
  const reader = stubReader({ status: 'available', quotes: [trainQuote()] })
  const evidence = await run([segment(undefined, '2026-10-03')], reader)
  assert.equal(reader.calls.length, 1)
  assert.equal(evidence[0].demandId, demands()[2].demandId)
  assert.equal(evidence[0].targetStopId, 'destination')
  assert.equal(evidence[0].status, 'queried')
})

// ---------------------------------------------------------------- 单段失败不抹掉其它段

test('a successful segment is preserved when another segment returns no_quotes', async () => {
  const reader = stubReader(call => (call === 1 ? { status: 'available', quotes: [trainQuote()] } : { status: 'unknown', quotes: [] }))
  const evidence = await run([segment('museum'), segment('park')], reader)
  assert.deepEqual(evidence.map(entry => entry.status), ['queried', 'no_quotes'])
  assert.equal(evidence[0].quotes.length, 1)
  assert.equal(evidence[0].quotes[0].demandId, evidence[0].demandId)
  assert.deepEqual(evidence[1].quotes, [])
  // no_quotes 不得被解释成额度或配置问题。
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'unknown')
})

test('a successful segment is preserved when another segment is unavailable', async () => {
  const reader = stubReader(call => (call === 1
    ? { status: 'available', quotes: [trainQuote()] }
    : Object.assign(new Error('火车供应商网络请求失败'), { code: 'PROVIDER_NETWORK_ERROR' })))
  const evidence = await run([segment('museum'), segment('park')], reader)
  assert.deepEqual(evidence.map(entry => entry.status), ['queried', 'unavailable'])
  assert.equal(evidence[0].quotes.length, 1)
  assert.deepEqual(evidence[1].quotes, [])
  // provider 失败只保留机器 code，不保留原始 message。
  assert.deepEqual(evidence[1].diagnostic, { code: 'PROVIDER_NETWORK_ERROR' })
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'unavailable')
})

// ---------------------------------------------------------------- quota

test('when the provider budget is spent the remaining segments are marked budget_exhausted without fetching', async () => {
  const reader = stubReader(call => {
    if (call > 1) throw new Error('must not fetch after the budget is spent')
    return { status: 'budget_exhausted', quotes: [] }
  })
  const evidence = await run([segment('museum'), segment('park')], reader)
  assert.equal(reader.calls.length, 1)
  assert.deepEqual(evidence.map(entry => entry.status), ['budget_exhausted', 'budget_exhausted'])
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'budget_exhausted')
})

test('a provider session limit stops later segments and is never reported as no tickets', async () => {
  const reader = stubReader(call => {
    if (call > 1) throw new Error('must not fetch after the session limit')
    return Object.assign(new Error('本轮真实查询次数已用完'), { code: 'PROVIDER_SESSION_LIMIT' })
  })
  const evidence = await run([segment('museum'), segment('park')], reader)
  assert.equal(reader.calls.length, 1)
  assert.deepEqual(evidence.map(entry => entry.status), ['budget_exhausted', 'budget_exhausted'])
  assert.deepEqual(evidence[0].diagnostic, { code: 'PROVIDER_SESSION_LIMIT' })
})

test('a provider session limit stays distinct from a plain no_quotes result', async () => {
  const reader = stubReader(call => (call === 1 ? { status: 'unknown', quotes: [] } : { status: 'budget_exhausted', quotes: [] }))
  const evidence = await run([segment('museum'), segment('park')], reader)
  assert.equal(reader.calls.length, 2)
  assert.deepEqual(evidence.map(entry => entry.status), ['no_quotes', 'budget_exhausted'])
  // 额度用尽的段绝不能被聚合成“查询无结果”。
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'budget_exhausted')
})

test('out_of_window and not_configured keep their own per-segment status', async () => {
  const reader = stubReader(call => (call === 1 ? { status: 'out_of_window', quotes: [] } : { status: 'not_configured', quotes: [] }))
  const evidence = await run([segment('museum'), segment('park')], reader)
  assert.deepEqual(evidence.map(entry => entry.status), ['out_of_window', 'not_configured'])
  assert.deepEqual(evidence.map(entry => entry.quotes), [[], []])
  // 两者都不是“无票”。
  assert.notEqual(evidence[0].status, 'no_quotes')
  assert.notEqual(evidence[1].status, 'no_quotes')
  // 按严重度取 not_configured（配置缺失优先暴露），而不是 out_of_window。
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'not_configured')
})

// ---------------------------------------------------------------- 不查询的分支

test('a flight segment stays disabled and performs zero fetch', async () => {
  const reader = stubReader({ status: 'available', quotes: [trainQuote()] })
  const evidence = await run([{ ...segment('museum'), mode: 'flight' }, segment('park')], reader)
  assert.equal(reader.calls.length, 1)
  assert.deepEqual(evidence.map(entry => entry.status), ['disabled', 'queried'])
  assert.equal(evidence[0].mode, 'flight')
  assert.deepEqual(evidence[0].quotes, [])
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'disabled')
})

test('an unbound segment is reported as unbound and is never queried', async () => {
  const reader = stubReader({ status: 'available', quotes: [trainQuote()] })
  const evidence = await run([segment('not-in-plan')], reader)
  assert.equal(reader.calls.length, 0)
  assert.equal(evidence[0].status, 'unbound')
  assert.equal(evidence[0].demandId, null)
  assert.equal(evidence[0].targetStopId, 'item:not-in-plan')
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'not_queried')
})

test('an ambiguous target is reported as ambiguous and is never queried', async () => {
  const reader = stubReader({ status: 'available', quotes: [trainQuote()] })
  const plan = routePlan()
  const duplicated = [...routeDemands(plan), { ...routeDemands(plan)[1] }]
  const evidence = await collectTransportEvidence({ transportDemands: [segment('park')], demands: duplicated, evidenceForTransport: reader.fetch, signal: new AbortController().signal })
  assert.equal(reader.calls.length, 0)
  assert.equal(evidence[0].status, 'ambiguous')
  assert.equal(evidence[0].demandId, null)
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'not_queried')
})

test('an already cancelled run queries nothing and marks every segment cancelled', async () => {
  const reader = stubReader({ status: 'available', quotes: [trainQuote()] })
  const controller = new AbortController()
  controller.abort()
  const evidence = await run([segment('museum'), segment('park')], reader, controller.signal)
  assert.equal(reader.calls.length, 0)
  assert.deepEqual(evidence.map(entry => entry.status), ['cancelled', 'cancelled'])
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'not_queried')
})

test('cancellation during a query stops every later segment from fetching', async () => {
  const controller = new AbortController()
  const reader = stubReader((call, demand, signal) => {
    signal.throwIfAborted()
    controller.abort()
    return Object.assign(new Error('aborted'), { name: 'AbortError' })
  })
  const evidence = await run([segment('museum'), segment('park')], reader, controller.signal)
  assert.equal(reader.calls.length, 1)
  assert.deepEqual(evidence.map(entry => entry.status), ['cancelled', 'cancelled'])
})

test('without a reader every bound segment stays not_queried instead of pretending to be empty', async () => {
  const evidence = await collectTransportEvidence({ transportDemands: [segment('museum')], demands: demands(), evidenceForTransport: undefined, signal: new AbortController().signal })
  assert.deepEqual(evidence.map(entry => entry.status), ['not_queried'])
  assert.deepEqual(evidence.map(entry => entry.quotes), [[]])
})

// ---------------------------------------------------------------- 旧单数兼容与 executor 集成

const OVERNIGHT_QUOTE = {
  provider: 'juhe', providerId: '817', providerName: '聚合数据·火车订票查询', environment: 'test', mode: 'train',
  productId: 'K1393', serviceNo: 'K1393', quoteId: 'juhe-train-817:2026-09-16:K1393',
  from: '长春', to: '南岔', fromCode: 'CCT', toCode: 'NCB',
  departureDate: '2026-09-16', departureTime: '18:53', arrivalDate: '2026-09-17', arrivalTime: '03:23',
  amountMinor: 14400, currency: 'CNY', priceBasis: 'per_person', taxIncluded: null, availability: 'available',
  fetchedAt: '2026-09-15T10:17:53.110Z', supplierExpiresAt: null,
  bookingTarget: { kind: 'manual', label: '请在官方平台复核后预订' },
  provenance: { sourceType: 'live', provider: 'juhe', sourceRef: '817', fetchedAt: '2026-09-15T10:17:53.110Z', validForDate: '2026-09-16', fieldScope: ['schedule', 'seat_options', 'reference_price', 'availability'], environment: 'test' }
}

function item(id, name, inputOrder) {
  return {
    menuItemId: id,
    occurrenceId: `${id}-occurrence`,
    placeRef: place(id, name, 43.82, 125.32, '220100'),
    role: 'must_visit',
    inputOrder,
    required: true,
    stayRequirement: 'must_visit',
    visitDuration: { minutes: 120 },
    preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-18T20:00:00+08:00' }
  }
}

function request(overrides = {}) {
  return {
    schemaVersion: 'real-travel-plan-request.v1',
    clientRequestId: 'b3-2-evidence',
    origin: place('origin', '长春站', 43.8171, 125.3235, '220100'),
    endDestination: place('destination', '哈尔滨站', 45.7733, 126.6572, '230100'),
    startAt: '2026-09-16T08:00:00+08:00',
    endBy: '2026-09-18T23:00:00+08:00',
    timezone: 'Asia/Shanghai',
    travelers: { adults: 2, children: [8] },
    budget: { amountMinor: 500000, currency: 'CNY', basis: 'party', includedCategories: ['transport', 'lodging'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true, maxTransfers: 1, seatType: 'hard_sleeper', cabin: 'economy' },
    lodgingPreferences: { rooms: 1, roomType: 'standard', bedType: 'double', breakfast: false, required: false },
    interests: ['人文'],
    pace: 'balanced',
    menuItems: [item('a', '目标地点', 0)],
    optimizeOrder: true,
    locks: [],
    confirmedConstraints: [],
    sourceInput: { type: 'manual_menu' },
    ...overrides
  }
}

function executorWith(reader) {
  return createPlanningExecutor({ evidenceForTransport: reader && reader.fetch, now: () => Date.parse('2026-09-15T10:00:00Z') })
}

test('a legacy single transportDemand still runs one compatible query and is labelled with the destination demandId', async () => {
  const reader = stubReader({ status: 'available', quotes: [OVERNIGHT_QUOTE] })
  const legacy = { mode: 'train', serviceDate: '2026-09-16', departure: { name: '长春', code: 'CCT' }, arrival: { name: '南岔', code: 'NCB' } }
  const result = await executorWith(reader)({ request: request({ transportDemand: legacy }), job: { id: 'legacy' }, signal: new AbortController().signal })
  assert.equal(reader.calls.length, 1)
  assert.equal(result.transportStatus, 'available')
  assert.equal(result.transportEvidence.length, 1)
  // 旧单数兼容：报价仍然进入 plan，carrier leg 行为不变。
  assert.equal(result.plan.quotes.length, 1)
  assert.equal(result.plan.legs.length, 1)
  assert.equal(result.transportEvidence[0].status, 'queried')
  assert.equal(result.transportEvidence[0].targetStopId, 'destination')
  assert.equal(result.transportEvidence[0].demandId, routeDemands(result.plan)[1].demandId)
  assert.equal(result.transportEvidence[0].quotes[0].demandId, result.transportEvidence[0].demandId)
})

test('a request without any transport demand performs zero provider fetch', async () => {
  const reader = stubReader({ status: 'available', quotes: [OVERNIGHT_QUOTE] })
  const result = await executorWith(reader)({ request: request(), job: { id: 'no-demand' }, signal: new AbortController().signal })
  assert.equal(reader.calls.length, 0)
  assert.deepEqual(result.transportEvidence, [])
  assert.equal(result.transportStatus, 'not_queried')
  assert.equal(result.plan.legs.length, 0)
})

test('multi segment evidence is recorded per demandId and enters the plan as selected quotes and carrier legs', async () => {
  // 候选报价必须与这一段自己的站点、日期一致，否则 selector 会如实拒绝。
  const reader = stubReader({ status: 'available', quotes: [OVERNIGHT_QUOTE] })
  const service = createPlanningService({ evidenceForTransport: reader.fetch })
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: 'multi-evidence', request: request({
    transportDemands: [{
      mode: 'train', serviceDate: '2026-09-16', departure: { name: '长春', code: 'CCT' }, arrival: { name: '南岔', code: 'NCB' }, targetMenuItemId: 'a'
    }]
  }) })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(reader.calls.length, 1)
  assert.equal(done.result.transportEvidence.length, 1)
  assert.equal(done.result.transportEvidence[0].demandId, routeDemands(done.result.plan)[0].demandId)
  assert.equal(done.result.transportEvidence[0].status, 'queried')
  // B3-4 起多段 evidence 正式接回主链：selected quote / carrier leg 进入 plan（B3-2 时期的
  // 「plan 保持 quote free」临时约束已由 round-03-workbuddy-b3-4.md §9.1 取代）。
  assert.equal(done.result.plan.quotes.length, 1)
  assert.equal(done.result.plan.legs.length, 1)
  // quote 与 carrier leg 必须与同一 server-owned demandId 同源。
  assert.equal(done.result.plan.quotes[0].demandId, done.result.transportEvidence[0].demandId)
  assert.equal(done.result.plan.legs[0].demandId, done.result.plan.quotes[0].demandId)
  assert.equal(done.result.plan.legs[0].quoteRef, done.result.plan.quotes[0].quoteId)
  // 兼容字段仍必须是前端受控取值。
  assert.equal(done.result.transportStatus, 'available')
})

// ---------------------------------------------------------------- 兼容字段不得泄露

test('the compat transportStatus stays inside the controlled frontend vocabulary', () => {
  // 前端受控表：mysummerapp/utils/real-planning.js 的 TRANSPORT_STATUS。
  const frontend = readFileSync(join(__dirname, '..', '..', 'mysummerapp', 'utils', 'real-planning.js'), 'utf8')
  const block = frontend.match(/const TRANSPORT_STATUS = \{([\s\S]*?)\n\}/)
  assert.ok(block, '前端受控状态表必须存在')
  const frontendStatuses = new Set([...block[1].matchAll(/([a-z_]+):/g)].map(match => match[1]))
  for (const value of Object.values(TRANSPORT_STATUS_COMPAT)) assert.ok(frontendStatuses.has(value), `${value} 必须是前端受控取值`)
  for (const status of [...TRANSPORT_EVIDENCE_STATUSES, 'unexpected_raw_status', undefined, null]) {
    assert.ok(frontendStatuses.has(compatTransportStatus(status)), `${status} 的兼容映射必须在受控表内`)
  }
})

test('the compat field never leaks provider status text or error messages', async () => {
  const reader = stubReader(call => {
    if (call === 1) return Object.assign(new Error('火车供应商拒绝了查询：key 无效'), { code: 'PROVIDER_REJECTED' })
    return { status: 'ERROR 火车供应商返回异常', quotes: [] }
  })
  const evidence = await run([segment('museum'), segment('park')], reader)
  assert.deepEqual(evidence.map(entry => entry.status), ['unavailable', 'unavailable'])
  assert.deepEqual(evidence[0].diagnostic, { code: 'PROVIDER_REJECTED' })
  // provider 状态不是受控 token 时不得保留。
  assert.equal(evidence[1].providerStatus, null)
  const serialized = JSON.stringify(evidence) + compatTransportStatus(transportEvidenceStatus(evidence))
  assert.ok(!serialized.includes('火车供应商'), '不得透传 provider 原始文本')
  assert.ok(!serialized.includes('key 无效'))
  assert.equal(compatTransportStatus(transportEvidenceStatus(evidence)), 'unavailable')
})

test('a controlled provider status is preserved per segment for later batches', async () => {
  const reader = stubReader(call => (call === 1 ? { status: 'out_of_window', quotes: [] } : { status: 'disabled', quotes: [] }))
  const evidence = await run([segment('museum'), segment('park')], reader)
  assert.deepEqual(evidence.map(entry => entry.providerStatus), ['out_of_window', 'disabled'])
  assert.deepEqual(evidence.map(entry => entry.status), ['out_of_window', 'disabled'])
})
