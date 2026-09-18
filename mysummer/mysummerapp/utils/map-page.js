const store = require('./travel-store')
const engine = require('./travel-engine')
const ui = require('./travel-ui')
const service = require('./travel-services')
const cloud = require('../config/cloud')

function touchPoint(touch) {
  if (!touch) return null
  return {
    x: Number(touch.clientX !== undefined ? touch.clientX : touch.pageX),
    y: Number(touch.clientY !== undefined ? touch.clientY : touch.pageY)
  }
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}

module.exports = function createMapPage(mode = 'home') { return {
  data: {
    keyword: '', city: '', searchMode: false, cityResults: [], placeResults: [], searchResultCount: 0, searchScrollTop: 0,
    expandedIds: [], locationText: '', locating: false, locationFailure: '', places: [], markers: [], points: [], count: 0,
    loading: false, error: '', filter: '全部', mapFailed: false, latitude: 47, longitude: 128, mapScale: 5,
    markerMode: 'selected', showAllMarkers: false, selectedPlaceId: '', temporaryPlaceId: '',
    sheetPlace: null, sheetHeight: 260, sheetMinHeight: 190, sheetMaxHeight: 680, sheetExpanded: false,
    sheetDetailLoading: false, sheetDetailMissing: false, sheetDetailError: '', sheetDisplayAddress: '', sheetAdded: false, sheetCanAdd: false, sheetCandidates: [],
    sheetReturnAvailable: false, hasSearchContext: false,
    sheetCommunityLoading: false, sheetCommunityError: '', sheetPosts: [], sheetReviews: [], sheetRoutes: [],
    sheetOtherPosts: [], sheetPhotos: [], sheetRatingText: '', sheetDurationText: ''
  },

  onLoad() {
    this.seq = 0
    this.detailSeq = {}
    this.detailCache = {}
    this.detailStates = {}
    this.markerIds = {}
    this.markerPlaces = {}
    this.nextMarkerId = 1
    this.searchResults = []
    this.searchContext = null
    this.selectedPlace = null
    this.temporaryPlace = null
    this.sheetSeq = 0
    this.sheetDetailSeq = 0
    this.sheetCommunitySeq = 0
    this.sheetControlGesture = null
    this.sheetAddHandledAt = 0
    this.pageIdentity = store.sessionIdentity()
    this.pool = []
    this.viewportHeight = 800
    try {
      const info = wx.getSystemInfoSync && wx.getSystemInfoSync()
      if (info && Number.isFinite(Number(info.windowHeight))) this.viewportHeight = Number(info.windowHeight)
    } catch (_) {}
    this.sheetMinHeight = Math.max(140, Math.min(170, Math.round(this.viewportHeight * 0.24)))
    this.sheetMaxHeight = Math.max(this.sheetMinHeight + 100, Math.round(this.viewportHeight - 72))
    this.setData({ sheetHeight: Math.min(Math.max(Math.round(this.viewportHeight * 0.44), this.sheetMinHeight), this.sheetMaxHeight), sheetMinHeight: this.sheetMinHeight, sheetMaxHeight: this.sheetMaxHeight })
    this.refresh(false)
    if (mode === 'search') this.setData({ searchMode: true })
    if (mode === 'selection' && this.getOpenerEventChannel) {
      this.getOpenerEventChannel().on('selection', payload => {
        this.searchResults = this.dedupePlaces(payload.results)
        this.searchContext = payload.context
        this.setData({ keyword: payload.keyword, city: payload.city || '', markerMode: 'selected', showAllMarkers: false })
        this.refresh(false)
        this.openPlaceDetail(payload.place)
      })
    }
  },

  onShow() {
    ui.run(this, () => {
      const identity = store.sessionIdentity()
      if (this.pageIdentity && !store.isCurrentSession(this.pageIdentity)) {
        this.seq++
        this.sheetSeq++
        this.sheetDetailSeq++
        this.sheetCommunitySeq++
        this.searchResults = []
        this.searchContext = null
        this.selectedPlace = null
        this.temporaryPlace = null
        this.setData({
          sheetPlace: null, sheetDetailLoading: false, sheetDetailMissing: false, sheetDetailError: '', sheetCandidates: [],
          sheetCommunityLoading: false, sheetCommunityError: '', sheetPosts: [], sheetReviews: [], sheetRoutes: [],
          sheetOtherPosts: [], sheetPhotos: [], sheetRatingText: '', sheetDurationText: '',
          selectedPlaceId: '', temporaryPlaceId: '', searchResultCount: 0, cityResults: [], placeResults: [], hasSearchContext: false
        })
      }
      this.pageIdentity = identity
      if (!Array.isArray(this.pool)) this.pool = []
      this.setData({ count: store.read().menu.length })
      this.refresh(false)
      if (this.data.sheetPlace) this.setData({ sheetAdded: this.menuHasPlace(this.data.sheetPlace) })
    })
  },

  placeKey(place) {
    if (place && place.selectionKey) return String(place.selectionKey)
    if (place && place.id !== undefined && place.id !== null && String(place.id)) return String(place.id)
    return 'map-' + Number(place.latitude).toFixed(6) + '-' + Number(place.longitude).toFixed(6) + '-' + String(place.name || '')
  },

  placeCategory(place) {
    if (!place) return ''
    if (this.isAdministrativePlace(place) || this.isCityPlace(place)) return ''
    if (place.categoryGroup) return place.categoryGroup
    const category = String(place.category || '')
    if (!category || ['地点', '待确认', '未识别位置'].includes(category)) return ''
    return /公园|自然|风景|森林|湿地|山|湖|河|景区/.test(category) ? '自然' : '人文'
  },

  isSearchFilterActive() {
    return this.searchResults.length > 0 && !this.data.searchMode && this.data.markerMode === 'all' && !this.temporaryPlace
  },

  isAdministrativePlace(place) {
    if (!place || place.objectType === 'poi' || place.objectType === 'coordinate') return false
    if (place.objectType === 'administrative' || place.providerKind === 'district' || place.isAdministrative === true || place.isAdmin === true || place.isProvince === true) return true
    const fields = [place.adminLevel, place.adminType, place.locationType, place.type, place.poiType].filter(value => value !== undefined && value !== null && String(value).trim() !== '').join(' ').toLowerCase()
    return /行政区|行政|district|administrative|county|province|municipality|城市|地区|自治州|盟/.test(fields)
  },

  isProvincePlace(place) {
    if (!this.isAdministrativePlace(place)) return false
    if (place.isProvince === true || place.planningRole === 'choose_city' || String(place.administrativeLevel || '').toLowerCase() === 'province') return true
    const fields = [place.adminLevel, place.adminType, place.locationType, place.type, place.poiType].filter(value => value !== undefined && value !== null && String(value).trim() !== '').join(' ').toLowerCase()
    return /省|自治区|province/.test(fields) || /(?:省|自治区)$/.test(String(place.name || '').trim())
  },

  isDestinationArea(place) {
    if (!place || this.isProvincePlace(place)) return false
    if (place.planningRole === 'destination_area') return true
    if (place.objectType === 'administrative' || place.providerKind === 'district') return true
    if (place.isCity === true && place.objectType !== 'poi') return true
    return this.isCityPlace(place)
  },

  menuHasPlace(place) {
    const menu = store.read().menu
    return menu.some(item => typeof store.samePlace === 'function' ? store.samePlace(item, place) : item.id === place.id || (place.providerId && item.providerId && String(item.providerId) === String(place.providerId)))
  },

  canAddPlace(place) {
    if (!place || place.canAdd === false || this.isProvincePlace(place)) return false
    if (place.recognitionStatus && place.recognitionStatus !== 'confirmed' && place.recognitionStatus !== 'legacy') return false
    if (place.objectType === 'coordinate' && place.recognitionStatus !== 'confirmed') return false
    return true
  },

  dedupePlaces(list) {
    const seen = new Map()
    ;(Array.isArray(list) ? list : []).forEach(place => {
      if (!place || !place.name || finite(place.latitude) === null || finite(place.longitude) === null) return
      const key = this.placeKey(place)
      if (!seen.has(key)) seen.set(key, place)
    })
    return Array.from(seen.values())
  },

  detailView(place, menu) {
    const detail = this.detailCache[place.id] || {}
    const state = this.detailStates[place.id] || {}
    const key = this.placeKey(place)
    return Object.assign({}, place, detail, {
      markerId: this.markerIds[key] || (this.markerIds[key] = this.nextMarkerId++),
      added: menu.some(item => typeof store.samePlace === 'function' ? store.samePlace(item, place) : item.id === place.id),
      expanded: (this.data.expandedIds || []).includes(place.id),
      detailLoading: !!state.loading, detailMissing: !!state.missing, detailError: state.error || ''
    })
  },

  refresh(center) {
    const menu = store.read().menu
    const source = this.searchResults.length ? this.searchResults : (this.pool || [])
    const filterActive = this.isSearchFilterActive()
    const activeFilter = filterActive ? this.data.filter : '全部'
    const places = source.filter(place => activeFilter === '全部' || this.placeCategory(place) === activeFilter).map(place => this.detailView(place, menu))
    const next = { places, count: menu.length }
    if (this.searchResults.length) {
      const all = this.searchResults.map(place => this.detailView(place, menu))
      next.cityResults = all.filter(place => this.isAdministrativePlace(place) || this.isCityPlace(place))
      next.placeResults = all.filter(place => !this.isAdministrativePlace(place) && !this.isCityPlace(place))
      next.searchResultCount = this.searchResults.length
    } else {
      next.cityResults = []
      next.placeResults = []
      next.searchResultCount = 0
    }
    if (center && places.length) {
      const first = places[0]
      next.latitude = Number(first.latitude)
      next.longitude = Number(first.longitude)
      next.mapScale = this.searchResults.length ? 10 : (this.data.mapScale || 5)
      next.points = places.map(place => ({ latitude: Number(place.latitude), longitude: Number(place.longitude) }))
    }
    this.setData(next)
    this.refreshMarkers()
  },

  refreshMarkers() {
    const selected = this.selectedPlace
    const inSearch = place => !!place && this.searchResults.some(item => this.placeKey(item) === this.placeKey(place))
    let source
    if (this.searchResults.length) {
      const filterActive = this.isSearchFilterActive()
      const searchPlaces = this.searchResults.filter(place => !filterActive || this.data.filter === '全部' || this.placeCategory(place) === this.data.filter)
      source = this.data.markerMode === 'all' ? searchPlaces : (selected ? [selected] : [])
      if (this.data.markerMode === 'all' && selected && !inSearch(selected)) source.push(selected)
    } else {
      source = selected ? [selected] : (this.pool || [])
    }
    const byKey = new Map()
    source.forEach(place => { if (place) byKey.set(this.placeKey(place), place) })
    this.markerPlaces = {}
    const markers = Array.from(byKey.values()).map(place => {
      const key = this.placeKey(place)
      const id = this.markerIds[key] || (this.markerIds[key] = this.nextMarkerId++)
      const active = !!selected && key === this.placeKey(selected)
      this.markerPlaces[id] = place
      const marker = {
        id, placeId: key, latitude: Number(place.latitude), longitude: Number(place.longitude),
        width: active ? 36 : 28, height: active ? 44 : 34, title: place.name,
        callout: { content: place.name, display: active ? 'ALWAYS' : 'BYCLICK', padding: 6 }
      }
      if (place.iconPath) marker.iconPath = place.iconPath
      return marker
    })
    this.setData({ markers })
  },

  mapRegionChange(event) {
    // Observe native gestures without feeding the same viewport back into <map>.
    // setData here can cause another regionchange and repeated fit/zoom updates.
    if (!event || !event.detail || (event.detail.type || event.type) !== 'end') return
    const center = event.detail.centerLocation || {}
    const latitude = finite(center.latitude)
    const longitude = finite(center.longitude)
    const mapScale = finite(event.detail.scale)
    const next = Object.assign({}, this.mapViewport)
    if (latitude !== null && latitude >= -90 && latitude <= 90) next.latitude = latitude
    if (longitude !== null && longitude >= -180 && longitude <= 180) next.longitude = longitude
    if (mapScale !== null && mapScale >= 3 && mapScale <= 20) next.mapScale = mapScale
    this.mapViewport = next
  },

  moveMapToPlace(place) {
    const latitude = finite(place && place.latitude)
    const longitude = finite(place && place.longitude)
    if (latitude === null || longitude === null) return
    const viewport = this.viewportHeight || 800
    const height = Number(this.data.sheetHeight || 260)
    const scale = Number((this.mapViewport && this.mapViewport.mapScale) || this.data.mapScale || 10)
    const offset = Math.min(1.2, Math.max(0.025, 0.35 * (height / viewport) * (scale / 10)))
    const centerLatitude = latitude + (latitude > 89.5 ? -offset : offset)
    this.setData({ latitude: centerLatitude, longitude, mapScale: scale, points: [] })
  },

  locate() {
    if (this.data.locating) return
    const identity = store.sessionIdentity()
    this.setData({ locating: true, locationFailure: '', error: '' })
    wx.getLocation({
      type: 'gcj02',
      success: async result => {
        try {
          const info = await service.regeo(result.latitude, result.longitude)
          if (!store.isCurrentSession(identity)) return
          this.setData({ latitude: result.latitude, longitude: result.longitude, locationText: info.formattedAddress + '（' + info.source + '）', locationFailure: '', points: [] })
        } catch (error) {
          if (store.isCurrentSession(identity)) { this.setData({ locationFailure: error.message || String(error) }); ui.fail(this, error) }
        } finally {
          if (store.isCurrentSession(identity)) this.setData({ locating: false })
        }
      },
      fail: error => {
        if (!store.isCurrentSession(identity)) return
        const message = error && error.errMsg || '未知错误'
        this.setData({ locating: false, locationFailure: message })
        ui.fail(this, new Error('微信定位失败：' + message + '。请在开发者工具设置模拟位置，或打开位置权限后重试。'))
      }
    })
  },

  openLocationSetting() { wx.openSetting({}) },
  field(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }) },

  enterSearch() {
    if (mode === 'search') return
    if (mode === 'selection') { wx.navigateBack(); return }
    if (this.openingSearch) return
    this.openingSearch = true
    wx.navigateTo({ url: '/pages/map-search/map-search', complete: () => { this.openingSearch = false } })
  },

  leaveSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.seq++
    this.setData({ searchMode: false, error: '', loading: false })
  },

  searchScroll(event) {
    const top = finite(event && event.detail && event.detail.scrollTop)
    if (top === null) return
    this.setData({ searchScrollTop: top })
    if (this.searchContext) this.searchContext.searchScrollTop = top
  },

  keywordInput(event) {
    const keyword = event.detail.value
    this.seq++
    this.sheetSeq++
    this.sheetDetailSeq++
    this.sheetCommunitySeq++
    this.setData({ keyword, searchMode: true, error: '', searchScrollTop: 0, cityResults: [], placeResults: [], searchResultCount: 0, showAllMarkers: false, markerMode: 'selected', sheetPlace: null, sheetDetailLoading: false, sheetDetailMissing: false, sheetDetailError: '', sheetCanAdd: false, sheetCandidates: [], sheetCommunityLoading: false, sheetCommunityError: '', hasSearchContext: false, sheetReturnAvailable: false })
    this.searchResults = []
    this.searchContext = null
    this.selectedPlace = null
    this.temporaryPlace = null
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.refresh(false)
    if (!keyword.trim()) { this.setData({ loading: false }); return }
    this.searchTimer = setTimeout(() => this.search(true), 350)
  },

  filter(event) {
    if (!this.isSearchFilterActive()) return
    this.setData({ filter: event.detail.value })
    this.refresh(false)
  },

  async search(silent) {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchTimer = null
    const keyword = this.data.keyword.trim()
    const seq = ++this.seq
    const identity = store.sessionIdentity()
    if (!keyword) {
      this.searchResults = []
      this.searchContext = null
      this.setData({ error: silent === true ? '' : '请输入城市或地点关键词', cityResults: [], placeResults: [], searchResultCount: 0, loading: false })
      this.refresh(false)
      return
    }
    this.setData({ loading: true, error: '', searchMode: true, filter: '全部', markerMode: 'selected', showAllMarkers: false })
    try {
      const result = this.dedupePlaces(await service.searchPlaces(keyword, this.data.city))
      if (seq !== this.seq || !store.isCurrentSession(identity)) return
      this.searchResults = result
      this.selectedPlace = null
      this.temporaryPlace = null
      this.searchContext = result.length ? { keyword: this.data.keyword, city: this.data.city, searchScrollTop: 0 } : null
      this.setData({ keyword: this.data.keyword, searchScrollTop: 0, cityResults: [], placeResults: [], searchResultCount: result.length })
      this.refresh(true)
    } catch (error) {
      if (seq === this.seq && store.isCurrentSession(identity)) ui.fail(this, error)
    } finally {
      if (seq === this.seq && store.isCurrentSession(identity)) this.setData({ loading: false })
    }
  },

  isCityName(name) { return /(?:市|地区|自治州|盟)$/.test(String(name || '').trim()) },

  isCityPlace(place) {
    if (!place || this.isProvincePlace(place)) return false
    if (place.isCity === false && !this.isAdministrativePlace(place)) return false
    if (place.objectType === 'poi') return false
    if (place.isCity === true || place.planningRole === 'destination_area' || this.isAdministrativePlace(place)) return true
    const adminFields = [place.adminLevel, place.adminType, place.locationType].filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    const adminText = adminFields.join(' ').toLowerCase()
    if (/城市|地区|自治州|盟|district|administrative|county|town|city/.test(adminText)) return true
    const typeText = [place.poiType, place.type, place.category].filter(value => value !== undefined && value !== null && String(value).trim() !== '').join(' ').toLowerCase()
    if (/城市|行政|地区|自治州|盟|district|administrative|county|town|^city$/.test(typeText)) return true
    if (/景点|公园|酒店|车站|餐馆|商场|poi|scenic|hotel|station/.test(typeText)) return false
    return this.isCityName(place.name)
  },

  placeAliases(name) {
    const text = String(name || '').trim()
    const short = text.replace(/(?:市|地区|自治州|盟)$/, '')
    return Array.from(new Set([text, short].filter(Boolean)))
  },

  communitySummary(posts) {
    const reviews = posts.filter(post => post.type === 'review')
    const routes = posts.filter(post => post.type === 'route' && post.plan)
    const otherPosts = posts.filter(post => post.type !== 'review' && !(post.type === 'route' && post.plan))
    const photos = posts.reduce((all, post) => all.concat(post.photos || []), [])
    const ratings = reviews.map(post => Number(post.rating)).filter(Number.isFinite)
    const durations = Array.from(new Set(reviews.map(post => post.duration).filter(Boolean)))
    return { posts, reviews, routes, otherPosts, photos, ratingText: ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) + ' / 5（' + ratings.length + ' 条评价）' : '', durationText: durations.join('、') }
  },

  communityFor(name) {
    const aliases = this.placeAliases(name)
    const posts = ui.posts().filter(post => Array.isArray(post.placeNames) && post.placeNames.some(placeName => aliases.includes(String(placeName).trim())))
    return this.communitySummary(posts)
  },

  communityView(post) {
    const author = post && post.author || {}
    return Object.assign({}, post, { authorName: author.nickname || (post && post.authorName) || '社区成员', placeNames: Array.isArray(post && post.placeNames) ? post.placeNames : [], photos: Array.isArray(post && post.photos) ? post.photos : [], createdAt: (post && (post.createdAt || post.publishedAt)) || '' })
  },

  canLoadCommunity() {
    let baseUrl = ''
    try { baseUrl = store.config().apiBaseUrl } catch (_) {}
    const wxCloud = typeof wx !== 'undefined' ? wx.cloud : null
    return Boolean((cloud.env && cloud.service && wxCloud && typeof wxCloud.callContainer === 'function') || baseUrl)
  },

  setSelectedPlace(place) {
    const inSearch = this.searchResults.some(item => this.placeKey(item) === this.placeKey(place))
    this.selectedPlace = place
    this.temporaryPlace = inSearch ? null : place
    this.setData({ selectedPlaceId: this.placeKey(place), temporaryPlaceId: inSearch ? '' : this.placeKey(place) })
  },

  openPlaceDetail(place) {
    ui.run(this, () => {
      if (!place) return
      const province = this.isProvincePlace(place)
      const city = this.isDestinationArea(place)
      const next = this.isAdministrativePlace(place) ? Object.assign({}, place, {
        isCity: city, isProvince: province, category: province ? (place.category || '省/自治区') : (place.category || '城市'),
        planningRole: province ? 'choose_city' : (place.planningRole || 'destination_area'), canAdd: province ? false : place.canAdd,
        address: place.address || ((place.city && place.city !== place.name) ? place.city : place.name),
        summary: place.summary || (province ? '请继续选择省内城市' : '城市目的地；加入后将作为旅行目的地安排市内游玩')
      }) : Object.assign({}, place, { category: place.category || '' })
      this.setSelectedPlace(next)
      this.showPlaceSheet(next, { select: false, move: true })
    })
  },

  detail(event) {
    const place = this.data.places.find(item => item.id === event.currentTarget.dataset.id)
    if (place) ui.run(this, () => { store.remember(place); ui.open('place-detail', 'id=' + encodeURIComponent(place.id)) })
  },

  resultDetail(event) {
    const id = event.currentTarget.dataset.id
    const place = this.searchResults.find(item => item.id === id) || this.data.places.find(item => item.id === id)
    if (!place) return
    if (mode !== 'search') { this.openPlaceDetail(place); return }
    if (this.openingSelection) return
    this.openingSelection = true
    const payload = { place, results: this.searchResults, context: this.searchContext, keyword: this.data.keyword, city: this.data.city }
    wx.navigateTo({
      url: '/pages/map-selection/map-selection',
      success: result => result.eventChannel.emit('selection', payload),
      fail: error => ui.fail(this, error),
      complete: () => { this.openingSelection = false }
    })
  },

  marker(event) {
    const place = this.markerPlaces[Number(event && event.detail && event.detail.markerId)]
    if (place) this.openPlaceDetail(place)
  },

  poi(event) {
    const raw = event && event.detail
    if (!raw || finite(raw.latitude) === null || finite(raw.longitude) === null) return
    const name = String(raw.name || '').trim()
    const id = 'map-' + Number(raw.latitude).toFixed(6) + '-' + Number(raw.longitude).toFixed(6) + '-' + name
    const rawType = [raw.poiType, raw.type].filter(value => value !== undefined && value !== null && String(value).trim() !== '').join(' ')
    // bindpoitap officially guarantees name + coordinates only. Treat any
    // native event as a candidate until the backend confirms its identity.
    const administrative = false
    const province = false
    const city = false
    const place = {
      id, selectionKey: id, name: name || '地图位置', latitude: Number(raw.latitude), longitude: Number(raw.longitude), address: raw.address || '', city: raw.city || '',
      source: '微信地图原生点击', objectType: 'coordinate', providerKind: '',
      recognitionStatus: name ? 'candidate' : 'unidentified', detailStatus: name ? 'pending' : 'missing',
      planningRole: 'confirm', canAdd: false,
      category: name ? '待确认' : '未识别位置', categoryGroup: '', candidateCategory: rawType,
      summary: name ? '正在确认地点身份' : '仅获取到地图坐标，暂未确认具体地点',
      isCity: city, isProvince: province, isAdministrative: administrative, isAdmin: raw.isAdmin,
      adminLevel: raw.adminLevel, adminType: raw.adminType, locationType: raw.locationType, poiType: raw.poiType, type: raw.type, stayDays: 1
    }
    this.openPlaceDetail(place)
  },

  selectList(event) {
    const place = this.data.places.find(item => item.id === event.currentTarget.dataset.id)
    if (place) this.openPlaceDetail(place)
  },

  togglePlace(place, scrollToCard) {
    if (this.isAdministrativePlace(place) || this.isCityPlace(place)) { this.openPlaceDetail(place); return }
    const ids = this.data.expandedIds || []
    const expanded = ids.includes(place.id)
    if (expanded) {
      this.detailSeq[place.id] = (this.detailSeq[place.id] || 0) + 1
      this.setData({ expandedIds: ids.filter(id => id !== place.id) })
      this.refresh(false)
      return
    }
    this.setData({ expandedIds: ids.concat([place.id]) })
    this.refresh(false)
    if (scrollToCard && typeof wx.pageScrollTo === 'function') {
      const markerId = this.markerIds[this.placeKey(place)]
      setTimeout(() => wx.pageScrollTo({ selector: '#place-card-' + markerId, duration: 250 }), 0)
    }
    if (!this.isCityPlace(place) && !place.detailMissing && !this.detailCache[place.id]) this.loadDetail(place)
  },

  async loadDetail(place) {
    if (this.isAdministrativePlace(place) || this.isCityPlace(place)) return
    const seq = (this.detailSeq[place.id] || 0) + 1
    this.detailSeq[place.id] = seq
    const identity = store.sessionIdentity()
    this.detailStates[place.id] = { loading: true, error: '' }
    this.refresh(false)
    try {
      const detail = await service.poiDetail(place)
      if (this.detailSeq[place.id] !== seq || !store.isCurrentSession(identity)) return
      if (detail) this.detailCache[place.id] = Object.assign({}, detail, { detailStatus: detail.detailStatus || 'available', recognitionStatus: detail.recognitionStatus || 'confirmed' })
      else this.detailStates[place.id] = { loading: false, missing: true, error: '补充资料暂缺，当前仅展示地图名称与位置。' }
    } catch (error) {
      if (this.detailSeq[place.id] === seq && store.isCurrentSession(identity)) this.detailStates[place.id] = { loading: false, error: error.message || String(error) }
    } finally {
      if (this.detailSeq[place.id] === seq && store.isCurrentSession(identity)) {
        this.detailStates[place.id] = Object.assign({}, this.detailStates[place.id], { loading: false })
        this.refresh(false)
      }
    }
  },

  retryDetail(event) {
    const id = event.currentTarget.dataset.id
    const place = this.data.places.find(item => item.id === id)
    if (place && !this.isAdministrativePlace(place) && !this.isCityPlace(place) && !place.detailMissing) this.loadDetail(place)
  },

  showPlaceSheet(place, options) {
    if (!place) return
    const config = options || {}
    if (config.select !== false) this.setSelectedPlace(place)
    if (config.move !== false) this.moveMapToPlace(place)
    const seq = ++this.sheetSeq
    this.sheetDetailSeq++
    this.sheetCommunitySeq++
    const cachedRaw = this.detailCache[place.id] || {}
    const cached = place.objectType === 'coordinate' && (!cachedRaw.objectType || cachedRaw.recognitionStatus !== 'confirmed') ? {} : cachedRaw
    const resolved = Object.assign({}, place, cached)
    const province = this.isProvincePlace(resolved)
    const isCity = this.isDestinationArea(resolved)
    const recognitionStatus = resolved.recognitionStatus || (resolved.objectType === 'coordinate' ? 'candidate' : 'confirmed')
    const canAdd = this.canAddPlace(Object.assign({}, resolved, { recognitionStatus }))
    const next = Object.assign({}, resolved, {
      isCity, isProvince: province, recognitionStatus, canAdd,
      category: province ? (cached.category || place.category || '省/自治区') : (isCity ? '城市' : (cached.category || place.category || (recognitionStatus === 'unidentified' ? '未识别位置' : recognitionStatus === 'candidate' ? '待确认' : '地点'))),
      planningRole: province ? 'choose_city' : (resolved.planningRole || (isCity ? 'destination_area' : (recognitionStatus === 'confirmed' ? 'stop' : 'confirm'))),
      address: cached.address || place.address || ((place.city && place.city !== place.name) ? place.city : (isCity ? place.name : (place.name === '地图位置' ? '位置：' + place.latitude + ', ' + place.longitude : ''))),
      summary: cached.summary || place.summary || (province ? '请继续选择省内城市' : (isCity ? '城市目的地；加入后将作为旅行目的地安排市内游玩' : (recognitionStatus === 'candidate' ? '正在确认地点身份，请从候选中选择' : '')))
    })
    const shouldResolve = !this.isAdministrativePlace(next) && !this.isCityPlace(next) && !cached.detailStatus && (next.objectType === 'poi' || next.providerId || next.recognitionStatus === 'candidate' || !next.detailStatus) && (next.name !== '地图位置' || next.objectType !== 'coordinate')
    const local = this.communityFor(next.name)
    this.setData({
      searchMode: false, sheetPlace: next, sheetDetailLoading: shouldResolve, sheetDetailMissing: next.detailStatus === 'missing' && recognitionStatus === 'confirmed', sheetDetailError: '', sheetCanAdd: canAdd,
      sheetCandidates: Array.isArray(next.candidates) ? next.candidates : [], sheetDisplayAddress: next.address || '', sheetAdded: this.menuHasPlace(next),
      sheetReturnAvailable: !!this.searchContext, hasSearchContext: !!this.searchContext, sheetCommunityLoading: false, sheetCommunityError: '',
      sheetPosts: local.posts, sheetReviews: local.reviews, sheetRoutes: local.routes, sheetOtherPosts: local.otherPosts,
      sheetPhotos: local.photos, sheetRatingText: local.ratingText, sheetDurationText: local.durationText, points: []
    })
    this.refreshMarkers()
    this.loadPlaceCommunity(next.name, seq)
    if (shouldResolve) this.loadPlaceDetail(next, seq)
  },

  async loadPlaceDetail(place, sheetSeq) {
    if (this.isAdministrativePlace(place) || this.isCityPlace(place)) return
    const detailSeq = ++this.sheetDetailSeq
    const identity = store.sessionIdentity()
    try {
      const response = (place.objectType === 'coordinate' || place.recognitionStatus === 'candidate' || place.source === '微信地图原生点击') && typeof service.resolvePlace === 'function'
        ? await service.resolvePlace(place)
        : { place: await service.poiDetail(place), recognitionStatus: 'confirmed', detailStatus: 'available', candidates: [] }
      if (sheetSeq !== this.sheetSeq || detailSeq !== this.sheetDetailSeq || !this.data.sheetPlace || !store.isCurrentSession(identity)) return
      const detail = response && response.place
      if (!detail) {
        const candidates = Array.isArray(response && response.candidates) ? response.candidates : []
        const unresolved = Object.assign({}, place, {
          objectType: 'coordinate', recognitionStatus: candidates.length ? 'candidate' : 'unidentified', detailStatus: 'missing',
          planningRole: 'confirm', canAdd: false, category: candidates.length ? '待确认' : '未识别位置', categoryGroup: '',
          summary: candidates.length ? '请选择下方候选地点确认后再加入菜单' : '仅获取到地图坐标，暂未确认具体地点', candidates
        })
        this.selectedPlace = unresolved
        if (this.temporaryPlace && this.placeKey(this.temporaryPlace) === this.placeKey(place)) this.temporaryPlace = unresolved
        this.setData({ sheetPlace: unresolved, sheetCandidates: candidates, sheetDetailLoading: false, sheetDetailMissing: false, sheetDetailError: '', sheetCanAdd: false, sheetDisplayAddress: unresolved.address || ('位置：' + unresolved.latitude + ', ' + unresolved.longitude) })
        this.refreshMarkers()
        return
      }
      const resolved = Object.assign({}, place, detail, { selectionKey: place.selectionKey || detail.selectionKey })
      const province = this.isProvincePlace(resolved)
      const isCity = this.isDestinationArea(resolved)
      const recognitionStatus = detail.recognitionStatus || response.recognitionStatus || 'confirmed'
      const merged = Object.assign({}, resolved, {
        isCity, isProvince: province, category: province ? (detail.category || '省/自治区') : (isCity ? '城市' : (detail.category || place.category || '地点')),
        planningRole: province ? 'choose_city' : (detail.planningRole || (isCity ? 'destination_area' : 'stop')),
        canAdd: detail.canAdd !== false && recognitionStatus === 'confirmed' && !province,
        recognitionStatus, detailStatus: detail.detailStatus || response.detailStatus || 'available',
        address: detail.address || place.address || ((resolved.city && resolved.city !== resolved.name) ? resolved.city : (isCity ? resolved.name : '')),
        summary: detail.summary || place.summary || (isCity ? '城市目的地；加入后将作为旅行目的地安排市内游玩' : '')
      })
      this.detailCache[place.id] = Object.assign({}, detail, { selectionKey: merged.selectionKey, recognitionStatus: merged.recognitionStatus, detailStatus: merged.detailStatus, objectType: merged.objectType, providerKind: merged.providerKind, planningRole: merged.planningRole, canAdd: merged.canAdd })
      if (merged.recognitionStatus === 'confirmed' && merged.canAdd !== false) store.remember(merged)
      this.selectedPlace = merged
      if (this.temporaryPlace && this.placeKey(this.temporaryPlace) === this.placeKey(place)) this.temporaryPlace = merged
      // 身份补全后必须重算 sheetAdded：provisional 地点用的是 map-<lat>-<lng>-<name> 这类
      // 临时 id，没有 providerId，按它查菜单必然查不到；只有 merged 拿到真实
      // providerId / selectionKey 之后，samePlace() 才能认出「其实已经在菜单里」。
      this.setData({ sheetPlace: merged, sheetCandidates: [], sheetDisplayAddress: merged.address || ((merged.city && merged.city !== merged.name) ? merged.city : ''), sheetDetailLoading: false, sheetDetailMissing: merged.detailStatus === 'missing', sheetDetailError: '', sheetCanAdd: this.canAddPlace(merged), sheetAdded: this.menuHasPlace(merged) })
      this.refreshMarkers()
    } catch (error) {
      if (sheetSeq === this.sheetSeq && detailSeq === this.sheetDetailSeq && store.isCurrentSession(identity)) {
        const failed = Object.assign({}, this.data.sheetPlace || place, { recognitionStatus: 'candidate', detailStatus: 'failed', planningRole: 'confirm', canAdd: false, summary: '地点身份请求失败，请重试确认' })
        this.selectedPlace = failed
        this.setData({ sheetPlace: failed, sheetCandidates: [], sheetDetailLoading: false, sheetDetailMissing: false, sheetDetailError: error.message || String(error), sheetCanAdd: false })
      }
    }
  },

  async loadPlaceCommunity(name, sheetSeq) {
    const seq = ++this.sheetCommunitySeq
    const identity = store.sessionIdentity()
    const local = this.communityFor(name)
    this.setData({ sheetCommunityLoading: true, sheetCommunityError: '', sheetPosts: local.posts, sheetReviews: local.reviews, sheetRoutes: local.routes, sheetOtherPosts: local.otherPosts, sheetPhotos: local.photos, sheetRatingText: local.ratingText, sheetDurationText: local.durationText })
    if (!this.canLoadCommunity()) {
      if (seq === this.sheetCommunitySeq && sheetSeq === this.sheetSeq && store.isCurrentSession(identity)) this.setData({ sheetCommunityLoading: false })
      return
    }
    try {
      const result = await service.communityFeed({ tab: 'recommend', keyword: this.placeAliases(name).slice(-1)[0] || name, type: 'all', limit: 20 })
      if (seq !== this.sheetCommunitySeq || sheetSeq !== this.sheetSeq || !store.isCurrentSession(identity)) return
      const merged = new Map()
      ;(result.items || []).map(item => this.communityView(item)).concat(this.communityFor(name).posts).forEach(post => { if (post && post.id && !merged.has(post.id)) merged.set(post.id, post) })
      const summary = this.communitySummary(Array.from(merged.values()))
      this.setData({ sheetCommunityLoading: false, sheetCommunityError: '', sheetPosts: summary.posts, sheetReviews: summary.reviews, sheetRoutes: summary.routes, sheetOtherPosts: summary.otherPosts, sheetPhotos: summary.photos, sheetRatingText: summary.ratingText, sheetDurationText: summary.durationText })
    } catch (error) {
      if (seq === this.sheetCommunitySeq && sheetSeq === this.sheetSeq && store.isCurrentSession(identity)) this.setData({ sheetCommunityLoading: false, sheetCommunityError: ui.friendlyError(error) })
    }
  },

  add(event) {
    ui.run(this, () => {
      const id = event.currentTarget.dataset.id
      const place = this.searchResults.find(item => item.id === id) || this.data.places.find(item => item.id === id) || (this.pool || []).find(item => item.id === id)
      if (!place) return
      if (!this.canAddPlace(place)) throw new Error('请先确认地点类型；省级行政区请继续选择城市')
      const result = store.togglePlace(place)
      this.refresh(false)
      wx.showToast({ title: result.added ? '已加入菜单' : '已移出菜单' })
    })
  },

  addSheet(event) {
    ui.run(this, () => {
      const now = Date.now()
      if (this.sheetAddHandledAt && now - this.sheetAddHandledAt < 300) return
      const target = event && event.currentTarget
      const targetId = target && target.dataset && target.dataset.id
      const sheetPlace = this.data.sheetPlace
      const sameTarget = !targetId || (sheetPlace && (String(sheetPlace.id) === String(targetId) || this.placeKey(sheetPlace) === String(targetId)))
      if (!sheetPlace || !sameTarget) throw new Error('当前地点信息已失效，请重新点击地图地点')
      const place = this.selectedPlace && this.placeKey(this.selectedPlace) === this.placeKey(sheetPlace) ? this.selectedPlace : sheetPlace
      if (!this.canAddPlace(place)) throw new Error(this.isProvincePlace(place) ? '省级行政区不能直接加入菜单，请先选择城市' : '地点尚未确认，暂不能加入菜单')
      const result = store.togglePlace(place)
      this.sheetAddHandledAt = now
      this.setData({ sheetAdded: result.added, count: result.state.menu.length })
      this.refresh(false)
      wx.showToast({ title: result.added ? '已加入菜单' : '已移出菜单' })
    })
  },

  toggleMarkerMode(event) {
    if (!this.searchResults.length) return
    const all = event && event.detail && typeof event.detail.value === 'boolean' ? event.detail.value : this.data.markerMode !== 'all'
    this.setData({ markerMode: all ? 'all' : 'selected', showAllMarkers: all })
    this.refresh(false)
  },

  returnSearch() {
    if (mode === 'selection') { wx.navigateBack(); return }
    const context = this.searchContext
    if (!context) return
    this.sheetSeq++
    this.sheetDetailSeq++
    this.sheetCommunitySeq++
    this.setData({
      searchMode: true, keyword: context.keyword, city: context.city || '', searchScrollTop: context.searchScrollTop || 0,
      sheetPlace: null, sheetDetailLoading: false, sheetDetailMissing: false, sheetDetailError: '', sheetCanAdd: false, sheetCandidates: [], sheetCommunityLoading: false,
      sheetCommunityError: '', sheetReturnAvailable: false, hasSearchContext: true, loading: false, error: ''
    })
    this.refresh(false)
  },

  selectCandidate(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id
    const candidate = (this.data.sheetCandidates || []).find(item => String(item.id) === String(id))
    if (!candidate) return
    const province = this.isProvincePlace(candidate)
    const confirmed = Object.assign({}, candidate, {
      recognitionStatus: 'confirmed', canAdd: !province, planningRole: province ? 'choose_city' : (this.isAdministrativePlace(candidate) ? 'destination_area' : 'stop'),
      selectionKey: this.data.sheetPlace && this.data.sheetPlace.selectionKey || candidate.selectionKey
    })
    this.openPlaceDetail(confirmed)
  },

  selectCity() {
    if (!this.data.sheetPlace || !this.isProvincePlace(this.data.sheetPlace)) return
    this.enterSearch()
  },

  retrySheetDetail() {
    const place = this.data.sheetPlace
    if (place && !this.isAdministrativePlace(place) && !this.isCityPlace(place) && !this.data.sheetDetailLoading && (place.name !== '地图位置' || place.objectType !== 'coordinate')) {
      const seq = this.sheetSeq
      this.setData({ sheetDetailLoading: true, sheetDetailError: '' })
      this.loadPlaceDetail(place, seq)
    }
  },

  retrySheetCommunity() {
    if (this.data.sheetPlace) this.loadPlaceCommunity(this.data.sheetPlace.name, this.sheetSeq)
  },

  sheetTouchStart(event) {
    const point = touchPoint(event.touches && event.touches[0])
    if (!point || !Number.isFinite(point.y) || !this.data.sheetPlace) return
    this.sheetDrag = { startY: point.y, startHeight: Number(this.data.sheetHeight || 260) }
  },

  sheetTouchMove(event) {
    if (!this.sheetDrag) return
    const point = touchPoint(event.touches && event.touches[0])
    if (!point || !Number.isFinite(point.y)) return
    const min = Number(this.data.sheetMinHeight || this.sheetMinHeight || 190)
    const max = Number(this.data.sheetMaxHeight || this.sheetMaxHeight || 680)
    const height = Math.min(max, Math.max(min, this.sheetDrag.startHeight + this.sheetDrag.startY - point.y))
    if (Math.abs(height - Number(this.data.sheetHeight || 260)) >= 1) this.setData({ sheetHeight: height })
  },

  sheetTouchEnd() { this.sheetDrag = null },
  sheetTouchCancel() { this.sheetDrag = null },
  sheetControlTouch(event) {
    const touch = event && ((event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]))
    const point = touchPoint(touch)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    if (!this.sheetControlGesture) {
      this.sheetControlGesture = { startX: point.x, startY: point.y, moved: false }
      return
    }
    if (Math.abs(point.x - this.sheetControlGesture.startX) > 12 || Math.abs(point.y - this.sheetControlGesture.startY) > 12) this.sheetControlGesture.moved = true
  },
  sheetControlTouchEnd(event) {
    const gesture = this.sheetControlGesture
    this.sheetControlGesture = null
    if (gesture && gesture.moved) return
    this.addSheet(event)
  },
  sheetControlTouchCancel() { this.sheetControlGesture = null },
  sheetPost(event) { if (event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id) ui.open('post-detail', 'id=' + event.currentTarget.dataset.id) },
  previewSheetPhoto(event) { const src = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.src; if (src) wx.previewImage({ current: src, urls: this.data.sheetPhotos || [] }) },
  menu() { ui.tab('menu') },
  seeds() { this.pool = engine.seedPlaces.slice(); this.searchResults = []; this.searchContext = null; this.selectedPlace = null; this.temporaryPlace = null; this.sheetSeq++; this.sheetDetailSeq++; this.sheetCommunitySeq++; this.setData({ keyword: '', error: '', searchMode: false, searchResultCount: 0, cityResults: [], placeResults: [], selectedPlaceId: '', temporaryPlaceId: '', markerMode: 'selected', showAllMarkers: false, sheetPlace: null, sheetDetailLoading: false, sheetDetailMissing: false, sheetDetailError: '', sheetCanAdd: false, sheetCandidates: [], sheetCommunityLoading: false, sheetCommunityError: '', hasSearchContext: false, sheetReturnAvailable: false }); this.refresh(true) },
  mapError() { this.setData({ mapFailed: true }) },
  retryMap() { this.setData({ mapFailed: false }) },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.seq++
    this.sheetSeq++
    this.sheetDetailSeq++
    this.sheetCommunitySeq++
    Object.keys(this.detailSeq).forEach(id => { this.detailSeq[id]++ })
  }
} }
