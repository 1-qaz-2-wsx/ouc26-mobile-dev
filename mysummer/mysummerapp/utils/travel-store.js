const PREFIX = 'travel-mvp-v3'
const LOGIN_SOURCE_KEY = PREFIX + ':login-source'
const POST_DRAFT_PREFIX = PREFIX + ':post-draft:'
const MAX_MENU_PLACES = 12
// 用户补录的实际出行信息（车票/航班/住宿）。上限与后端 /travel/sync 的 MAX_BOOKINGS 对齐。
const MAX_BOOKINGS = 200
const BOOKING_KINDS = ['train', 'flight', 'hotel']
const BOOKING_FIELDS = {
  train: ['serviceNo', 'from', 'to', 'date', 'departTime', 'arriveTime', 'seatClass', 'unitPrice', 'quantity'],
  flight: ['flightNo', 'from', 'to', 'date', 'departTime', 'arriveTime', 'cabin', 'unitPrice', 'quantity'],
  hotel: ['name', 'checkInDate', 'checkOutDate', 'checkInTime', 'checkOutTime', 'roomType', 'rooms', 'nights', 'unitPrice', 'totalPrice']
}
let cache = {}
let sessionEpoch = 0
function clone(x) { return JSON.parse(JSON.stringify(x)) }
function normalizePlaceRecord(place) {
  if (!place || typeof place !== 'object') return place
  const next = Object.assign({}, place)
  if (!next.objectType) next.objectType = next.isAdministrative || next.isCity ? 'administrative' : 'legacy'
  if (!next.providerKind && next.objectType === 'administrative') next.providerKind = 'district'
  if (!next.recognitionStatus) next.recognitionStatus = next.objectType === 'legacy' ? 'legacy' : 'confirmed'
  if (!next.planningRole) next.planningRole = next.objectType === 'administrative' || next.isCity ? 'destination_area' : 'stop'
  if (!next.categoryGroup && next.category && !['地点', '待确认', '未识别位置'].includes(String(next.category))) next.categoryGroup = /公园|自然|风景|森林|湿地|山|湖|河|景区/.test(String(next.category)) ? '自然' : '人文'
  return next
}
function placeAlias(name) { return String(name || '').trim().replace(/(?:省|市|自治区|地区|自治州|盟|县|区|旗)$/, '') }
function samePlace(a, b) {
  if (!a || !b) return false
  if (a.id !== undefined && b.id !== undefined && String(a.id) === String(b.id)) return true
  if (a.providerId && b.providerId && String(a.providerId) === String(b.providerId) && (!a.providerKind || !b.providerKind || a.providerKind === b.providerKind)) return true
  if (a.selectionKey && b.selectionKey && String(a.selectionKey) === String(b.selectionKey)) return true
  const legacy = !a.objectType || a.objectType === 'legacy' || !b.objectType || b.objectType === 'legacy'
  const coords = Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude)) && Number.isFinite(Number(b.latitude)) && Number.isFinite(Number(b.longitude))
  return legacy && coords && Math.abs(Number(a.latitude) - Number(b.latitude)) < 0.0005 && Math.abs(Number(a.longitude) - Number(b.longitude)) < 0.0005 && placeAlias(a.name) === placeAlias(b.name)
}
function stablePlaceKey(place) {
  if (!place || typeof place !== 'object') return ''
  const id = place.providerId || place.placeId || place.id
  if (id === undefined || id === null || String(id).trim() === '') return ''
  const provider = String(place.provider || (place.providerKind === 'poi' || place.providerKind === 'district' ? 'qq' : 'local')).trim().toLowerCase() || 'local'
  return provider + ':' + String(id).trim()
}
function normalizeReferencePlace(stop) {
  if (!stop || typeof stop !== 'object') return null
  const id = stop.id || stop.placeId || stop.providerId
  const name = stop.name || stop.title
  if (id === undefined || id === null || String(id).trim() === '' || name === undefined || name === null || String(name).trim() === '') return null
  const next = Object.assign({}, stop, {
    id: String(id).trim(), placeId: String(stop.placeId || id).trim(),
    name: String(name).trim(), provider: String(stop.provider || (stop.providerKind === 'poi' || stop.providerKind === 'district' ? 'qq' : 'local')).trim() || 'local'
  })
  if (!next.objectType && next.planningRole === 'destination_area') next.objectType = 'administrative'
  return normalizePlaceRecord(next)
}
function classifyRouteStops(snapshot) {
  const state = read()
  const source = Array.isArray(snapshot) ? snapshot : snapshot && Array.isArray(snapshot.stops) ? snapshot.stops : []
  const occupiedKeys = new Set((state.menu || []).map(stablePlaceKey).filter(Boolean))
  const occupied = (state.menu || []).slice()
  const stops = [], skipped = []
  source.forEach((raw, index) => {
    const place = normalizeReferencePlace(raw)
    if (!place) { skipped.push({ index, name: raw && (raw.name || raw.title) || '未命名地点', reason: '缺少稳定地点 ID 或名称' }); return }
    const key = stablePlaceKey(place)
    const duplicate = Boolean(key && occupiedKeys.has(key))
    if (duplicate) { skipped.push({ index, name: place.name, id: place.id, reason: '已在菜单中或路线内重复' }); return }
    if (place.canAdd === false || place.planningRole === 'choose_city' || place.isProvince === true) { skipped.push({ index, name: place.name, id: place.id, reason: '地点尚未确认或省级行政区需先选择城市' }); return }
    if (place.recognitionStatus && !['confirmed', 'legacy'].includes(place.recognitionStatus)) { skipped.push({ index, name: place.name, id: place.id, reason: '地点尚未确认' }); return }
    if (occupied.length >= MAX_MENU_PLACES) { skipped.push({ index, name: place.name, id: place.id, reason: '已达到 12 个地点上限' }); return }
    stops.push(place)
    occupied.push(place)
    if (key) occupiedKeys.add(key)
  })
  return {
    stops, skipped, limit: MAX_MENU_PLACES,
    currentCount: state.menu.length, remainingSlots: Math.max(0, MAX_MENU_PLACES - state.menu.length),
    canImport: stops.length > 0
  }
}
function previewRouteStops(snapshot) { return classifyRouteStops(snapshot) }
function importRouteStops(snapshot) {
  const preview = classifyRouteStops(snapshot)
  const added = [], skipped = preview.skipped.slice()
  if (!preview.stops.length) return Object.assign({}, preview, { added, imported: 0 })
  mutate(state => {
    preview.stops.forEach(place => {
      if (state.menu.length >= MAX_MENU_PLACES) { skipped.push({ name: place.name, id: place.id, reason: '已达到 12 个地点上限' }); return }
      const normalized = normalizePlaceRecord(place)
      const stableKey = stablePlaceKey(normalized)
      state.catalog = state.catalog.filter(item => stableKey ? stablePlaceKey(item) !== stableKey : !samePlace(item, normalized)).concat([normalized])
      state.menu.push(Object.assign({}, normalized, { stayDays: Number.isInteger(Number(place.stayDays)) && Number(place.stayDays) >= 1 ? Math.min(30, Number(place.stayDays)) : 1, note: String(place.note || '') }))
      added.push(clone(normalized))
    })
  })
  return Object.assign({}, preview, { added, imported: added.length, skipped, canImport: added.length > 0, remainingSlots: Math.max(0, MAX_MENU_PLACES - read().menu.length) })
}
function assertMenuPlace(place) {
  if (!place || place.canAdd === false || place.planningRole === 'choose_city' || place.isProvince === true) throw new Error('省级行政区不能直接加入菜单，请先确认城市')
  if (place.recognitionStatus && !['confirmed', 'legacy'].includes(place.recognitionStatus)) throw new Error('地点尚未确认，暂不能加入菜单')
  if (place.objectType === 'coordinate' && place.recognitionStatus !== 'confirmed') throw new Error('坐标位置尚未确认，暂不能加入菜单')
}
function id(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }
// bookings：用户补录的实际车票/航班/住宿信息。storage version 仍为 3：
// 这是向后兼容的新增集合，旧数据读入时补 []，不迁移、不删除任何既有字段。
function blank() { return { version: 3, menu: [], catalog: [], requirements: {}, plans: [], trips: [], bookings: [], posts: [], sync: { dirty: false, localRevision: 0, lastSyncedAt: null } } }
let syncHook = null
function storage() { if (typeof wx === 'undefined') throw new Error('微信存储不可用'); return wx }
function session() { return storage().getStorageSync(PREFIX + ':session') || { kind: 'guest', id: 'guest', nickname: '游客' } }
function sessionIdentity(value) {
  const current = value || session()
  return { epoch: sessionEpoch, kind: current.kind || 'guest', id: current.id || '', token: current.token || '' }
}
function isCurrentSession(identity) {
  if (!identity) return false
  const current = sessionIdentity()
  return current.epoch === identity.epoch && current.kind === identity.kind && current.id === identity.id && current.token === identity.token
}
function setSession(value) {
  const previous = session()
  storage().setStorageSync(PREFIX + ':session', value)
  if ((previous.kind || 'guest') !== (value.kind || 'guest') || (previous.id || '') !== (value.id || '') || (previous.token || '') !== (value.token || '')) sessionEpoch += 1
}
function recordLoginSource(source) {
  const value = String(source || '社区操作').trim().slice(0, 40) || '社区操作'
  storage().setStorageSync(LOGIN_SOURCE_KEY, { source: value, createdAt: Date.now() })
  return value
}
function takeLoginSource() {
  const value = storage().getStorageSync(LOGIN_SOURCE_KEY)
  if (!value) return ''
  storage().setStorageSync(LOGIN_SOURCE_KEY, null)
  return typeof value === 'string' ? value : String(value.source || '')
}
function key() { return PREFIX + ':' + session().id }
function read() {
  const k = key()
  if (!cache[k]) {
    let raw = storage().getStorageSync(k)
    // Older releases prefixed server IDs with wx-. Preserve that namespace by
    // copying it forward once the canonical server user ID is known; never
    // delete the old key or merge it with another account.
    const current = session()
    if (!raw && current.kind === 'wechat' && current.id && !String(current.id).startsWith('wx-')) {
      const legacyKey = PREFIX + ':wx-' + current.id
      const legacy = storage().getStorageSync(legacyKey)
      if (legacy) {
        raw = clone(legacy)
        storage().setStorageSync(k, raw)
      }
    }
    if (raw && (raw.version !== 3 || !Array.isArray(raw.plans) || !Array.isArray(raw.menu) || !Array.isArray(raw.posts) || !Array.isArray(raw.trips))) throw new Error('本地数据格式异常，原数据保留，请联系开发者检查')
    const state = raw || blank()
    state.menu = (Array.isArray(state.menu) ? state.menu : []).map(normalizePlaceRecord)
    state.catalog = (Array.isArray(state.catalog) ? state.catalog : []).map(normalizePlaceRecord)
    state.bookings = (Array.isArray(state.bookings) ? state.bookings : []).filter(row => row && typeof row.id === 'string')
    cache[k] = state
  }
  return clone(cache[k])
}
function write(next, options = {}) {
  const previousSync = cache[key()] && cache[key()].sync || {}
  const nextSync = Object.assign({ dirty: false, localRevision: 0, lastSyncedAt: null }, previousSync, next.sync)
  nextSync.localRevision = Number(nextSync.localRevision || 0) + 1
  next.sync = nextSync
  storage().setStorageSync(key(), next); cache[key()] = clone(next)
  if (!options.remote && session().kind === 'wechat') {
    const sync = Object.assign({}, next.sync, { dirty: true })
    storage().setStorageSync(key(), Object.assign({}, next, { sync })); cache[key()] = clone(Object.assign({}, next, { sync }))
    if (syncHook) syncHook()
  }
  return clone(cache[key()])
}
function mutate(fn) { const next = read(); fn(next); return write(next) }
function config() { return Object.assign({}, require('../config/services')) }
function saveConfig(value) { storage().setStorageSync(PREFIX + ':config', Object.assign(config(), value)) }
function postDraftKey(value) {
  const current = value || session()
  return POST_DRAFT_PREFIX + String(current.kind || 'guest') + ':' + String(current.id || 'guest')
}
function readPostDraft(value) {
  const draft = storage().getStorageSync(postDraftKey(value))
  return draft && typeof draft === 'object' ? clone(draft) : null
}
function savePostDraft(draft, value) {
  if (!draft || typeof draft !== 'object') throw new Error('发帖草稿格式不正确')
  const next = Object.assign({}, clone(draft), { updatedAt: Date.now() })
  storage().setStorageSync(postDraftKey(value), next)
  return clone(next)
}
function clearPostDraft(value) {
  const k = postDraftKey(value)
  if (typeof storage().removeStorageSync === 'function') storage().removeStorageSync(k)
  else storage().setStorageSync(k, null)
}
function place(id) {
  return read().catalog.find(p => p.id === id) || require('./travel-engine').seedPlaces.find(p => p.id === id) || null
}
function remember(p) {
  if (!p || p.canAdd === false || (p.recognitionStatus && !['confirmed', 'legacy'].includes(p.recognitionStatus))) return
  mutate(s => {
    const normalized = normalizePlaceRecord(p)
    s.catalog = s.catalog.filter(x => !samePlace(x, normalized)).concat([normalized])
    s.menu = s.menu.map(item => samePlace(item, normalized) ? Object.assign({}, normalized, { stayDays: item.stayDays, note: item.note }) : item)
  })
}
function addPlace(p) {
  assertMenuPlace(p)
  return mutate(s => {
    if (s.menu.some(x => samePlace(x, p))) return
    if (s.menu.length >= MAX_MENU_PLACES) throw new Error('本轮最多选择 12 个地点')
    const normalized = normalizePlaceRecord(p)
    s.catalog = s.catalog.filter(x => !samePlace(x, normalized)).concat([normalized])
    s.menu.push(Object.assign({}, normalized, { stayDays: 1, note: '' }))
  })
}
function togglePlace(p) {
  let added = false
  const state = mutate(s => {
    const index = s.menu.findIndex(x => samePlace(x, p))
    if (index >= 0) {
      s.menu.splice(index, 1)
      return
    }
    assertMenuPlace(p)
    if (s.menu.length >= MAX_MENU_PLACES) throw new Error('本轮最多选择 12 个地点')
    const normalized = normalizePlaceRecord(p)
    s.catalog = s.catalog.filter(x => !samePlace(x, normalized)).concat([normalized])
    s.menu.push(Object.assign({}, normalized, { stayDays: 1, note: '' }))
    added = true
  })
  return { state, added }
}
function putPlan(plan) {
  return mutate(s => {
    const old = s.plans.find(x => x.id === plan.id)
    if (old && plan.version <= old.version && JSON.stringify(old) !== JSON.stringify(plan)) throw new Error('方案已更新，请重新打开再编辑')
    s.plans = s.plans.filter(x => x.id !== plan.id).concat([plan])
    s.trips.forEach(t => {
      if (t.planId === plan.id && t.plan.version !== plan.version) {
        t.plan = clone(plan)
        t.version = Number(t.version || 1) + 1
        t.updatedAt = new Date().toISOString()
      }
    })
  })
}
function getPlan(id) { return read().plans.find(p => p.id === id) || null }

// 开启行程。2026-09-18 起不再有「提前提醒 / 订阅消息」：行程只承载安排与记录。
// 同一个方案重复开启是幂等的，直接返回已有行程。
function startTrip(plan) {
  if (!plan || !plan.id) throw new Error('方案数据不完整，无法开启行程')
  let result
  mutate(s => {
    result = s.trips.find(t => t.planId === plan.id)
    if (result) return
    result = { id: id('trip'), planId: plan.id, plan: clone(plan), status: 'active', visibility: 'private', records: {}, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 }
    s.trips.push(result)
  })
  return clone(result)
}

// 从真实规划结果开启行程：把后端 display/plan 物化成行程页认识的 item 形状，
// 并把用户已经补录的实际车票/住宿信息一并带进 items[].booking。
// 物化规则见 utils/real-planning.js 的 tripPlanFromReal（只读机器字段 + display 文案）。
function startTripFromReal(result, options = {}) {
  const draft = require('./real-planning').tripPlanFromReal(result, options)
  if (!draft) throw new Error('当前方案没有可开启的行程内容，请重新生成')
  if (!draft.items.length) throw new Error('这份方案还没有可执行的安排，请回菜单调整后重新生成')
  let result_ = null
  mutate(s => {
    const existing = s.trips.find(t => t.planId === draft.id)
    if (existing) { result_ = existing; return }
    const plan = clone(draft)
    plan.items.forEach(item => {
      const source = item.sourceRef || {}
      if (!source.sectionId) return
      const recorded = (s.bookings || []).find(row => row && row.deleted !== true && row.planId === draft.id && row.sectionId === source.sectionId)
      if (recorded) {
        item.booking = clone(recorded.fields)
        item.bookingKind = recorded.kind
        item.bookingState = '已补充（用户记录）'
      }
    })
    result_ = { id: id('trip'), planId: plan.id, plan, status: 'active', visibility: 'private', records: {}, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 }
    s.trips.push(result_)
  })
  return clone(result_)
}

function updateTrip(trip) { return mutate(s => { s.trips = s.trips.map(t => t.id === trip.id ? Object.assign({}, trip, { version: Math.max(Number(trip.version || 1), Number(t.version || 1) + 1), updatedAt: new Date().toISOString() }) : t) }) }
function ownedPosts() { return read().posts }

// ——— 补充信息（bookings）———
// 身份 = 方案实例 + 卡片 section id，清洗成后端 ID_PATTERN 允许的字符集并截断 128。
// 重新生成会得到新的 planId，因此旧记录不会被自动继承（Owner 2026-09-18 决定）。
function bookingId(planId, sectionId) {
  return (String(planId || '') + ':' + String(sectionId || '')).replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 128)
}
function cleanBookingValue(value) {
  const out = String(value === undefined || value === null ? '' : value).trim()
  return out.slice(0, 120)
}
function cleanBookingFields(kind, fields) {
  const keys = BOOKING_FIELDS[kind] || []
  const source = fields && typeof fields === 'object' ? fields : {}
  const cleaned = {}
  keys.forEach(key => { cleaned[key] = cleanBookingValue(source[key]) })
  return cleaned
}
// 必填只要求「名称类」字段：车次 / 航班号 / 酒店名。金额、时间等留空不阻塞保存。
function assertBookingFields(kind, fields) {
  const required = kind === 'hotel' ? 'name' : kind === 'flight' ? 'flightNo' : 'serviceNo'
  if (!fields[required]) throw new Error(kind === 'hotel' ? '请填写酒店名称' : kind === 'flight' ? '请填写航班号' : '请填写车次')
}
function listBookings(planId) {
  return read().bookings.filter(row => row && row.deleted !== true && (!planId || row.planId === planId))
}
function getBooking(planId, sectionId) {
  return read().bookings.find(row => row && row.deleted !== true && row.planId === planId && row.sectionId === sectionId) || null
}
function saveBooking(input) {
  const planId = String((input && input.planId) || '').trim()
  const sectionId = String((input && input.sectionId) || '').trim()
  const kind = String((input && input.kind) || '').trim()
  if (!planId || !sectionId) throw new Error('缺少方案或卡片标识，无法保存补充信息')
  if (!BOOKING_KINDS.includes(kind)) throw new Error('补充信息类型无效')
  const fields = cleanBookingFields(kind, input && input.fields)
  assertBookingFields(kind, fields)
  let saved = null
  mutate(s => {
    const rowId = bookingId(planId, sectionId)
    const existing = (s.bookings || []).find(row => row && row.id === rowId)
    saved = {
      id: rowId, planId, sectionId, kind, fields,
      updatedAt: Date.now(),
      version: Number(existing && existing.version || 0) + 1
    }
    s.bookings = (s.bookings || []).filter(row => row && row.id !== rowId).concat([saved])
  })
  return clone(saved)
}
// 删除用墓碑：本机立刻不可见，同时把 deleted 行同步到云端，
// 避免下一次同步把已经删掉的记录又带回来。
function deleteBooking(planId, sectionId) {
  const row = getBooking(planId, sectionId)
  if (!row) return null
  mutate(s => {
    s.bookings = (s.bookings || []).map(item => item.id === row.id
      ? Object.assign({}, item, { deleted: true, updatedAt: Date.now(), version: Number(item.version || 1) + 1 })
      : item)
  })
  return clone(getBooking(planId, sectionId))
}
function syncPayload(state = read()) {
  const trips = Array.isArray(state.trips) ? state.trips : []
  const bookings = Array.isArray(state.bookings) ? state.bookings : []
  // 提醒字段已废弃：这里既不上报 reminders，也不上报 reminderMinutes。
  return {
    plans: clone((state.plans || []).slice(0, 50)),
    trips: clone(trips.slice(0, 50)),
    bookings: clone(bookings.slice(0, MAX_BOOKINGS)),
    clientRevision: Number(state.sync && state.sync.localRevision || 0)
  }
}
function applyRemote(remote, identity) {
  if (identity && !isCurrentSession(identity)) return null
  if (!remote || !Array.isArray(remote.plans) || !Array.isArray(remote.trips)) throw new Error('云端旅行数据格式异常')
  const current = read()
  // 服务端在「版本相同但内容不同」时保留自己那份，仅通过 conflicts 回报（见 backend/src/travel-api.js）。
  // 这里若不接收 conflicts，本地改动就会被云端版本静默覆盖，而用户看到的是「同步已完成」。
  const conflicts = Array.isArray(remote.conflicts)
    ? remote.conflicts.filter(item => item && (item.type === 'plan' || item.type === 'trip') && item.id)
      .slice(0, 50).map(item => ({ type: item.type, id: String(item.id), serverVersion: Number(item.serverVersion) || 1 }))
    : []
  // 保留 localRevision：它既是同步竞态的基线，也被 syncPayload 当作 clientRevision 上报。
  const sync = Object.assign({}, current.sync, {
    dirty: false, lastSyncedAt: remote.serverTime || Date.now(),
    lastConflicts: conflicts, lastConflictAt: conflicts.length ? new Date().toISOString() : null
  })
  const next = Object.assign({}, current, { plans: clone(remote.plans), trips: clone(remote.trips), sync })
  if (Array.isArray(remote.bookings)) next.bookings = clone(remote.bookings)
  storage().setStorageSync(key(), next); cache[key()] = clone(next)
  return clone(next)
}
function syncConflicts(state = read()) {
  const conflicts = state && state.sync && state.sync.lastConflicts
  return Array.isArray(conflicts) ? conflicts : []
}
function setSyncHook(fn) { syncHook = typeof fn === 'function' ? fn : null }
module.exports = { PREFIX, MAX_MENU_PLACES, MAX_BOOKINGS, BOOKING_KINDS, clone, id, blank, session, sessionIdentity, isCurrentSession, setSession, recordLoginSource, takeLoginSource, read, mutate, config, saveConfig, postDraftKey, readPostDraft, savePostDraft, clearPostDraft, place, samePlace, stablePlaceKey, normalizeReferencePlace, previewRouteStops, importRouteStops, remember, addPlace, togglePlace, putPlan, getPlan, startTrip, startTripFromReal, updateTrip, ownedPosts, bookingId, cleanBookingFields, listBookings, getBooking, saveBooking, deleteBooking, syncPayload, applyRemote, syncConflicts, setSyncHook, resetCache: () => { cache = {} } }
