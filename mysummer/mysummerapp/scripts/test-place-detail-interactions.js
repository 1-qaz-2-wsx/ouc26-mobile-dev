const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const memory = {}
const toasts = []
global.wx = {
  getStorageSync(key) { return memory[key] || null },
  setStorageSync(key, value) { memory[key] = value },
  showToast(options) { toasts.push(options && options.title) },
  previewImage() {}
}

const store = require('../utils/travel-store')
const service = require('../utils/travel-services')
const ui = require('../utils/travel-ui')
ui.posts = () => [{
  id: 'review-b',
  type: 'review',
  title: '乙地体验',
  content: '适合慢慢游览。',
  placeNames: ['乙地'],
  rating: 4,
  duration: '2 小时',
  photos: [],
  createdAt: '2026-01-01T00:00:00Z'
}]

let definition
global.Page = value => { definition = value }
require('../pages/place-detail/place-detail')

function createPage() {
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value) }
  })
  page.onLoad({ id: 'harbin' })
  return page
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

function seedMenu(place) {
  store.addPlace(place)
  return place
}

function seedCatalog(place) {
  store.mutate(state => { state.catalog = state.catalog.filter(item => !store.samePlace(item, place)).concat([place]) })
  return place
}

function createPageWithPlace(place) {
  const page = createPage()
  page.setCurrentPlace(place, place.id, { loading: false, error: '' })
  return page
}

async function main() {
  const pending = []
  service.poiDetail = place => new Promise(resolve => pending.push({ place, resolve }))
  const page = createPage()

  page.poi({ detail: { name: '甲地', latitude: 39, longitude: 116 } })
  assert.equal(page.data.place.name, '甲地')
  assert.equal(page.data.detailLoading, true)
  assert.equal(page.data.markers.length, 2)

  page.poi({ detail: { name: '乙地', latitude: 40, longitude: 117 } })
  assert.equal(page.data.place.name, '乙地')
  assert.equal(page.data.markers.length, 3)

  pending[0].resolve({ id: 'poi-a', name: '甲地详情', latitude: 39, longitude: 116 })
  await flush()
  assert.equal(page.data.place.name, '乙地', '过期地点响应不得覆盖当前地点')

  pending[1].resolve({ id: 'poi-b', name: '乙地', latitude: 40, longitude: 117, address: '乙地地址', category: '自然' })
  await flush()
  assert.equal(page.data.detailLoading, false)
  assert.equal(page.data.place.address, '乙地地址')
  assert.equal(page.data.ratingText, '4.0 / 5（1 条评价）')
  assert.equal(page.data.durationText, '2 小时')

  const firstMarker = page.data.markers.find(marker => marker.placeKey.includes('甲地'))
  page.marker({ detail: { markerId: firstMarker.id } })
  assert.equal(page.data.place.name, '甲地')
  assert.equal(page.data.detailLoading, true)
  assert.equal(pending.length, 3)

  pending[2].resolve({ id: 'poi-a', name: '甲地', latitude: 39, longitude: 116, address: '甲地地址' })
  await flush()
  assert.equal(page.data.place.address, '甲地地址')
  assert.equal(page.data.markers.find(marker => marker.placeKey === page.currentKey).callout.display, 'ALWAYS')

  const pendingBeforeCity = pending.length
  page.poi({ detail: { name: '哈尔滨', latitude: 45.8, longitude: 126.5, type: '行政区' } })
  assert.equal(page.data.place.isCity, true, '原生地图行政字段应识别为城市')
  assert.equal(page.data.detailLoading, false, '城市详情不应进入景点 POI 加载态')
  assert.equal(pending.length, pendingBeforeCity, '城市详情不应调用唯一 POI 匹配')

  page.sheetTouchStart({ touches: [{ clientX: 180, clientY: 640 }] })
  page.sheetTouchEnd({ changedTouches: [{ clientX: 184, clientY: 560 }] })
  assert.equal(page.data.sheetExpanded, true, '向上滑动应展开地点详情')
  page.toggleSheet()
  assert.equal(page.data.sheetExpanded, true, '滑动后的点击事件不得再次切换状态')
  page.sheetTouchStart({ touches: [{ clientX: 180, clientY: 560 }] })
  page.sheetTouchEnd({ changedTouches: [{ clientX: 180, clientY: 650 }] })
  assert.equal(page.data.sheetExpanded, false, '向下滑动应收起地点详情')

  global.wx.cloud = { callContainer() {} }
  service.communityFeed = async () => ({ items: [{ id: 'cloud-review', type: 'review', title: '哈尔滨社区体验', content: '云端社区内容', placeNames: ['哈尔滨'], rating: 5, duration: '半天', photos: [] }] })
  const cloudPage = createPage()
  await flush()
  assert.equal(cloudPage.data.reviews.some(item => item.id === 'cloud-review'), true, '展开详情应包含云端社区内容')

  // ===== G2-BUG：以 travel-store.samePlace() 作为「地点是否已在菜单」的唯一真值 =====
  const source = fs.readFileSync(path.join(__dirname, '../pages/place-detail/place-detail.js'), 'utf8')
  assert.equal(/added:\s*store\.read\(\)\.menu\.some/.test(source), false, 'place-detail 不得再内联简化版 id/providerId 菜单判断')
  const setCurrentBlock = source.slice(source.indexOf('setCurrentPlace('), source.indexOf('selectPlace(place, key, shouldLoad)'))
  assert.match(setCurrentBlock, /added:\s*this\.menuHasPlace\(place\)/, 'setCurrentPlace 的 added 必须统一走 menuHasPlace()（内部即 store.samePlace()）')
  assert.match(source, /menuHasPlace\(place\)\s*\{[\s\S]*?store\.samePlace\(item, place\)/, 'menuHasPlace 必须用 store.samePlace() 遍历当前菜单')
  assert.match(source, /if \(this\.menuHasPlace\(place\)\)\s*\{[\s\S]*?已在菜单中/, 'add() 必须先判断再写入，已存在时不得伪造「刚加入成功」')

  // 旧版简化判断（只比 id / providerId）——用它做前置对照，证明本组用例真能抓到回归
  const legacyAddedCheck = (item, place) => Boolean(item.id === place.id || (place.providerId && item.providerId && String(item.providerId) === String(place.providerId)))
  const menuItem = id => store.read().menu.find(item => item.id === id)

  // 场景 1：菜单里已有「同一 providerId、不同 local id」的地点 → 初始必须显示已加入
  seedMenu({ id: 'menu-prov-1', providerId: '7001', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '同源地点', category: '人文', latitude: 45.75, longitude: 126.64, stayDays: 1 })
  const sameProviderPlace = seedCatalog({ id: 'catalog-prov-2', providerId: '7001', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '同源地点', category: '人文', latitude: 45.75, longitude: 126.64 })
  assert.equal(store.samePlace(menuItem('menu-prov-1'), sameProviderPlace), true, '前置条件：菜单项与当前地点按 samePlace 判定为同一地点')
  const providerPage = createPageWithPlace(sameProviderPlace)
  assert.equal(providerPage.data.added, true, '菜单已有同一 providerId 的地点时，place-detail 初始必须显示已加入')

  // 场景 3 / 4：点击一个实际已存在的地点不得重复写菜单，也不得伪造「刚加入成功」
  const revisionBefore = store.read().sync.localRevision
  const menuCountBefore = store.read().menu.length
  toasts.length = 0
  providerPage.add()
  assert.equal(store.read().menu.length, menuCountBefore, '已存在的地点不得重复写入菜单')
  assert.equal(store.read().sync.localRevision, revisionBefore, '已存在的地点不应产生任何一次 store 写入')
  assert.equal(providerPage.data.added, true, '点击后必须保持已加入状态')
  assert.deepEqual(toasts, ['已在菜单中'], '已存在时只能提示「已在菜单中」，不得伪造「已加入菜单」')

  // 场景 1b：当前地点仍是 provisional（只有 selectionKey、没有 providerId）→ 旧版必然漏判
  seedMenu({ id: 'menu-sk-2', providerId: '7002', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, selectionKey: 'sk-prov-2', name: '待补全地点', category: '人文', latitude: 45.4, longitude: 126.4, stayDays: 1 })
  const provisionalPlace = seedCatalog({ id: 'map-45.400000-126.400000-待补全地点', selectionKey: 'sk-prov-2', objectType: 'coordinate', recognitionStatus: 'candidate', planningRole: 'confirm', canAdd: false, name: '待补全地点', category: '待确认', latitude: 45.4, longitude: 126.4 })
  assert.equal(store.samePlace(menuItem('menu-sk-2'), provisionalPlace), true, '前置条件：selectionKey 命中 samePlace')
  assert.equal(legacyAddedCheck(menuItem('menu-sk-2'), provisionalPlace), false, '前置条件：旧版简化判断在 provisional 地点上必然漏判——这正是「初始仍显示加入菜单」的根因')
  const provisionalPage = createPageWithPlace(provisionalPlace)
  assert.equal(provisionalPage.data.added, true, 'provisional 地点只有 selectionKey 时，仍必须按 samePlace 命中菜单')

  // 场景 2：菜单里是 legacy 记录（只靠名称 + 坐标判定）→ 旧版同样必然漏判
  seedMenu({ id: 'menu-legacy-3', name: '老记录地点', latitude: 45.5, longitude: 126.5, stayDays: 1 })
  const legacyMatchedPlace = seedCatalog({ id: 'catalog-poi-4', providerId: '7006', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '老记录地点', category: '人文', latitude: 45.5, longitude: 126.5 })
  assert.equal(store.samePlace(menuItem('menu-legacy-3'), legacyMatchedPlace), true, '前置条件：legacy 名称 + 坐标命中 samePlace')
  assert.equal(legacyAddedCheck(menuItem('menu-legacy-3'), legacyMatchedPlace), false, '前置条件：旧版简化判断对 legacy 菜单项必然漏判')
  const legacyPage = createPageWithPlace(legacyMatchedPlace)
  assert.equal(legacyPage.data.added, true, 'legacy 菜单项按 samePlace 命中时，place-detail 初始必须显示已加入')

  // 真正未加入的地点：仍应正常写入并提示「已加入菜单」
  const freshPlace = seedCatalog({ id: 'catalog-fresh-3', providerId: '7003', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '全新地点', category: '人文', latitude: 45.9, longitude: 126.9 })
  const freshPage = createPageWithPlace(freshPlace)
  assert.equal(freshPage.data.added, false, '未加入的地点初始必须是未加入状态')
  toasts.length = 0
  freshPage.add()
  assert.equal(store.read().menu.some(item => store.samePlace(item, freshPlace)), true, '未加入的地点应正常写入菜单')
  assert.deepEqual(toasts, ['已加入菜单'], '真正新增时才提示「已加入菜单」')
  assert.equal(freshPage.data.added, true, '新增成功后必须切到已加入状态')

  // 场景 5：同 session 从别处返回，onShow 必须重新同步 added（不重复拉社区、不重置地图）
  const resyncPlace = seedCatalog({ id: 'catalog-resync-4', providerId: '7004', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '回页同步地点', category: '人文', latitude: 45.3, longitude: 126.3 })
  const resyncPage = createPageWithPlace(resyncPlace)
  assert.equal(resyncPage.data.added, false, '前置条件：回页同步地点尚未加入')
  const markersBefore = JSON.stringify(resyncPage.data.markers)
  const communitySeqBefore = resyncPage.communitySeq
  seedMenu(resyncPlace)
  resyncPage.onShow()
  assert.equal(resyncPage.data.added, true, '同 session 返回页面必须重新同步 added')
  assert.equal(resyncPage.communitySeq, communitySeqBefore, '同 session 返回不得重复触发社区请求')
  assert.equal(JSON.stringify(resyncPage.data.markers), markersBefore, '同 session 返回不得重置地图 marker 状态')
  assert.equal(resyncPage.data.place.id, resyncPlace.id, '同 session 返回不得替换当前地点')

  console.log('PASS place detail native POI, marker switching, community refresh and stale response guard')
  console.log('PASS place detail menu-added state derived from store.samePlace() (providerId / selectionKey / add() / onShow resync)')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
