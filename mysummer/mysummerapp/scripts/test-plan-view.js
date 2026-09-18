/* Run: node mysummerapp/scripts/test-plan-view.js
   方案视图模型：本地演示方案与后端真实草案必须归一化成同一套页面骨架，
   否则「合并成一个方案页」只是把两张页面塞进同一个文件而已。 */
const assert = require('node:assert/strict')
const memory = new Map()
global.wx = { getStorageSync: key => memory.get(key) || '', setStorageSync: (key, value) => memory.set(key, value), showToast() {} }
const engine = require('../utils/travel-engine')
const planView = require('../utils/plan-view')
const real = require('../utils/real-planning')
const { createPlanningService } = require('../../backend/src/planning/service')

const FRAME_KEYS = ['source', 'sourceText', 'heading', 'tone', 'editable', 'conditionRows', 'statusRows',
  'gaps', 'warnings', 'days', 'legs', 'lodging', 'candidates', 'mapNote', 'map']

function shapeOf(view) {
  const missing = FRAME_KEYS.filter(key => !(key in view))
  assert.deepEqual(missing, [], '方案骨架缺少字段：' + missing.join(', '))
  assert.ok(Array.isArray(view.conditionRows) && view.conditionRows.length, '条件摘要不能为空')
  assert.ok(Array.isArray(view.statusRows) && view.statusRows.length, '状态行不能为空')
  assert.ok(view.conditionRows.every(row => row.label && row.value), '条件行必须有可读的标签与取值')
  assert.ok(view.map && Array.isArray(view.map.markers) && Array.isArray(view.map.includePoints), '地图字段必须完整')
}

// ——— 本地演示方案 ———
const req = Object.assign(engine.defaults(), { startDate: '2026-10-01', days: 4 })
const plan = engine.generate(req, engine.seedPlaces.slice(0, 2))
const local = planView.fromLocal(plan)
shapeOf(local)
assert.equal(local.source, 'local')
assert.equal(local.tone, 'ok')
assert.equal(local.editable, true, '本地方案保留就地编辑能力')
assert.equal(local.legs.length, 0)
assert.equal(local.gaps.length, 0, '可执行方案不应有缺口')

// 按天分组：一个日期一组，顺序与行程阅读顺序一致，且每行都带上可展开的原始商品。
assert.deepEqual(local.days.map(day => day.key), [...new Set(plan.items.map(item => item.date))].sort())
local.days.forEach(day => {
  assert.ok(day.rows.length, day.key + ' 的分组不应为空')
  const stamps = day.rows.map(row => String(row.item.date + row.item.start))
  assert.deepEqual(stamps, stamps.slice().sort(), day.key + ' 组内必须按时间排序')
  day.rows.forEach(row => {
    assert.ok(row.id && row.label && row.value, '结果行必须有 id / 标签 / 取值')
    assert.ok(row.item && row.item.quote, '本地行必须保留报价明细，否则「展开详情」没有内容')
  })
})

// 缺口不再沉默：缺库存时 gaps 必须出现，并且整体语气降级。
const blocked = JSON.parse(JSON.stringify(plan))
blocked.items = blocked.items.slice(0, 1)
engine.evaluate(engine.total(blocked))
const blockedView = planView.fromLocal(blocked)
assert.ok(blockedView.gaps.length > 0, '缺少库存的方案必须暴露缺口')
assert.equal(blockedView.tone, 'risk')

// 选中项只改变地图，不改变骨架。
const hotel = plan.items.find(item => item.type === 'hotel')
const focused = planView.fromLocal(plan, hotel.id)
assert.deepEqual(focused.days.map(day => day.key), local.days.map(day => day.key))
assert.ok(focused.map.markers.some(marker => marker.itemId === hotel.id), '选中项必须能在图上定位')

assert.throws(() => planView.fromLocal(null), /不完整/)
assert.throws(() => planView.fromLocal({ request: {} }), /不完整/)

// ——— 后端真实草案 ———
const place = { id: 'a', providerId: '123', name: '地点', latitude: 43, longitude: 125, stayDays: 1 }
const request = real.buildRequest({ origin: '地点', originPlace: place, startDate: '2026-09-17', days: 2, people: 2,
  budget: 1000, budgetType: '全团', modes: ['火车'], pace: '均衡', preference: '自然', needHotel: false }, [place], 'menu-planning')
const rulePlan = createPlanningService().buildRulePlan({ request })
const leg = { legId: 'nav', mode: 'car', from: rulePlan.inputSnapshot.origin, to: rulePlan.items[0].placeRef,
  departureAt: '2026-09-17T08:00:00+08:00', arrivalAt: '2026-09-17T09:00:00+08:00', durationMinutes: 60,
  provenance: { provider: 'tencent-map', sourceType: 'estimate', environment: 'test' },
  routeGeometry: { coordinateSystem: 'GCJ-02', points: [{ lat: 43, lng: 125 }, { lat: 43.001, lng: 125.001 }] } }
const remote = { plan: rulePlan, routeAudit: { legs: [leg] }, cityExpansions: [], transportStatus: 'not_queried' }
// 没有 journey 时按天行程必须为空，而不是伪造条目。
assert.deepEqual(planView.fromReal(remote).days, [])
assert.deepEqual(planView.fromReal(remote).lodging, [])

const journey = {
  days: [
    { date: '2026-09-17',
      activities: [{ id: 'act-1', name: '地点', startAt: '2026-09-17T10:00:00+08:00', endAt: '2026-09-17T12:00:00+08:00' }],
      transport: [{ id: 'leg-1', serviceNo: 'K123', mode: 'train', from: { name: '长春' }, to: { name: '南岔' } }] },
    { date: '2026-09-18', activities: [], transport: [] }
  ],
  lodgingNeeds: [{ id: 'stay-1', checkInDate: '2026-09-17', rooms: 1, status: 'needs_review' }]
}
const remoteView = planView.fromReal({ plan: rulePlan, routeAudit: { legs: [leg] }, cityExpansions: [], journey, transportStatus: 'not_queried' })
shapeOf(remoteView)
assert.equal(remoteView.source, 'real')
assert.equal(remoteView.editable, false, '真实草案不可就地编辑，改条件需回菜单')
assert.equal(remoteView.legs.length, 1)
assert.equal(remoteView.legs[0].estimated, true)
assert.equal(remoteView.legs[0].test, true)
assert.equal(remoteView.legs[0].source, 'tencent-map')
assert.equal(remoteView.legs[0].durationText, '60 分钟')

// 按天行程：活动与交通合并成同一组结果行，空日显式标注而不是留白。
assert.deepEqual(remoteView.days.map(day => day.title), ['2026-09-17', '2026-09-18'])
assert.equal(remoteView.days[0].rows.length, 2)
assert.equal(remoteView.days[0].rows[0].label, '地点')
assert.equal(remoteView.days[0].rows[0].value, '2026-09-17 10:00（北京时间） — 2026-09-17 12:00（北京时间）')
assert.match(remoteView.days[0].rows[1].label, /^交通 · K123$/)
assert.equal(remoteView.days[0].rows[1].value, '长春 → 南岔')
assert.equal(remoteView.days[0].noActivities, false)
assert.equal(remoteView.days[1].noActivities, true, '没有活动的日子必须显式标注，不能留白')
assert.equal(remoteView.lodging.length, 1)
assert.equal(remoteView.lodging[0].label, '住宿地点、房型与价格待查询')

assert.ok(remoteView.statusRows.some(row => row.label === '交通查询状态' && row.value === '尚未查询'),
  '后端的 transportStatus 必须翻译成可读文案')
assert.deepEqual(planView.fromReal(remote, 'a').map.polyline, [], '未选中路段时不画连线')
assert.equal(planView.fromReal(remote, 'nav').map.polyline.length, 1)

// 两源共用同一套骨架 —— 这是「合并方案页」成立的前提。
assert.deepEqual(Object.keys(local).sort(), Object.keys(remoteView).sort(), '两种方案必须输出同一组字段')

// 页面换选中项时只调 mapFor，它必须与 fromXxx 产出的地图完全一致，否则「点一下地图变了样」。
assert.deepEqual(planView.mapFor('local', plan, hotel.id), planView.fromLocal(plan, hotel.id).map)
assert.deepEqual(planView.mapFor('real', remote, 'nav'), planView.fromReal(remote, 'nav').map)
assert.equal(planView.mapFor('real', null, 'nav'), null, '没有草案时不得伪造地图')
assert.equal(planView.mapFor('local', null, 'x'), null)

// 后端新增状态不得被乐观改写。
assert.equal(real.transportText('not_configured'), '未配置供应商账号')
assert.equal(real.transportText('brand_new_status'), 'brand_new_status')
assert.equal(real.transportText(undefined), '尚未查询')

// ——— B1：真实方案展示只消费 result.display，不再读取 plan.validation 的自由文本 ———
const SENTINEL = 'INTERNAL_VALIDATION_MESSAGE_SHOULD_NOT_SURFACE'
const taintedPlan = JSON.parse(JSON.stringify(rulePlan))
taintedPlan.validation.warnings.push({ code: 'TRANSFER_QUOTE_MISSING', message: SENTINEL })
taintedPlan.validation.errors.push({ code: 'BUDGET_EXCEEDED', message: SENTINEL })
const displayResult = {
  plan: taintedPlan,
  routeAudit: { legs: [leg] },
  cityExpansions: [],
  journey,
  display: {
    schemaVersion: 'planning-display.v1',
    header: {
      title: '地点 · 2 天', range: '09-17 08:00 → 09-18 20:00', party: '2 位成人',
      feasibility: 'blocked', coverage: 'partial', dataMode: 'manual',
      badges: [{ code: 'GENERAL_BLOCKED', text: '当前条件无法执行', severity: 'blocked' }],
      cost: { status: 'unknown', currency: 'CNY', basis: 'party', knownMinor: null, estimatedRange: null, unknownCategories: ['transport'], dataStatus: 'unknown' }
    },
    sections: [],
    notes: [
      { id: 'note:TEST_ENVIRONMENT:leg-1', code: 'TEST_ENVIRONMENT', severity: 'action_required', title: '当前交通数据来自测试环境', action: '核对正式班次、库存和价格', sectionId: 'leg:leg-1' },
      { id: 'note:BUDGET_EXCEEDED:plan', code: 'BUDGET_EXCEEDED', severity: 'blocked', title: '已知费用超过严格预算', action: '调整预算或旅行条件', sectionId: null }
    ]
  }
}
const displayView = planView.fromReal(displayResult)
shapeOf(displayView)
assert.deepEqual(Object.keys(displayView).sort(), Object.keys(local).sort(), 'display 视图必须与本地视图同形')
assert.equal(displayView.tone, 'risk', 'blocked 的 display 必须降级为 risk 语气')
assert.ok(displayView.gaps.some(item => item.code === 'TEST_ENVIRONMENT'), '缺口必须来自 display.notes')
assert.ok(displayView.gaps.some(item => item.code === 'BUDGET_EXCEEDED'))
assert.ok(displayView.warnings.some(text => text.includes('测试环境')), '提醒文案来自受控 code 映射，而不是后端自由文本')
assert.ok(!JSON.stringify(displayView).includes(SENTINEL), '绝不能把 plan.validation 的自由文本渲染到页面')
assert.equal(real.viewResult(displayResult).known, '未知', 'display 费用未知时不得补 0')
assert.equal(planView.fromReal(displayResult, 'nav').map.polyline.length, 1, 'display 迁移不得改变地图几何通道')
assert.deepEqual(planView.fromReal(displayResult, 'a').map.polyline, [], '未选中路段时不画连线')

// ——— B1-R1 / B1-R2：有 display 时，用户可见语义不得再从原始工程结构旁路生成 ———
// 把原始结构灌满毒值，再配一份完全合法的 display：所有毒值都必须被 display 挡住。
const GAP_SENTINEL = 'RAW_INTERNAL_GAP'
const SOURCE_SENTINEL = 'RAW_INTERNAL_SOURCE'
const JOURNEY_SENTINEL = 'RAW_INTERNAL_JOURNEY'
const MESSAGE_SENTINEL = 'RAW_INTERNAL_MESSAGE'
const TRANSPORT_STATUS_SENTINEL = 'RAW_INTERNAL_TRANSPORT_STATUS'
const PLAN_ITEM_SENTINEL = 'RAW_INTERNAL_PLAN_ITEM'
const SENTINELS = [GAP_SENTINEL, SOURCE_SENTINEL, JOURNEY_SENTINEL, MESSAGE_SENTINEL,
  TRANSPORT_STATUS_SENTINEL, PLAN_ITEM_SENTINEL]
function assertNoSentinels(value, where) {
  const dump = JSON.stringify(value)
  SENTINELS.forEach(sentinel => assert.ok(!dump.includes(sentinel), where + ' 不得出现内部旁路内容：' + sentinel))
}

const safeDisplay = {
  schemaVersion: 'planning-display.v1',
  header: {
    title: '地点 · 2 天', range: '09-17 08:00 → 09-18 20:00', party: '2 位成人',
    feasibility: 'needs_review', coverage: 'partial', dataMode: 'manual',
    badges: [{ code: 'GENERAL_REVIEW_REQUIRED', text: '待确认 2 项', severity: 'action_required' }],
    cost: { status: 'partial', currency: 'CNY', basis: 'party', knownMinor: 28800, estimatedRange: null, unknownCategories: ['lodging'], dataStatus: 'unknown' }
  },
  sections: [
    { id: 'place:a', kind: 'place', dayKey: '2026-09-17', title: '地点', subtitle: '09-17 · 10:00–12:00', severity: 'info',
      dataStatus: 'unknown', collapsed: true, facts: [{ label: '时间', value: '10:00–12:00' }], options: [], actions: [] },
    { id: 'leg:nav', kind: 'leg', dayKey: '2026-09-17', title: '长春 → 南岔', subtitle: 'K123 · 08:00–09:00', severity: 'action_required',
      dataStatus: 'unknown', collapsed: true, facts: [{ label: '车次', value: 'K123' }, { label: '来源', value: '测试环境，不能证明生产可购买' }],
      options: [], actions: [{ code: 'TEST_ENVIRONMENT', label: '核对正式班次、库存和价格' }] },
    { id: 'lodging:stay-1', kind: 'lodging', dayKey: '2026-09-17', title: '09-17 住宿', subtitle: '住宿地点、房型与价格待查询', severity: 'info',
      dataStatus: 'unknown', collapsed: true, facts: [{ label: '房间', value: '1 间' }], options: [], actions: [] },
    { id: 'unresolved:CITY_EXPANSION_PENDING:city', kind: 'unresolved', dayKey: null, title: '城市内景点尚未排入行程', subtitle: '候选尚未完成校验，未排入行程',
      severity: 'action_required', dataStatus: 'unknown', collapsed: false,
      facts: [{ label: '城市', value: '长春' }, { label: '状态', value: '待确认' }], options: [],
      actions: [{ code: 'CITY_EXPANSION_PENDING', label: '确认已验证的景点和游玩时间' }] }
  ],
  notes: [
    { id: 'note:CITY_EXPANSION_PENDING:city', code: 'CITY_EXPANSION_PENDING', severity: 'action_required', title: '城市内景点尚未排入行程', action: '确认已验证的景点和游玩时间', sectionId: 'unresolved:CITY_EXPANSION_PENDING:city' },
    { id: 'note:TEST_ENVIRONMENT:leg:nav', code: 'TEST_ENVIRONMENT', severity: 'action_required', title: '当前交通数据来自测试环境', action: '核对正式班次、库存和价格', sectionId: 'leg:nav' }
  ]
}

const poisonedPlan = JSON.parse(JSON.stringify(rulePlan))
poisonedPlan.validation.warnings.push({ code: 'TRANSFER_QUOTE_MISSING', message: MESSAGE_SENTINEL })
poisonedPlan.validation.errors.push({ code: 'BUDGET_EXCEEDED', message: MESSAGE_SENTINEL })
poisonedPlan.legs = [{ legId: 'leg-poison', mode: 'car', from: { name: SOURCE_SENTINEL }, to: { name: SOURCE_SENTINEL },
  departureAt: '2026-09-17T08:00:00+08:00', arrivalAt: '2026-09-17T09:00:00+08:00', durationMinutes: 60,
  provenance: { provider: SOURCE_SENTINEL, sourceType: 'live', environment: 'test' },
  routeGeometry: { coordinateSystem: 'GCJ-02', points: [{ lat: 43, lng: 125 }, { lat: 43.001, lng: 125.001 }] } }]
// R2：地点名称与时间也不再允许从 plan.items 旁路到用户可见输出。
poisonedPlan.items[0].placeRef.name = PLAN_ITEM_SENTINEL
poisonedPlan.items[0].startAt = '2026-01-01T00:00:00+08:00'
poisonedPlan.items[0].endAt = '2026-01-01T00:00:00+08:00'
const poisonedResult = {
  plan: poisonedPlan,
  transportStatus: TRANSPORT_STATUS_SENTINEL,
  routeAudit: {
    legs: [{ legId: 'nav', mode: 'car', from: { name: SOURCE_SENTINEL }, to: { name: SOURCE_SENTINEL },
      departureAt: '2026-09-17T08:00:00+08:00', arrivalAt: '2026-09-17T09:00:00+08:00', durationMinutes: 60,
      provenance: { provider: SOURCE_SENTINEL, sourceType: 'estimate', environment: 'test' },
      routeGeometry: { coordinateSystem: 'GCJ-02', points: [{ lat: 43, lng: 125 }, { lat: 43.001, lng: 125.001 }] } }],
    gaps: [{ code: 'TRANSFER_EVIDENCE_MISSING', message: GAP_SENTINEL }],
    errors: [{ code: 'ROUTE_TIME_CONFLICT', message: GAP_SENTINEL }]
  },
  cityExpansions: [{ sourceOccurrenceId: 'a', sourceMenuItemIds: ['a'], candidates: [{ placeRef: { name: GAP_SENTINEL } }],
    gaps: [GAP_SENTINEL], stay: { dates: [GAP_SENTINEL] },
    activityPreview: { activities: [{ itemId: 'x', placeRef: { name: GAP_SENTINEL }, startAt: '2026-09-17T10:00:00+08:00', endAt: '2026-09-17T12:00:00+08:00' }] } }],
  journey: {
    days: [{ date: '2026-09-17',
      activities: [{ id: JOURNEY_SENTINEL, name: JOURNEY_SENTINEL, startAt: '2026-09-17T10:00:00+08:00', endAt: '2026-09-17T12:00:00+08:00' }],
      transport: [{ id: JOURNEY_SENTINEL, serviceNo: JOURNEY_SENTINEL, mode: 'train', from: { name: JOURNEY_SENTINEL }, to: { name: JOURNEY_SENTINEL } }] }],
    lodgingNeeds: [{ id: JOURNEY_SENTINEL, checkInDate: '2026-09-17', rooms: 1, status: 'needs_review' }],
    conflicts: [{ code: 'ROUTE_TIME_CONFLICT', message: JOURNEY_SENTINEL }]
  },
  display: safeDisplay
}

const poisonedView = planView.fromReal(poisonedResult)
shapeOf(poisonedView)
assertNoSentinels(poisonedView, 'fromReal 的 display 视图')
assertNoSentinels(real.viewResult(poisonedResult), 'viewResult 的 display 视图')
assert.deepEqual(Object.keys(poisonedView).sort(), Object.keys(local).sort(), 'display 视图必须与本地视图同形')
assert.deepEqual(planView.fromLocal(plan), local, '本地方案视图不受 display 迁移影响')

// display 通道确实在用 display，而不是退化成空视图。
assert.equal(poisonedView.heading, '待核实草案，不代表可预订')
assert.equal(poisonedView.tone, 'warn')
assert.ok(poisonedView.gaps.some(item => item.code === 'CITY_EXPANSION_PENDING'), '缺口来自 display.notes')
assert.ok(poisonedView.gaps.some(item => item.code === 'TEST_ENVIRONMENT'))
assert.equal(poisonedView.statusRows.find(row => row.label === '已知费用').value, '已知部分 ¥288.00')
assert.equal(poisonedView.statusRows.find(row => row.label === '未知类别').value, 'lodging')
assert.equal(poisonedView.conditionRows.find(row => row.label === '时间范围').value, '09-17 08:00 → 09-18 20:00')
assert.equal(poisonedView.conditionRows.find(row => row.label === '出行人数').value, '2 位成人')
assert.deepEqual(poisonedView.days.map(day => day.key), ['2026-09-17'])
assert.equal(poisonedView.days[0].noActivities, false, '有 place section 的日子不是空日')
assert.equal(poisonedView.days[0].rows.length, 3, '地点 / 交通 / 住宿进同一条时间线')
assert.equal(poisonedView.days[0].rows[0].label, '地点')
assert.equal(poisonedView.days[0].rows[0].value, '09-17 · 10:00–12:00')
assert.equal(poisonedView.days[0].rows[1].label, '长春 → 南岔')
assert.equal(poisonedView.days[0].rows[1].value, 'K123 · 08:00–09:00')
assert.equal(poisonedView.days[0].rows[1].note, '测试环境，不能证明生产可购买')
assert.equal(poisonedView.days[0].rows[2].value, '住宿地点、房型与价格待查询')

// 旧原始形状区块在 display 模式下必须留空，而不是继续读原始结构。
assert.deepEqual(poisonedView.legs, [], '交通段区块行模板要求原始 from/to，本批留空')
assert.deepEqual(poisonedView.lodging, [], '住宿区块行模板要求原始 rooms，本批留空')
assert.deepEqual(poisonedView.candidates, [], '城市候选区块含内部 code，不得再输出')

// B1-R2：交通查询状态与地点清单都只由 display 生成。
assert.equal(poisonedView.statusRows.find(row => row.label === '交通查询状态').value, '—',
  'display 没有交通类 note 时用通用未知占位，而不是回退读 result.transportStatus')
assert.deepEqual(real.viewResult(poisonedResult).transportStatusText, '—')
assert.deepEqual(real.viewResult(poisonedResult).items,
  [{ id: 'a', name: '地点', startAt: '2026-09-17 10:00', endAt: '2026-09-17 12:00' }],
  '菜单预览地点清单只由 display place section 生成')

// 地图是唯一允许继续读原始坐标与几何的通道，迁移不得破坏它。
assert.ok(poisonedView.map && poisonedView.map.markers.length > 0, 'display 视图仍必须能出图')
assert.equal(planView.fromReal(poisonedResult, 'nav').map.polyline.length, 1)
assert.deepEqual(planView.fromReal(poisonedResult, 'a').map.polyline, [])
assert.equal(planView.fromReal(poisonedResult, 'nav').days[0].rows[1].id, 'nav', '日期行仍可把选中项交给地图')
// marker 的 callout 是用户可见地点名称，有 display 时必须来自 display（几何仍来自原始 result）。
assert.equal(poisonedView.map.markers[0].callout.content, '地点', 'marker 文案来自 display place section')
assert.equal(poisonedView.map.markers[0].latitude, poisonedPlan.items[0].placeRef.coordinate.lat, '坐标仍来自原始 result')
assert.deepEqual(planView.mapFor('real', poisonedResult, 'nav'), planView.fromReal(poisonedResult, 'nav').map,
  '换选中项时地图必须与 fromReal 完全一致')

// ——— 没有 display 的历史缓存：受限 legacy 视图仍能有限展示，且不透传 validation.message ———
const legacyView = planView.fromReal({ plan: poisonedPlan, routeAudit: poisonedResult.routeAudit,
  cityExpansions: poisonedResult.cityExpansions, journey: poisonedResult.journey })
shapeOf(legacyView)
assert.deepEqual(Object.keys(legacyView).sort(), Object.keys(local).sort(), 'legacy 视图也必须与本地视图同形')
assert.equal(legacyView.days.length, 1, 'legacy 仍能展示按天行程')
assert.equal(legacyView.legs.length, 2, 'legacy 仍能展示交通段')
assert.equal(legacyView.lodging.length, 1, 'legacy 仍能展示住宿需求')
assert.deepEqual(legacyView.candidates, [], 'legacy 也不得把内部 code 当缺口文案')
assert.ok(!JSON.stringify(legacyView).includes(MESSAGE_SENTINEL), 'legacy 不得透传 validation.message')
assert.ok(!JSON.stringify(real.viewResult({ plan: poisonedPlan })).includes(MESSAGE_SENTINEL))
// legacy 按设计仍读基础字段：这两条断言把两条通道的边界钉住，避免以后被误当成旁路回归。
assert.equal(real.viewResult({ plan: poisonedPlan, transportStatus: 'not_queried' }).transportStatusText, '尚未查询')
assert.equal(real.viewResult({ plan: poisonedPlan }).items[0].name, PLAN_ITEM_SENTINEL,
  'legacy 受限通道仍读 plan.items，display 通道则不行')
assert.equal(planView.fromReal({ plan: poisonedPlan }).map.markers[0].callout.content, PLAN_ITEM_SENTINEL,
  'legacy 受限通道的 marker 文案仍来自原始 placeRef.name，display 通道则不行')

console.log('PASS plan view model normalizes local demo plans and backend drafts into one shared page skeleton')
