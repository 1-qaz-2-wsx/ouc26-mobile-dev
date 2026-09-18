const assert = require('node:assert/strict')
const real = require('../utils/real-planning')
const place = { id: 'a', providerId: '123', name: '地点', latitude: 43, longitude: 125, stayDays: 1 }
const req = { origin: '地点', originPlace: place, startDate: '2026-09-17', days: 2, people: 2, budget: 1000,
  budgetType: '全团', modes: ['火车'], pace: '均衡', preference: '自然', needHotel: true }
const result = real.buildRequest(req, [place], 'test')
assert.equal(result.optimizeOrder, true)
assert.equal(result.endDestination.providerPlaceId, '123')
assert.equal(result.budget.amountMinor, 100000)
assert.equal(result.lodgingPreferences.rooms, 1)
assert.equal(real.buildRequest({ ...req, optimizeOrder: false }, [place], 'test').optimizeOrder, false)
assert.throws(() => real.buildRequest({ ...req, constraints: '必须有早餐' }, [place], 'test'))
assert.throws(() => real.buildRequest({ ...req, departureTime: '25:00' }, [place], 'test'))
assert.throws(() => real.buildRequest({ ...req, childAges: '8,' }, [place], 'test'))
assert.throws(() => real.buildRequest({ ...req, origin: '修改文字' }, [place], 'test'))
console.log('real planning request: passed')

// ——— viewResult 的两条通道 ———
// 菜单页直接渲染 viewResult（label / known / unknown / transportStatusText / warnings / items）。
// 有 display 时这些语义只能来自 display，不得旁路 transportStatus / plan.items / cityExpansions / journey。
const { createPlanningService } = require('../../backend/src/planning/service')
const MENU_FIELDS = ['label', 'known', 'unknown', 'transportStatusText', 'warnings', 'items']
const rulePlan = createPlanningService().buildRulePlan({ request: real.buildRequest(req, [place], 'test-view') })

// 毒值：把原始工程字段全灌 sentinel，display 必须把它们全部挡住。
const poisonedPlan = JSON.parse(JSON.stringify(rulePlan))
poisonedPlan.validation.warnings.push({ code: 'TRANSFER_QUOTE_MISSING', message: 'RAW_INTERNAL_MESSAGE' })
poisonedPlan.items[0].placeRef.name = 'RAW_INTERNAL_PLAN_ITEM'
poisonedPlan.items[0].startAt = '2026-01-01T00:00:00+08:00'
poisonedPlan.items[0].endAt = '2026-01-01T00:00:00+08:00'

const displayResult = {
  plan: poisonedPlan,
  transportStatus: 'RAW_INTERNAL_TRANSPORT_STATUS',
  routeAudit: { legs: [], gaps: [{ code: 'TRANSFER_EVIDENCE_MISSING', message: 'RAW_INTERNAL_GAP' }] },
  cityExpansions: [{ sourceOccurrenceId: 'a', sourceMenuItemIds: ['a'], candidates: [], gaps: ['RAW_INTERNAL_GAP'], stay: { dates: [] } }],
  journey: { days: [], lodgingNeeds: [], conflicts: [{ code: 'ROUTE_TIME_CONFLICT', message: 'RAW_INTERNAL_JOURNEY' }] },
  display: {
    schemaVersion: 'planning-display.v1',
    header: { title: '地点 · 2 天', range: '09-17 08:00 → 09-18 20:00', party: '2 位成人', feasibility: 'valid', coverage: 'complete',
      dataMode: 'manual', badges: [{ code: 'PLAN_VALID', text: '条件已通过校验', severity: 'info' }],
      cost: { status: 'unknown', currency: 'CNY', basis: 'party', knownMinor: null, estimatedRange: null, unknownCategories: ['transport'], dataStatus: 'unknown' } },
    sections: [
      { id: 'place:a', kind: 'place', dayKey: '2026-09-17', title: '地点', subtitle: '09-17 · 10:00–12:00', severity: 'info',
        dataStatus: 'unknown', collapsed: true, facts: [{ label: '时间', value: '10:00–12:00' }], options: [], actions: [] }
    ],
    notes: [{ id: 'note:TRANSPORT_QUOTE_MISSING:plan', code: 'TRANSPORT_QUOTE_MISSING', severity: 'info', title: '交通报价尚未查询', action: '可稍后补充交通信息', sectionId: null }]
  }
}
const view = real.viewResult(displayResult)
MENU_FIELDS.forEach(field => assert.ok(field in view, '菜单页依赖 viewResult 字段：' + field))
assert.equal(view.label, '待核实草案，不代表可预订')
assert.equal(view.known, '未知')
assert.equal(view.unknown, 'transport')
assert.equal(view.warnings.length, 1)
// 交通查询状态复用后端受控 note.title，不再读 result.transportStatus
assert.equal(view.transportStatusText, '交通报价尚未查询')
// items 只由 display 的 place section 生成，不再读 plan.items
assert.deepEqual(view.items, [{ id: 'a', name: '地点', startAt: '2026-09-17 10:00', endAt: '2026-09-17 12:00' }])
assert.ok(!JSON.stringify(view).includes('RAW_INTERNAL'), 'display 通道不得旁路 transportStatus / plan.items / cityExpansions / journey / routeAudit')

// 没有 display 的历史缓存：仍按旧受限逻辑读基础字段，但绝不透传 validation.message。
const legacyView = real.viewResult({ plan: poisonedPlan, transportStatus: 'not_queried' })
MENU_FIELDS.forEach(field => assert.ok(field in legacyView, 'legacy 通道也必须提供：' + field))
assert.equal(legacyView.transportStatusText, '尚未查询', 'legacy 仍使用受控的 transportStatus 翻译')
assert.equal(legacyView.items[0].name, 'RAW_INTERNAL_PLAN_ITEM', 'legacy 受限通道按设计仍读基础字段，display 通道则不行')
assert.ok(!JSON.stringify(legacyView).includes('RAW_INTERNAL_MESSAGE'))
console.log('real planning view result: passed')
