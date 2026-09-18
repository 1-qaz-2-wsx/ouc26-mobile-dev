const assert = require('node:assert/strict')
const fs = require('node:fs')
const store = require('../utils/travel-store')
const engine = require('../utils/travel-engine')
const tencentMap = require('../utils/tencent-map')

global.wx = {
  getStorageSync() { return null },
  setStorageSync() {},
  getSystemInfoSync() { return { windowHeight: 800 } },
  showToast() {},
  pageScrollTo() {},
  navigateTo(options) { global.lastNavigation = options },
  switchTab() {}
}

const service = require('../utils/travel-services')
let definition
global.Page = value => { definition = value }
require('../pages/index/index')

function createPage(pool = []) {
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    seq: 0, detailSeq: {}, detailCache: {}, detailStates: {}, markerIds: {}, markerPlaces: {}, nextMarkerId: 1,
    searchResults: [], searchContext: null, selectedPlace: null, temporaryPlace: null,
    sheetSeq: 0, sheetDetailSeq: 0, sheetCommunitySeq: 0, pool, viewportHeight: 800, sheetMinHeight: 190, sheetMaxHeight: 728,
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback() }
  })
  page.refresh()
  return page
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

async function main() {
  const fallbackCalls = []
  const fallbackService = tencentMap.create(async (path, data) => {
    fallbackCalls.push({ path, data })
    if (path === '/maps/poi') return { place: null, recognitionStatus: 'unidentified', detailStatus: 'missing', candidates: [] }
    return { places: [{ id: '230100', name: '哈尔滨市', isCity: true, latitude: 45.75, longitude: 126.64, province: '黑龙江省' }] }
  })
  const fallback = await fallbackService.resolvePlace({ name: '哈尔滨', latitude: 45.7146, longitude: 126.645 })
  assert.equal(fallback.place.objectType, 'administrative', '旧版 /maps/poi 返回空时应从同名行政区搜索恢复城市')
  assert.equal(fallback.place.name, '哈尔滨市')
  assert.equal(fallback.place.planningRole, 'destination_area')
  assert.deepEqual(fallbackCalls.map(item => item.path), ['/maps/poi', '/maps/search'], '城市恢复必须先确认原生地点，再走同名行政区搜索')

  let candidateSearchCalls = 0
  const candidateService = tencentMap.create(async path => {
    if (path === '/maps/search') candidateSearchCalls++
    return path === '/maps/poi'
      ? { place: null, recognitionStatus: 'candidate', detailStatus: 'missing', candidates: [{ id: 'poi-1', objectType: 'poi', name: '哈尔滨站', canAdd: false }] }
      : { places: [{ id: '230100', name: '哈尔滨市', isCity: true, latitude: 45.75, longitude: 126.64 }] }
  })
  const candidate = await candidateService.resolvePlace({ name: '哈尔滨', latitude: 45.75, longitude: 126.64 })
  assert.equal(candidate.place, null, '已有候选地点时不得静默改选城市')
  assert.equal(candidateSearchCalls, 0, '候选状态不应绕过用户确认调用行政区恢复')

  const failedFallbackService = tencentMap.create(async path => {
    if (path === '/maps/poi') return { place: null, recognitionStatus: 'unidentified', detailStatus: 'missing', candidates: [] }
    throw new Error('行政区检索超时')
  })
  await assert.rejects(failedFallbackService.resolvePlace({ name: '哈尔滨', latitude: 45.75, longitude: 126.64 }), /行政区检索超时/, '行政区兜底请求失败必须保留失败状态')

  service.resolvePlace = fallbackService.resolvePlace
  const fallbackPage = createPage([])
  fallbackPage.poi({ detail: { name: '哈尔滨', latitude: 45.7146, longitude: 126.645 } })
  for (let i = 0; i < 6; i++) await flush()
  assert.equal(fallbackPage.data.sheetPlace.name, '哈尔滨市', '首页城市点击应展示确认后的行政区名称')
  assert.equal(fallbackPage.data.sheetPlace.category, '城市', '首页城市点击不得停留在未识别标签')
  assert.equal(fallbackPage.data.sheetPlace.summary, '城市目的地；加入后将作为旅行目的地安排市内游玩')
  assert.equal(fallbackPage.data.sheetCanAdd, true, '确认后的城市应可加入菜单')

  const initial = createPage()
  initial.onLoad()
  initial.onShow()
  assert.equal(initial.data.markers.length, 0, '冷启动与返回首页不自动显示示例标记')
  assert.equal(initial.data.sheetPlace, null, '初始不预选地点')
  let viewportWrites = 0
  const setData = initial.setData
  initial.setData = function (value) { viewportWrites++; setData.call(this, value) }
  for (let i = 0; i < 20; i++) initial.mapRegionChange({ type: 'regionchange', detail: { type: 'end', centerLocation: { latitude: 45, longitude: 126 }, scale: 12 } })
  assert.equal(viewportWrites, 0, '地图事件不回写绑定属性，避免缩放反馈循环')
  assert.equal(initial.mapViewport.mapScale, 12, '仍记录用户实际缩放')
  initial.mapRegionChange({ type: 'end', detail: { scale: 0 } })
  assert.equal(initial.mapViewport.mapScale, 12, '无效缩放不能覆盖有效视野')
  const page = createPage([
    { id: 'a', name: '甲', latitude: 39, longitude: 116, category: '人文' },
    { id: 'b', name: '乙', latitude: 40, longitude: 117, category: '自然' }
  ])
  const pendingCards = []
  service.poiDetail = place => new Promise(resolve => pendingCards.push({ place, resolve }))
  page.togglePlace(page.data.places[0], false)
  page.togglePlace(page.data.places[1], false)
  assert.deepEqual(page.data.expandedIds, ['a', 'b'])
  pendingCards[1].resolve({ id: 'b', name: '乙详情', telephone: '010-2' })
  pendingCards[0].resolve({ id: 'a', name: '甲详情', telephone: '010-1' })
  await flush()
  assert.equal(page.data.places.find(item => item.id === 'a').telephone, '010-1')
  assert.equal(page.data.places.find(item => item.id === 'b').telephone, '010-2')

  const searchPage = createPage([])
  service.searchPlaces = async () => [
    { id: 'city-1', name: '北京市', isCity: true, category: '城市', latitude: 39.9, longitude: 116.4 },
    { id: 'poi-1', name: '故宫博物院', category: '人文', latitude: 39.916, longitude: 116.397 },
    { id: 'poi-2', name: '颐和园', category: '自然', latitude: 39.999, longitude: 116.275 },
    { id: 'poi-2', name: '颐和园重复项', category: '自然', latitude: 39.999, longitude: 116.275 }
  ]
  searchPage.setData({ keyword: '北京', searchMode: true })
  await searchPage.search(false)
  assert.equal(searchPage.data.searchMode, true)
  assert.equal(searchPage.data.searchResultCount, 3, '搜索结果按稳定 ID 去重')
  assert.equal(searchPage.data.markers.length, 0, '搜索列表未选择地点时不显示自定义 marker')
  assert.equal(searchPage.data.markerMode, 'selected')
  searchPage.searchScroll({ detail: { scrollTop: 123 } })
  global.lastNavigation = null
  searchPage.resultDetail({ currentTarget: { dataset: { id: 'city-1' } } })
  assert.equal(searchPage.data.sheetPlace.id, 'city-1')
  assert.equal(searchPage.data.markers.length, 1, '选择搜索结果后默认只显示当前 marker')
  assert.equal(global.lastNavigation, null, '搜索结果打开底部面板不得跳转独立页面')
  assert.equal(searchPage.data.latitude > 39.9, true, '选中地点应向面板上方移动')

  searchPage.toggleMarkerMode()
  assert.equal(searchPage.data.markerMode, 'all')
  assert.equal(searchPage.data.markers.length, 3, '全部模式显示本次搜索的全部结果')
  assert.equal(searchPage.data.markers.filter(marker => marker.width === 36).length, 1, '全部模式突出当前 marker')
  searchPage.filter({ detail: { value: '自然' } })
  assert.deepEqual(searchPage.data.markers.map(marker => marker.title), ['颐和园'], '搜索结果筛选应只保留对应标签的气泡标')
  searchPage.filter({ detail: { value: '人文' } })
  assert.deepEqual(searchPage.data.markers.map(marker => marker.title), ['故宫博物院'], '行政区和城市不应被误归入人文筛选')
  searchPage.filter({ detail: { value: '全部' } })
  assert.equal(searchPage.data.markers.length, 3, '恢复全部后重新显示全部搜索结果气泡')
  searchPage.toggleMarkerMode()
  assert.equal(searchPage.data.markers.length, 1, '关闭全部模式恢复唯一选中 marker')

  let detailCalls = 0
  service.poiDetail = async place => { detailCalls++; return Object.assign({}, place, { address: '详情地址' }) }
  searchPage.resultDetail({ currentTarget: { dataset: { id: 'poi-1' } } })
  await flush()
  assert.equal(searchPage.data.sheetPlace.id, 'poi-1')
  assert.equal(detailCalls, 1, '具体地点仍请求详情')
  searchPage.setData({ markerMode: 'all', showAllMarkers: true })
  searchPage.filter({ detail: { value: '自然' } })
  assert.equal(searchPage.data.markers.length, 1, '筛选开启后地图只保留自然标签气泡')
  searchPage.poi({ detail: { name: '临时地点', latitude: 39.8, longitude: 116.2, type: '景点' } })
  assert.equal(searchPage.isSearchFilterActive(), false, '点击地图确定临时地点后不再启用搜索结果筛选')
  assert.equal(searchPage.data.placeResults.length, 2, '原生 POI 不追加到搜索结果列表')
  assert.equal(searchPage.data.temporaryPlaceId.startsWith('map-'), true)
  assert.equal(searchPage.data.markers.length, 4, '全部模式可额外显示一个当前临时地点')
  searchPage.poi({ detail: { name: '临时地点2', latitude: 39.7, longitude: 116.1, type: '景点' } })
  assert.equal(searchPage.data.markers.length, 4, '连续临时地点只保留一个额外 marker')
  searchPage.toggleMarkerMode()
  assert.equal(searchPage.data.markers.length, 1, '关闭全部后只保留当前临时地点')

  const racePending = []
  service.poiDetail = place => new Promise(resolve => racePending.push({ place, resolve }))
  const racePage = createPage([])
  racePage.searchResults = [
    { id: 'race-a', name: '地点 A', latitude: 39, longitude: 116, category: '人文' },
    { id: 'race-b', name: '地点 B', latitude: 40, longitude: 117, category: '人文' },
    { id: 'race-c', name: '地点 C', latitude: 41, longitude: 118, category: '人文' }
  ]
  racePage.searchContext = { keyword: '地点', city: '', searchScrollTop: 0 }
  racePage.refresh()
  racePage.openPlaceDetail(racePage.searchResults[0])
  racePage.openPlaceDetail(racePage.searchResults[1])
  racePage.openPlaceDetail(racePage.searchResults[2])
  racePending[0].resolve({ name: 'A 迟到', address: 'A 地址' })
  racePending[1].resolve({ name: 'B 迟到', address: 'B 地址' })
  await flush()
  assert.equal(racePage.data.sheetPlace.id, 'race-c', 'A/B 迟到详情不能覆盖 C')
  assert.equal(racePage.data.markers.length, 1)
  racePending[2].resolve({ name: 'C 最新', address: 'C 地址' })
  await flush()
  assert.equal(racePage.data.sheetPlace.name, 'C 最新')

  const beforeHeight = racePage.data.sheetHeight
  racePage.sheetTouchStart({ touches: [{ clientY: 640 }] })
  racePage.sheetTouchMove({ touches: [{ clientY: 500 }] })
  assert.equal(racePage.data.sheetHeight > beforeHeight, true, '面板拖动应连续增加高度')
  racePage.sheetTouchMove({ touches: [{ clientY: 780 }] })
  assert.equal(racePage.data.sheetHeight, racePage.data.sheetMinHeight, '下滑到最小高度只收起不销毁')
  assert.equal(racePage.data.sheetPlace.id, 'race-c')
  racePage.sheetTouchEnd()
  racePage.sheetTouchStart({ touches: [{ clientY: 780 }] })
  racePage.sheetTouchMove({ touches: [{ clientY: 420 }] })
  assert.equal(racePage.data.sheetHeight > racePage.data.sheetMinHeight, true, '面板可停留在中间高度')
  racePage.sheetTouchCancel()
  assert.equal(racePage.data.sheetPlace.id, 'race-c')

  racePage.returnSearch()
  assert.equal(racePage.data.searchMode, true)
  assert.equal(racePage.data.keyword, '地点')
  assert.equal(racePage.data.searchScrollTop, 0)
  assert.equal(racePage.data.sheetPlace, null)
  assert.equal(racePage.data.searchResultCount, 3)

  let cityCalls = 0
  let administrativeResolveCalls = 0
  service.poiDetail = async () => { cityCalls++; throw new Error('city must not query scenic POI') }
  service.resolvePlace = async () => {
    administrativeResolveCalls++
    return { place: { id: 'qq-230100', providerId: '230100', providerKind: 'district', objectType: 'administrative', recognitionStatus: 'confirmed', detailStatus: 'available', planningRole: 'destination_area', canAdd: true, name: '哈尔滨市', address: '哈尔滨市', isCity: true, isAdministrative: true, category: '城市', summary: '城市目的地' }, recognitionStatus: 'confirmed', detailStatus: 'available', candidates: [] }
  }
  racePage.resultDetail({ currentTarget: { dataset: { id: 'race-a' } } })
  const cityBefore = cityCalls
  racePage.poi({ detail: { name: '哈尔滨', latitude: 45.75, longitude: 126.64, type: '行政区' } })
  assert.equal(cityCalls, cityBefore, '行政区原生 POI 不应调用景点详情')
  await flush()
  assert.equal(administrativeResolveCalls, 1, '行政区原生点击应走统一地点确认接口')
  assert.equal(racePage.data.sheetPlace.category, '城市')

  let bareCityDetailCalls = 0
  service.resolvePlace = async () => {
    bareCityDetailCalls++
    return { place: { id: 'qq-230100', providerId: '230100', providerKind: 'district', objectType: 'administrative', recognitionStatus: 'confirmed', detailStatus: 'available', planningRole: 'destination_area', canAdd: true, name: '哈尔滨市', address: '哈尔滨市', isCity: true, isAdministrative: true, category: '城市', summary: '城市目的地' }, recognitionStatus: 'confirmed', detailStatus: 'available', candidates: [] }
  }
  const bareCityPage = createPage([])
  bareCityPage.poi({ detail: { name: '哈尔滨', latitude: 45.75, longitude: 126.64 } })
  await flush()
  assert.equal(bareCityDetailCalls, 1, '无后缀城市名应请求行政区兜底详情')
  assert.equal(bareCityPage.data.sheetPlace.isCity, true, '行政区兜底结果应保持城市标识')
  assert.equal(bareCityPage.data.sheetPlace.category, '城市', '行政区兜底结果应显示城市类型')
  assert.equal(bareCityPage.data.sheetDetailMissing, false, '行政区兜底成功不应显示详情缺失')
  assert.equal(bareCityPage.data.sheetPlace.providerKind, 'district', '行政区兜底不能被当作 POI')

  const unresolvedPage = createPage([])
  service.resolvePlace = async () => ({ place: null, recognitionStatus: 'unidentified', detailStatus: 'missing', candidates: [] })
  unresolvedPage.poi({ detail: { latitude: 45.75, longitude: 126.64 } })
  await flush()
  assert.equal(unresolvedPage.data.sheetPlace.objectType, 'coordinate', '无名称坐标保持为坐标对象')
  assert.equal(unresolvedPage.data.sheetPlace.canAdd, false, '未识别坐标不能加入菜单')
  assert.equal(unresolvedPage.data.sheetPlace.category, '未识别位置', '未识别坐标不使用默认人文标签')

  const candidatePage = createPage([])
  service.resolvePlace = async () => ({ place: null, recognitionStatus: 'candidate', detailStatus: 'missing', candidates: [{ id: 'candidate-poi', providerId: 'candidate-poi', providerKind: 'poi', objectType: 'poi', recognitionStatus: 'candidate', canAdd: false, name: '候选景点', category: '景点', latitude: 45.75, longitude: 126.64 }] })
  service.poiDetail = async place => Object.assign({}, place, { recognitionStatus: 'confirmed', detailStatus: 'available', canAdd: true, address: '候选地点地址' })
  candidatePage.poi({ detail: { name: '地图标签', latitude: 45.75, longitude: 126.64 } })
  await flush()
  assert.equal(candidatePage.data.sheetCandidates.length, 1, '未确认结果展示候选地点')
  assert.equal(candidatePage.data.sheetCanAdd, false, '候选未明确选择前不能加入菜单')
  candidatePage.selectCandidate({ currentTarget: { dataset: { id: 'candidate-poi' } } })
  await flush()
  assert.equal(candidatePage.data.sheetCanAdd, true, '用户明确选择候选后才允许加入')
  assert.equal(candidatePage.data.sheetPlace.providerKind, 'poi', '候选选择保留 POI 数据源类型')

  const provincePage = createPage([])
  service.resolvePlace = async () => ({ place: { id: 'qq-440000', providerId: '440000', providerKind: 'district', objectType: 'administrative', recognitionStatus: 'confirmed', detailStatus: 'available', planningRole: 'choose_city', canAdd: false, name: '广东省', address: '广东省', isProvince: true, isAdministrative: true, category: '省/自治区', summary: '请继续选择省内城市' }, recognitionStatus: 'confirmed', detailStatus: 'available', candidates: [] })
  provincePage.poi({ detail: { name: '广东省', latitude: 23.13, longitude: 113.26, type: '行政区' } })
  await flush()
  assert.equal(provincePage.data.sheetPlace.isProvince, true, '省级行政区进入行政区状态')
  assert.equal(provincePage.data.sheetCanAdd, false, '省级行政区不能直接加入菜单')
  assert.equal(provincePage.data.sheetPlace.planningRole, 'choose_city', '省级行政区引导选择城市')

  const nativePending = []
  service.resolvePlace = place => new Promise((resolve, reject) => nativePending.push({ place, resolve, reject }))
  const nativeRacePage = createPage([])
  nativeRacePage.poi({ detail: { name: 'A', latitude: 39, longitude: 116, type: '景点' } })
  nativeRacePage.poi({ detail: { name: 'B', latitude: 40, longitude: 117, type: '景点' } })
  nativePending[0].resolve({ place: { id: 'poi-a', providerId: 'a', objectType: 'poi', providerKind: 'poi', recognitionStatus: 'confirmed', detailStatus: 'available', name: 'A 已确认', category: '景点', latitude: 39, longitude: 116 }, recognitionStatus: 'confirmed', detailStatus: 'available' })
  await flush()
  assert.equal(nativeRacePage.data.sheetPlace.name, 'B', '原生点击 A 的迟到响应不能覆盖当前 B')
  nativePending[1].resolve({ place: { id: 'poi-b', providerId: 'b', objectType: 'poi', providerKind: 'poi', recognitionStatus: 'confirmed', detailStatus: 'available', name: 'B 已确认', category: '景点', latitude: 40, longitude: 117 }, recognitionStatus: 'confirmed', detailStatus: 'available' })
  await flush()
  assert.equal(nativeRacePage.data.sheetPlace.name, 'B 已确认', '当前原生点击 B 能完成确认')

  const failedPage = createPage([])
  service.resolvePlace = async () => { throw new Error('地图服务请求失败，请重试') }
  failedPage.poi({ detail: { name: '失败地点', latitude: 41, longitude: 118 } })
  await flush()
  assert.equal(failedPage.data.sheetCanAdd, false, '请求失败时不能沿用上一次可加入状态')
  assert.match(failedPage.data.sheetDetailError, /请求失败/)

  const addPage = createPage([])
  const addPlace = { id: 'join-regression-place', name: '加入回归地点', latitude: 45.75, longitude: 126.64, category: '人文' }
  addPage.selectedPlace = addPlace
  addPage.setData({ sheetPlace: addPlace, sheetAdded: false, count: 0 })
  addPage.sheetControlTouch({ touches: [{ clientX: 100, clientY: 100 }] })
  addPage.sheetControlTouchEnd({ currentTarget: { dataset: { id: addPlace.id } } })
  assert.equal(addPage.data.count, 1, '拖动区内的加入按钮应更新首页菜单数量')
  assert.equal(store.read().menu.some(item => item.id === addPlace.id), true, '拖动区内的加入按钮应写入菜单')
  addPage.sheetAddHandledAt = 0
  addPage.sheetControlTouch({ touches: [{ clientX: 100, clientY: 100 }] })
  addPage.sheetControlTouchEnd({ currentTarget: { dataset: { id: addPlace.id } } })
  assert.equal(addPage.data.count, 0, '再次点击已加入按钮应更新首页菜单数量')
  assert.equal(store.read().menu.some(item => item.id === addPlace.id), false, '再次点击已加入按钮应移出菜单')

  const typedCity = { id: 'typed-city', providerId: '230100', providerKind: 'district', objectType: 'administrative', recognitionStatus: 'confirmed', planningRole: 'destination_area', canAdd: true, isCity: true, category: '城市', name: '哈尔滨市', latitude: 45.75, longitude: 126.64, province: '黑龙江省', city: '哈尔滨市', stayDays: 1 }
  const typedResult = store.togglePlace(typedCity)
  assert.equal(typedResult.added, true)
  const typedStored = store.read().menu.find(item => item.id === typedCity.id)
  assert.equal(typedStored.providerKind, 'district', '菜单保留行政区数据源类型')
  assert.equal(typedStored.providerId, '230100', '菜单保留稳定行政区 ID')
  assert.equal(typedStored.planningRole, 'destination_area', '菜单保留目的地区域用途')
  const typedErrors = engine.validate(Object.assign(engine.defaults(), { days: 2 }), [typedStored])
  assert.equal(typedErrors.stops, undefined, '确认后的城市可进入规划')
  const typedPlan = engine.generate(Object.assign(engine.defaults(), { days: 2 }), [typedStored])
  assert.equal(typedPlan.demands[0].toType, 'destination_area', '规划将城市作为区域目的地而不是精确 POI')
  assert.equal(typedPlan.demands.find(item => item.category === 'ticket').latitude, undefined, '城市门票需求不使用城市中心坐标作为景点点位')
  store.togglePlace(typedCity)

  const dragPage = createPage([])
  const dragPlace = { id: 'join-regression-drag', name: '拖动误触地点', latitude: 45.76, longitude: 126.65, category: '人文' }
  dragPage.selectedPlace = dragPlace
  dragPage.setData({ sheetPlace: dragPlace, sheetAdded: false, count: 0 })
  dragPage.sheetControlTouch({ touches: [{ clientX: 100, clientY: 100 }] })
  dragPage.sheetControlTouch({ touches: [{ clientX: 100, clientY: 140 }] })
  dragPage.sheetControlTouchEnd({ currentTarget: { dataset: { id: dragPlace.id } } })
  assert.equal(dragPage.data.count, 0, '拖动按钮时不应误加入菜单')

  // --- G2-BUG：抽屉地点身份补全后必须重算 sheetAdded（真值仍是 store.samePlace()） ---
  const menuProviderPlace = { id: 'menu-prov-7001', providerId: '7001', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '补全地点', category: '人文', latitude: 45.75, longitude: 126.64, stayDays: 1 }
  store.addPlace(menuProviderPlace)
  service.resolvePlace = async () => ({
    place: { id: 'poi-7001', providerId: '7001', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', detailStatus: 'available', planningRole: 'stop', canAdd: true, name: '补全地点', category: '人文', latitude: 45.75, longitude: 126.64 },
    recognitionStatus: 'confirmed', detailStatus: 'available', candidates: []
  })
  const provisionPage = createPage([])
  provisionPage.poi({ detail: { name: '补全地点', latitude: 45.75, longitude: 126.64, type: '景点' } })
  assert.equal(provisionPage.data.sheetPlace.id.startsWith('map-'), true, '原生点击先以 provisional id 进入抽屉')
  assert.equal(provisionPage.data.sheetPlace.providerId, undefined, '前置条件：provisional 地点还没有 providerId')
  assert.equal(provisionPage.data.sheetAdded, false, 'provisional 地点无法命中菜单，初始只能是未加入')
  for (let i = 0; i < 4; i++) await flush()
  assert.equal(provisionPage.data.sheetPlace.providerId, '7001', '抽屉身份应补全为真实 providerId')
  assert.equal(provisionPage.data.sheetAdded, true, '身份补全命中菜单后，sheetAdded 必须自动变为 true（否则按钮会一直显示「加入菜单」）')

  // 搜索结果 item.added 仍必须基于 samePlace()，不得退化
  const menuSearchPlace = { id: 'menu-prov-8001', providerId: '8001', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '搜索命中地点', category: '人文', latitude: 39.5, longitude: 116.5, stayDays: 1 }
  store.addPlace(menuSearchPlace)
  const addedSearchPage = createPage([])
  addedSearchPage.searchResults = [
    { id: 'qq-8001', providerId: '8001', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '搜索命中地点', category: '人文', latitude: 39.5, longitude: 116.5 },
    { id: 'qq-8002', providerId: '8002', providerKind: 'poi', provider: 'qq', objectType: 'poi', recognitionStatus: 'confirmed', planningRole: 'stop', canAdd: true, name: '未命中地点', category: '人文', latitude: 39.6, longitude: 116.6 }
  ]
  addedSearchPage.searchContext = { keyword: '地点', city: '', searchScrollTop: 0 }
  addedSearchPage.refresh()
  assert.equal(addedSearchPage.data.placeResults.find(item => item.id === 'qq-8001').added, true, '搜索结果的 item.added 必须按 samePlace() 命中菜单')
  assert.equal(addedSearchPage.data.placeResults.find(item => item.id === 'qq-8002').added, false, '未加入的搜索结果必须保持 added=false')
  store.togglePlace(menuSearchPlace)
  store.togglePlace(menuProviderPlace)

  const wxml = fs.readFileSync(require('node:path').join(__dirname, '../pages/index/index.wxml'), 'utf8')
  assert.equal(/^(<<<<<<<|=======|>>>>>>>)/m.test(wxml), false, 'WXML 不得保留 Git 冲突标记')
  assert.equal(wxml.includes('closeSheet'), false, '首页面板不再提供关闭按钮')
  assert.equal(wxml.includes('查看菜单'), false, '首页面板不再提供查看菜单按钮')
  assert.equal(wxml.includes('返回搜索结果'), false, '返回由原生页面栈负责，面板不再显示重复按钮')
  assert.ok(wxml.includes('bindchange="toggleMarkerMode"'), '全部结果使用滑动开关')
  assert.ok(wxml.includes('bindtap="search">搜索'), '搜索框右侧主动执行搜索')
  assert.equal(wxml.includes('catchtap="add"'), true, '加入按钮阻止冒泡')
  assert.ok(wxml.includes('catchtouchend="sheetControlTouchEnd"'), '加入按钮使用触摸结束兜底，不依赖单一 tap 事件')
  assert.ok(wxml.includes('wx:if="{{searchResultCount && markerMode===\'all\' && !temporaryPlaceId}}"'), '分类筛选仅在显示全部搜索结果时出现')
  assert.equal(wxml.includes('disabled="{{item.added}}"'), false, '已加入地点仍可点击移出菜单')
  assert.equal(wxml.includes('disabled="{{sheetAdded}}"'), false, '地点面板的已加入按钮仍可点击移出菜单')
  assert.ok(wxml.includes('暂未确认这是具体地点还是城市，请选择候选地点或重新获取。'), '未识别状态使用面向用户的确认提示')
  assert.equal(wxml.includes('未识别为具体地点或行政区，不会自动替换成所在城市。'), false, '不向用户暴露内部兜底策略文案')
  assert.ok(wxml.includes('mapFailed && places.length && !sheetPlace'), '大列表只作为地图失败备用入口，不遮挡正常地图')
  assert.ok(wxml.includes('catchtouchmove="sheetTouchMove"'), '拖动标题区不穿透地图')
  assert.equal(wxml.includes('sheetAdded || sheetDetailLoading'), false, '基础地点可直接加入，不依赖详情请求成功')
  const css = fs.readFileSync(require('node:path').join(__dirname, '../pages/index/index.wxss'), 'utf8')
  assert.match(css, /\.index-page \.place-sheet\{[^}]*display:flex[^}]*transition:none/, '面板连续跟手而不是高度动画追赶')
  assert.match(css, /\.index-page \.sheet-scroll\{[^}]*flex:1;[^}]*min-height:0/, '内容滚动区使用剩余高度')
  // --- G2-R2：p03 正常态保留 / p05 真空态收窄 / 按钮居中与字号不虚 / 抽屉不卡 ---
  const EMPTY_GUARD = '!mapFailed || places.length > 0'
  assert.equal(wxml.includes('map-empty-row'), false, '不存在「把正常态降级成空态」的次级按钮分支')
  assert.ok(wxml.includes('wx:if="{{' + EMPTY_GUARD + '}}" class="map-control-row"'), 'p03 正常态保留我的位置 / 示例地点，只有 p05 真空态才隐藏')
  assert.ok(wxml.includes('wx:if="{{' + EMPTY_GUARD + '}}" class="floating"'), 'p03 正常态保留菜单悬浮按钮，只有 p05 真空态才隐藏')
  assert.ok(wxml.includes('wx:if="{{!sheetPlace && !mapFailed}}" class="map-selection-hint"'), 'p03 正常态保留底部提示胶囊，只有 p05 真空态才隐藏')
  assert.equal(/map-control-row[^>]*wx:if="\{\{places\.length \|\|/.test(wxml), false, '不得再用「有数据才显示」的旧守卫把正常态删空')
  assert.equal(wxml.split('class="map-control-row"').length - 1, 1, '我的位置 / 示例地点只有一处渲染点')
  assert.equal(wxml.includes('result-type'), false, 'p04 地点行只有标题 + 一行元信息，与 PDF 一致')

  // 按钮居中：不能用 block + line-height 撑高
  const detailCss = fs.readFileSync(require('node:path').join(__dirname, '../pages/place-detail/place-detail.wxss'), 'utf8')
  assert.match(css, /\.index-page button\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/, '按钮文字靠 flex 居中，不靠 line-height 撑高')
  assert.match(detailCss, /\.detail-page button\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/, '地点详情按钮同样 flex 居中')
  // 行高必须是整数 rpx，小数倍率会产生半像素基线导致文字发虚（先剥掉注释再查）
  const stripComments = value => value.replace(/\/\*[\s\S]*?\*\//g, '')
  const decimalLineHeight = stripComments(css).match(/line-height:\s*\d*\.\d+(?!\d*px)/g) || []
  assert.deepEqual(decimalLineHeight, [], 'WXSS 不得使用小数倍率行高（会导致文字发虚）')
  assert.deepEqual(stripComments(detailCss).match(/line-height:\s*\d*\.\d+(?!\d*px)/g) || [], [], '地点详情 WXSS 同样不得使用小数倍率行高')
  // 抽屉不得做高度过渡动画
  assert.match(css, /\.index-page \.place-sheet\{[^}]*transition:none/, '首页抽屉高度直接跟手，不做动画')
  assert.match(detailCss, /\.detail-sheet\{[^}]*transition:none/, '地点详情抽屉不做高度动画（动画会每帧重排导致卡顿）')
  assert.equal(/transition:\s*height/.test(detailCss), false, '不得再对抽屉高度做 transition')

  // --- G2-R2 尺寸收口：p03 实测值锁死（pdf_px × 750/542 = ×1.3838） ---
  // 卡片 17pdf→24rpx；上距导航栏 17pdf→24rpx；圆角 20pdf→28rpx；
  // 内边距 上16pdf→22rpx 左右19pdf→25rpx 下27pdf→37rpx
  assert.match(css, /\.index-page \.map-controls\{[^}]*top:calc\(24rpx \+ env\(safe-area-inset-top\)\)[^}]*left:24rpx/, '卡片上距导航栏 17pdf → 24rpx，左右边距 17pdf → 24rpx')
  assert.match(css, /\.index-page \.map-controls\{[^}]*padding:22rpx 25rpx 37rpx/, '卡片内边距 上22rpx 左右25rpx 下37rpx（按 PDF 实测，不再用 width:100% 兜底）')
  assert.match(css, /\.index-page \.map-controls\{[^}]*border-radius:28rpx/, '卡片圆角 20pdf → 28rpx')
  assert.match(css, /\.index-page \.map-search\{[^}]*min-height:92rpx/, '搜索框高 67pdf → 92rpx（取偶数保整像素）')
  assert.match(css, /\.index-page \.map-control-row\{[^}]*gap:19rpx[^}]*margin-top:19rpx/, '辅助按钮间距与上间距均 14pdf → 19rpx')
  assert.match(css, /\.index-page \.map-control-row button\{[^}]*min-height:76rpx/, '我的位置 / 示例地点 高 56pdf → 76rpx（取偶数保整像素）')
  assert.match(css, /\.index-page \.floating\{[^}]*min-width:133rpx[^}]*min-height:84rpx/, '菜单悬浮按钮宽度 199→133rpx（G2-R4 Owner 要求宽度约 2/3；高 84rpx 不变）')
  assert.match(css, /\.index-page \.map-selection-hint\{[^}]*min-height:66rpx/, '底部提示胶囊 高 47pdf → 66rpx')
  assert.match(css, /\.index-page \.search-cancel\{[^}]*min-width:85rpx[^}]*min-height:92rpx/, 'p04 搜索按钮宽度 127→85rpx（G2-R4 Owner 要求宽度约 2/3；高 92rpx 不变）')
  assert.match(css, /\.index-page \.result-row\{[^}]*margin:0 0 24rpx;padding:25rpx/, 'p04 结果卡间距 17pdf → 24rpx，内距 25rpx（卡高 88pdf → 122rpx）')
  assert.match(css, /\.index-page \.result-row\{[^}]*border-radius:36rpx/, 'p04 结果卡圆角 26pdf → 36rpx')
  assert.match(css, /\.index-page \.result-add\{[^}]*min-width:104rpx[^}]*min-height:60rpx/, 'p04 动作胶囊宽度 148→104rpx（G2-R4 Owner 要求宽度约 2/3；「＋ 菜单」文字 79rpx+24rpx 内距=103rpx 已是下限）')
  assert.match(css, /\.index-page \.search-page\{[^}]*padding:calc\(30rpx \+ env\(safe-area-inset-top\)\) 30rpx/, 'p04 页边距 22pdf → 30rpx')

  // --- G2-R3：Owner 反馈「搜索/菜单/加入菜单/已加入菜单 尺寸与预期不符 + 字体依旧模糊」 ---
  // 根因一：mvp.wxss:12 的 button{min-height:84rpx}(0,0,1) 在页级复位漏声明该属性时生效，
  //         把所有矮于 84rpx 的按钮（60/62/66/76rpx）全部撑到 84rpx。
  assert.match(css, /\.index-page button\{[^}]*min-height:0/, '页级按钮复位必须显式 min-height:0，否则被 mvp 的 84rpx 撑高（「尺寸与预期不符」总根因）')
  assert.match(detailCss, /\.detail-page button\{[^}]*min-height:0/, '地点详情按钮复位同样必须 min-height:0')
  // 根因二：button + border-radius + overflow:hidden 会让按钮被提升为独立合成层 → 层内文字降采样发虚
  const buttonReset = css.match(/\.index-page button\{[^}]*\}/)[0]
  const detailReset = detailCss.match(/\.detail-page button\{[^}]*\}/)[0]
  assert.equal(/overflow\s*:\s*hidden/.test(buttonReset), false, '按钮复位不得写 overflow:hidden（会导致文字被降采样发虚）')
  assert.equal(/overflow\s*:\s*hidden/.test(detailReset), false, '地点详情按钮复位同样不得写 overflow:hidden')
  // 根因三：原生 button::after 的 10rpx 方框描边盖在胶囊上 → 看起来「不够圆」
  assert.match(css, /\.index-page button::after\{[^}]*border:0/, '必须清掉原生 button::after 的方框描边，否则胶囊看起来不够圆')
  assert.match(detailCss, /\.detail-page button::after\{[^}]*border:0/, '地点详情同样要清 button::after')
  // 根因四：align-items:center 下行盒顶边 = (高 − 行高)/2，奇数差值 → 半像素 → 文字发虚
  for (const [label, source] of [['首页', css], ['地点详情', detailCss]]) {
    const stripped = stripComments(source)
    const blocks = stripped.match(/[^{}]+\{[^{}]*\}/g) || []
    const oddHeight = []
    const oddLineHeight = []
    for (const block of blocks) {
      const sel = block.slice(0, block.indexOf('{')).trim()
      const body = block.slice(block.indexOf('{') + 1, -1)
      const num = name => {
        const hit = body.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([0-9.]+)rpx'))
        return hit ? parseFloat(hit[1]) : null
      }
      const fs = num('font-size'); const lh = num('line-height')
      const h = num('min-height') !== null ? num('min-height') : num('height')
      if (h !== null && lh !== null && (h - lh) % 2 !== 0) oddHeight.push(sel + ' h=' + h + ' lh=' + lh)
      if (fs !== null && lh !== null && (lh - fs) % 2 !== 0) oddLineHeight.push(sel + ' fs=' + fs + ' lh=' + lh)
    }
    assert.deepEqual(oddHeight, [], label + '：高度与行高之差必须为偶数（奇数会让行盒落半像素，文字发虚）')
    assert.deepEqual(oddLineHeight, [], label + '：行高与字号之差必须为偶数（同上）')
  }
  // 四个被点名的按钮：高度一档比一档矮，且都远低于 mvp 的 84rpx 兜底
  assert.match(css, /\.index-page \.floating\{[^}]*min-height:84rpx/, '菜单 CTA 高 84rpx（84−36=48 偶数）')
  assert.match(css, /\.index-page \.map-search\{[^}]*min-height:92rpx/, 'p03 搜索框高 92rpx（92−36=56 偶数）')
  assert.match(css, /\.index-page \.map-control-row button\{[^}]*min-height:76rpx/, '我的位置 / 示例地点 高 76rpx（76−36=40 偶数）')
  assert.equal(/min-height:7[0-9]rpx/.test(css.replace(/76rpx/g, '')), false, '不得再有 7x rpx 的奇数高度')
  // 「铺满式长框」守卫：主按钮不得用 width:100% 兜底，辅助按钮靠 flex:1 等分
  assert.equal(/\.index-page \.map-control-row button\{[^}]*width:100%/.test(css), false, '辅助按钮不得用 width:100% 拉满卡片')
  assert.match(css, /\.index-page \.map-control-row button\{[^}]*flex:1/, '辅助按钮靠 flex:1 等分卡片内宽')

  // --- G2-R4：Owner「搜索 / 菜单 / 加入菜单 / 已加入菜单 尺寸改更短，大概是现在的 2/3」 ---
  // Owner 明确选的是「只缩宽度（更短更圆）」轴 ⇒ 高度一律保持不变。
  // 关键：定宽与左右内距必须**一起**收窄。只降定宽不降内距，胶囊只是「文字居中留白更多」，
  // 并不会真的变短；而且内距不收窄时实测定宽会被文案撑回原样（文字宽度是硬下限）。
  // 实测量值见 pages/index/index.wxss 的 G2-R4 注释块（headless 渲染回量 × 1.3838）。
  const WIDTH_SPEC = [
    ['\\.search-cancel', 85, 16, 92, 127],
    ['\\.result-add', 104, 12, 60, 148],
    ['\\.floating', 133, 22, 84, 199],
    ['\\.sheet-add', 132, 14, 84, 180],
    ['\\.place-card-add', 120, 12, 62, 0]
  ]
  for (const [sel, minWidth, pad, minHeight, was] of WIDTH_SPEC) {
    const rule = css.match(new RegExp('\\.index-page ' + sel + '\\{[^}]*\\}'))
    assert.ok(rule, sel + ' 规则必须存在')
    assert.match(rule[0], new RegExp('min-width:' + minWidth + 'rpx'), sel + ' 定宽必须为 ' + minWidth + 'rpx')
    assert.match(rule[0], new RegExp('padding:0 ' + pad + 'rpx'), sel + ' 左右内距必须同步收到 ' + pad + 'rpx，否则胶囊只是留白更多、并不会变短')
    assert.match(rule[0], new RegExp('min-height:' + minHeight + 'rpx'), sel + ' 高度必须保持 ' + minHeight + 'rpx（Owner 只要求缩宽度）')
    if (was) {
      const ratio = minWidth / was
      assert.ok(ratio >= 0.62 && ratio <= 0.76, sel + ' 宽度应约为 G2-R3 的 2/3（0.62~0.76），实为 ' + ratio.toFixed(3))
      assert.equal(new RegExp('\\.index-page ' + sel + '\\{[^}]*min-width:' + was + 'rpx').test(css), false, sel + ' 不得保留旧定宽 ' + was + 'rpx')
    }
  }
  // 悬浮 CTA 的上限要跟着定宽一起收，否则两位数（菜单 · 12）会撑破新的短胶囊
  assert.match(css, /\.index-page \.floating\{[^}]*max-width:187rpx/, '菜单悬浮 max-width 必须同步 280→187rpx')

  const mapPageSource = fs.readFileSync(require('node:path').join(__dirname, '../utils/map-page.js'), 'utf8')
  assert.match(mapPageSource, /^ {2}locate\(\)\s*\{/m, '定位实现保留，空态只隐藏入口不删功能')
  assert.match(mapPageSource, /^ {2}seeds\(\)\s*\{/m, '示例地点实现保留，空态只隐藏入口不删功能')
  console.log('PASS separated search/selection/marker/map/sheet state, marker modes, drag sheet, return context and stale guards (mocked)')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
