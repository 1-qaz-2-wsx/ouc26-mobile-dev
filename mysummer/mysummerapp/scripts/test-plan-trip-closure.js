/* Run: node mysummerapp/scripts/test-plan-trip-closure.js
 *
 * 2026-09-18 方案 → 行程闭环：
 *   真实方案页点「开启旅程」→ 物化行程 items（地点/交通/住宿，城市锚点不进时间轴）
 *   → 菜单与要求归零 → 弹窗提示 → 切到行程页 → 行程页能记录见闻。
 * 全程不需要登录（游客也能开启），也不再有任何提醒字段。
 */
const assert = require('node:assert/strict')

const memory = new Map()
const clone = value => JSON.parse(JSON.stringify(value))
let lastTab = ''
let modalCount = 0
global.wx = {
  getStorageSync: key => (memory.has(key) ? clone(memory.get(key)) : ''),
  setStorageSync: (key, value) => memory.set(key, clone(value)),
  showToast() {},
  showModal(options) { modalCount += 1; if (options.success) options.success({ confirm: true }) },
  switchTab(options) { lastTab = options.url },
  navigateTo() {}, pageScrollTo() {}, navigateBack() {},
  chooseMedia() {}, saveFile() {}, setNavigationBarTitle() {}, getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } })
}
global.getApp = () => ({ globalData: {} })

const store = require('../utils/travel-store')
const cache = require('../utils/planning-cache')

function definitionOf(pagePath) {
  let definition
  const previous = global.Page
  global.Page = value => { definition = value }
  const file = require.resolve('../pages/' + pagePath + '/' + pagePath)
  delete require.cache[file]
  require(file)
  global.Page = previous
  return definition
}
function makePage(definition) {
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(values, callback) {
      Object.keys(values).forEach(key => {
        const parts = key.split('.')
        let target = this.data
        for (let index = 0; index < parts.length - 1; index++) target = target[parts[index]] || (target[parts[index]] = {})
        target[parts[parts.length - 1]] = values[key]
      })
      if (callback) callback()
    }
  })
}

const place = (id, name, lat, lng) => ({ providerPlaceId: id, name, type: 'poi', coordinate: { lat, lng } })
const menuItem = (id, name, lat, lng) => ({ menuItemId: id, occurrenceId: id, placeRef: place(id, name, lat, lng), role: 'must_visit', inputOrder: 0, required: true })

// 一份最小但完整的真实结果：1 个具体景点 + 1 个城市锚点 + 1 段火车 + 1 晚住宿。
const result = {
  plan: {
    id: 'plan-trip',
    schemaVersion: 'real-travel-plan.v1',
    updatedAt: '2026-09-18T10:00:00.000Z',
    dataMode: 'mixed',
    inputSnapshot: {
      timezone: 'Asia/Shanghai',
      startAt: '2026-10-01T08:00:00+08:00',
      endBy: '2026-10-03T20:00:00+08:00',
      travelers: { adults: 2, children: [8] },
      origin: place('origin', '长春站', 43.8171, 125.3235),
      endDestination: place('destination', '南岔', 47.1, 129.2),
      menuItems: [menuItem('park', '南岔森林公园', 47.1, 129.2), menuItem('city', '哈尔滨', 45.77, 126.65)]
    },
    items: [
      { itemId: 'park', kind: 'poi', placeRef: place('park', '南岔森林公园', 47.1, 129.2), startAt: '2026-10-02T09:30:00+08:00', endAt: '2026-10-02T13:00:00+08:00' },
      // 城市锚点：可作为规划输入，但不得变成可执行活动。
      { itemId: 'city', kind: 'poi', placeRef: { name: '哈尔滨', type: 'city', coordinate: { lat: 45.77, lng: 126.65 } }, startAt: '2026-10-03T09:00:00+08:00', endAt: '2026-10-03T16:00:00+08:00' }
    ],
    legs: [{
      legId: 'leg-train-1', mode: 'train', serviceNo: 'G1234',
      from: { name: '长春' }, to: { name: '南岔' },
      departureAt: '2026-10-01T08:12:00+08:00', arrivalAt: '2026-10-01T11:20:00+08:00'
    }]
  },
  journey: { days: [], lodgingNeeds: [{ id: 'lodging-2026-10-01', checkInDate: '2026-10-01', checkOutDate: '2026-10-02', rooms: 1, status: 'needs_review' }] },
  routeAudit: { legs: [] },
  display: {
    schemaVersion: 'planning-display.v1',
    header: { title: '南岔 · 3 天', departureDate: '10-01', dayCount: 3, range: '10-01 08:00 → 10-03 20:00', party: '2 位成人 · 1 位儿童', feasibility: 'valid', cost: { status: 'partial', basis: 'party', plannedMinor: 500000, knownMinor: 26800, unknownCategories: ['lodging'] } },
    sections: [
      { id: 'leg:leg-train-1', kind: 'leg', mode: 'train', dayKey: '2026-10-01', title: '长春 → 南岔', subtitle: 'G1234 · 08:12–11:20', facts: [{ label: '时间', value: '08:12–11:20' }], options: [], actions: [], severity: 'info', dataStatus: 'unknown' },
      { id: 'lodging:lodging-2026-10-01', kind: 'lodging', dayKey: '2026-10-01', title: '10-01 住宿', subtitle: '附近住宿候选待检索', facts: [{ label: '房间', value: '1 间' }], options: [], actions: [], severity: 'info', dataStatus: 'unknown' },
      { id: 'place:park', kind: 'place', dayKey: '2026-10-02', title: '南岔森林公园', subtitle: '10-02 · 09:30–13:00', facts: [{ label: '时间', value: '09:30–13:00' }], options: [], actions: [], severity: 'info', dataStatus: 'live' }
    ],
    notes: []
  }
}

function main() {
  /* ---- 游客也能开启行程：物化规则、幂等、无提醒字段 ---- */
  store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
  store.resetCache()
  store.mutate(state => {
    state.menu = [{ id: 'park', name: '南岔森林公园', latitude: 47.1, longitude: 129.2, stayDays: 2 }]
    state.requirements = { startDate: '2026-10-01', days: 3, people: 2, budget: 5000 }
  })

  const first = store.startTripFromReal(result, { jobId: 'job-trip' })
  const second = store.startTripFromReal(result, { jobId: 'job-trip' })
  assert.equal(store.read().trips.length, 1, '同一份方案重复开启只产生一个行程')
  assert.equal(first.id, second.id)
  assert.equal(first.reminders, undefined, '行程不再携带提醒')
  assert.equal(first.advanceMinutes, undefined)
  assert.equal(first.status, 'active')
  assert.equal(first.visibility, 'private')

  const plan = first.plan
  assert.equal(plan.id, 'plan-trip')
  assert.equal(plan.request.startDate, '2026-10-01')
  assert.equal(plan.request.days, 3, '首尾都算的 3 天')
  assert.equal(plan.request.people, 3, '2 位成人 + 1 位儿童')
  assert.deepEqual(plan.stops.map(stop => stop.name), ['南岔森林公园', '哈尔滨'])
  const byType = plan.items.reduce((map, item) => { (map[item.type] = map[item.type] || []).push(item); return map }, {})
  assert.equal(byType.ticket.length, 1, '城市锚点不得变成可执行活动')
  assert.equal(byType.ticket[0].title, '南岔森林公园')
  assert.equal(byType.ticket[0].date, '2026-10-02')
  assert.equal(byType.train.length, 1)
  assert.equal(byType.train[0].serviceNo, 'G1234')
  assert.equal(byType.train[0].start, '08:12')
  assert.equal(byType.train[0].end, '11:20')
  assert.equal(byType.hotel.length, 1)
  assert.equal(byType.hotel[0].date, '2026-10-01')
  assert.equal(byType.hotel[0].endDate, '2026-10-02')
  assert.equal(byType.hotel[0].rooms, 1)
  plan.items.forEach(item => {
    assert.ok(item.sourceRef && item.sourceRef.sectionId, '每个行程项都要能指回方案卡片：' + item.id)
    assert.equal(item.source, '真实规划')
  })

  /* ---- 已补充信息随行程带入 ---- */
  store.saveBooking({ planId: 'plan-trip', sectionId: 'lodging:lodging-2026-10-01', kind: 'hotel', fields: { name: '伊春小旅馆', unitPrice: '78' } })
  store.mutate(state => { state.trips = [] })
  const withBooking = store.startTripFromReal(result)
  const hotel = withBooking.plan.items.find(item => item.type === 'hotel')
  assert.equal(hotel.booking.name, '伊春小旅馆')
  assert.equal(hotel.bookingState, '已补充（用户记录）')

  /* ---- 方案页 start()：清菜单 + 弹窗 + 切行程页 ---- */
  store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
  cache.save(store.sessionIdentity(), result, { jobId: 'job-trip-2' })
  store.mutate(state => {
    state.menu = [{ id: 'park', name: '南岔森林公园', latitude: 47.1, longitude: 129.2, stayDays: 2 }]
    state.requirements = { startDate: '2026-10-01', days: 3, people: 2, budget: 5000 }
    state.trips = []
  })
  const pd = makePage(definitionOf('plan-detail'))
  pd.onLoad({})
  pd.onShow()
  assert.equal(pd.data.ready, true)
  modalCount = 0
  return pd.start().then(() => {
    assert.equal(modalCount, 1, '开启后要有一次弹窗提示')
    assert.equal(lastTab, '/pages/itinerary/itinerary', '弹窗确认后进入行程页')
    const state = store.read()
    assert.equal(state.menu.length, 0, '开启行程后菜单必须归零')
    assert.deepEqual(state.requirements, {}, '要求也回到默认（由 engine.defaults 在下一次补全）')
    assert.equal(state.trips.length, 1)

    /* ---- 行程页渲染与记录 ---- */
    const trip = store.read().trips[0]
    trip.plan.items.forEach(item => {
      const section = item.sourceRef.sectionId
      assert.ok(section, '行程项必须保留 section 身份，行程页才能回填补充信息')
    })
    const itn = makePage(definitionOf('itinerary'))
    itn.onShow()
    assert.equal(itn.data.trips.length, 1)
    assert.ok(itn.data.dayItems.length > 0, '行程页当天有安排')
    const transport = itn.data.dayItems.find(item => item.kind === 'transport')
    if (transport) {
      assert.equal(transport.supplementable, true, '交通卡在行程页也能补充信息')
      assert.ok(transport.sectionId.indexOf('leg:') === 0)
    }
    const target = itn.data.dayItems[0]
    itn.record({ currentTarget: { dataset: { id: target.id } } })
    itn.setData({ note: '今天看到了落日' })
    itn.saveRecord()
    const savedTrip = store.read().trips[0]
    assert.equal(savedTrip.records[target.id].note, '今天看到了落日')
    assert.equal(savedTrip.records[target.id].done, true)
    console.log('PASS plan→trip closure: materialised items (no city anchor), guest start, menu reset,')
    console.log('     modal + itinerary entry, booking carried into the trip and a saved travel note')
  })
}

Promise.resolve()
  .then(main)
  .catch(error => { console.error(error); process.exitCode = 1 })
