/* Run: node mysummerapp/scripts/test-booking-record.js
 *
 * 补充信息页（pages/booking）的三态记录流程（2026-09-18 定稿）：
 *   · 车票 / 航班 / 住宿三套字段，原值从真实方案预填；
 *   · 保存写本机 bookings（planId + sectionId 身份），删除写墓碑；
 *   · 重新生成方案后不自动继承；
 *   · 页面里没有任何库存核验、第三方跳转或自动填入通道。
 */
const assert = require('node:assert/strict')

const memory = new Map()
const clone = value => JSON.parse(JSON.stringify(value))
let lastNavigation = ''
let toast = ''
global.wx = {
  getStorageSync: key => (memory.has(key) ? clone(memory.get(key)) : ''),
  setStorageSync: (key, value) => memory.set(key, clone(value)),
  showToast: options => { toast = options.title },
  showModal: options => options.success({ confirm: true }),
  navigateBack: () => { lastNavigation = 'back' },
  navigateTo: options => { lastNavigation = options.url },
  switchTab() {}, pageScrollTo() {}
}
global.getApp = () => ({ globalData: {} })

const store = require('../utils/travel-store')
const cache = require('../utils/planning-cache')
const real = require('../utils/real-planning')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

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
const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } })

const result = {
  plan: {
    id: 'plan-record',
    inputSnapshot: { timezone: 'Asia/Shanghai' },
    legs: [
      { legId: 'leg-train-1', mode: 'train', serviceNo: 'G1234', from: { name: '青岛' }, to: { name: '哈尔滨' }, departureAt: '2026-09-20T08:12:00+08:00', arrivalAt: '2026-09-20T17:35:00+08:00' },
      { legId: 'leg-flight-1', mode: 'flight', serviceNo: 'CA1234', from: { name: '青岛' }, to: { name: '哈尔滨' }, departureAt: '2026-09-21T07:00:00+08:00', arrivalAt: '2026-09-21T09:10:00+08:00' }
    ],
    items: []
  },
  journey: { lodgingNeeds: [{ id: 'lodging-2026-09-20', checkInDate: '2026-09-20', checkOutDate: '2026-09-22', rooms: 2, status: 'needs_review' }] },
  display: { schemaVersion: 'planning-display.v1', header: {}, sections: [], notes: [] }
}

store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
store.resetCache()
store.mutate(state => { state.bookings = [] })
cache.save(store.sessionIdentity(), result, { jobId: 'job-record' })

const definition = definitionOf('booking')

async function main() {
/* ---- 车票态：原值预填 + 保存 ---- */
const train = makePage(definition)
train.onLoad({ planId: 'plan-record', sectionId: 'leg:leg-train-1' })
assert.equal(train.data.kind, 'train')
assert.equal(train.data.kindText, '车票信息')
assert.equal(train.data.existing, false)
assert.equal(train.data.fields.serviceNo, 'G1234', '车次从方案原值预填')
assert.equal(train.data.fields.date, '2026-09-20')
assert.equal(train.data.fields.departTime, '08:12')
assert.equal(train.data.fields.arriveTime, '17:35')
assert.equal(train.data.fields.unitPrice, '', '金额一律留空，由用户填自己实际买到的价格')
assert.ok(train.data.refRows.some(row => row.label === '车次' && row.value === 'G1234'))

train.field(event({ key: 'seatClass' }, '二等座'))
train.field(event({ key: 'unitPrice' }, '612'))
train.field(event({ key: 'quantity' }, '2'))
lastNavigation = ''
train.save()
await wait(500)
assert.equal(lastNavigation, 'back', '保存后返回方案页')
assert.equal(toast, '已补充')
const saved = store.getBooking('plan-record', 'leg:leg-train-1')
assert.deepEqual(saved.fields, { serviceNo: 'G1234', from: '青岛', to: '哈尔滨', date: '2026-09-20', departTime: '08:12', arriveTime: '17:35', seatClass: '二等座', unitPrice: '612', quantity: '2' })
assert.equal(saved.id, 'plan-record:leg:leg-train-1')
assert.equal(saved.version, 1)

/* ---- 再次进入是修改态，版本递增；删除写墓碑 ---- */
const again = makePage(definition)
again.onLoad({ planId: 'plan-record', sectionId: 'leg:leg-train-1' })
assert.equal(again.data.existing, true)
assert.equal(again.data.fields.seatClass, '二等座')
again.field(event({ key: 'seatClass' }, '一等座'))
again.save()
assert.equal(store.getBooking('plan-record', 'leg:leg-train-1').fields.seatClass, '一等座')
assert.equal(store.getBooking('plan-record', 'leg:leg-train-1').version, 2)
await again.remove()
{
  assert.equal(store.getBooking('plan-record', 'leg:leg-train-1'), null, '删除后卡片回到未补充')
  const tombstone = store.read().bookings.find(row => row.id === 'plan-record:leg:leg-train-1')
  assert.equal(tombstone.deleted, true, '删除要留下墓碑，避免同步把旧记录带回来')
  assert.equal(tombstone.version, 3)

  /* ---- 航班态与住宿态字段 ---- */
  const flight = makePage(definition)
  flight.onLoad({ planId: 'plan-record', sectionId: 'leg:leg-flight-1' })
  assert.equal(flight.data.kind, 'flight')
  assert.equal(flight.data.fields.flightNo, 'CA1234')
  assert.ok(flight.data.rows.some(row => row.key === 'cabin' && row.label === '舱位'))

  const hotel = makePage(definition)
  hotel.onLoad({ planId: 'plan-record', sectionId: 'lodging:lodging-2026-09-20' })
  assert.equal(hotel.data.kind, 'hotel')
  assert.equal(hotel.data.fields.checkInDate, '2026-09-20')
  assert.equal(hotel.data.fields.checkOutDate, '2026-09-22')
  assert.equal(hotel.data.fields.rooms, '2')
  assert.equal(hotel.data.fields.nights, '2', '晚数按入住 / 退房日期算')
  hotel.field(event({ key: 'name' }, '伊春小旅馆'))
  hotel.field(event({ key: 'roomType' }, '经济双床房'))
  hotel.field(event({ key: 'unitPrice' }, '78'))
  assert.equal(hotel.data.fields.totalPrice, '156', '合计留空时按 每晚 × 晚数 生成参考值')
  hotel.save()
  assert.equal(store.getBooking('plan-record', 'lodging:lodging-2026-09-20').fields.name, '伊春小旅馆')

  /* ---- 必填校验：只要求名称类字段 ---- */
  const blank = makePage(definition)
  blank.onLoad({ planId: 'plan-record', sectionId: 'leg:leg-flight-1' })
  blank.setData({ fields: Object.assign({}, blank.data.fields, { flightNo: '' }) })
  blank.save()
  assert.match(blank.data.error, /请填写航班号/)
  assert.equal(store.getBooking('plan-record', 'leg:leg-flight-1'), null, '校验失败不得写入')

  /* ---- 重新生成后的方案不继承补充信息 ---- */
  assert.equal(store.getBooking('plan-record-2', 'lodging:lodging-2026-09-20'), null)
  const prefill = real.bookingPrefill({ plan: { inputSnapshot: {}, legs: [], items: [] }, journey: {} }, 'leg:leg-train-1')
  assert.equal(prefill, null, '找不到对应卡片时不给预填，也不猜')
  // 后端 ID_PATTERN 允许 [A-Za-z0-9:_-]：合法字符原样保留，空格等非法字符清洗成下划线。
  assert.equal(store.bookingId('plan:a', 'leg:1'), 'plan:a:leg:1')
  assert.equal(store.bookingId('plan A', 'leg 1'), 'plan_A:leg_1', '身份里的非法字符会被清洗')
  console.log('PASS booking record: three field sets, prefill from the plan, save/update/delete tombstone,')
  console.log('     required-name validation and no inheritance across regenerated plans')
}
}

main().catch(error => { console.error(error); process.exitCode = 1 })
