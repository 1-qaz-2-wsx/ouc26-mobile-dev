// B4-2：附近住宿「地点信息」证据接入 planning 主链的验收测试。
// 覆盖 specs/agent-tasks/round-03-workbuddy-b4-2.md §12 必测场景 2-22、26-33。
// 全部 reader 都是本地 mock：不调用真实腾讯地图或聚合供应商，不消耗任何真实额度。
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  collectLodgingEvidence, createPlanningExecutor, lodgingDiagnostics, lodgingNeedSkipStatus,
  lodgingSearchAnchor, LODGING_EVIDENCE_STATUSES, LODGING_NOT_SEARCHED_STATUSES
} = require('../src/planning/pipeline')

const NOW = Date.parse('2026-09-25T02:00:00Z')
const AT = time => `2026-10-${time}`
const FORBIDDEN_KEYS = ['message', 'reason', 'details', 'price', 'amountMinor', 'inventory', 'availability',
  'roomType', 'bookable', 'url', 'deeplink', 'bookingTarget', 'bookingUrl', 'purchaseUrl']

// ---------------------------------------------------------------- fixtures

function place(id, name, lat, lng, adcode = '220100', overrides = {}) {
  return { provider: 'tencent-map', providerPlaceId: id, name, type: 'poi', coordinate: { lat, lng }, coordinateSystem: 'GCJ-02', adcode, ...overrides }
}

function menuItem(menuItemId, name, inputOrder, lat, lng, window = null) {
  return {
    menuItemId,
    occurrenceId: `${menuItemId}-occ`,
    placeRef: place(`${menuItemId}-place`, name, lat, lng),
    role: 'attraction',
    inputOrder,
    required: true,
    stayRequirement: 'must_visit',
    visitDuration: { minutes: 60 },
    preferredWindow: window || { startAt: AT('01T09:00:00+08:00'), endAt: AT('03T20:00:00+08:00') }
  }
}

function request(menuItems, overrides = {}) {
  return {
    schemaVersion: 'real-travel-plan-request.v1',
    clientRequestId: 'b4-2',
    origin: place('origin', '长春站', 43.8171, 125.3235),
    endDestination: place('destination', '哈尔滨站', 45.7733, 126.6572, '230100'),
    startAt: AT('01T08:00:00+08:00'),
    endBy: AT('03T23:00:00+08:00'),
    timezone: 'Asia/Shanghai',
    travelers: { adults: 2, children: [] },
    budget: { amountMinor: 500000, currency: 'CNY', basis: 'party', includedCategories: ['transport', 'lodging'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true, maxTransfers: 1 },
    lodgingPreferences: { rooms: 1 },
    interests: ['人文'],
    pace: 'balanced',
    menuItems,
    optimizeOrder: false,
    locks: [],
    confirmedConstraints: [],
    sourceInput: { type: 'manual_menu' },
    ...overrides
  }
}

// 与 B4-1 provider 输出同形的地点候选（只含信息型字段）。
function lodgingOption(overrides = {}) {
  return {
    provider: 'tencent-map', providerName: '腾讯位置服务', providerPlaceId: '1001', placeId: 'qq-1001',
    name: '汉庭酒店(人民广场店)', address: '长春市朝阳区人民大街 1 号', province: '吉林省', city: '长春市', district: '朝阳区',
    adcode: '220102', coordinate: { lat: 43.82, lng: 125.32 }, coordinateSystem: 'gcj02', category: '住宿服务;宾馆酒店',
    source: '腾讯位置服务',
    provenance: { sourceType: 'live', provider: 'tencent-map', sourceRef: 'place/v1/search', fetchedAt: '2026-09-25T02:00:00.000Z', fieldScope: ['place_identity'] },
    ...overrides
  }
}

async function runPipeline(options = {}) {
  const calls = { lodging: [] }
  const executorOptions = { now: () => NOW }
  if (options.evidenceForRoutes !== null) executorOptions.evidenceForRoutes = options.evidenceForRoutes || (async () => [])
  if (options.evidenceForLodging !== null) {
    const reader = options.evidenceForLodging || (async () => ({ status: 'available', options: [lodgingOption()] }))
    executorOptions.evidenceForLodging = async input => { calls.lodging.push(input); return reader(input) }
  }
  if (options.evidenceForTransport) executorOptions.evidenceForTransport = options.evidenceForTransport
  const executor = createPlanningExecutor(executorOptions)
  const result = await executor({ request: options.request, job: { id: options.jobId || 'b4-2-job' }, signal: options.signal || new AbortController().signal })
  return { result, calls }
}

function collectKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys
  for (const [key, child] of Object.entries(value)) { keys.push(key); collectKeys(child, keys) }
  return keys
}

// 每段都有一条本地导航证据，用来消除「缺少接驳证据」这类与住宿无关的 action_required。
function mockRouteEvidence({ demands }) {
  return demands.map((demand, index) => ({
    demandId: demand.demandId,
    legs: [{
      legId: `mock-leg-${index}`, from: demand.from, to: demand.to, mode: 'car', serviceDate: AT('01'),
      departureAt: demand.readyAt,
      arrivalAt: new Date(Date.parse(demand.readyAt) + 30 * 60000).toISOString(),
      durationMinutes: 30, routeGeometry: { source: 'fixture' }, quoteRef: null, status: 'available',
      provenance: { provider: 'fixture-route', sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: '2026-09-25T02:00:00.000Z' }
    }]
  }))
}

// 直接构造 journey / plan，用来精确控制锚点候选，不经过排程器。
function journeyFixture(needs, days = []) {
  return {
    schemaVersion: 'planning-journey-days.v1',
    days,
    lodgingNeeds: needs.map(need => ({
      rooms: 1, travelers: { adults: 2, children: [] }, hotelId: null, roomTypeId: null, amountMinor: null,
      availability: 'unknown', gaps: ['HOTEL_RATE_INVENTORY_UNAVAILABLE'], ...need
    })),
    conflicts: [],
    requestedNights: needs.length,
    confirmedHotelNights: 0,
    complete: false
  }
}

function planFixture(days = []) {
  return {
    inputSnapshot: { startAt: AT('01T08:00:00+08:00'), timezone: 'Asia/Shanghai', origin: place('origin', '长春站', 43.8171, 125.3235) },
    legs: [],
    items: [],
    days
  }
}

function activity(id, lat, lng, endAt) {
  return { id, kind: 'explicit_activity', placeRef: place(`${id}-place`, id, lat, lng), startAt: new Date(Date.parse(endAt) - 3600000).toISOString(), endAt }
}

// ---------------------------------------------------------------- 锚点选择（§4）

test('only needs_review lodging needs are queryable while the other statuses keep their own reason', () => {
  assert.equal(lodgingNeedSkipStatus({ id: 'a', status: 'needs_review' }), null)
  assert.equal(lodgingNeedSkipStatus({ id: 'a', status: 'not_required_by_user' }), 'not_required')
  assert.equal(lodgingNeedSkipStatus({ id: 'a', status: 'night_train_rest_pending_confirmation' }), 'pending_confirmation')
  // 未知状态不查询，也不假装是任何一种已知语义。
  assert.equal(lodgingNeedSkipStatus({ id: 'a', status: 'something_new' }), 'not_queried')
  assert.equal(lodgingNeedSkipStatus(null), null)
})

test('the anchor is the last known real position before 22:00, preferring the latest activity', () => {
  const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [{
    date: '2026-10-01',
    activities: [activity('early', 43.80, 125.20, '2026-10-01T02:00:00.000Z'), activity('late', 43.95, 125.40, '2026-10-01T06:00:00.000Z')],
    transport: []
  }])
  const anchor = lodgingSearchAnchor({ need: journey.lodgingNeeds[0], journey, plan: planFixture(), routeAudit: null, timezone: 'Asia/Shanghai' })
  assert.equal(anchor.sourceKind, 'activity')
  assert.equal(anchor.sourceId, 'late')
  assert.deepEqual(anchor.location, { lat: 43.95, lng: 125.4 })
  assert.equal(anchor.at, '2026-10-01T06:00:00.000Z')
  // 锚点只保留受控的 identity/time，不复制整份 PlaceRef。
  assert.deepEqual(Object.keys(anchor).sort(), ['at', 'location', 'lodgingNeedId', 'sourceId', 'sourceKind'])
})

test('a transport arrival is used when no activity is known yet', () => {
  const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [{ date: '2026-10-01', activities: [], transport: [] }])
  const plan = planFixture()
  plan.legs = [{ legId: 'leg:car-1', mode: 'car', to: place('station-a', '车站', 45.0, 126.0), arrivalAt: '2026-10-01T10:00:00.000Z', departureAt: '2026-10-01T08:00:00.000Z', status: 'unknown' }]
  const anchor = lodgingSearchAnchor({ need: journey.lodgingNeeds[0], journey, plan, routeAudit: null, timezone: 'Asia/Shanghai' })
  assert.equal(anchor.sourceKind, 'transport_arrival')
  assert.equal(anchor.sourceId, 'leg:car-1')
  assert.deepEqual(anchor.location, { lat: 45, lng: 126 })
})

test('a carrier leg without a real coordinate is never used as an anchor', () => {
  const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [{ date: '2026-10-01', activities: [], transport: [] }])
  const plan = planFixture()
  // 站名点：coordinate 为 null、coordinateSystem 为 unknown —— 禁止用站名反推坐标。
  plan.legs = [{ legId: 'leg:train-1', mode: 'train', to: { provider: 'juhe', providerPlaceId: 'HGH', name: '哈尔滨', type: 'train_station', coordinate: null, coordinateSystem: 'unknown' }, arrivalAt: '2026-10-01T10:00:00.000Z', departureAt: '2026-10-01T08:00:00.000Z', status: 'available' }]
  const anchor = lodgingSearchAnchor({ need: journey.lodgingNeeds[0], journey, plan, routeAudit: null, timezone: 'Asia/Shanghai' })
  assert.equal(anchor.sourceKind, 'origin')
})

test('the request origin is only a fallback and still has to be known before 22:00', () => {
  const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [{ date: '2026-10-01', activities: [], transport: [] }])
  const anchor = lodgingSearchAnchor({ need: journey.lodgingNeeds[0], journey, plan: planFixture(), routeAudit: null, timezone: 'Asia/Shanghai' })
  assert.equal(anchor.sourceKind, 'origin')
  assert.equal(anchor.sourceId, 'origin')
  assert.deepEqual(anchor.location, { lat: 43.8171, lng: 125.3235 })

  // 起点时间晚于该晚 22:00 时不允许当兜底。
  const latePlan = planFixture()
  latePlan.inputSnapshot.startAt = '2026-10-01T15:00:00.000Z'
  assert.equal(lodgingSearchAnchor({ need: journey.lodgingNeeds[0], journey, plan: latePlan, routeAudit: null, timezone: 'Asia/Shanghai' }), null)
})

test('a next-day activity never back-fills the previous night and a late activity is excluded', () => {
  const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [
    { date: '2026-10-01', activities: [activity('after-22', 43.99, 125.99, '2026-10-01T15:00:00.000Z')], transport: [] },
    { date: '2026-10-02', activities: [activity('next-day', 44.99, 126.99, '2026-10-02T04:00:00.000Z')], transport: [] }
  ])
  const anchor = lodgingSearchAnchor({ need: journey.lodgingNeeds[0], journey, plan: planFixture(), routeAudit: null, timezone: 'Asia/Shanghai' })
  // 22:00 之后结束的活动与次日活动都不得作为当晚住宿位置的依据。
  assert.equal(anchor.sourceKind, 'origin')
  assert.notEqual(anchor.sourceId, 'after-22')
  assert.notEqual(anchor.sourceId, 'next-day')
})

test('an unusable coordinate is never faked with 0/null and yields anchor_missing', async () => {
  const cases = [
    ['missing coordinate', undefined],
    ['null pair', { lat: null, lng: null }],
    ['zero pair', { lat: 0, lng: 0 }],
    ['non finite', { lat: Number.POSITIVE_INFINITY, lng: 125 }],
    ['out of range', { lat: 91, lng: 125 }]
  ]
  for (const [name, coordinate] of cases) {
    const plan = planFixture()
    plan.inputSnapshot.origin = { provider: 'manual', providerPlaceId: 'origin', name: '起点', coordinate, coordinateSystem: 'WGS84' }
    const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [{ date: '2026-10-01', activities: [], transport: [] }])
    assert.equal(lodgingSearchAnchor({ need: journey.lodgingNeeds[0], journey, plan, routeAudit: null, timezone: 'Asia/Shanghai' }), null, name)
  }
  // 非 GCJ-02 且非腾讯来源的坐标同样不被采信。
  const plan = planFixture()
  plan.inputSnapshot.origin = { provider: 'manual', providerPlaceId: 'origin', name: '起点', coordinate: { lat: 43.8, lng: 125.3 }, coordinateSystem: 'WGS84' }
  const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [{ date: '2026-10-01', activities: [], transport: [] }])
  let fetches = 0
  const options = await collectLodgingEvidence({
    journey, plan, routeAudit: null, signal: new AbortController().signal,
    evidenceForLodging: async () => { fetches += 1; return { status: 'available', options: [lodgingOption()] } }
  })
  assert.equal(fetches, 0)
  assert.deepEqual(options, [{ lodgingNeedId: 'lodging-2026-10-01', status: 'anchor_missing', options: [], anchor: null }])
})

// ---------------------------------------------------------------- 状态归一（§5.1 / §5.2）

test('provider results are normalized into distinct lodging statuses', async () => {
  const journey = () => journeyFixture([
    { id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' },
    { id: 'lodging-2026-10-02', checkInDate: '2026-10-02', status: 'needs_review' }
  ])
  const days = [{ date: '2026-10-01', activities: [activity('a', 43.9, 125.3, '2026-10-01T04:00:00.000Z')], transport: [] }]
  const run = async reader => collectLodgingEvidence({ journey: journey(), plan: planFixture(), routeAudit: null, signal: new AbortController().signal, evidenceForLodging: reader })

  const available = await run(async () => ({ status: 'available', options: [lodgingOption()] }))
  assert.deepEqual(available.map(entry => entry.status), ['available', 'available'])
  assert.equal(available[0].options.length, 1)

  const emptyRows = await run(async () => ({ status: 'no_results', options: [] }))
  assert.deepEqual(emptyRows.map(entry => entry.status), ['no_results', 'no_results'])
  assert.deepEqual(emptyRows[0].options, [])

  // available 但没有任何候选，只能表达“没检索到”，不能表达“有房”。
  const emptyAvailable = await run(async () => ({ status: 'available', options: [] }))
  assert.deepEqual(emptyAvailable.map(entry => entry.status), ['no_results', 'no_results'])

  const unavailable = await run(async () => { throw Object.assign(new Error('腾讯地图查询失败（120）'), { status: 502 }) })
  assert.deepEqual(unavailable.map(entry => entry.status), ['unavailable', 'unavailable'])

  const budget = await run(async () => { throw Object.assign(new Error('本轮真实查询次数已用完'), { code: 'PROVIDER_SESSION_LIMIT', status: 429 }) })
  assert.deepEqual(budget.map(entry => entry.status), ['budget_exhausted', 'budget_exhausted'])
})

test('a missing or cancelled lodging reader never invents candidates', async () => {
  const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [{ date: '2026-10-01', activities: [activity('a', 43.9, 125.3, '2026-10-01T04:00:00.000Z')], transport: [] }])
  const withoutReader = await collectLodgingEvidence({ journey, plan: planFixture(), routeAudit: null, signal: new AbortController().signal })
  assert.equal(withoutReader[0].status, 'not_queried')
  assert.ok(LODGING_NOT_SEARCHED_STATUSES.includes('not_queried'))

  const controller = new AbortController()
  controller.abort()
  let fetches = 0
  const cancelled = await collectLodgingEvidence({
    journey, plan: planFixture(), routeAudit: null, signal: controller.signal,
    evidenceForLodging: async () => { fetches += 1; return { status: 'available', options: [lodgingOption()] } }
  })
  assert.equal(fetches, 0)
  assert.equal(cancelled[0].status, 'not_queried')
})

test('after a budget_exhausted night every later night stays exhausted without another fetch', async () => {
  const journey = journeyFixture([
    { id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' },
    { id: 'lodging-2026-10-02', checkInDate: '2026-10-02', status: 'needs_review' },
    { id: 'lodging-2026-10-03', checkInDate: '2026-10-03', status: 'needs_review' }
  ], [{ date: '2026-10-01', activities: [activity('a', 43.9, 125.3, '2026-10-01T04:00:00.000Z')], transport: [] }])
  let fetches = 0
  const options = await collectLodgingEvidence({
    journey, plan: planFixture(), routeAudit: null, signal: new AbortController().signal,
    evidenceForLodging: async () => {
      fetches += 1
      if (fetches === 1) return { status: 'available', options: [lodgingOption()] }
      throw Object.assign(new Error('本轮真实查询次数已用完'), { code: 'PROVIDER_SESSION_LIMIT', status: 429 })
    }
  })
  assert.deepEqual(options.map(entry => entry.status), ['available', 'budget_exhausted', 'budget_exhausted'])
  assert.equal(fetches, 2, '额度用尽后不得再发起请求')
  // 每一晚都必须留痕，不能静默消失，也不能写成 no_results。
  assert.equal(options.every(entry => typeof entry.lodgingNeedId === 'string'), true)
  assert.equal(options.some(entry => entry.status === 'no_results'), false)
})

test('not_required and pending_confirmation nights are never queried and never produce a not-searched note', async () => {
  const journey = journeyFixture([
    { id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'not_required_by_user' },
    { id: 'lodging-2026-10-02', checkInDate: '2026-10-02', status: 'night_train_rest_pending_confirmation' },
    { id: 'lodging-2026-10-03', checkInDate: '2026-10-03', status: 'needs_review' }
  ], [{ date: '2026-10-01', activities: [activity('a', 43.9, 125.3, '2026-10-01T04:00:00.000Z')], transport: [] }])
  let fetches = 0
  const options = await collectLodgingEvidence({
    journey, plan: planFixture(), routeAudit: null, signal: new AbortController().signal,
    evidenceForLodging: async () => { fetches += 1; return { status: 'available', options: [lodgingOption()] } }
  })
  assert.deepEqual(options.map(entry => entry.status), ['not_required', 'pending_confirmation', 'available'])
  assert.equal(fetches, 1, '只有 needs_review 的晚次允许消耗 map 额度')
  assert.deepEqual(lodgingDiagnostics(options), [], 'not_required / pending_confirmation 不得产生未检索提示')
  // 证明上面的空数组不是“诊断永远为空”：把同一晚换成失败状态后必须产出一条定位到该晚的 info 诊断。
  assert.deepEqual(lodgingDiagnostics([{ lodgingNeedId: 'lodging-2026-10-03', status: 'no_results', options: [], anchor: null }]),
    [{ code: 'LODGING_NOT_SEARCHED', targetId: 'lodging-2026-10-03', message: '附近住宿地点候选尚未完成检索' }])
})

test('only the allowed failure statuses produce a LODGING_NOT_SEARCHED diagnostic', () => {
  const rows = lodgingDiagnostics(LODGING_EVIDENCE_STATUSES.map(status => ({ lodgingNeedId: `lodging-${status}`, status, options: [], anchor: null })))
  assert.deepEqual(rows.map(row => row.status === undefined && row.code), LODGING_NOT_SEARCHED_STATUSES.map(() => 'LODGING_NOT_SEARCHED'))
  assert.deepEqual(rows.map(row => row.targetId), LODGING_NOT_SEARCHED_STATUSES.map(status => `lodging-${status}`))
  const produced = rows.map(row => row.targetId.replace('lodging-', ''))
  assert.deepEqual(produced.sort(), [...LODGING_NOT_SEARCHED_STATUSES].sort())
  assert.equal(produced.includes('available'), false)
  assert.equal(produced.includes('not_required'), false)
  assert.equal(produced.includes('pending_confirmation'), false)
})

test('machine state options are cloned instead of aliasing the provider payload', async () => {
  const providerOption = lodgingOption()
  const journey = journeyFixture([{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', status: 'needs_review' }], [{ date: '2026-10-01', activities: [activity('a', 43.9, 125.3, '2026-10-01T04:00:00.000Z')], transport: [] }])
  const options = await collectLodgingEvidence({
    journey, plan: planFixture(), routeAudit: null, signal: new AbortController().signal,
    evidenceForLodging: async () => ({ status: 'available', options: [providerOption] })
  })
  assert.equal(options[0].options.length, 1)
  assert.notEqual(options[0].options[0], providerOption)
  assert.deepEqual(options[0].options[0], providerOption)
  options[0].options[0].name = '被下游改写'
  assert.equal(providerOption.name, '汉庭酒店(人民广场店)')
})

// ---------------------------------------------------------------- 端到端：只有 needs_review 消耗额度（§3）

test('a two-night plan queries exactly once per needs_review night', async () => {
  const { result, calls } = await runPipeline({ request: request([menuItem('a', '伪满皇宫博物院', 0, 43.90, 125.35)]) })
  assert.equal(result.journey.lodgingNeeds.length, 2)
  assert.equal(calls.lodging.length, 2, '每个 needs_review 晚次恰好一次附近检索')
  assert.equal(result.lodgingOptions.length, 2)
  assert.deepEqual(result.lodgingOptions.map(entry => entry.status), ['available', 'available'])
  // 只允许一个明确关键词，且不自动改查第二个关键词。
  assert.equal(calls.lodging.every(input => input.signal && input.location && Object.keys(input).length === 2), true)
  const anchor = result.lodgingOptions[0].anchor
  assert.equal(anchor.sourceKind, 'activity')
  assert.equal(anchor.sourceId, 'a')
  assert.deepEqual(anchor.location, { lat: 43.9, lng: 125.35 })
})

test('required=false skips every lodging query and keeps the section non-misleading', async () => {
  const { result, calls } = await runPipeline({
    request: request([menuItem('a', '活动', 0, 43.9, 125.35)], { lodgingPreferences: { rooms: 1, required: false } }),
    evidenceForRoutes: mockRouteEvidence
  })
  assert.equal(calls.lodging.length, 0)
  assert.deepEqual(result.lodgingOptions.map(entry => entry.status), ['not_required', 'not_required'])
  const lodgingSections = result.display.sections.filter(section => section.kind === 'lodging')
  assert.equal(lodgingSections.length, 2)
  assert.equal(lodgingSections.every(section => section.subtitle === '用户选择不安排住宿'), true)
  assert.equal(lodgingSections.every(section => section.options.length === 0), true)
  assert.equal(result.display.notes.some(note => note.code === 'LODGING_NOT_SEARCHED'), false)
  assert.equal(result.display.notes.some(note => note.code === 'HOTEL_QUOTE_MISSING'), false)
  assert.equal(result.plan.validation.warnings.some(row => row.code === 'HOTEL_QUOTE_MISSING'), false)
  assert.equal(result.plan.validation.errors.length, 0)
  // 用户明确不要住宿时，住宿侧不得对可执行性产生任何影响。
  assert.equal(result.plan.feasibility, 'valid')
  assert.equal(result.partial, false)
})

// ---------------------------------------------------------------- 端到端：夜车与 no_results

function nightTrainRequest() {
  const built = request([menuItem('a', '活动', 0, 43.9, 125.35)])
  built.transportDemands = [{ mode: 'train', serviceDate: AT('01'), departure: { name: '长春', code: 'CCT' }, arrival: { name: '哈尔滨', code: 'HGH' }, targetMenuItemId: 'a' }]
  return built
}

const NIGHT_TRAIN_QUOTE = {
  provider: 'juhe', environment: 'test', mode: 'train', productId: 'K1', serviceNo: 'K1',
  quoteId: 'juhe-train-817:2026-10-01:K1', from: '长春', to: '哈尔滨', fromCode: 'CCT', toCode: 'HGH',
  departureDate: AT('01'), departureTime: '21:00', arrivalDate: AT('02'), arrivalTime: '07:00',
  amountMinor: 20000, currency: 'CNY', priceBasis: 'per_person', availability: 'available',
  fetchedAt: '2026-09-25T02:00:00.000Z', bookingTarget: { kind: 'manual', label: '人工复核' },
  transportDetail: { mode: 'train', departureDate: AT('01') },
  provenance: { sourceType: 'live', provider: 'juhe', sourceRef: '817', fetchedAt: '2026-09-25T02:00:00.000Z', environment: 'test' }
}

test('a night train covering the rest window stays pending confirmation and consumes no lodging query', async () => {
  const { result, calls } = await runPipeline({
    request: nightTrainRequest(),
    evidenceForTransport: async () => ({ status: 'available', quotes: [NIGHT_TRAIN_QUOTE] }),
    evidenceForLodging: async () => ({ status: 'no_results', options: [] })
  })
  const overnight = result.journey.lodgingNeeds.find(need => need.status === 'night_train_rest_pending_confirmation')
  assert.ok(overnight, '夜车覆盖休息窗口的晚次必须保持 pending_confirmation')
  assert.equal(result.lodgingOptions.find(entry => entry.lodgingNeedId === overnight.id).status, 'pending_confirmation')
  const section = result.display.sections.find(row => row.id === `lodging:${overnight.id}`)
  assert.equal(section.subtitle, '夜车覆盖休息时段，请确认是否仍需住宿')
  assert.deepEqual(section.options, [])
  // 只有另一晚（needs_review）被查询，且该晚不额外制造“未检索”噪音。
  assert.equal(calls.lodging.length, 1)
  assert.deepEqual(result.plan.validation.warnings.filter(row => row.code === 'LODGING_NOT_SEARCHED').map(row => row.targetId),
    result.lodgingOptions.filter(entry => entry.status === 'no_results').map(entry => entry.lodgingNeedId))
  assert.equal(result.display.notes.some(note => note.code === 'LODGING_NOT_SEARCHED' && note.sectionId === `lodging:${overnight.id}`), false)
})

test('no_results means "no candidate found", never "no rooms" or "no hotels nearby"', async () => {
  const { result } = await runPipeline({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]), evidenceForLodging: async () => ({ status: 'no_results', options: [] }) })
  assert.deepEqual(result.lodgingOptions.map(entry => entry.status), ['no_results', 'no_results'])
  const section = result.display.sections.find(row => row.kind === 'lodging')
  assert.equal(section.subtitle, '附近暂未检索到住宿地点候选')
  assert.deepEqual(section.options, [])
  assert.equal(section.dataStatus, 'live', '本次地点检索确实执行过')
  const serialized = JSON.stringify(result.display)
  for (const token of ['无房', '没有酒店', '满房', '已订满', '可预订', '已预订']) {
    assert.equal(serialized.includes(token), false, `display 不得出现“${token}”`)
  }
  const note = result.display.notes.find(row => row.code === 'LODGING_NOT_SEARCHED')
  assert.equal(note.severity, 'info')
  assert.equal(note.sectionId, section.id)
})

// ---------------------------------------------------------------- 端到端：失败不得影响可行性

test('a lodging failure never enters plan.errors and never changes feasibility, partial or taskStatus', async () => {
  const failures = [
    ['unavailable', async () => { throw Object.assign(new Error('腾讯地图查询失败（120），请联系开发者检查配额和服务权限'), { status: 502 }) }],
    ['budget_exhausted', async () => { throw Object.assign(new Error('本轮真实查询次数已用完'), { code: 'PROVIDER_SESSION_LIMIT', status: 429 }) }],
    ['no_results', async () => ({ status: 'no_results', options: [] })]
  ]
  const baseline = await runPipeline({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]), jobId: 'baseline' })
  assert.equal(baseline.result.lodgingOptions.every(entry => entry.status === 'available'), true)
  for (const [name, reader] of failures) {
    const { result } = await runPipeline({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]), evidenceForLodging: reader, jobId: `fail-${name}` })
    assert.equal(result.plan.validation.errors.some(row => row.code === 'LODGING_NOT_SEARCHED'), false, name)
    assert.equal(result.plan.validation.errors.length, baseline.result.plan.validation.errors.length, name)
    assert.equal(result.plan.feasibility, baseline.result.plan.feasibility, `${name} 不得单独把 valid 降为 needs_review`)
    assert.equal(result.partial, baseline.result.partial, name)
    assert.equal(result.plan.taskStatus, baseline.result.plan.taskStatus, name)
    // 失败只允许产出 info 级受控提示。
    const rows = result.plan.validation.warnings.filter(row => row.code === 'LODGING_NOT_SEARCHED')
    assert.equal(rows.length, 2, name)
    assert.equal(result.display.notes.filter(note => note.code === 'LODGING_NOT_SEARCHED').every(note => note.severity === 'info'), true, name)
    assert.equal(result.display.header.feasibility, baseline.result.display.header.feasibility, name)
  }
})

test('an anchor_missing night and a searched night are reported separately with their own section', async () => {
  const built = request([menuItem('a', '活动', 0, 43.9, 125.35, { startAt: AT('03T09:00:00+08:00'), endAt: AT('03T20:00:00+08:00') })])
  built.origin = place('origin', '起点', 43.8171, 125.3235, '220100', { provider: 'manual', coordinateSystem: 'WGS84' })
  built.menuItems = [{ ...built.menuItems[0], placeRef: place('a-place', '活动', 43.9, 125.35, '220100', { provider: 'manual', coordinateSystem: 'WGS84' }) }]
  const { result, calls } = await runPipeline({ request: built })
  assert.deepEqual(result.lodgingOptions.map(entry => entry.status), ['anchor_missing', 'anchor_missing'])
  assert.equal(calls.lodging.length, 0, '没有合法锚点就绝不查询')
  assert.equal(result.lodgingOptions.every(entry => entry.anchor === null), true)
  for (const entry of result.lodgingOptions) {
    const section = result.display.sections.find(row => row.id === `lodging:${entry.lodgingNeedId}`)
    assert.equal(section.subtitle, '附近住宿候选待检索')
    assert.equal(section.dataStatus, 'unknown')
    const note = result.display.notes.find(row => row.code === 'LODGING_NOT_SEARCHED' && row.sectionId === section.id)
    assert.ok(note, `${entry.lodgingNeedId} 必须有定位到自己的 LODGING_NOT_SEARCHED`)
    assert.equal(note.severity, 'info')
  }
  assert.equal(result.plan.validation.errors.length, 0)
})

// ---------------------------------------------------------------- 端到端：不改变住宿原始事实（§6）

test('map lodging candidates never write hotel facts or confirm a night', async () => {
  const { result } = await runPipeline({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]) })
  assert.equal(result.journey.confirmedHotelNights, 0)
  assert.equal(result.journey.requestedNights, 2)
  assert.equal(result.journey.complete, false)
  for (const need of result.journey.lodgingNeeds) {
    assert.equal(need.status, 'needs_review')
    assert.equal(need.hotelId, null)
    assert.equal(need.roomTypeId, null)
    assert.equal(need.amountMinor, null)
    assert.equal(need.availability, 'unknown')
    assert.ok(need.gaps.includes('HOTEL_RATE_INVENTORY_UNAVAILABLE'))
  }
  const serialized = JSON.stringify(result.journey)
  assert.equal(serialized.includes('汉庭酒店'), false, '附近 POI 不得写回 journey 住宿事实')
  // 机器态确实拿到了候选，但只存在于 lodgingOptions。
  assert.equal(result.lodgingOptions[0].options.length, 1)
  assert.equal(result.lodgingOptions[0].options[0].name, '汉庭酒店(人民广场店)')
})

// ---------------------------------------------------------------- 端到端：display 边界（§8 / §9）

test('display lodging options only expose id/name/address/distanceText/dataStatus', async () => {
  const { result } = await runPipeline({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]) })
  const section = result.display.sections.find(row => row.kind === 'lodging')
  assert.equal(section.subtitle, '附近住宿候选已检索（仅地点信息）')
  assert.equal(section.dataStatus, 'live')
  assert.equal(section.options.length, 1)
  const option = section.options[0]
  assert.deepEqual(Object.keys(option).sort(), ['address', 'dataStatus', 'distanceText', 'id', 'name'])
  assert.equal(option.id, '1001')
  assert.equal(option.name, '汉庭酒店(人民广场店)')
  assert.equal(option.address, '长春市朝阳区人民大街 1 号')
  assert.equal(option.dataStatus, 'live')
  // 直线距离必须写明“直线”，不得写成步行/车程或“距离酒店”。
  assert.match(option.distanceText, /^直线约 [\d.]+ (m|km)$/)
  assert.equal(/步行|车程|分钟|驾车/.test(option.distanceText), false)
  // available 只描述地点信息：价格与库存必须继续写明未查询。
  assert.ok(section.facts.some(fact => fact.label === '价格与库存' && fact.value === '未查询'))
  assert.ok(section.facts.some(fact => fact.label === '房间' && fact.value === '1 间'))
  assert.ok(result.display.notes.some(note => note.code === 'HOTEL_QUOTE_MISSING' && note.severity === 'info'))
})

test('the whole display payload stays free of price, inventory, booking and provider diagnostics', async () => {
  const { result } = await runPipeline({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]) })
  const keys = collectKeys(result.display)
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.equal(keys.includes(forbidden), false, `display 不得包含字段 ${forbidden}`)
  }
  const serialized = JSON.stringify(result.display)
  for (const token of ['providerPlaceId', 'coordinateSystem', 'gcj02', 'PROVIDER_SESSION_LIMIT', 'fieldScope', 'provenance']) {
    assert.equal(serialized.includes(token), false, `display 不得泄漏 ${token}`)
  }
  // 机器态仍然保留可以定位候选的稳定身份与诊断时间，供后端排查。
  assert.equal(result.lodgingOptions[0].options[0].providerPlaceId, '1001')
  assert.equal(typeof result.lodgingOptions[0].anchor.at, 'string')
})

test('executionMode counts the lodging reader as server evidence', async () => {
  // 只有住宿 reader 时也必须被识别为 server_evidence。
  const lodgingOnly = await runPipeline({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]), evidenceForRoutes: null })
  assert.equal(lodgingOnly.result.executionMode, 'server_evidence')
  assert.equal(lodgingOnly.calls.lodging.length, 2)
  // reader 存在但没有任何一次真实检索（required=false）时，executionMode 只表示执行器能力，
  // 不代表“酒店已查询”。
  const skipped = await runPipeline({
    request: request([menuItem('a', '活动', 0, 43.9, 125.35)], { lodgingPreferences: { rooms: 1, required: false } }),
    evidenceForRoutes: null
  })
  assert.equal(skipped.result.executionMode, 'server_evidence')
  assert.equal(skipped.calls.lodging.length, 0)
  assert.equal(skipped.result.lodgingOptions.every(entry => entry.options.length === 0), true)

  const fullyLocal = createPlanningExecutor({ now: () => NOW })
  const localResult = await fullyLocal({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]), job: { id: 'local' }, signal: new AbortController().signal })
  assert.equal(localResult.executionMode, 'local_evidence_only')
  assert.deepEqual(localResult.lodgingOptions.map(entry => entry.status), ['not_queried', 'not_queried'])
})

test('a plan without any lodging need keeps the projection unchanged', async () => {
  const executor = createPlanningExecutor({ now: () => NOW, evidenceForLodging: async () => ({ status: 'available', options: [lodgingOption()] }) })
  const result = await executor({ request: request([menuItem('a', '活动', 0, 43.9, 125.35)]), job: { id: 'single-day' }, signal: new AbortController().signal })
  assert.ok(result.journey.lodgingNeeds.length >= 0)
  assert.equal(Array.isArray(result.lodgingOptions), true)
  assert.equal(result.lodgingOptions.length, result.journey.lodgingNeeds.length)
})
