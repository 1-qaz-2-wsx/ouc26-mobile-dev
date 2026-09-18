const test = require('node:test')
const assert = require('node:assert/strict')
const { buildRulePlan } = require('../src/planning/rule-planner')
const { createPlanningService } = require('../src/planning/service')
const {
  CODE_TEXT, DISPLAY_SCHEMA, computeFeasibility, projectDisplay, severityOf
} = require('../src/planning/display-projection')

const SEVERITIES = ['info', 'action_required', 'blocked']
const FEASIBILITIES = ['valid', 'needs_review', 'blocked']
const FORBIDDEN_KEYS = ['message', 'reason', 'details', 'url', 'deeplink', 'bookingTarget', 'bookingUrl', 'purchaseUrl']

// display-contract.md §6.1 冻结的公共 code 基线：任何一个缺失都意味着映射表回退。
const REQUIRED_CODES = [
  'PLAN_VALID', 'GENERAL_REVIEW_REQUIRED', 'GENERAL_BLOCKED',
  'STATION_TRANSFERS_UNCONFIRMED', 'TRANSPORT_PLACEMENT_UNCONFIRMED', 'TRANSPORT_QUOTE_MISSING',
  'TRANSPORT_QUOTE_UNSELECTED', 'TRANSPORT_QUOTE_UNBOUND', 'TRANSPORT_QUOTE_REJECTED', 'TEST_ENVIRONMENT',
  // B3-4 §5：显式 transport demand 的逐段失败状态必须是各自可区分的受控语义。
  'TRANSPORT_NO_QUOTES', 'TRANSPORT_QUERY_BUDGET_EXHAUSTED', 'TRANSPORT_QUERY_OUT_OF_WINDOW',
  'TRANSPORT_PROVIDER_DISABLED', 'TRANSPORT_PROVIDER_NOT_CONFIGURED', 'TRANSPORT_QUERY_UNAVAILABLE',
  'TRANSPORT_NOT_QUERIED',
  'HOTEL_QUOTE_MISSING', 'TRANSFER_QUOTE_MISSING', 'LODGING_NOT_SEARCHED', 'CITY_EXPANSION_PENDING',
  'MAP_EVIDENCE_MISSING', 'MAP_EVIDENCE_UNAVAILABLE', 'POI_SCHEDULE_EVIDENCE_UNAVAILABLE',
  'CANDIDATE_CITY_MEMBERSHIP_UNCONFIRMED', 'NO_ELIGIBLE_POI', 'UNRESOLVED_PLACE_LEVEL',
  'CITY_STAY_EXCEEDS_TRIP', 'BUDGET_EXCEEDED', 'OPTIMIZATION_FALLBACK_TO_FEASIBLE_BASELINE',
  'ROUTE_EVIDENCE_UNAVAILABLE', 'TRANSFER_EVIDENCE_MISSING', 'ROUTE_TIME_NEEDS_REVIEW',
  'ROUTE_EVIDENCE_INVALID', 'ROUTE_DEMAND_UNKNOWN', 'ROUTE_CHAIN_AMBIGUOUS', 'ROUTE_LEG_INVALID',
  'ROUTE_LEG_ID_DUPLICATE', 'ROUTE_ENDPOINT_DISCONNECTED', 'ROUTE_TIME_CONFLICT', 'ROUTE_ARRIVES_TOO_LATE',
  'ROUTE_DURATION_MISMATCH', 'ROUTE_PROVENANCE_MISSING', 'ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED',
  'ROUTE_LEG_BLOCKED', 'ROUTE_DESTINATION_MISMATCH', 'LOCK_TARGET_NOT_FOUND', 'ORDER_LOCK_POSITION_REQUIRED',
  'ORDER_LOCK_POSITION_INVALID', 'ORDER_LOCK_CONFLICT', 'ORDER_LOCK_DUPLICATE_TARGET', 'ORDER_LOCK_VIOLATION',
  'ORDER_LOCK_CONFLICT_WITH_EXPLICIT_ORDER', 'TIME_LOCK_INVALID', 'TIME_LOCK_CONFLICT',
  'TIME_LOCK_DURATION_CONFLICT', 'TIME_LOCK_VIOLATION', 'LOCKED_TIME_CONFLICT',
  'ITEM_OUTSIDE_REQUEST_WINDOW', 'TIME_ORDER_CONFLICT', 'TIME_WINDOW_CONFLICT', 'SOURCE_CONSTRAINT_MISSING',
  'ACTIVITY_TRANSPORT_OVERLAP', 'TRANSPORT_ARRIVAL_TARGET_CONFLICT'
]

function place(id, name, lat, lng, adcode = '220100') {
  return { provider: 'tencent-map', providerPlaceId: id, name, type: 'poi', coordinate: { lat, lng }, coordinateSystem: 'GCJ-02', adcode }
}

function item(id, name, inputOrder, lat, lng, duration = 120, extra = {}) {
  return {
    menuItemId: id, occurrenceId: `${id}-occurrence`, placeRef: place(id, name, lat, lng), role: 'must_visit',
    inputOrder, required: true, stayRequirement: 'must_visit', visitDuration: { minutes: duration },
    preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-16T20:00:00+08:00' },
    ...extra
  }
}

function request(items, overrides = {}) {
  return {
    schemaVersion: 'real-travel-plan-request.v1',
    clientRequestId: 'display-001',
    origin: place('origin', '长春站', 43.8171, 125.3235),
    endDestination: place('destination', '哈尔滨站', 45.7733, 126.6572, '230100'),
    startAt: '2026-09-16T08:00:00+08:00',
    endBy: '2026-09-18T23:00:00+08:00',
    timezone: 'Asia/Shanghai',
    travelers: { adults: 2, children: [8] },
    budget: { amountMinor: 500000, currency: 'CNY', basis: 'party', includedCategories: ['transport', 'lodging'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true, maxTransfers: 1, seatType: 'hard_sleeper', cabin: 'economy' },
    transportDemand: { mode: 'train', serviceDate: '2026-09-16', departure: { name: '长春', code: 'CCT' }, arrival: { name: '南岔', code: 'NCB' } },
    lodgingPreferences: { rooms: 1, roomType: 'standard', bedType: 'double', breakfast: false },
    interests: ['人文'], pace: 'balanced', menuItems: items, optimizeOrder: true, locks: [],
    confirmedConstraints: [], sourceInput: { type: 'manual_menu' },
    ...overrides
  }
}

// 无报价、且用户明确不需要住宿：只剩 TRANSPORT_QUOTE_MISSING / TRANSFER_QUOTE_MISSING 两条 info 缺口。
function infoOnlyPlan() {
  return buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { lodgingPreferences: { rooms: 1, required: false } }),
    now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'display-info-only'
  })
}

function withDiagnostics(plan, { errors = [], warnings = [] }) {
  const copy = structuredClone(plan)
  copy.validation.errors = errors.map(row => ({ ...row }))
  copy.validation.warnings = warnings.map(row => ({ ...row }))
  return copy
}

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) { value.forEach(entry => collectKeys(entry, keys)); return keys }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) { keys.push(key); collectKeys(nested, keys) }
  }
  return keys
}

function mockRouteEvidence({ demands }) {
  return demands.map((demand, index) => ({
    demandId: demand.demandId,
    legs: [{
      legId: `mock-leg-${index}`, from: demand.from, to: demand.to, mode: 'car', serviceDate: '2026-09-16',
      departureAt: demand.readyAt,
      arrivalAt: new Date(Date.parse(demand.readyAt) + 30 * 60000).toISOString(),
      durationMinutes: 30, routeGeometry: { source: 'fixture' }, quoteRef: null, status: 'available',
      provenance: { provider: 'fixture-route', sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: '2026-09-15T10:00:00Z' }
    }]
  }))
}

test('display projection exposes planning-display.v1 without leaking internal text or links', () => {
  const plan = infoOnlyPlan()
  const display = projectDisplay({ plan, cityExpansions: [], routeAudit: null, journey: null })

  assert.equal(display.schemaVersion, DISPLAY_SCHEMA)
  assert.ok(display.header && typeof display.header.title === 'string' && display.header.title.length)
  assert.ok(display.header.range && display.header.party)
  assert.ok(FEASIBILITIES.includes(display.header.feasibility))
  assert.ok(['complete', 'partial'].includes(display.header.coverage))
  assert.ok(['live', 'mixed', 'manual', 'demo'].includes(display.header.dataMode))
  assert.ok(Array.isArray(display.header.badges) && display.header.badges.length)
  assert.ok(display.header.badges.every(badge => SEVERITIES.includes(badge.severity) && !Object.hasOwn(badge, 'tone')))
  assert.ok(Array.isArray(display.sections) && Array.isArray(display.notes))

  const keys = collectKeys(display)
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.equal(keys.includes(forbidden), false, `display 不应包含字段 ${forbidden}`)
  }
  assert.equal(display.sections.every(section => !Object.hasOwn(section, 'message')), true)
})

test('every frozen public code has a controlled severity/title/action mapping', () => {
  for (const code of REQUIRED_CODES) {
    const entry = CODE_TEXT[code]
    assert.ok(entry, `缺少公共 code 映射：${code}`)
    assert.ok(SEVERITIES.includes(entry.severity), `${code} severity 非法`)
    assert.equal(typeof entry.title === 'string' && entry.title.trim().length > 0, true, `${code} 缺少 title`)
    assert.equal(typeof entry.action === 'string' && entry.action.trim().length > 0, true, `${code} 缺少 action`)
    assert.equal(severityOf(code), entry.severity)
  }
  // 映射表中的每个 code 都必须能投影成同 code、同文案的受控 note。
  for (const [code, entry] of Object.entries(CODE_TEXT)) {
    if (code === 'PLAN_VALID' || code === 'MOCK_DATA') continue
    const plan = withDiagnostics(infoOnlyPlan(), { warnings: [{ code, message: '不应出现的内部文本' }] })
    const display = projectDisplay({ plan })
    const note = display.notes.find(row => row.code === code)
    assert.ok(note, `${code} 未生成 note`)
    assert.equal(note.title, entry.title)
    assert.equal(note.action, entry.action)
    assert.equal(JSON.stringify(display).includes('不应出现的内部文本'), false, `${code} 透传了内部文本`)
  }
})

test('unknown codes fall back to a controlled code instead of forwarding their message', () => {
  const plan = withDiagnostics(infoOnlyPlan(), {
    warnings: [{ code: 'TOTALLY_UNKNOWN_CODE', message: 'RAW_INTERNAL_SENTINEL' }]
  })
  const display = projectDisplay({ plan })
  assert.ok(display.notes.some(note => note.code === 'GENERAL_REVIEW_REQUIRED'))
  assert.equal(display.notes.some(note => note.code === 'TOTALLY_UNKNOWN_CODE'), false)
  assert.equal(JSON.stringify(display).includes('RAW_INTERNAL_SENTINEL'), false)

  const blockedPlan = withDiagnostics(infoOnlyPlan(), { errors: [{ code: 'ANOTHER_UNKNOWN', message: 'RAW_ERROR_SENTINEL' }] })
  const blockedDisplay = projectDisplay({ plan: blockedPlan })
  assert.ok(blockedDisplay.notes.some(note => note.code === 'GENERAL_BLOCKED'))
  assert.equal(JSON.stringify(blockedDisplay).includes('RAW_ERROR_SENTINEL'), false)
})

test('feasibility follows severity: info stays valid, action_required downgrades, errors block', () => {
  const info = projectDisplay({ plan: infoOnlyPlan() })
  assert.equal(info.header.feasibility, 'valid')
  assert.equal(info.header.coverage, 'complete')
  assert.deepEqual(new Set(info.notes.map(note => note.code)), new Set(['TRANSPORT_QUOTE_MISSING', 'TRANSFER_QUOTE_MISSING']))
  assert.ok(info.notes.every(note => note.severity === 'info'))

  const review = projectDisplay({
    plan: withDiagnostics(infoOnlyPlan(), { warnings: [{ code: 'TEST_ENVIRONMENT' }, { code: 'HOTEL_QUOTE_MISSING' }] })
  })
  assert.equal(review.header.feasibility, 'needs_review')
  assert.equal(review.header.coverage, 'partial')
  assert.ok(review.header.badges.some(badge => badge.code === 'GENERAL_REVIEW_REQUIRED'))

  const blocked = projectDisplay({ plan: withDiagnostics(infoOnlyPlan(), { errors: [{ code: 'BUDGET_EXCEEDED' }] }) })
  assert.equal(blocked.header.feasibility, 'blocked')
  assert.equal(blocked.header.coverage, 'partial')
  assert.ok(blocked.notes.some(note => note.severity === 'blocked'))

  // computeFeasibility 是 plan.feasibility 与 display.header.feasibility 的共同依据。
  assert.equal(computeFeasibility([], [{ code: 'HOTEL_QUOTE_MISSING' }]), 'valid')
  assert.equal(computeFeasibility([], [{ code: 'TEST_ENVIRONMENT' }]), 'needs_review')
  assert.equal(computeFeasibility([{ code: 'TIME_WINDOW_CONFLICT' }], []), 'blocked')
})

test('unknown cost is never zeroed and partial cost keeps its unknown categories', () => {
  const plan = infoOnlyPlan()
  const display = projectDisplay({ plan })
  assert.equal(plan.costSummary.knownTotal, null)
  assert.equal(display.header.cost.knownMinor, null)
  assert.equal(display.header.cost.status, 'unknown')
  assert.ok(display.header.cost.unknownCategories.includes('transport'))
  assert.ok(display.header.cost.unknownCategories.includes('local_transfer'))
  assert.notEqual(display.header.cost.knownMinor, 0)

  const withQuote = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { travelers: { adults: 2, children: [] }, budget: { amountMinor: 20000, currency: 'CNY', basis: 'person', includedCategories: ['transport'], strict: true } }),
    transportQuotes: [{
      provider: 'juhe', providerId: '817', environment: 'test', mode: 'train', productId: 'K1393', serviceNo: 'K1393',
      quoteId: 'juhe-train-817:2026-09-16:K1393', from: '长春', to: '南岔', fromCode: 'CCT', toCode: 'NCB',
      departureDate: '2026-09-16', departureTime: '18:53', arrivalDate: '2026-09-17', arrivalTime: '03:23',
      amountMinor: 14400, currency: 'CNY', priceBasis: 'per_person', availability: 'available',
      fetchedAt: '2026-09-15T10:17:53.110Z', bookingTarget: { kind: 'manual', label: '人工复核' },
      provenance: { sourceType: 'live', provider: 'juhe', sourceRef: '817', fetchedAt: '2026-09-15T10:17:53.110Z', environment: 'test' }
    }],
    now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'display-cost-partial'
  })
  const partial = projectDisplay({ plan: withQuote })
  assert.equal(partial.header.cost.status, 'partial')
  assert.equal(partial.header.cost.knownMinor, withQuote.costSummary.knownTotal)
  assert.ok(partial.header.cost.unknownCategories.length)
})

test('a plan with lodgingPreferences.required === false never shows a misleading hotel block', () => {
  const plan = infoOnlyPlan()
  assert.equal(plan.inputSnapshot.lodgingPreferences.required, false)
  assert.equal(plan.validation.warnings.some(row => row.code === 'HOTEL_QUOTE_MISSING'), false)
  const journey = {
    days: [], conflicts: [],
    lodgingNeeds: [{ id: 'lodging-2026-09-16', checkInDate: '2026-09-16', rooms: 1, status: 'not_required_by_user' }]
  }
  const display = projectDisplay({ plan, cityExpansions: [], routeAudit: null, journey })
  assert.equal(display.header.feasibility, 'valid')
  assert.equal(display.notes.some(note => ['HOTEL_QUOTE_MISSING', 'LODGING_NOT_SEARCHED'].includes(note.code)), false)
  assert.equal(display.notes.some(note => note.severity !== 'info'), false)
  const lodgingSections = display.sections.filter(section => section.kind === 'lodging')
  assert.equal(lodgingSections.length, 1)
  assert.equal(lodgingSections[0].severity, 'info')
  assert.equal(lodgingSections[0].subtitle, '用户选择不安排住宿')
  assert.equal(lodgingSections[0].id, 'lodging:lodging-2026-09-16')
})

test('pipeline returns display and only action_required facts make the task partial', async () => {
  const service = createPlanningService({ evidenceForRoutes: mockRouteEvidence })
  const created = service.jobs.create({
    ownerId: 'a', idempotencyKey: 'display-valid',
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { lodgingPreferences: { rooms: 1, required: false } })
  })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(done.result.display.schemaVersion, DISPLAY_SCHEMA)
  assert.equal(done.result.plan.feasibility, 'valid')
  assert.equal(done.result.display.header.feasibility, 'valid')
  assert.equal(done.result.partial, false, '纯 info 缺口不应把任务标记为 partial')
  assert.equal(done.taskStatus, 'succeeded')
  assert.ok(done.result.display.notes.every(note => note.severity === 'info'))
  assert.equal(collectKeys(done.result.display).some(key => FORBIDDEN_KEYS.includes(key)), false)
})

test('pipeline surfaces city expansion as an action note and a matching unresolved section', async () => {
  const city = item('city', '长春', 0, 43.82, 125.32)
  city.placeRef.type = 'city'
  city.stayDays = 1
  const service = createPlanningService({ evidenceForRoutes: mockRouteEvidence })
  const created = service.jobs.create({
    ownerId: 'a', idempotencyKey: 'display-city',
    request: request([city], { lodgingPreferences: { rooms: 1, required: false } })
  })
  const done = await service.jobs.run({ ownerId: 'a', jobId: created.job.id })
  const display = done.result.display
  assert.equal(display.header.feasibility, 'needs_review')
  assert.equal(done.result.partial, true)
  const note = display.notes.find(row => row.code === 'CITY_EXPANSION_PENDING')
  assert.ok(note && note.severity === 'action_required')
  const section = display.sections.find(row => row.kind === 'unresolved')
  assert.ok(section, '城市锚点必须生成 unresolved section，而不是可执行活动')
  assert.equal(section.id, 'unresolved:CITY_EXPANSION_PENDING:city')
  assert.equal(section.severity, 'action_required')
  assert.ok(section.facts.some(fact => fact.label === '城市' && fact.value === '长春'))
  assert.equal(note.sectionId, section.id)
  assert.equal(display.sections.some(row => row.kind === 'place' && row.title === '长春'), false)
})

// 测试环境下的真实班次报价：用于验证交通类 note 能定位到已选路段。
function testTrainQuote() {
  return {
    provider: 'juhe', providerId: '817', environment: 'test', mode: 'train', productId: 'K1393', serviceNo: 'K1393',
    quoteId: 'juhe-train-817:2026-09-16:K1393', from: '长春', to: '南岔', fromCode: 'CCT', toCode: 'NCB',
    departureDate: '2026-09-16', departureTime: '18:53', arrivalDate: '2026-09-17', arrivalTime: '03:23',
    amountMinor: 14400, currency: 'CNY', priceBasis: 'per_person', availability: 'available',
    fetchedAt: '2026-09-15T10:17:53.110Z', bookingTarget: { kind: 'manual', label: '人工复核' },
    provenance: { sourceType: 'live', provider: 'juhe', sourceRef: '817', fetchedAt: '2026-09-15T10:17:53.110Z', environment: 'test' }
  }
}

test('transport notes point at the selected leg section instead of dangling', () => {
  const plan = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { travelers: { adults: 2, children: [] } }),
    transportQuotes: [testTrainQuote()],
    now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'display-leg-link'
  })
  assert.equal(plan.legs.length, 1, '已选报价必须生成一条路段')
  const legSectionId = `leg:${plan.legs[0].legId}`
  const display = projectDisplay({ plan, cityExpansions: [], routeAudit: null, journey: null })

  const legSection = display.sections.find(section => section.kind === 'leg')
  assert.ok(legSection, '已选路段必须生成 leg section')
  assert.equal(legSection.id, legSectionId)

  // 交通类 note 必须带 sectionId，不能是悬空提示。
  for (const code of ['TEST_ENVIRONMENT', 'TRANSPORT_PLACEMENT_UNCONFIRMED']) {
    const note = display.notes.find(row => row.code === code)
    assert.ok(note, `缺少 ${code} note`)
    assert.equal(note.sectionId, legSectionId, `${code} 应定位到已选路段`)
  }

  // note 与 section 同源：动作提示要真的挂到路段上，严重度同步升级。
  assert.equal(legSection.severity, 'action_required')
  const actionCodes = legSection.actions.map(action => action.code)
  assert.ok(actionCodes.includes('TEST_ENVIRONMENT'))
  assert.ok(actionCodes.includes('TRANSPORT_PLACEMENT_UNCONFIRMED'))
  assert.equal(legSection.dataStatus, 'unknown', '测试环境路段不能标记为实时可购买')
  assert.equal(collectKeys(display).some(key => FORBIDDEN_KEYS.includes(key)), false)
})

// ---------------------------------------------------------------- B3-4 §6.2 / §6.3：demandId 定位

function carrierPlanForDisplay() {
  const plan = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { travelers: { adults: 2, children: [] } }),
    transportQuotes: [testTrainQuote()],
    now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'display-demand-link'
  })
  assert.equal(plan.legs.length, 1)
  assert.equal(typeof plan.legs[0].demandId, 'string')
  return plan
}

test('a demandId-only note locates the unique carrier leg section', () => {
  const plan = carrierPlanForDisplay()
  const sectionId = `leg:${plan.legs[0].legId}`
  // 只带 demandId 的受控提示（逐段交通状态）也必须能定位，而不是悬空。
  plan.validation.warnings.push({ code: 'TRANSPORT_QUOTE_UNBOUND', demandId: plan.legs[0].demandId, message: '内部文本不得外泄' })
  const display = projectDisplay({ plan })
  assert.equal(display.sections.some(section => section.id === sectionId && section.kind === 'leg'), true)
  const note = display.notes.find(row => row.code === 'TRANSPORT_QUOTE_UNBOUND')
  assert.ok(note)
  assert.equal(note.sectionId, sectionId, '唯一 selected carrier 时 demandId 必须定位到该 leg section')
  assert.equal(JSON.stringify(display).includes('内部文本不得外泄'), false)
})

test('a demand mapping to more than one leg section never guesses a target', () => {
  const plan = carrierPlanForDisplay()
  const duplicated = structuredClone(plan.legs[0])
  duplicated.legId = `${plan.legs[0].legId}#2`
  plan.legs.push(duplicated)
  plan.validation.warnings.push({ code: 'TRANSPORT_QUOTE_UNBOUND', demandId: plan.legs[0].demandId, message: '不猜绑定' })
  const display = projectDisplay({ plan })
  // 两条 leg 各自有独立 section，绝不合并成一张「交通总卡」。
  assert.equal(display.sections.filter(section => section.kind === 'leg').length, 2)
  assert.equal(new Set(display.sections.filter(section => section.kind === 'leg').map(section => section.id)).size, 2)
  // 同一 demand 对应多条 leg 时不建立映射，sectionId 保持 null。
  assert.equal(display.notes.find(row => row.code === 'TRANSPORT_QUOTE_UNBOUND').sectionId, null)
})

// ---------------------------------------------------------------- B4-2 §8 / §9：住宿 section 的附近候选

function lodgingJourney(needs) {
  return { days: [], conflicts: [], lodgingNeeds: needs.map(need => ({ rooms: 1, ...need })) }
}

function lodgingOption(id, name, lat, lng, overrides = {}) {
  return { provider: 'tencent-map', providerPlaceId: id, placeId: `qq-${id}`, name, address: `${name}地址`,
    coordinate: { lat, lng }, coordinateSystem: 'gcj02', category: '住宿服务;宾馆酒店', ...overrides }
}

function lodgingEntry(lodgingNeedId, status, { options = [], anchor = null } = {}) {
  return { lodgingNeedId, status, options, anchor }
}

function withLodging(plan, needIds, statuses) {
  // pipeline 只允许为这些状态补 info 级 LODGING_NOT_SEARCHED。
  const notSearched = ['no_results', 'budget_exhausted', 'unavailable', 'anchor_missing', 'not_queried']
  const warnings = needIds
    .map((id, index) => ({ id, status: statuses[index] }))
    .filter(row => notSearched.includes(row.status))
    .map(row => ({ code: 'LODGING_NOT_SEARCHED', targetId: row.id, message: '内部文本不得外泄' }))
  return warnings.length ? withDiagnostics(plan, { warnings }) : plan
}

test('an available lodging search exposes only the frozen option fields with a straight-line hint', () => {
  const journey = lodgingJourney([{ id: 'lodging-2026-09-16', checkInDate: '2026-09-16', status: 'needs_review' }])
  const anchor = { sourceKind: 'activity', sourceId: 'museum', at: '2026-09-16T12:00:00+08:00', location: { lat: 43.9, lng: 125.3 } }
  const display = projectDisplay({
    plan: infoOnlyPlan(), journey,
    lodgingOptions: [lodgingEntry('lodging-2026-09-16', 'available', {
      anchor,
      options: [lodgingOption('near', '近处酒店', 43.9, 125.3072), lodgingOption('far', '远处酒店', 43.92, 125.3)]
    })]
  })
  const section = display.sections.find(row => row.kind === 'lodging')
  assert.equal(section.id, 'lodging:lodging-2026-09-16')
  assert.equal(section.subtitle, '附近住宿候选已检索（仅地点信息）')
  assert.equal(section.dataStatus, 'live')
  assert.equal(section.severity, 'info')
  // §4.3 冻结形状：只有这五个字段，providerPlaceId / provenance 等机器态字段不得外泄。
  assert.equal(section.options.length, 2)
  for (const option of section.options) {
    assert.deepEqual(Object.keys(option).sort(), ['address', 'dataStatus', 'distanceText', 'id', 'name'])
    assert.equal(option.dataStatus, 'live')
    assert.match(option.distanceText, /^直线约 \d+ m$|^直线约 \d+\.\d km$/)
  }
  assert.equal(section.options[0].id, 'near')
  assert.equal(section.options[0].name, '近处酒店')
  assert.equal(section.options[0].address, '近处酒店地址')
  // 直线距离必须真的分远近，且不得写成步行 / 车程。
  const meters = option => Number.parseFloat(option.distanceText.replace(/[^\d.]/g, '')) * (option.distanceText.includes('km') ? 1000 : 1)
  assert.ok(meters(section.options[0]) < meters(section.options[1]))
  assert.equal(section.options.some(option => /步行|车程|驾车|分钟/.test(option.distanceText)), false)
  // 地点候选存在不等于有价：价格与库存必须继续写明未查询。
  assert.deepEqual(section.facts, [{ label: '房间', value: '1 间' }, { label: '价格与库存', value: '未查询' }])
  const keys = collectKeys(display)
  for (const forbidden of ['price', 'amountMinor', 'inventory', 'availability', 'roomType', 'bookable', 'providerPlaceId', 'provenance', 'coordinate']) {
    assert.equal(keys.includes(forbidden), false, `display 不得包含 ${forbidden}`)
  }
})

test('a no_results search stays a live place search without claiming anything about rooms', () => {
  const journey = lodgingJourney([{ id: 'lodging-2026-09-16', checkInDate: '2026-09-16', status: 'needs_review' }])
  const plan = withLodging(infoOnlyPlan(), ['lodging-2026-09-16'], ['no_results'])
  const display = projectDisplay({ plan, journey, lodgingOptions: [lodgingEntry('lodging-2026-09-16', 'no_results')] })
  const section = display.sections.find(row => row.kind === 'lodging')
  assert.equal(section.subtitle, '附近暂未检索到住宿地点候选')
  assert.deepEqual(section.options, [])
  // live 只表示“本次地点检索真实执行过”，不表示房态。
  assert.equal(section.dataStatus, 'live')
  const note = display.notes.find(row => row.code === 'LODGING_NOT_SEARCHED')
  assert.ok(note)
  assert.equal(note.severity, 'info')
  assert.equal(note.sectionId, section.id)
  assert.equal(note.title, CODE_TEXT.LODGING_NOT_SEARCHED.title)
  assert.equal(note.action, CODE_TEXT.LODGING_NOT_SEARCHED.action)
  const serialized = JSON.stringify(display)
  for (const token of ['无房', '没有酒店', '满房', '可预订', '已预订', '内部文本不得外泄']) {
    assert.equal(serialized.includes(token), false, `display 不得出现“${token}”`)
  }
})

test('every unresolved lodging search downgrades nothing and locates its own info note', () => {
  const needIds = ['lodging-2026-09-16', 'lodging-2026-09-17', 'lodging-2026-09-18', 'lodging-2026-09-19']
  const statuses = ['budget_exhausted', 'unavailable', 'anchor_missing', 'not_queried']
  const journey = lodgingJourney(needIds.map((id, index) => ({ id, checkInDate: `2026-09-1${6 + index}`, status: 'needs_review' })))
  const plan = withLodging(infoOnlyPlan(), needIds, statuses)
  const display = projectDisplay({ plan, journey, lodgingOptions: needIds.map((id, index) => lodgingEntry(id, statuses[index])) })
  for (const [index, id] of needIds.entries()) {
    const section = display.sections.find(row => row.id === `lodging:${id}`)
    assert.equal(section.subtitle, '附近住宿候选待检索', statuses[index])
    assert.equal(section.dataStatus, 'unknown', statuses[index])
    assert.deepEqual(section.options, [], statuses[index])
    assert.equal(section.severity, 'info', statuses[index])
    const note = display.notes.find(row => row.code === 'LODGING_NOT_SEARCHED' && row.sectionId === section.id)
    assert.ok(note, `${id} 必须有定位到自己的 info note`)
    assert.equal(note.severity, 'info')
  }
  // 住宿检索失败不构成硬约束：既不能升级 section，也不能影响可行性。
  assert.equal(display.header.feasibility, 'valid')
  assert.equal(computeFeasibility([], plan.validation.warnings), 'valid')
  assert.equal(display.sections.some(row => row.kind === 'lodging' && row.severity !== 'info'), false)
})

test('not_required and pending_confirmation nights never produce a not-searched note or fake options', () => {
  const journey = lodgingJourney([
    { id: 'lodging-2026-09-16', checkInDate: '2026-09-16', status: 'not_required_by_user' },
    { id: 'lodging-2026-09-17', checkInDate: '2026-09-17', status: 'night_train_rest_pending_confirmation' }
  ])
  const plan = infoOnlyPlan()
  const display = projectDisplay({
    plan, journey,
    // 即使上游给出了候选，用户明确不要住宿 / 夜车待确认时也不得展示住宿候选。
    lodgingOptions: [
      lodgingEntry('lodging-2026-09-16', 'not_required', { options: [lodgingOption('1', '不应出现', 43.9, 125.3)] }),
      lodgingEntry('lodging-2026-09-17', 'pending_confirmation', { options: [lodgingOption('2', '不应出现', 43.9, 125.3)] })
    ]
  })
  assert.equal(display.notes.some(row => row.code === 'LODGING_NOT_SEARCHED'), false)
  assert.equal(display.notes.some(row => row.code === 'HOTEL_QUOTE_MISSING'), false)
  assert.equal(display.header.feasibility, 'valid')
  const required = display.sections.find(row => row.id === 'lodging:lodging-2026-09-16')
  assert.equal(required.subtitle, '用户选择不安排住宿')
  assert.deepEqual(required.options, [])
  const pending = display.sections.find(row => row.id === 'lodging:lodging-2026-09-17')
  assert.equal(pending.subtitle, '夜车覆盖休息时段，请确认是否仍需住宿')
  assert.deepEqual(pending.options, [])
  assert.equal(JSON.stringify(display).includes('不应出现'), false)
})

test('a lodging projection without machine options keeps the previous neutral semantics', () => {
  const journey = lodgingJourney([{ id: 'lodging-2026-09-16', checkInDate: '2026-09-16', status: 'needs_review' }])
  const display = projectDisplay({ plan: infoOnlyPlan(), journey })
  const section = display.sections.find(row => row.kind === 'lodging')
  assert.equal(section.subtitle, '住宿地点、房型与价格待查询')
  assert.equal(section.dataStatus, 'unknown')
  assert.deepEqual(section.options, [])
})

// 2026-09-18 Owner 决定：方案页条件行需要「出发日期 / 天数 / 预算额度」，
// 交通卡需要聚合 API 返回的席别与参考票价。两者都必须是可选项：
// 没有数据时省略，绝不补 0、绝不把参考价写成可购买或已核验。
test('plan page additions: departure date, day count, planned budget and seat reference price', () => {
  const quote = Object.assign({}, testTrainQuote(), {
    environment: 'production',
    provenance: {
      sourceType: 'live', provider: 'juhe', sourceRef: '817',
      fetchedAt: '2026-09-15T10:17:53.110Z', environment: 'production'
    },
    selectedSeat: { name: '二等座', typeCode: 'O', amountMinor: 61200, availability: 'available', rawAvailability: '有票' },
    seatOptions: [{ name: '二等座', typeCode: 'O', amountMinor: 61200, availability: 'available', priceBasis: 'per_person' }]
  })
  const plan = buildRulePlan({
    request: request([item('museum', '博物馆', 0, 43.82, 125.32)], {
      travelers: { adults: 2, children: [] },
      budget: { amountMinor: 800000, currency: 'CNY', basis: 'party', includedCategories: ['transport'], strict: false }
    }),
    transportQuotes: [quote],
    now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'display-plan-page'
  })
  const display = projectDisplay({ plan, cityExpansions: [], routeAudit: null, journey: null })

  assert.equal(display.header.departureDate, '09-16')
  assert.equal(display.header.dayCount, 3)
  assert.equal(display.header.cost.plannedMinor, 800000, '预算额度按用户输入原样投影，不乘人数')
  assert.equal(display.header.cost.basis, 'party')

  const leg = display.sections.find(section => section.kind === 'leg')
  assert.equal(leg.mode, 'train', 'leg section 必须带受控的交通方式，页面不解析 facts 反推')
  const seat = leg.facts.find(fact => fact.label === '席别')
  const price = leg.facts.find(fact => fact.label === '参考票价')
  assert.equal(seat && seat.value, '二等座')
  assert.ok(price, '有 selectedSeat 时必须给出参考票价 fact')
  assert.match(price.value, /¥612\.00 \/ 人/)
  assert.match(price.value, /参考价，未核验/)
  assert.equal(/已核验$|可购买|已订/.test(price.value), false)
  // 参考价不得出现在 facts 以外的结构里，也不得把 provider 原文带出。
  assert.equal(collectKeys(display).some(key => FORBIDDEN_KEYS.includes(key)), false)

  // 没有 selectedSeat 的历史/接驳路段：整项省略，不补 0。
  const noSeat = projectDisplay({
    plan: buildRulePlan({
      request: request([item('museum', '博物馆', 0, 43.82, 125.32)], {
        travelers: { adults: 2, children: [] },
        budget: { amountMinor: null, currency: 'CNY', basis: 'party', includedCategories: ['transport'], strict: false }
      }),
      transportQuotes: [testTrainQuote()],
      now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'display-plan-page-no-seat'
    }),
    cityExpansions: [], routeAudit: null, journey: null
  })
  const noSeatLeg = noSeat.sections.find(section => section.kind === 'leg')
  assert.equal(noSeatLeg.facts.some(fact => fact.label === '席别'), false)
  assert.equal(noSeatLeg.facts.some(fact => fact.label === '参考票价'), false)
  assert.equal(noSeat.header.cost.plannedMinor, null, '没有预算时不给 0')

  // 测试环境的价格必须写明测试环境，不能被写成生产参考价。
  const testSeat = Object.assign({}, testTrainQuote(), {
    selectedSeat: { name: '硬卧', typeCode: '3', amountMinor: 14400, availability: 'available', rawAvailability: '有票' }
  })
  const testDisplay = projectDisplay({
    plan: buildRulePlan({
      request: request([item('museum', '博物馆', 0, 43.82, 125.32)], { travelers: { adults: 2, children: [] } }),
      transportQuotes: [testSeat],
      now: () => Date.parse('2026-09-15T10:00:00Z'), planId: 'display-plan-page-test-seat'
    }),
    cityExpansions: [], routeAudit: null, journey: null
  })
  const testPrice = testDisplay.sections.find(section => section.kind === 'leg').facts.find(fact => fact.label === '参考票价')
  assert.match(testPrice.value, /测试环境价，未核验/)
})
