/* Run: node mysummerapp/scripts/test-bookings-sync.js
 *
 * 补充信息（bookings）跨设备同步（2026-09-18）：
 *   · 本机 syncPayload 只带 plans / trips / bookings + clientRevision，不再带 reminders / reminderMinutes；
 *   · 走真实的 POST /travel/sync 处理函数，验证服务端接受、按 owner 隔离、版本冲突与删除墓碑；
 *   · applyRemote 会合并云端的 bookings，同时保留提醒兼容字段不影响本机。
 */
const assert = require('node:assert/strict')

const memory = new Map()
const clone = value => JSON.parse(JSON.stringify(value))
global.wx = {
  getStorageSync: key => (memory.has(key) ? clone(memory.get(key)) : ''),
  setStorageSync: (key, value) => memory.set(key, clone(value)),
  showToast() {}, showModal: options => options.success({ confirm: true })
}

const store = require('../utils/travel-store')
const { createTravelApi } = require('../../backend/src/travel-api')
const { createCommunityRepository } = require('../../backend/src/community-repository')

// 后端测试同款的最小内存仓库：足够验证 owner 隔离、版本与冲突逻辑。
function fixture() {
  const rows = new Map()
  const scope = data => ({
    get: async (table, id) => data.get(table + '/' + id) || null,
    set: async (table, id, value) => { data.set(table + '/' + id, clone(value)) },
    remove: async (table, id) => { data.delete(table + '/' + id) },
    collection: table => {
      const api = {
        doc(id) {
          return {
            get: async () => ({ data: data.has(table + '/' + id) ? [clone(data.get(table + '/' + id))] : [] }),
            set: async value => { data.set(table + '/' + id, clone(value)); return {} },
            remove: async () => { data.delete(table + '/' + id); return {} },
            delete: async () => { data.delete(table + '/' + id); return {} }
          }
        },
        where(query) { api.query = query; return api },
        orderBy(field) { api.order = { field }; return api },
        limit(value) { api.max = value; return api },
        async get() {
          let list = [...data.entries()].filter(([key]) => key.startsWith(table + '/')).map(([, value]) => clone(value))
          if (api.query) list = list.filter(row => Object.entries(api.query).every(([key, value]) => row[key] === value))
          if (api.order) list.sort((a, b) => String(b[api.order.field] || '').localeCompare(String(a[api.order.field] || '')))
          return { data: list.slice(0, api.max || 20) }
        }
      }
      return api
    }
  })
  const db = {
    collection: table => scope(rows).collection(table),
    async runTransaction(work) {
      const draft = new Map([...rows.entries()].map(([key, value]) => [key, clone(value)]))
      const value = await work(scope(draft))
      rows.clear()
      for (const [key, item] of draft) rows.set(key, item)
      return value
    }
  }
  return { repository: createCommunityRepository(db), rows }
}

async function main() {
  store.setSession({ kind: 'wechat', id: 'wx-sync', token: 'token-sync' })
  store.resetCache()
  store.mutate(state => {
    state.bookings = []
    state.trips = []
    state.plans = []
    state.menu = []
  })
  store.saveBooking({ planId: 'plan-sync', sectionId: 'leg:leg-1', kind: 'train', fields: { serviceNo: 'G1024', seatClass: '二等座', unitPrice: '612', quantity: '2' } })
  store.saveBooking({ planId: 'plan-sync', sectionId: 'lodging:night-1', kind: 'hotel', fields: { name: '伊春小旅馆', unitPrice: '78' } })
  store.deleteBooking('plan-sync', 'lodging:night-1')

  /* ---- 本机 payload：只有 plans / trips / bookings ---- */
  const payload = store.syncPayload()
  assert.deepEqual(Object.keys(payload).sort(), ['bookings', 'clientRevision', 'plans', 'trips'])
  assert.equal(payload.reminders, undefined, '提醒字段不再上报')
  assert.equal(payload.reminderMinutes, undefined, '默认提前量不再上报')
  assert.equal(payload.bookings.length, 2)
  assert.equal(payload.bookings.find(row => row.sectionId === 'lodging:night-1').deleted, true, '删除墓碑要一起上报')
  payload.bookings.forEach(row => {
    assert.match(row.id, /^[A-Za-z0-9:_-]{1,128}$/, '行 id 必须满足后端 ID_PATTERN')
    assert.ok(row.planId && row.sectionId, '补充信息必须能定位回方案与卡片')
  })

  /* ---- 真实 /travel/sync：接受、隔离、版本冲突 ---- */
  const f = fixture()
  const api = createTravelApi({ repository: f.repository, verify: token => token === 'token-sync' ? { id: 'wx-sync' } : { id: 'other' } })
  const request = () => ({ headers: { 'x-app-authorization': 'Bearer token-sync' } })
  const first = await api.handle('/travel/sync', payload, request())
  assert.equal(first.bookings.length, 2)
  assert.equal(f.rows.get('travel_bookings/plan-sync:leg:leg-1').ownerId, 'wx-sync')
  assert.equal(first.bookings.find(row => row.sectionId === 'leg:leg-1').fields.seatClass, '二等座')

  // 另一个账号看不到任何记录。
  const otherApi = createTravelApi({ repository: f.repository, verify: () => ({ id: 'other-user' }) })
  const other = await otherApi.handle('/travel/sync', { plans: [], trips: [], bookings: [] }, { headers: { 'x-app-authorization': 'Bearer other' } })
  assert.deepEqual(other.bookings, [])

  // 更高版本覆盖；同版本不同内容回报冲突但保留服务端版本。
  const bumped = clone(payload)
  const target = bumped.bookings.find(row => row.sectionId === 'leg:leg-1')
  target.version += 1
  target.updatedAt = Date.now() + 1000
  target.fields.seatClass = '一等座'
  const upgraded = await api.handle('/travel/sync', bumped, request())
  assert.equal(upgraded.bookings.find(row => row.sectionId === 'leg:leg-1').fields.seatClass, '一等座')
  const conflictPayload = clone(bumped)
  conflictPayload.bookings.find(row => row.sectionId === 'leg:leg-1').fields.seatClass = '商务座'
  const conflicted = await api.handle('/travel/sync', conflictPayload, request())
  assert.equal(conflicted.conflicts[0].type, 'booking')
  assert.equal(conflicted.bookings.find(row => row.sectionId === 'leg:leg-1').fields.seatClass, '一等座', '同版本冲突时保留服务端版本')

  // 旧客户端仍带 reminders / reminderMinutes：功能已废弃，但兼容必须成立。
  const legacy = await api.handle('/travel/sync', { plans: [], trips: [], reminderMinutes: 30, reminders: [] }, request())
  assert.equal(legacy.reminderMinutes, 30)

  /* ---- applyRemote：云端 bookings 合并回本机 ---- */
  const applied = store.applyRemote({ plans: [], trips: [], bookings: upgraded.bookings, serverTime: Date.now() }, store.sessionIdentity())
  assert.equal(applied.bookings.length, 2)
  assert.equal(store.getBooking('plan-sync', 'leg:leg-1').fields.seatClass, '一等座')
  assert.equal(store.getBooking('plan-sync', 'lodging:night-1'), null, '墓碑行不会作为有效记录返回')

  console.log('PASS bookings sync: payload shape, real /travel/sync acceptance, owner isolation,')
  console.log('     version conflict handling, tombstones and reminder compatibility')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
