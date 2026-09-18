const store = require('../../utils/travel-store')
const ui = require('../../utils/travel-ui')
const service = require('../../utils/travel-services')
const cloud = require('../../config/cloud')

function touchPoint(touch) {
  if (!touch) return null
  return {
    x: Number(touch.clientX !== undefined ? touch.clientX : touch.pageX),
    y: Number(touch.clientY !== undefined ? touch.clientY : touch.pageY)
  }
}

Page({
  data: {
    place: null,
    error: '',
    sheetExpanded: false,
    latitude: 0,
    longitude: 0,
    markers: [],
    posts: [],
    reviews: [],
    routes: [],
    otherPosts: [],
    photos: [],
    ratingText: '',
    durationText: '',
    communityLoading: false,
    communityError: '',
    hasCoordinates: false,
    detailLoading: false,
    detailMissing: false,
    detailError: '',
    displayAddress: '',
    added: false
  },

  onLoad(query) {
    this.selectionSeq = 0
    this.currentKey = ''
    this.mapPlaces = []
    this.markerIds = {}
    this.nextMarkerId = 1
    this.resolvedKeys = {}
    this.communitySeq = 0
    this.pageIdentity = store.sessionIdentity()
    ui.run(this, () => {
      const place = store.place(query.id)
      if (!place) throw new Error('地点未找到，请返回地图重新搜索')
      this.resolvedKeys[place.id] = true
      this.setCurrentPlace(place, place.id, { loading: false, error: '' })
      this.loadCommunity(place, place.id)
    })
  },

  onShow() {
    const identity = store.sessionIdentity()
    if (!this.pageIdentity || store.isCurrentSession(this.pageIdentity)) {
      // 同一个 session 内从别处返回本页（最常见的是去菜单页增删后又回来）：
      // 只重新同步 added，不重复触发社区请求，也不重置地图 / 抽屉状态。
      if (this.data.place) {
        const added = this.menuHasPlace(this.data.place)
        if (added !== this.data.added) this.setData({ added })
      }
      return
    }
    this.pageIdentity = identity
    this.communitySeq++
    if (this.data.place) {
      const place = store.place(this.data.place.id) || this.data.place
      this.setCurrentPlace(place, this.currentKey, { loading: false, error: '' })
      this.setData({ posts: [], reviews: [], routes: [], otherPosts: [], photos: [], ratingText: '', durationText: '', communityLoading: false, communityError: '' })
      this.loadCommunity(place, this.currentKey)
    }
  },

  placeAliases(name) {
    const text = String(name || '').trim()
    const short = text.replace(/(?:市|地区|自治州|盟)$/, '')
    return Array.from(new Set([text, short].filter(Boolean)))
  },

  stablePlaceKey(place) {
    if (!place || typeof place !== 'object') return ''
    const id = place.providerId || place.placeId || place.id
    if (id === undefined || id === null || String(id).trim() === '') return ''
    const provider = String(place.provider || (place.providerKind === 'poi' || place.providerKind === 'district' ? 'qq' : 'local')).trim().toLowerCase() || 'local'
    return provider + ':' + String(id).trim()
  },

  postMatchesPlace(post, placeOrName) {
    const place = placeOrName && typeof placeOrName === 'object' ? placeOrName : { name: placeOrName }
    const key = this.stablePlaceKey(place)
    const refs = Array.isArray(post && post.places) ? post.places.filter(item => item && this.stablePlaceKey(item)) : []
    if (refs.length) return Boolean(key && refs.some(item => this.stablePlaceKey(item) === key))
    const aliases = this.placeAliases(place.name)
    return Array.isArray(post && post.placeNames) && post.placeNames.some(name => aliases.includes(String(name).trim()))
  },

  isCityName(name) {
    return /(?:市|地区|自治州|盟)$/.test(String(name || '').trim())
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

  communityFor(placeOrName) {
    const posts = ui.posts().filter(post => this.postMatchesPlace(post, placeOrName))
    return this.communitySummary(posts)
  },

  communitySummary(posts) {
    const reviews = posts.filter(post => post.type === 'review')
    const routes = posts.filter(post => post.type === 'route' && post.plan)
    const otherPosts = posts.filter(post => post.type !== 'review' && !(post.type === 'route' && post.plan))
    const photos = posts.reduce((all, post) => all.concat(post.photos || []), [])
    const ratings = reviews.map(post => Number(post.rating)).filter(Number.isFinite)
    const durations = [...new Set(reviews.map(post => post.duration).filter(Boolean))]
    return {
      posts,
      reviews,
      routes,
      otherPosts,
      photos,
      durationText: durations.join('、'),
      ratingText: ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) + ' / 5（' + ratings.length + ' 条评价）' : ''
    }
  },

  communityView(post) {
    const author = post && post.author || {}
    return Object.assign({}, post, {
      authorName: author.nickname || (post && post.authorName) || '社区成员',
      placeNames: Array.isArray(post && post.placeNames) ? post.placeNames : [],
      photos: Array.isArray(post && post.photos) ? post.photos : [],
      createdAt: (post && (post.createdAt || post.publishedAt)) || ''
    })
  },

  canLoadCommunity() {
    let baseUrl = ''
    try { baseUrl = store.config().apiBaseUrl } catch (_) {}
    const wxCloud = typeof wx !== 'undefined' ? wx.cloud : null
    return Boolean((cloud.env && cloud.service && wxCloud && typeof wxCloud.callContainer === 'function') || baseUrl)
  },

  pointKey(place) {
    return 'map-' + Number(place.latitude).toFixed(6) + '-' + Number(place.longitude).toFixed(6) + '-' + place.name
  },

  rememberMapPlace(key, place) {
    this.mapPlaces = this.mapPlaces.filter(item => item.key !== key).concat([{ key, place }]).slice(-8)
    if (!this.markerIds[key]) this.markerIds[key] = this.nextMarkerId++
  },

  // 「这个地点是否已在菜单里」的唯一真值 = travel-store.samePlace()。
  // 不要在这里再写一套简化判断：同一个地点在本页常常先以 provisional id
  // （map-<lat>-<lng>-<name>）出现，补全后才拿到 providerId / selectionKey；
  // 只比 id / providerId 会漏判，于是按钮显示「加入菜单」，点下去才发现早就加过了。
  menuHasPlace(place) {
    if (!place) return false
    const menu = store.read().menu
    if (typeof store.samePlace === 'function') return menu.some(item => store.samePlace(item, place))
    return menu.some(item => item.id === place.id || (place.providerId && item.providerId && String(item.providerId) === String(place.providerId)))
  },

  markerData(activeKey) {
    return this.mapPlaces.filter(item => Number.isFinite(Number(item.place.latitude)) && Number.isFinite(Number(item.place.longitude))).map(item => ({
      id: this.markerIds[item.key],
      placeKey: item.key,
      latitude: Number(item.place.latitude),
      longitude: Number(item.place.longitude),
      width: item.key === activeKey ? 34 : 28,
      height: item.key === activeKey ? 42 : 34,
      title: item.place.name,
      callout: { content: item.place.name, display: item.key === activeKey ? 'ALWAYS' : 'BYCLICK', padding: 6 }
    }))
  },

  setCurrentPlace(nextPlace, key, state) {
    const previous = this.mapPlaces.find(item => item.key === key)
    const place = Object.assign({}, previous ? previous.place : {}, nextPlace)
    if (this.isCityPlace(place)) {
      place.isCity = true
      place.category = '城市'
    }
    const latitude = Number(place.latitude)
    const longitude = Number(place.longitude)
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    const samePlace = Boolean(this.data.place && (this.data.place.id === place.id || (this.currentKey === key && this.data.place.name === place.name)))
    const displayAddress = place.address || (place.city && place.city !== place.name ? place.city : (this.isCityPlace(place) ? place.name : ''))
    const localCommunity = samePlace ? {
      posts: this.data.posts || [],
      reviews: this.data.reviews || [],
      routes: this.data.routes || [],
      otherPosts: this.data.otherPosts || [],
      photos: this.data.photos || [],
      ratingText: this.data.ratingText || '',
      durationText: this.data.durationText || '',
      communityLoading: this.data.communityLoading,
      communityError: this.data.communityError || ''
    } : Object.assign(this.communityFor(place), { communityLoading: false, communityError: '' })
    this.currentKey = key
    this.rememberMapPlace(key, place)
    this.setData(Object.assign({
      place,
      hasCoordinates,
      latitude: hasCoordinates ? latitude : this.data.latitude,
      longitude: hasCoordinates ? longitude : this.data.longitude,
      markers: this.markerData(key),
      detailLoading: !!state.loading,
      detailMissing: !!state.missing,
      detailError: state.error || '',
      displayAddress,
      added: this.menuHasPlace(place)
    }, localCommunity))
  },

  selectPlace(place, key, shouldLoad) {
    const seq = ++this.selectionSeq
    this.communitySeq++
    const shouldFetch = shouldLoad && !this.isCityPlace(place)
    this.setData({ sheetExpanded: false })
    this.setCurrentPlace(place, key, { loading: shouldFetch, error: '' })
    this.loadCommunity(place, key)
    if (shouldFetch) this.loadDetail(place, key, seq)
  },

  async loadCommunity(placeOrName, key) {
    const seq = ++this.communitySeq
    const identity = store.sessionIdentity()
    const place = placeOrName && typeof placeOrName === 'object' ? placeOrName : { name: placeOrName }
    const name = place.name || ''
    this.setData({ communityLoading: true, communityError: '' })
    if (!this.canLoadCommunity()) {
      if (seq === this.communitySeq && key === this.currentKey) this.setData({ communityLoading: false })
      return
    }
    try {
      const result = await service.communityFeed({ tab: 'recommend', keyword: this.placeAliases(name).slice(-1)[0] || name, type: 'all', limit: 20 })
      if (seq !== this.communitySeq || key !== this.currentKey || !store.isCurrentSession(identity)) return
      const localPosts = this.communityFor(place).posts
      const merged = new Map()
      ;(result.items || []).map(item => this.communityView(item)).filter(post => this.postMatchesPlace(post, place)).concat(localPosts).forEach(post => {
        if (post && post.id && !merged.has(post.id)) merged.set(post.id, post)
      })
      this.setData(Object.assign(this.communitySummary(Array.from(merged.values())), { communityLoading: false, communityError: '' }))
    } catch (error) {
      if (seq === this.communitySeq && key === this.currentKey && store.isCurrentSession(identity)) this.setData({ communityLoading: false, communityError: ui.friendlyError(error) })
    }
  },

  async loadDetail(place, key, seq) {
    if (this.isCityPlace(place)) return
    const identity = store.sessionIdentity()
    try {
      const detail = await service.poiDetail(place)
      if (seq !== this.selectionSeq || key !== this.currentKey || !store.isCurrentSession(identity)) return
      if (!detail) {
        this.setData({ detailLoading: false, detailMissing: true, detailError: '补充资料暂缺，当前仅展示地图名称与位置。' })
        return
      }
      const merged = Object.assign({}, place, detail)
      this.resolvedKeys[key] = true
      store.remember(merged)
      this.setCurrentPlace(merged, key, { loading: false, error: '' })
    } catch (error) {
      if (seq !== this.selectionSeq || key !== this.currentKey || !store.isCurrentSession(identity)) return
      this.setData({ detailLoading: false, detailMissing: false, detailError: error.message || String(error) })
    }
  },

  poi(event) {
    const raw = event.detail
    if (!raw || !Number.isFinite(Number(raw.latitude)) || !Number.isFinite(Number(raw.longitude))) return
    const name = String(raw.name || '').trim()
    const provisional = {
      id: this.pointKey(Object.assign({}, raw, { name: name || '地图位置' })),
      name: name || '地图位置',
      latitude: Number(raw.latitude),
      longitude: Number(raw.longitude),
      address: raw.address || '',
      city: raw.city || '',
      source: '微信地图选点',
      objectType: 'coordinate',
      recognitionStatus: name ? 'candidate' : 'unidentified',
      detailStatus: name ? 'pending' : 'missing',
      planningRole: 'confirm',
      canAdd: false,
      category: name ? '待确认' : '未识别位置',
      summary: name ? '正在确认地点身份' : '仅获取到地图坐标，暂未确认具体地点',
      adminLevel: raw.adminLevel,
      adminType: raw.adminType,
      locationType: raw.locationType,
      poiType: raw.poiType,
      type: raw.type,
      stayDays: 1
    }
    const key = provisional.id
    const known = this.mapPlaces.find(item => item.key === key)
    if (key === this.currentKey && this.data.detailLoading) return
    this.selectPlace(known ? known.place : provisional, key, !this.resolvedKeys[key])
  },

  marker(event) {
    const marker = this.data.markers.find(item => item.id === Number(event.detail.markerId))
    if (!marker || marker.placeKey === this.currentKey) return
    const candidate = this.mapPlaces.find(item => item.key === marker.placeKey)
    if (candidate) this.selectPlace(candidate.place, candidate.key, !this.resolvedKeys[candidate.key])
  },

  retryDetail() {
    if (!this.data.place || this.data.detailLoading || this.data.detailMissing || this.isCityPlace(this.data.place)) return
    const seq = ++this.selectionSeq
    this.setData({ detailLoading: true, detailError: '' })
    this.loadDetail(this.data.place, this.currentKey, seq)
  },
  retryCommunity() {
    if (this.data.place) this.loadCommunity(this.data.place, this.currentKey)
  },

  add() {
    ui.run(this, () => {
      const place = this.data.place
      if (!place) return
      // 先用同一套 samePlace() 判断：store.addPlace() 内部遇到已存在的地点是
      // 静默跳过的（不写、不报错），页面若无条件 toast「已加入菜单」，就会制造
      // 「本来就在菜单里，却说刚加入成功」的假象。
      if (this.menuHasPlace(place)) {
        this.setData({ added: true })
        wx.showToast({ title: '已在菜单中' })
        return
      }
      store.addPlace(place)
      this.setData({ added: true })
      wx.showToast({ title: '已加入菜单' })
    })
  },
  menu() { ui.tab('menu') },
  post(event) { ui.open('post-detail', 'id=' + event.currentTarget.dataset.id) },
  sheetTouchStart(event) {
    const point = touchPoint(event.touches && event.touches[0])
    if (point && Number.isFinite(point.y)) this.sheetGesture = { point, startedAt: Date.now() }
  },
  sheetTouchEnd(event) {
    const gesture = this.sheetGesture
    this.sheetGesture = null
    const point = touchPoint(event.changedTouches && event.changedTouches[0])
    if (!gesture || !point || !Number.isFinite(point.y)) return
    const dy = point.y - gesture.point.y
    const dx = point.x - gesture.point.x
    if (Math.abs(dy) < 36 || Math.abs(dy) < Math.abs(dx) * 1.15) return
    const expanded = dy < 0
    if (expanded === Boolean(this.data.sheetExpanded)) return
    this.sheetGestureConsumed = true
    this.setData({ sheetExpanded: expanded })
    setTimeout(() => { this.sheetGestureConsumed = false }, 320)
  },
  sheetTouchCancel() { this.sheetGesture = null },
  toggleSheet() {
    if (this.sheetGestureConsumed) {
      this.sheetGestureConsumed = false
      return
    }
    this.setData({ sheetExpanded: !this.data.sheetExpanded })
  },
  preview(event) { wx.previewImage({ current: event.currentTarget.dataset.src, urls: this.data.photos }) },
  onUnload() { this.selectionSeq++; this.communitySeq++ }
})
