const assert = require('node:assert/strict')
const memory = new Map()
global.wx = { getStorageSync: key => memory.get(key) || '', setStorageSync: (key, value) => memory.set(key, value), showToast() {} }
const store = require('../utils/travel-store')
const cache = require('../utils/planning-cache')
const real = require('../utils/real-planning')
assert.equal(real.localTime('2026-09-17T19:23:00.000Z'), '2026-09-18 03:23（北京时间）')
const maps = require('../utils/real-plan-map')
const { createPlanningService } = require('../../backend/src/planning/service')
const { projectDisplay } = require('../../backend/src/planning/display-projection')
const place = { id: 'a', providerId: '123', name: '地点', latitude: 43, longitude: 125, stayDays: 1 }
const req = { origin: '地点', originPlace: place, startDate: '2026-09-17', days: 2, people: 2, budget: 1000,
  budgetType: '全团', modes: ['火车'], pace: '均衡', preference: '自然', needHotel: false }
const bound = real.buildRequest({ ...req, departureStation: '长春', arrivalStation: '南岔', trainToFirstPlace: true }, [place], 'menu-planning')
assert.equal(bound.transportDemand.targetMenuItemId, 'a')
assert.throws(() => real.buildRequest({ ...req, departureStation: '长春' }, [place], 'x'), /同时填写/)
assert.throws(() => real.buildRequest({ ...req, trainToFirstPlace: true }, [place], 'x'), /填写出发站/)
assert.throws(() => real.buildRequest({ ...req, modes: ['自驾'], departureStation: '长春', arrivalStation: '南岔' }, [place], 'x'), /勾选火车/)
const fs = require('node:fs')
const wxml = fs.readFileSync(require('node:path').join(__dirname, '../pages/menu/menu.wxml'), 'utf8')
assert.equal((wxml.match(/bindtap="generate"/g) || []).length, 1, 'one primary generation entry')
assert.ok(!wxml.includes('bindtap="generateReal"'), 'no duplicate draft entry')
assert.ok(!wxml.includes('data-field="trainToFirstPlace"'),
  '火车站点与绑定开关已按 Owner 2026-09-18 决议从菜单页删除；buildRequest 侧契约不变')
const plan = createPlanningService().buildRulePlan({ request: real.buildRequest(req, [place], 'menu-planning') })
const leg = { legId: 'nav', mode: 'car', from: plan.inputSnapshot.origin, to: plan.items[0].placeRef, departureAt: req.startDate + 'T08:00:00+08:00', arrivalAt: req.startDate + 'T09:00:00+08:00', durationMinutes: 60,
  provenance: { provider: 'tencent-map', sourceType: 'estimate', environment: 'test' }, routeGeometry: { coordinateSystem: 'GCJ-02', points: [{ lat: 43, lng: 125 }, { lat: 43.001, lng: 125.001 }] } }
const result = { plan, routeAudit: { legs: [leg] }, cityExpansions: [] }
// 方案页只消费 result.display（planning-display.v1）；没有投影时页面会明确显示「还没有方案」。
result.display = projectDisplay({ plan, cityExpansions: [], routeAudit: result.routeAudit, journey: null })
const initialMap = maps.mapData(result)
assert.deepEqual(initialMap.polyline, [], 'no fabricated center-to-center route')
const selected = maps.mapData(result, 'nav')
assert.equal(selected.polyline.length, 1)
assert.deepEqual(selected.markers.map(m => m.id), initialMap.markers.map(m => m.id))
assert.deepEqual(maps.mapData(result, 'a').polyline, [], 'changing selection clears previous route')
let definition
global.Page = value => { definition = value }
require('../pages/menu/menu')
let calls = 0
assert.equal(definition.generate.call({ generateReal: () => ++calls }), 1, 'default generator uses real backend, never legacy engine')
assert.equal(calls, 1)
require('../pages/plan-detail/plan-detail')
// setData 桩按真实框架语义处理点号路径（'view.map'），否则选中所属的地图更新测不出来。
const page = Object.assign({}, definition, {
  data: {},
  setData(values) {
    Object.keys(values).forEach(key => {
      const parts = key.split('.')
      let target = this.data
      for (let index = 0; index < parts.length - 1; index++) target = target[parts[index]] || (target[parts[index]] = {})
      target[parts[parts.length - 1]] = values[key]
    })
  }
})
store.setSession({ kind: 'wechat', id: 'alice', token: 'a' })
cache.save(store.sessionIdentity(), result)
page.onLoad({ source: 'real' })
page.onShow()
// 2026-09-18 版面：条件行只有「出发与规模 / 预算·预计花费」，不再有可执行性与待确认清单。
assert.equal(page.data.ready, true)
assert.match(page.data.scale, /09-17/)
assert.match(page.data.scale, /2 天/)
assert.ok(page.data.days.length >= 1, '按天时间轴必须有内容')
const legCard = page.data.days.reduce((list, day) => list.concat(day.rows), []).find(row => row.kind === 'leg')
assert.ok(legCard, '路线审计里选中的接驳段必须进入时间轴')
assert.match(legCard.title, /接驳/)
assert.ok(!JSON.stringify(page.data).includes('DEMO-'))
// 地图只画有证据的几何：默认不画城市之间的中心连线，marker 点击只展开对应卡片。
assert.deepEqual(page.data.map.polyline, [], 'no fabricated center-to-center route')
assert.ok(page.data.map.markers.length > 0)
const marker = page.data.map.markers[0]
page.marker({ detail: { markerId: marker.id } })
assert.equal(page.data.selected, marker.itemId)
assert.equal(page.data.expanded[marker.itemId], true)
store.setSession({ kind: 'wechat', id: 'bob', token: 'b' })
page.onShow()
assert.equal(page.data.ready, false, '账号切换后不得继续显示上一个账号的方案')
assert.match(page.data.error, /还没有方案/)
console.log('PASS default real generator, explicit carrier target, display-only plan page and account-isolated result page')
