// B3-1：多段交通数据契约 + carrier 判定层测试。
// 覆盖 specs/agent-tasks/round-03-workbuddy-b3-1.md §5 的 17 个必测场景。
// 本文件不访问任何真实供应商：node --test 每个测试文件独立进程，
// 因此下面的 require.cache 检查只反映本文件自身的导入。
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  CARRIER_DISTANCE_THRESHOLD_KM,
  DESTINATION_STOP_ID,
  adcodePrefix,
  bindTransportDemands,
  carrierDemandFor,
  carrierDemands,
  evaluateCarrierNeed,
  haversineKm,
  isDestinationRouteDemand,
  requiredCarrierDemands,
  routeDemandTargetMenuItemId,
  routeDemandToStopId,
  transportDemandTargetStopId
} = require('../src/planning/transport-demands')
const { normalizePlanRequest } = require('../src/planning/normalizer')
const { routeDemands } = require('../src/planning/route-audit')

const CHANGCHUN = { lat: 43.8171, lng: 125.3235 } // 220100
const HARBIN = { lat: 45.8038, lng: 126.5349 } // 230100
const NEARBY = { lat: 44.8171, lng: 125.3235 } // 与长春同纬度带约 111km

// routeDemands 产出的 from/to 是 PlaceRef：坐标必须嵌在 coordinate 下。
function point(base, adcode) {
  return { coordinate: { lat: base.lat, lng: base.lng }, ...(adcode === undefined ? {} : { adcode }) }
}

function routeDemand(from, to) {
  return { demandId: JSON.stringify(['origin', 'item:target']), from, to }
}

// ---------------------------------------------------------------- carrier 判定规则

test('under 150km with a shared adcode prefix is locally reachable, not a carrier demand', () => {
  const demand = routeDemand(point(CHANGCHUN, '220100'), point(NEARBY, '220100'))
  const result = carrierDemandFor(demand)
  assert.ok(result.distanceKm > 0 && result.distanceKm < CARRIER_DISTANCE_THRESHOLD_KM)
  assert.equal(result.carrier, 'not_required')
  assert.deepEqual(result.missingEvidence, [])
})

test('over 150km is a carrier demand', () => {
  const result = carrierDemandFor(routeDemand(point(CHANGCHUN, '220100'), point(HARBIN, '230100')))
  assert.ok(result.distanceKm > CARRIER_DISTANCE_THRESHOLD_KM)
  assert.equal(result.carrier, 'required')
  assert.ok(result.reasons.includes('DISTANCE_OVER_THRESHOLD'))
})

test('exactly 150km never triggers the distance rule', () => {
  const exact = evaluateCarrierNeed({ distanceKm: 150, fromAdcodePrefix: '2201', toAdcodePrefix: '2201' })
  assert.equal(exact.carrier, 'not_required')
  assert.deepEqual(exact.reasons, ['DISTANCE_WITHIN_THRESHOLD', 'ADCODE_PREFIX_SAME'])
  const justOver = evaluateCarrierNeed({ distanceKm: 150.0001, fromAdcodePrefix: '2201', toAdcodePrefix: '2201' })
  assert.equal(justOver.carrier, 'required')
  assert.deepEqual(justOver.reasons, ['DISTANCE_OVER_THRESHOLD'])
  // 恰好 150km 且无 adcode 时，距离规则不命中，因此仍是 unknown 而不是 not_required。
  const exactWithoutAdcode = evaluateCarrierNeed({ distanceKm: 150 })
  assert.equal(exactWithoutAdcode.carrier, 'unknown')
  assert.deepEqual(exactWithoutAdcode.missingEvidence, ['adcode'])
})

test('different adcode prefix is a carrier demand even when the distance is short', () => {
  const result = carrierDemandFor(routeDemand(point(CHANGCHUN, '220100'), point(NEARBY, '230100')))
  assert.ok(result.distanceKm < CARRIER_DISTANCE_THRESHOLD_KM)
  assert.equal(result.carrier, 'required')
  assert.deepEqual(result.reasons, ['ADCODE_PREFIX_DIFFERS'])
})

test('missing coordinates with a shared adcode prefix stay unknown', () => {
  const result = carrierDemandFor(routeDemand({ adcode: '220100' }, point(NEARBY, '220100')))
  assert.equal(result.carrier, 'unknown')
  assert.equal(result.distanceKm, null)
  assert.deepEqual(result.missingEvidence, ['distance'])
})

test('a short distance without usable adcode evidence stays unknown', () => {
  const result = carrierDemandFor(routeDemand(point(CHANGCHUN, '220100'), point(NEARBY, 'not-a-code')))
  assert.ok(result.distanceKm < CARRIER_DISTANCE_THRESHOLD_KM)
  assert.equal(result.carrier, 'unknown')
  assert.deepEqual(result.missingEvidence, ['adcode'])
})

test('missing coordinates and missing adcode never become a local verdict', () => {
  const result = carrierDemandFor(routeDemand({}, {}))
  assert.equal(result.carrier, 'unknown')
  assert.equal(result.distanceKm, null)
  assert.deepEqual(result.missingEvidence, ['distance', 'adcode'])
  // 缺失证据不得被当成 0km / 同城。
  assert.notEqual(result.carrier, 'not_required')
})

test('over 150km stays required even without adcode evidence', () => {
  const result = carrierDemandFor(routeDemand(point(CHANGCHUN, '220100'), point(HARBIN)))
  assert.ok(result.distanceKm > CARRIER_DISTANCE_THRESHOLD_KM)
  assert.equal(result.carrier, 'required')
  assert.deepEqual(result.reasons, ['DISTANCE_OVER_THRESHOLD'])
  assert.deepEqual(result.missingEvidence, ['adcode'])
})

test('different adcode prefix stays required even without coordinates', () => {
  const result = carrierDemandFor(routeDemand({ adcode: '220100' }, { adcode: '230100' }))
  assert.equal(result.carrier, 'required')
  assert.equal(result.distanceKm, null)
  assert.deepEqual(result.reasons, ['ADCODE_PREFIX_DIFFERS'])
})

test('distance and adcode helpers refuse unusable evidence instead of guessing', () => {
  assert.equal(haversineKm(point(CHANGCHUN), point(CHANGCHUN)), 0)
  assert.equal(haversineKm({}, point(HARBIN)), null)
  assert.equal(haversineKm({ coordinate: { lat: Number.NaN, lng: 125 } }, point(HARBIN)), null)
  assert.equal(haversineKm({ coordinate: { lat: 91, lng: 125 } }, point(HARBIN)), null)
  assert.equal(adcodePrefix({ adcode: '2201' }), null)
  assert.equal(adcodePrefix({ adcode: '220100' }), '2201')
  assert.equal(adcodePrefix({ adcode: ' 230100 ' }), '2301')
  assert.equal(adcodePrefix({}), null)
})

// ---------------------------------------------------------------- 契约兼容

function place(providerPlaceId, name, lat, lng, adcode) {
  return {
    provider: 'tencent-map',
    providerPlaceId,
    name,
    type: 'city',
    coordinate: { lat, lng },
    coordinateSystem: 'GCJ-02',
    adcode
  }
}

function menuItem(menuItemId, name, lat, lng, adcode, inputOrder) {
  return {
    menuItemId,
    occurrenceId: `occ-${menuItemId}`,
    placeRef: place(`${menuItemId}-place`, name, lat, lng, adcode),
    role: 'must_visit',
    inputOrder,
    required: true,
    stayRequirement: 'must_visit',
    visitDuration: { minutes: 120 },
    preferredWindow: { startAt: '2026-10-02T09:00:00+08:00', endAt: '2026-10-02T18:00:00+08:00' }
  }
}

function segment(targetMenuItemId, serviceDate = '2026-10-02') {
  return {
    mode: 'train',
    serviceDate,
    departure: { name: '长春', code: 'CCT' },
    arrival: { name: '哈尔滨', code: 'HGH' },
    targetMenuItemId
  }
}

// 缺省 targetMenuItemId 的段：在新数组语义中表示“最后一段 -> endDestination”。
function destinationSegment(serviceDate = '2026-10-03') {
  return { mode: 'train', serviceDate, departure: { name: '哈尔滨', code: 'HGH' }, arrival: { name: '漠河', code: 'MOA' } }
}

function request(overrides = {}) {
  return {
    schemaVersion: 'real-travel-plan-request.v1',
    clientRequestId: 'client-b3-1',
    origin: place('origin', '长春', CHANGCHUN.lat, CHANGCHUN.lng, '220100'),
    endDestination: place('destination', '哈尔滨', HARBIN.lat, HARBIN.lng, '230100'),
    startAt: '2026-10-01T08:00:00+08:00',
    endBy: '2026-10-03T20:00:00+08:00',
    timezone: 'Asia/Shanghai',
    travelers: { adults: 2, children: [] },
    budget: { amountMinor: 500000, currency: 'cny', basis: 'party', includedCategories: ['transport'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: false, maxTransfers: 1, seatType: 'second_class', cabin: 'economy' },
    lodgingPreferences: { rooms: 1, roomType: 'standard', bedType: 'double', breakfast: false },
    interests: ['人文'],
    pace: 'balanced',
    menuItems: [
      menuItem('museum', '伪满皇宫博物院', 43.9, 125.35, '220100', 0),
      menuItem('park', '太阳岛', 45.79, 126.58, '230100', 1)
    ],
    optimizeOrder: true,
    locks: [],
    confirmedConstraints: [],
    sourceInput: { type: 'manual_menu' },
    ...overrides
  }
}

function constraintErrors(input) {
  try {
    normalizePlanRequest(input)
    return null
  } catch (error) {
    assert.equal(error.code, 'INVALID_CONSTRAINTS')
    return error.fieldErrors || []
  }
}

test('legacy transportDemand becomes a canonical one-element transportDemands array', () => {
  const legacy = { mode: 'train', serviceDate: '2026-10-02', departure: { name: '长春', code: 'CCT' }, arrival: { name: '哈尔滨', code: 'HGH' }, targetMenuItemId: 'park' }
  const { normalizedRequest } = normalizePlanRequest(request({ transportDemand: legacy }))
  assert.equal(normalizedRequest.transportDemands.length, 1)
  assert.deepEqual(normalizedRequest.transportDemands[0], legacy)
  // 本批保留 legacy 单数字段，消费者迁移放到后续批次。
  assert.deepEqual(normalizedRequest.transportDemand, legacy)
})

test('transportDemands[] keeps the caller order and never reorders segments', () => {
  const demands = [segment('park', '2026-10-02'), segment('museum', '2026-10-03')]
  const { normalizedRequest } = normalizePlanRequest(request({ transportDemands: demands }))
  assert.deepEqual(normalizedRequest.transportDemands.map(item => item.targetMenuItemId), ['park', 'museum'])
  assert.deepEqual(normalizedRequest.transportDemands.map(item => item.serviceDate), ['2026-10-02', '2026-10-03'])
  assert.equal(normalizedRequest.transportDemand, null)
})

test('no transport input yields an empty canonical array and cloning does not alias the input', () => {
  const withoutInput = normalizePlanRequest(request())
  assert.deepEqual(withoutInput.normalizedRequest.transportDemands, [])
  const source = [segment('park')]
  const { normalizedRequest } = normalizePlanRequest(request({ transportDemands: source }))
  normalizedRequest.transportDemands[0].targetMenuItemId = 'mutated'
  assert.equal(source[0].targetMenuItemId, 'park')
  // 显式空数组不是“清空交通需求”的声明：旧单数需求仍然保留。
  const emptied = normalizePlanRequest(request({ transportDemand: segment('park'), transportDemands: [] }))
  assert.equal(emptied.normalizedRequest.transportDemands.length, 1)
})

test('a segment targeting a place outside the menu is rejected', () => {
  const fieldErrors = constraintErrors(request({ transportDemands: [segment('missing-place')] }))
  assert.ok(fieldErrors.some(item => item.path === 'transportDemands[0].targetMenuItemId'))
})

test('duplicate targetMenuItemId inside transportDemands[] is rejected', () => {
  const fieldErrors = constraintErrors(request({ transportDemands: [segment('park'), segment('park', '2026-10-03')] }))
  assert.ok(fieldErrors.some(item => item.path === 'transportDemands[1].targetMenuItemId'))
})

test('legacy transportDemand plus a non-empty transportDemands[] is rejected instead of silently merged', () => {
  const fieldErrors = constraintErrors(request({ transportDemand: segment('park'), transportDemands: [segment('museum')] }))
  assert.ok(fieldErrors.some(item => item.path === 'transportDemands'))
})

test('transportDemands[] items reject unsupported fields, including a client supplied demandId', () => {
  const withDemandId = constraintErrors(request({ transportDemands: [{ ...segment('park'), demandId: 'client-forged' }] }))
  assert.ok(withDemandId.some(item => item.path === 'transportDemands[0].demandId'))
  // 缺省 targetMenuItemId 的段同样不得自带 server demandId。
  const untargetedWithDemandId = constraintErrors(request({ transportDemands: [{ ...destinationSegment(), demandId: 'client-forged' }] }))
  assert.ok(untargetedWithDemandId.some(item => item.path === 'transportDemands[0].demandId'))
  const notAnObject = constraintErrors(request({ transportDemands: [null] }))
  assert.ok(notAnObject.some(item => item.path === 'transportDemands[0]'))
  const notAnArray = constraintErrors(request({ transportDemands: segment('park') }))
  assert.ok(notAnArray.some(item => item.path === 'transportDemands'))
})

test('a single legacy transportDemand still validates exactly as before', () => {
  assert.equal(constraintErrors(request({ transportDemand: segment('park') })), null)
  const legacyWithoutTarget = destinationSegment()
  assert.equal(constraintErrors(request({ transportDemand: legacyWithoutTarget })), null)
  const { normalizedRequest } = normalizePlanRequest(request({ transportDemand: legacyWithoutTarget }))
  assert.equal(normalizedRequest.transportDemands.length, 1)
  assert.deepEqual(normalizedRequest.transportDemand, legacyWithoutTarget)
  // legacy 兼容不变：canonical 包装不替它补出 targetMenuItemId。
  assert.equal(Object.hasOwn(normalizedRequest.transportDemands[0], 'targetMenuItemId'), false)
})

// ---------------------------------------------------------------- 与 server route demand 的关联

function routePlan() {
  const at = time => `2026-10-01T${time}:00+08:00`
  return {
    inputSnapshot: {
      origin: place('origin', '长春', CHANGCHUN.lat, CHANGCHUN.lng, '220100'),
      endDestination: place('destination', '哈尔滨', HARBIN.lat, HARBIN.lng, '230100'),
      startAt: at('08:00'),
      endBy: at('20:00'),
      menuItems: [
        { menuItemId: 'museum', placeRef: place('museum-place', '伪满皇宫博物院', 43.9, 125.35, '220100') },
        { menuItemId: 'park', placeRef: place('park-place', '太阳岛', 45.79, 126.58, '230100') }
      ]
    },
    plannedOrder: ['museum', 'park'],
    items: [
      { itemId: 'museum', startAt: at('10:00'), endAt: at('12:00') },
      { itemId: 'park', startAt: at('15:00'), endAt: at('18:00') }
    ],
    legs: []
  }
}

test('explicit segments bind to the server route demand by stop id only', () => {
  const demands = routeDemands(routePlan())
  assert.equal(demands.length, 3)
  assert.deepEqual(demands.map(routeDemandTargetMenuItemId), ['museum', 'park', null])
  assert.deepEqual(demands.map(routeDemandToStopId), ['item:museum', 'item:park', DESTINATION_STOP_ID])
  assert.deepEqual(demands.map(isDestinationRouteDemand), [false, false, true])
  const bound = bindTransportDemands([segment('park'), segment('museum', '2026-10-03')], demands)
  assert.deepEqual(bound.map(entry => entry.binding), ['bound', 'bound'])
  assert.deepEqual(bound.map(entry => entry.targetStopId), ['item:park', 'item:museum'])
  assert.equal(bound[0].demandId, demands[1].demandId)
  assert.equal(bound[1].demandId, demands[0].demandId)
  // 无法映射时保留 unbound，不靠站名相似度猜绑定。
  const unbound = bindTransportDemands([segment('not-planned')], demands)
  assert.deepEqual(unbound, [{ index: 0, targetMenuItemId: 'not-planned', targetStopId: 'item:not-planned', demandId: null, binding: 'unbound' }])
})

// ---------------------------------------------------------------- endDestination 绑定（B3-1-R1）

test('a single segment without targetMenuItemId is valid input and stays canonical', () => {
  const demands = [destinationSegment()]
  const { normalizedRequest } = normalizePlanRequest(request({ transportDemands: demands }))
  assert.equal(normalizedRequest.transportDemands.length, 1)
  assert.deepEqual(normalizedRequest.transportDemands[0], destinationSegment())
  assert.equal(Object.hasOwn(normalizedRequest.transportDemands[0], 'targetMenuItemId'), false)
  assert.equal(normalizedRequest.transportDemand, null)
})

test('a segment without targetMenuItemId binds to the final item -> destination route demand', () => {
  const demands = routeDemands(routePlan())
  const bound = bindTransportDemands([destinationSegment()], demands)
  assert.equal(bound[0].binding, 'bound')
  assert.equal(bound[0].targetStopId, DESTINATION_STOP_ID)
  assert.equal(bound[0].targetMenuItemId, null)
  assert.equal(bound[0].demandId, demands[2].demandId)
  assert.ok(isDestinationRouteDemand(demands.find(demand => demand.demandId === bound[0].demandId)))
  assert.deepEqual(transportDemandTargetStopId(destinationSegment()), DESTINATION_STOP_ID)
})

test('targeted and untargeted segments coexist and each binds to its own route demand', () => {
  const demands = routeDemands(routePlan())
  const bound = bindTransportDemands([segment('museum'), destinationSegment(), segment('park', '2026-10-04')], demands)
  assert.deepEqual(bound.map(entry => entry.binding), ['bound', 'bound', 'bound'])
  assert.deepEqual(bound.map(entry => entry.demandId), [demands[0].demandId, demands[2].demandId, demands[1].demandId])
  assert.deepEqual(new Set(bound.map(entry => entry.demandId)).size, 3)
})

test('two segments without targetMenuItemId are rejected as INVALID_CONSTRAINTS', () => {
  const fieldErrors = constraintErrors(request({ transportDemands: [destinationSegment(), destinationSegment('2026-10-04')] }))
  assert.ok(fieldErrors.some(item => item.path === 'transportDemands[1]'))
  // 一个无 target + 任意多个有 target 仍然合法。
  assert.equal(constraintErrors(request({ transportDemands: [segment('museum'), destinationSegment(), segment('park', '2026-10-04')] })), null)
})

test('an untargeted segment without any destination route stays unbound', () => {
  const demands = routeDemands(routePlan()).filter(demand => !isDestinationRouteDemand(demand))
  assert.equal(demands.length, 2)
  const bound = bindTransportDemands([destinationSegment()], demands)
  assert.deepEqual(bound, [{ index: 0, targetMenuItemId: null, targetStopId: DESTINATION_STOP_ID, demandId: null, binding: 'unbound' }])
})

test('binding never guesses from station names, array order or the only unmatched route', () => {
  const demands = routeDemands(routePlan())
  // 站名与最后一段完全一致的普通过路段：仍必须只按 stop id 绑定。
  const nameLookalike = { mode: 'train', serviceDate: '2026-10-02', departure: { name: '长春', code: 'CCT' }, arrival: { name: '哈尔滨', code: 'HGH' }, targetMenuItemId: 'museum' }
  const bound = bindTransportDemands([nameLookalike], demands)
  assert.equal(bound[0].demandId, demands[0].demandId)
  assert.notEqual(bound[0].demandId, demands[2].demandId)
  // 数组顺序不参与判定：无 target 的段排在最前也仍然指向 destination。
  const reordered = bindTransportDemands([destinationSegment(), segment('museum')], demands)
  assert.equal(reordered[0].demandId, demands[2].demandId)
  assert.equal(reordered[1].demandId, demands[0].demandId)
  // 既不是 item 也不是 destination 的 route：不得被当作“唯一剩下的那一段”。
  const strayRoute = [{ demandId: JSON.stringify(['origin', 'station:somewhere']), from: {}, to: {} }]
  assert.deepEqual(bindTransportDemands([destinationSegment()], strayRoute), [
    { index: 0, targetMenuItemId: null, targetStopId: DESTINATION_STOP_ID, demandId: null, binding: 'unbound' }
  ])
  assert.equal(routeDemandToStopId(strayRoute[0]), 'station:somewhere')
  assert.equal(isDestinationRouteDemand(strayRoute[0]), false)
})

test('a destination route demand is ambiguous when duplicated instead of picking one', () => {
  const demands = routeDemands(routePlan())
  const duplicated = [demands[2], { ...demands[2] }]
  const bound = bindTransportDemands([destinationSegment()], duplicated)
  assert.deepEqual(bound, [{ index: 0, targetMenuItemId: null, targetStopId: DESTINATION_STOP_ID, demandId: null, binding: 'ambiguous' }])
})

test('carrier judgement runs on real server route demands without extra inputs', () => {
  const demands = routeDemands(routePlan())
  const judged = carrierDemands(demands)
  assert.deepEqual(judged.map(entry => entry.carrier), ['not_required', 'required', 'not_required'])
  assert.deepEqual(requiredCarrierDemands(demands).map(entry => entry.demandId), [demands[1].demandId])
  assert.deepEqual(judged.map(entry => entry.demandId), demands.map(demand => demand.demandId))
  assert.deepEqual(demands.map(demand => ({ from: demand.from, to: demand.to })), [
    { from: routePlan().inputSnapshot.origin, to: routePlan().inputSnapshot.menuItems[0].placeRef },
    { from: routePlan().inputSnapshot.menuItems[0].placeRef, to: routePlan().inputSnapshot.menuItems[1].placeRef },
    { from: routePlan().inputSnapshot.menuItems[1].placeRef, to: routePlan().inputSnapshot.endDestination }
  ])
})

// ---------------------------------------------------------------- 零 provider 调用

test('carrier judgement never loads the provider layer and stays synchronous', () => {
  const providerModules = Object.keys(require.cache)
    .filter(key => /planning[\\/]providers[\\/]/.test(key) || /provider-(registry|budget)\.js$/.test(key))
  assert.deepEqual(providerModules, [])
  // 模块不导出任何查询入口。
  assert.deepEqual(Object.keys(require('../src/planning/transport-demands')).filter(key => /search|fetch|query|quote|provider|cache/i.test(key)), [])
  // 判定全部是同步纯函数：同样输入得到同样输出，且不返回 Promise。
  const first = carrierDemands(routeDemands(routePlan()))
  const second = carrierDemands(routeDemands(routePlan()))
  assert.deepEqual(first, second)
  for (const entry of first) assert.equal(entry.then, undefined)
  assert.equal(bindTransportDemands([segment('park')], routeDemands(routePlan())) instanceof Promise, false)
})
