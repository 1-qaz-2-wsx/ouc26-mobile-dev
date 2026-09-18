// B3-4：多段 carrier 真正接回规划主链的端到端验收。
// 覆盖 specs/agent-tasks/round-03-workbuddy-b3-4.md §9 的必测场景 1-9、17-32。
// 全部 provider / route reader 都是本地 mock：不调用真实腾讯地图或聚合供应商，不消耗任何真实额度。
const test = require('node:test')
const assert = require('node:assert/strict')
const { createPlanningService } = require('../src/planning/service')

const NOW = Date.parse('2026-09-18T02:00:00Z')
const AT = time => `2026-10-${time}`
const LEGACY_QUOTE_ID = 'juhe-train-817:2026-10-04:K7003'
const LEGACY_STATION = { name: '哈尔滨', code: 'HGH' }
const FORBIDDEN_KEYS = ['message', 'reason', 'details', 'url', 'deeplink', 'bookingTarget', 'bookingUrl', 'purchaseUrl']

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

// 两个显式交通需求：origin -> museum、museum -> park。
// 第三段 park -> destination 故意不提供 carrier，用来验证「非 carrier demand 仍然走 route reader」。
function pipelineRequest(overrides = {}) {
  return {
    schemaVersion: 'real-travel-plan-request.v1',
    clientRequestId: 'b3-4-pipeline',
    origin: place('origin', '长春站', 43.8171, 125.3235, '220100'),
    endDestination: place('destination', '哈尔滨站', 45.7733, 126.6572, '230100'),
    startAt: AT('01T08:00:00+08:00'),
    endBy: AT('04T23:00:00+08:00'),
    timezone: 'Asia/Shanghai',
    travelers: { adults: 1, children: [] },
    budget: { amountMinor: 500000, currency: 'CNY', basis: 'party', includedCategories: ['transport'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true, maxTransfers: 1 },
    transportDemands: [
      { mode: 'train', serviceDate: AT('02'), departure: { name: '长春', code: 'CCT' }, arrival: { name: '沈阳', code: 'SYT' }, targetMenuItemId: 'museum' },
      { mode: 'train', serviceDate: AT('03'), departure: { name: '沈阳', code: 'SYT' }, arrival: { name: '哈尔滨', code: 'HGH' }, targetMenuItemId: 'park' }
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
    provider: 'juhe', environment: 'test', mode: 'train',
    productId: quoteId.split(':').pop(), serviceNo: quoteId.split(':').pop(), quoteId,
    from, to, fromCode, toCode, departureDate, departureTime, arrivalDate, arrivalTime,
    amountMinor, currency: 'CNY', priceBasis: 'per_person', availability: 'available',
    fetchedAt: '2026-09-18T02:00:00.000Z', bookingTarget: { kind: 'manual', label: '人工复核' },
    provenance,
    ...overrides
  }
}

// 段 A：长春 -> 沈阳，10-02 08:00 发车、14:00 到达（晚于 museum 原始窗口起点，验证顺延）
const QUOTE_A = () => trainQuote('juhe-train-817:2026-10-02:K7001', '长春', '沈阳', 'CCT', 'SYT', AT('02'), '08:00', AT('02'), '14:00', 20000)
// 段 B：沈阳 -> 哈尔滨，10-03 05:00 发车、07:00 到达
const QUOTE_B = () => trainQuote('juhe-train-817:2026-10-03:K7002', '沈阳', '哈尔滨', 'SYT', 'HGH', AT('03'), '05:00', AT('03'), '07:00', 30000)
// legacy 单段：哈尔滨 -> 漠河，10-04 出发（晚于全部活动结束，可合法绑定到 destination 段）
const QUOTE_LEGACY = () => trainQuote(LEGACY_QUOTE_ID, LEGACY_STATION.name, '漠河', LEGACY_STATION.code, 'MHX', AT('04'), '08:00', AT('04'), '14:00', 40000)

const QUOTES_BY_ARRIVAL_CODE = { SYT: QUOTE_A, HGH: QUOTE_B, MHX: QUOTE_LEGACY }

function quoteFor(demand) {
  const build = QUOTES_BY_ARRIVAL_CODE[demand.arrival && demand.arrival.code]
  return build ? build() : null
}

// ---------------------------------------------------------------- runner

// 记录真实的 reader 调用，用来证明「谁被查询、谁没被查询」。
async function runPipeline(request, options = {}) {
  const calls = { transport: [], routes: [] }
  const serviceOptions = { clock: options.clock || (() => NOW) }
  if (options.evidenceForTransport !== null) {
    const reader = options.evidenceForTransport || (async ({ demand }) => ({ status: 'available', quotes: [quoteFor(demand)].filter(Boolean) }))
    serviceOptions.evidenceForTransport = async input => {
      calls.transport.push(input.demand)
      return reader(input)
    }
  }
  if (options.evidenceForRoutes !== null) {
    const reader = options.evidenceForRoutes || (async () => [])
    serviceOptions.evidenceForRoutes = async input => {
      calls.routes.push(input.demands)
      return reader(input)
    }
  }
  const service = createPlanningService(serviceOptions)
  const created = service.jobs.create({ ownerId: 'a', idempotencyKey: options.key || 'b3-4-pipeline', request })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  return { ...done, calls }
}

function collectKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys
  for (const [key, child] of Object.entries(value)) {
    keys.push(key)
    collectKeys(child, keys)
  }
  return keys
}

const LAST_DEMAND_ID = JSON.stringify(['item:park', 'destination'])

// 新 transportDemands[] 里唯一不带 targetMenuItemId 的元素明确表示 endDestination。
function destinationRequest() {
  const request = pipelineRequest()
  request.transportDemands = [
    { mode: 'train', serviceDate: AT('02'), departure: { name: '长春', code: 'CCT' }, arrival: { name: '沈阳', code: 'SYT' }, targetMenuItemId: 'museum' },
    { mode: 'train', serviceDate: AT('04'), departure: LEGACY_STATION, arrival: { name: '漠河', code: 'MHX' } }
  ]
  return request
}

// ---------------------------------------------------------------- 1 / 2：真正进入 plan

test('two explicit transport demands enter the final plan as two selected quotes and two carrier legs', async () => {
  const { result, calls } = await runPipeline(pipelineRequest())
  assert.equal(result.plan.quotes.length, 2)
  assert.equal(result.plan.legs.length, 2)
  assert.deepEqual(result.plan.legs.map(leg => leg.toItemId), ['museum', 'park'])
  assert.ok(result.plan.legs.every(leg => leg.mode === 'train' && leg.serviceNo && leg.quoteRef))
  assert.ok(result.plan.legs.every(leg => leg.status === 'available'))
  // 每个 demand 只查询一次，绝不重复查同一段。
  assert.equal(calls.transport.length, 2)
  assert.deepEqual(calls.transport.map(demand => demand.targetMenuItemId), ['museum', 'park'])
  assert.equal(result.transportEvidence.length, 2)
  assert.equal(result.transportEvidence.every(row => row.status === 'queried'), true)
})

test('every selected carrier leg stays same-origin with its own quote on demandId', async () => {
  const { result } = await runPipeline(pipelineRequest())
  const demandIds = new Set()
  for (const leg of result.plan.legs) {
    assert.equal(typeof leg.demandId, 'string')
    assert.ok(leg.demandId)
    const quote = result.plan.quotes.find(row => row.quoteId === leg.quoteRef)
    assert.ok(quote, `leg ${leg.legId} 必须引用 plan.quotes 内的报价`)
    assert.equal(quote.demandId, leg.demandId)
    assert.equal(quote.quoteId, leg.quoteRef)
    demandIds.add(leg.demandId)
  }
  assert.equal(demandIds.size, 2)
  assert.equal(new Set(result.plan.quotes.map(quote => quote.quoteId)).size, 2)
  // 两个 leg 的 id 也必须唯一（display section 依赖它）。
  assert.equal(new Set(result.plan.legs.map(leg => leg.legId)).size, 2)
})

// ---------------------------------------------------------------- 8 / 9 / 32：route reader 只查非 carrier 段

test('carrier demands are never sent to the route reader while local demands still are', async () => {
  const { result, calls } = await runPipeline(pipelineRequest())
  assert.equal(calls.routes.length, 1)
  const queried = calls.routes[0]
  const carrierDemandIds = new Set(result.plan.legs.map(leg => leg.demandId))
  assert.equal(queried.length, 1, '只有非 carrier demand 才允许进入 route reader')
  assert.deepEqual(queried.map(demand => demand.demandId), [LAST_DEMAND_ID])
  assert.equal(queried.every(demand => !carrierDemandIds.has(demand.demandId)), true)
  // 3 个 route demand 里恰好只有 1 个被查询：carrier 段没有额外消耗 map 额度。
  assert.equal(queried.length, 3 - result.plan.legs.length)
})

// ---------------------------------------------------------------- 6 / 7：绑定成功不再误报

test('a correctly bound carrier reports the station transfer gap instead of the legacy unimplemented code', async () => {
  const { result } = await runPipeline(pipelineRequest())
  for (const list of [result.routeAudit.errors, result.plan.validation.errors]) {
    assert.equal(list.some(row => row.code === 'ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED'), false)
  }
  const stationGaps = result.routeAudit.gaps.filter(gap => gap.code === 'STATION_TRANSFERS_UNCONFIRMED')
  assert.equal(stationGaps.length, 2)
  for (const leg of result.plan.legs) {
    const gap = stationGaps.find(row => row.legId === leg.legId)
    assert.ok(gap, `carrier leg ${leg.legId} 必须保留 station transfer gap`)
    assert.equal(gap.demandId, leg.demandId)
    // carrier demand 不得被当成「缺少接驳证据」，也绝不能按 0 分钟处理。
    assert.equal(result.routeAudit.gaps.some(row => row.code === 'TRANSFER_EVIDENCE_MISSING' && row.demandId === leg.demandId), false)
  }
  assert.equal(result.routeAudit.gaps.some(gap => gap.code === 'TRANSFER_EVIDENCE_MISSING' && gap.demandId === LAST_DEMAND_ID), true)
  assert.equal(result.routeAudit.status, 'needs_review')
  assert.equal(result.plan.feasibility, 'needs_review')
})

// ---------------------------------------------------------------- 3 / 4 / 31：display section 与去重

test('each carrier leg owns an independent display section and its notes locate it by legId', async () => {
  const { result } = await runPipeline(pipelineRequest())
  const legSections = result.display.sections.filter(section => section.kind === 'leg')
  assert.equal(legSections.length, 2)
  assert.equal(new Set(legSections.map(section => section.id)).size, 2)
  for (const section of legSections) {
    assert.ok(result.plan.legs.some(leg => section.id === `leg:${leg.legId}`))
  }

  // 测试环境提示必须一段一条，并各自定位到自己的 leg section。
  const environmentNotes = result.display.notes.filter(note => note.code === 'TEST_ENVIRONMENT' && note.sectionId)
  assert.equal(environmentNotes.length, 2)
  assert.deepEqual(new Set(environmentNotes.map(note => note.sectionId)), new Set(legSections.map(section => section.id)))

  // 车站接驳提示同样必须定位到 leg section，且 planner 与 routeAudit 的报告只合成一条。
  const stationNotes = result.display.notes.filter(note => note.code === 'STATION_TRANSFERS_UNCONFIRMED')
  assert.equal(stationNotes.length, 2)
  for (const note of stationNotes) {
    assert.ok(legSections.some(section => section.id === note.sectionId), `${note.id} 必须定位到路段 section`)
    assert.equal(note.severity, 'action_required')
  }
  const keys = result.display.notes.map(note => `${note.code}::${note.sectionId || ''}`)
  assert.equal(new Set(keys).size, keys.length, '同一 code + target 只允许出现一条 note')
})

// ---------------------------------------------------------------- 18-25：逐段失败状态

const FAILURE_CASES = [
  ['no_quotes', async ({ demand }) => demand.targetMenuItemId === 'museum'
    ? { status: 'available', quotes: [quoteFor(demand)] } : { status: 'unknown', quotes: [] },
    'TRANSPORT_NO_QUOTES', 'unknown'],
  ['budget_exhausted', async ({ demand }) => {
    if (demand.targetMenuItemId === 'museum') return { status: 'available', quotes: [quoteFor(demand)] }
    throw Object.assign(new Error('provider session limit'), { code: 'PROVIDER_SESSION_LIMIT' })
  }, 'TRANSPORT_QUERY_BUDGET_EXHAUSTED', 'budget_exhausted'],
  ['out_of_window', async ({ demand }) => demand.targetMenuItemId === 'museum'
    ? { status: 'available', quotes: [quoteFor(demand)] } : { status: 'out_of_window', quotes: [] },
    'TRANSPORT_QUERY_OUT_OF_WINDOW', 'out_of_window'],
  ['not_configured', async ({ demand }) => demand.targetMenuItemId === 'museum'
    ? { status: 'available', quotes: [quoteFor(demand)] } : { status: 'not_configured', quotes: [] },
    'TRANSPORT_PROVIDER_NOT_CONFIGURED', 'not_configured'],
  ['unavailable', async ({ demand }) => demand.targetMenuItemId === 'museum'
    ? { status: 'available', quotes: [quoteFor(demand)] } : { status: 'upstream_error', quotes: [] },
    'TRANSPORT_QUERY_UNAVAILABLE', 'unavailable'],
  ['disabled', async ({ demand }) => demand.targetMenuItemId === 'museum'
    ? { status: 'available', quotes: [quoteFor(demand)] } : { status: 'disabled', quotes: [] },
    'TRANSPORT_PROVIDER_DISABLED', 'disabled']
]

test('each explicit transport failure keeps its own controlled status and stays reviewable', async () => {
  for (const [name, evidenceForTransport, code, compatStatus] of FAILURE_CASES) {
    const { result } = await runPipeline(pipelineRequest(), { evidenceForTransport, key: `failure-${name}` })
    // 成功段不因另一段失败被抹掉，缺失段不伪造 leg。
    assert.equal(result.plan.legs.length, 1, name)
    assert.equal(result.plan.quotes.length, 1, name)
    assert.equal(result.plan.legs[0].toItemId, 'museum', name)

    const warning = result.plan.validation.warnings.find(row => row.code === code)
    assert.ok(warning, `${name} 必须产出受控 code ${code}`)
    assert.equal(warning.demandId, JSON.stringify(['item:museum', 'item:park']), name)
    // 受控 code 只能是 action_required，不能把失败段升级成 blocked。
    assert.equal(result.plan.validation.errors.some(row => row.code === code), false, name)
    assert.equal(result.plan.feasibility, 'needs_review', name)
    assert.equal(result.routeAudit.errors.length, 0, name)

    const note = result.display.notes.find(row => row.code === code)
    assert.ok(note, `${name} 的受控状态必须进入 display`)
    assert.equal(note.severity, 'action_required', name)
    // 该段没有被选中的 leg，因此不允许伪造成一个 leg section 目标。
    assert.equal(note.sectionId, null, name)
    assert.equal(result.transportStatus, compatStatus, name)
  }
})

test('a segment that was never queried reports its own controlled status instead of silence', async () => {
  const { result, calls } = await runPipeline(pipelineRequest(), { evidenceForTransport: null, key: 'not-queried' })
  assert.equal(calls.transport.length, 0)
  assert.equal(result.plan.legs.length, 0)
  const notes = result.plan.validation.warnings.filter(row => row.code === 'TRANSPORT_NOT_QUERIED')
  assert.equal(notes.length, 2)
  assert.equal(result.transportStatus, 'not_queried')
  assert.ok(result.display.notes.some(note => note.code === 'TRANSPORT_NOT_QUERIED'))
  assert.equal(result.display.notes.find(note => note.code === 'TRANSPORT_NOT_QUERIED').sectionId, null)
})

test('a disabled flight demand never triggers a flight fetch and keeps its own status', async () => {
  const request = pipelineRequest()
  request.transportDemands = [
    request.transportDemands[0],
    { mode: 'flight', serviceDate: AT('03'), departure: { name: '沈阳', code: 'SYT' }, arrival: { name: '哈尔滨', code: 'HGH' }, targetMenuItemId: 'park' }
  ]
  const { result, calls } = await runPipeline(request, { key: 'flight-disabled' })
  assert.equal(calls.transport.length, 1, '只允许查询已启用的火车段')
  assert.equal(calls.transport.some(demand => demand.mode === 'flight'), false)
  assert.equal(result.plan.legs.length, 1)
  assert.ok(result.plan.validation.warnings.some(row => row.code === 'TRANSPORT_PROVIDER_DISABLED'))
  assert.equal(result.plan.validation.warnings.some(row => row.code === 'TRANSPORT_NO_QUOTES'), false)
  assert.equal(result.plan.feasibility, 'needs_review')
})

// ---------------------------------------------------------------- 26：缺失段不计 0

test('a failed segment is never counted as zero while the known segment keeps its subtotal', async () => {
  const { result } = await runPipeline(pipelineRequest(), {
    evidenceForTransport: FAILURE_CASES[0][1], key: 'missing-cost'
  })
  const transport = result.plan.costSummary.categoryBreakdown.find(row => row.category === 'transport')
  assert.equal(result.plan.costSummary.knownTotal, null)
  assert.equal(transport.amountMinor, 20000)
  assert.equal(transport.status, 'partial')
  assert.equal(transport.basis, 'per_person')
  assert.equal(result.plan.costSummary.knownSubtotalMinor, 20000)
  assert.ok(result.plan.costSummary.unknownCategories.includes('transport'))
})

// ---------------------------------------------------------------- 29 / 30：display 与机器态边界

test('display never forwards provider raw status, message or links', async () => {
  // provider 原始状态刻意用前端未知的裸大写 token，归一后才允许进入受控 code。
  const rawStatus = 'UPSTREAM_TIMEOUT_ERR'
  const { result } = await runPipeline(pipelineRequest(), {
    key: 'no-leak',
    evidenceForTransport: async ({ demand }) => demand.targetMenuItemId === 'museum'
      ? { status: 'available', quotes: [quoteFor(demand)] }
      : { status: rawStatus, quotes: [] }
  })
  const serialized = JSON.stringify(result.display)
  for (const token of [rawStatus, 'provider session limit', 'PROVIDER_SESSION_LIMIT']) {
    assert.equal(serialized.includes(token), false, `display 不得出现 ${token}`)
  }
  assert.equal(collectKeys(result.display).some(key => FORBIDDEN_KEYS.includes(key)), false)
  // 归一后的受控状态仍然可区分，没有被塌缩成「无票」。
  assert.ok(result.display.notes.some(note => note.code === 'TRANSPORT_QUERY_UNAVAILABLE'))
  assert.equal(result.display.notes.some(note => note.code === 'TRANSPORT_NO_QUOTES'), false)
  // 机器态诊断仍保留在 transportEvidence，只是前端不需要消费它。
  const entry = result.transportEvidence.find(row => row.demandId === JSON.stringify(['item:museum', 'item:park']))
  assert.equal(entry.status, 'unavailable')
  assert.equal(entry.providerStatus, null)
})

test('transportEvidence keeps the machine state outside display', async () => {
  const { result } = await runPipeline(pipelineRequest(), { evidenceForTransport: FAILURE_CASES[1][1], key: 'machine-state' })
  const diagnostic = result.transportEvidence.find(row => row.status === 'budget_exhausted')
  assert.ok(diagnostic)
  assert.equal(diagnostic.diagnostic.code, 'PROVIDER_SESSION_LIMIT')
  assert.equal(diagnostic.quotes.length, 0)
  assert.equal(result.transportEvidence.every(row => typeof row.demandId === 'string' && typeof row.status === 'string'), true)
  assert.equal(JSON.stringify(result.display).includes('PROVIDER_SESSION_LIMIT'), false)
})

test('local transport failure text stays controlled and never becomes a machine token', async () => {
  const { result } = await runPipeline(pipelineRequest())
  const controlled = result.display.notes.map(note => note.title)
  assert.equal(controlled.every(title => typeof title === 'string' && title.length > 0), true)
  for (const note of result.display.notes) {
    assert.equal(/^[A-Z][A-Z0-9_]+$/.test(note.title), false, 'display 标题不得是机器 code')
  }
})

// ---------------------------------------------------------------- 27 / 28：兼容路径

test('the legacy single transportDemand keeps its provider raw quoteId and still reaches display', async () => {
  const request = pipelineRequest()
  delete request.transportDemands
  request.transportDemand = { mode: 'train', serviceDate: AT('04'), departure: LEGACY_STATION, arrival: { name: '漠河', code: 'MHX' } }
  const { result } = await runPipeline(request, { key: 'legacy' })
  assert.equal(result.plan.quotes.length, 1)
  // 旧路径必须保留 provider 原始 quoteId，不能被段级作用域改写。
  assert.equal(result.plan.quotes[0].quoteId, LEGACY_QUOTE_ID)
  assert.equal(result.plan.quotes[0].quoteId.includes('@'), false)
  assert.equal(result.plan.legs.length, 1)
  // B3-3-R1：legacy 的 leg / quote 仍然同步 server-owned demandId。
  assert.equal(result.plan.legs[0].demandId, JSON.stringify(['item:park', 'destination']))
  assert.equal(result.plan.quotes[0].demandId, result.plan.legs[0].demandId)
  assert.equal(result.plan.legs[0].quoteRef, LEGACY_QUOTE_ID)
  assert.ok(result.display.sections.some(section => section.kind === 'leg'))
  assert.equal(result.routeAudit.errors.length, 0)
  assert.equal(result.transportStatus, 'available')
})

test('a plan without any transport demand keeps the original local behaviour', async () => {
  const request = pipelineRequest()
  delete request.transportDemands
  const { result, calls } = await runPipeline(request, { key: 'no-transport' })
  assert.equal(calls.transport.length, 0)
  assert.equal(result.plan.legs.length, 0)
  assert.equal(result.plan.quotes.length, 0)
  assert.equal(result.transportStatus, 'not_queried')
  // 没有 carrier 时，所有 route demand 仍然照常送进 route reader。
  assert.equal(calls.routes.length, 1)
  assert.equal(calls.routes[0].length, 3)
  assert.deepEqual(result.plan.plannedOrder, ['museum', 'park'])
  assert.equal(result.plan.validation.errors.length, 0)
  assert.equal(result.display.sections.filter(section => section.kind === 'leg').length, 0)
  assert.equal(result.routeAudit.errors.length, 0)
})

// ---------------------------------------------------------------- 17：孤立 carrier evidence 保留兼容 code

test('carrier-like route evidence without any plan binding keeps the compatibility code', async () => {
  const demandId = JSON.stringify(['item:park', 'destination'])
  const { result } = await runPipeline(pipelineRequest(), {
    key: 'orphan-carrier',
    evidenceForRoutes: async () => [{
      demandId,
      legs: [{
        legId: 'orphan-train', from: { provider: 'tencent-map', providerPlaceId: 'origin' },
        to: { provider: 'tencent-map', providerPlaceId: 'destination' }, mode: 'train', serviceNo: 'K9',
        serviceDate: AT('02'), departureAt: AT('02T12:00:00+08:00'), arrivalAt: AT('02T14:00:00+08:00'), durationMinutes: 120,
        routeGeometry: { source: 'mock' }, status: 'available', quoteRef: null,
        provenance: { sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: '2026-09-18T02:00:00.000Z' }
      }]
    }]
  })
  const row = result.plan.validation.errors.find(error => error.code === 'ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED')
  assert.ok(row, '未经过 selector 的孤立 carrier evidence 必须保留兼容 code')
  assert.equal(result.routeAudit.status, 'blocked')
})

// ---------------------------------------------------------------- B3-4-R1：destination carrier 展示语义

test('a destination carrier is reported as station transfer instead of placement unconfirmed', async () => {
  const { result, calls } = await runPipeline(destinationRequest(), { key: 'destination-carrier' })
  // 该段已明确绑定到 endDestination：leg.toItemId 合法地为 null。
  const leg = result.plan.legs.find(row => row.demandId === LAST_DEMAND_ID)
  assert.ok(leg, '无 targetMenuItemId 的段必须生成 destination carrier leg')
  assert.equal(leg.toItemId, null)
  assert.equal(leg.quoteRef, result.plan.quotes.find(quote => quote.demandId === LAST_DEMAND_ID).quoteId)
  assert.equal(calls.transport.length, 2)
  assert.equal(calls.routes.length, 1)
  assert.equal(calls.routes[0].length, 1, 'destination carrier 同样不得再进 route reader')

  // planner 侧：只允许 station transfer，不得再说成「尚未放入完整行程」。
  const codes = result.plan.validation.warnings.map(row => row.code)
  assert.ok(codes.includes('STATION_TRANSFERS_UNCONFIRMED'))
  assert.equal(codes.includes('TRANSPORT_PLACEMENT_UNCONFIRMED'), false, '合法 destination carrier 不得被判为未放入完整行程')
  const warning = result.plan.validation.warnings.find(row => row.code === 'STATION_TRANSFERS_UNCONFIRMED' && row.legId === leg.legId)
  assert.equal(warning.demandId, LAST_DEMAND_ID)

  // route audit 侧：唯一绑定 + 无整段 local 证据 → station transfer gap，不是 blocked。
  assert.ok(result.routeAudit.gaps.some(gap => gap.code === 'STATION_TRANSFERS_UNCONFIRMED' && gap.legId === leg.legId))
  assert.equal(result.routeAudit.errors.length, 0)
  assert.notEqual(result.plan.feasibility, 'blocked')
  assert.equal(result.routeAudit.status, 'needs_review')

  // display 侧：只出现正确的 station transfer note，并定位到该 destination leg section。
  const noteCodes = result.display.notes.map(note => note.code)
  assert.equal(noteCodes.includes('TRANSPORT_PLACEMENT_UNCONFIRMED'), false)
  const stationNotes = result.display.notes.filter(note => note.code === 'STATION_TRANSFERS_UNCONFIRMED')
  assert.equal(stationNotes.length, 2, '两个 carrier 段各一条，且 planner 与 routeAudit 的报告只合成一条')
  const destinationNote = stationNotes.find(note => note.sectionId === `leg:${leg.legId}`)
  assert.ok(destinationNote, 'destination carrier 的 station transfer note 必须定位到自己的 leg section')
  assert.equal(destinationNote.severity, 'action_required')
  const keys = result.display.notes.map(note => `${note.code}::${note.sectionId || ''}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('an item target carrier keeps reporting the same station transfer code', async () => {
  const { result } = await runPipeline(pipelineRequest(), { key: 'item-target-carrier' })
  const codes = result.plan.validation.warnings.map(row => row.code)
  assert.equal(codes.includes('TRANSPORT_PLACEMENT_UNCONFIRMED'), false)
  for (const leg of result.plan.legs) {
    assert.equal(typeof leg.toItemId, 'string')
    assert.ok(result.plan.validation.warnings.some(row => row.code === 'STATION_TRANSFERS_UNCONFIRMED' && row.legId === leg.legId))
  }
})

test('the legacy single transportDemand keeps its existing placement warning behaviour', async () => {
  // B3-4-R1 §2.2：本批不改 legacy buildRulePlan() 既有语义，这里把它钉住以免顺手漂移。
  const request = pipelineRequest()
  delete request.transportDemands
  request.transportDemand = { mode: 'train', serviceDate: AT('04'), departure: LEGACY_STATION, arrival: { name: '漠河', code: 'MHX' } }
  const { result } = await runPipeline(request, { key: 'legacy-placement' })
  const leg = result.plan.legs[0]
  assert.equal(leg.toItemId, null)
  // legacy planner 侧：仍然按旧语义报 placement unconfirmed（本批明确不改，§2.2）。
  assert.ok(result.plan.validation.warnings.some(row => row.code === 'TRANSPORT_PLACEMENT_UNCONFIRMED'))
  assert.equal(result.transportStatus, 'available')
  // route-audit 与目标形态无关：legacy leg 已有同源 quote / demandId 与合法 destination 绑定，
  // 因此仍会独立给出 station transfer gap（pipeline 会把它并进 plan.validation.warnings）。
  const stationGap = result.routeAudit.gaps.find(gap => gap.code === 'STATION_TRANSFERS_UNCONFIRMED')
  assert.ok(stationGap)
  assert.equal(stationGap.legId, leg.legId)
  assert.equal(result.routeAudit.errors.length, 0)
  assert.notEqual(result.plan.feasibility, 'blocked')
  // legacy 的并存现状：display 同时出现 placement 与 station 两条提示，且都定位到同一条 leg section。
  // 这属于 §2.2 明确保留的 legacy 差异（新数组路径已收口），不在本批改动范围。
  const sectionId = `leg:${leg.legId}`
  const legacyCodes = result.display.notes.filter(note => note.sectionId === sectionId).map(note => note.code)
  assert.ok(legacyCodes.includes('TRANSPORT_PLACEMENT_UNCONFIRMED'))
  assert.ok(legacyCodes.includes('STATION_TRANSFERS_UNCONFIRMED'))
})
