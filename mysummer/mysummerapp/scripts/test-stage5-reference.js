const assert = require('node:assert/strict')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : '' },
  setStorageSync(key, value) { storage.set(key, JSON.parse(JSON.stringify(value))) },
  removeStorageSync(key) { storage.delete(key) },
  showToast() {}, showModal(options) { options.success({ confirm: true }) },
  switchTab() {}, navigateTo() {}, navigateBack() {}
}
let definition
global.Page = value => { definition = value }
const store = require('../utils/travel-store')
store.setSession({ kind: 'demo', id: 'stage5', nickname: '演示用户' })
store.resetCache()
require('../pages/post-detail/post-detail')

function page() {
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) {
      Object.entries(values).forEach(([key, value]) => {
        const parts = key.split('.')
        let target = this.data
        parts.slice(0, -1).forEach(part => { target = target[part] || (target[part] = {}) })
        target[parts[parts.length - 1]] = value
      })
    }
  })
}

const snapshot = {
  version: 2,
  stops: [
    { id: 'route-city', placeId: 'route-city', provider: 'qq', providerId: 'city-1', name: '路线城市', objectType: 'administrative', planningRole: 'destination_area', isCity: true, latitude: 40, longitude: 120 },
    { id: 'route-city', placeId: 'route-city', provider: 'qq', providerId: 'city-1', name: '路线城市', objectType: 'administrative', planningRole: 'destination_area', isCity: true, latitude: 40, longitude: 120 },
    { id: 'route-poi', placeId: 'route-poi', provider: 'qq', providerId: 'poi-1', name: '路线景点', objectType: 'poi', providerKind: 'poi', category: '景点', latitude: 40.1, longitude: 120.1 },
    { name: '缺失稳定 ID' }
  ],
  items: []
}

const originalPlan = { id: 'existing-plan', version: 1, stops: [{ id: 'existing', name: '原方案地点' }], items: [] }
store.mutate(state => { state.plans = [originalPlan] })
const preview = store.previewRouteStops(snapshot)
assert.equal(preview.stops.length, 2)
assert.equal(preview.skipped.length, 2)
assert.equal(preview.stops[0].planningRole, 'destination_area')
const imported = store.importRouteStops(snapshot)
assert.equal(imported.imported, 2)
assert.equal(store.read().menu.length, 2)
assert.equal(store.read().menu[0].providerId, 'city-1')
assert.equal(store.read().menu[1].category, '景点')
assert.deepEqual(store.read().plans, [originalPlan], '导入参考路线不能覆盖已有方案')
assert.equal(store.importRouteStops(snapshot).imported, 0, '重复导入只按稳定 ID 去重')
store.mutate(state => { state.menu = [] })
const overflow = store.previewRouteStops({ stops: Array.from({ length: 13 }, (_, index) => ({ id: 'cap-' + index, provider: 'qq', name: '地点 ' + index, latitude: 40 + index / 100, longitude: 120 + index / 100 })) })
assert.equal(overflow.stops.length, 12, '预览明确限制最多 12 个地点')
assert.equal(overflow.skipped.length, 1)
store.importRouteStops(snapshot)

const detail = page()
detail.id = 'post-stage5'
detail.setData({ post: { id: detail.id, type: 'route', title: '参考路线', routeSnapshot: snapshot }, loading: false })
detail.reference()
assert.equal(detail.data.referencePreview.stops.length, 0, '菜单已有地点时预览应显示无新增项')
assert.match(detail.data.referenceError, /没有可导入|确认/)
console.log('PASS stage5 route reference preview/import dedupes stable IDs, preserves type metadata, enforces the 12-place cap, and leaves plans unchanged')
