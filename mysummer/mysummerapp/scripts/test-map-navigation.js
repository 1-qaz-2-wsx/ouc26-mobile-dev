const assert = require('node:assert/strict')
const memory = {}
let lastNavigation, backCount = 0
global.wx = {
  getStorageSync: key => memory[key], setStorageSync: (key, value) => { memory[key] = value },
  getSystemInfoSync: () => ({ windowHeight: 700 }),
  navigateTo: options => { lastNavigation = options; if (options.complete) options.complete() },
  navigateBack: () => { backCount++ }, showToast() {}
}
const factory = require('../utils/map-page')
function page(mode) {
  const p = factory(mode)
  p.data = JSON.parse(JSON.stringify(p.data))
  p.setData = function (value) { Object.assign(this.data, value) }
  p.onLoad()
  return p
}
const home = page('home')
home.enterSearch()
assert.equal(lastNavigation.url, '/pages/map-search/map-search')
assert.equal(home.data.keyword, '')
const search = page('search')
assert.equal(search.data.searchMode, true)
const city = { id: 'test-city', name: '哈尔滨市', isCity: true, latitude: 45.75, longitude: 126.6 }
search.searchResults = [city]
search.searchContext = { keyword: '哈尔滨', city: '', searchScrollTop: 125 }
search.setData({ keyword: '哈尔滨', searchScrollTop: 125 })
search.resultDetail({ currentTarget: { dataset: { id: city.id } } })
assert.equal(lastNavigation.url, '/pages/map-selection/map-selection')
let receiver
const selected = factory('selection')
selected.data = JSON.parse(JSON.stringify(selected.data))
selected.setData = function (value) { Object.assign(this.data, value) }
selected.getOpenerEventChannel = () => ({ on: (name, callback) => { receiver = callback } })
selected.loadPlaceCommunity = () => {}
selected.onLoad()
lastNavigation.success({ eventChannel: { emit: (name, payload) => receiver(payload) } })
assert.equal(selected.data.sheetPlace.id, city.id)
assert.equal(selected.data.markers.length, 1)
selected.toggleMarkerMode({ detail: { value: true } })
assert.equal(selected.data.markerMode, 'all')
selected.toggleMarkerMode({ detail: { value: false } })
assert.equal(selected.data.markerMode, 'selected')
selected.returnSearch()
assert.equal(backCount, 1)
search.onShow()
assert.equal(search.data.keyword, '哈尔滨')
assert.equal(search.data.searchScrollTop, 125)
search.onUnload()
home.onShow()
assert.equal(home.data.keyword, '')
assert.equal(home.data.markers.length, 0)
console.log('PASS native search/selection stack, event channel, retained results and clean homepage')
