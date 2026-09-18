const { createHash } = require('node:crypto')
const { failure } = require('./community-repository')

const TYPES = new Set(['route', 'review', 'question'])
const MAX_PHOTOS = 6
const MAX_PLACES = 12
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
}

function hash(value) {
  return createHash('sha256').update(stable(value)).digest('hex')
}

function requestKey(input, required = false) {
  const value = input && (input.requestKey || input.clientRequestId)
  if (value === undefined || value === null || value === '') {
    if (required) throw failure('请求缺少幂等键', 400)
    return null
  }
  if (typeof value !== 'string' || value.trim().length < 8 || value.trim().length > 128) throw failure('幂等键格式不正确', 400)
  return value.trim()
}

function cleanText(value, min, max, field) {
  if (typeof value !== 'string') throw failure(`${field}格式不正确`, 400)
  const text = value.trim()
  if (text.length < min || text.length > max) throw failure(`${field}长度不正确`, 400)
  return text
}

function optionalText(value, max, field) {
  if (value === undefined || value === null || value === '') return null
  return cleanText(String(value), 0, max, field)
}

function cleanDate(value, field, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw failure(`${field}不能为空`, 400)
    return null
  }
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw failure(`${field}格式不正确`, 400)
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw failure(`${field}格式不正确`, 400)
  return value
}

function normalizePlaces(input) {
  const source = Array.isArray(input && (input.places || input.placeRefs)) ? (input.places || input.placeRefs) : []
  if (source.length > MAX_PLACES) throw failure('关联地点最多 12 个', 400)
  return source.map((place, index) => {
    if (!place || typeof place !== 'object') throw failure(`第 ${index + 1} 个地点格式不正确`, 400)
    const id = place.id || place.placeId || place.providerId
    const name = place.name || place.title
    if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim()) throw failure(`第 ${index + 1} 个地点缺少稳定标识或名称`, 400)
    const stableId = id.trim().slice(0, 128)
    const provider = String(place.provider || place.source || 'qq').slice(0, 40)
    const result = { id: stableId, placeId: stableId, name: name.trim().slice(0, 100), provider }
    if (place.providerId !== undefined && place.providerId !== null && String(place.providerId).trim()) result.providerId = String(place.providerId).trim().slice(0, 128)
    if (place.address) result.address = String(place.address).trim().slice(0, 200)
    if (place.category) result.category = String(place.category).trim().slice(0, 60)
    if (Number.isFinite(Number(place.latitude)) && Number.isFinite(Number(place.longitude))) {
      result.latitude = Number(place.latitude)
      result.longitude = Number(place.longitude)
    }
    return result
  })
}

function normalizePlaceNames(input, places) {
  const names = places.map(place => place.name)
  const legacy = Array.isArray(input && input.placeNames) ? input.placeNames : []
  if (legacy.length > MAX_PLACES) throw failure('关联地点最多 12 个', 400)
  for (const value of legacy) {
    if (typeof value !== 'string') throw failure('关联地点格式不正确', 400)
    const name = value.trim()
    if (!name || names.includes(name)) continue
    names.push(name.slice(0, 100))
  }
  if (names.length > MAX_PLACES) throw failure('关联地点最多 12 个', 400)
  return names
}

function normalizePhotos(input) {
  const photos = Array.isArray(input && input.photos) ? input.photos : []
  if (photos.length > MAX_PHOTOS) throw failure('图片最多 6 张', 400)
  return photos.map((photo, index) => {
    if (typeof photo !== 'string' || !photo.trim() || photo.trim().length > 128) throw failure(`第 ${index + 1} 张图片标识不正确`, 400)
    return photo.trim()
  })
}

function sanitizeRouteSnapshot(snapshot) {
  if (snapshot === undefined || snapshot === null) return null
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw failure('路线快照格式不正确', 400)
  const stops = Array.isArray(snapshot.stops) ? snapshot.stops : []
  const items = Array.isArray(snapshot.items) ? snapshot.items : []
  if (!stops.length || stops.length > MAX_PLACES || items.length > 200) throw failure('路线快照地点或安排数量不正确', 400)
  const safeStops = stops.map((stop, index) => {
    if (!stop || typeof stop !== 'object') throw failure(`路线快照第 ${index + 1} 个地点格式不正确`, 400)
    const id = stop.id || stop.placeId || stop.providerId
    const name = stop.name || stop.title
    if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim()) throw failure('路线快照地点缺少稳定标识或名称', 400)
    const stableId = id.trim().slice(0, 128)
    const result = { id: stableId, placeId: stableId, name: name.trim().slice(0, 100), provider: String(stop.provider || stop.source || 'qq').slice(0, 40) }
    if (stop.providerId !== undefined && stop.providerId !== null && String(stop.providerId).trim()) result.providerId = String(stop.providerId).trim().slice(0, 128)
    for (const key of ['providerKind', 'objectType', 'planningRole', 'category', 'categoryGroup', 'address', 'province', 'city', 'district', 'administrativeLevel', 'adminLevel']) {
      if (stop[key] !== undefined && stop[key] !== null && typeof stop[key] !== 'object') result[key] = String(stop[key]).slice(0, 120)
    }
    for (const key of ['isCity', 'isProvince', 'isAdministrative']) {
      if (stop[key] !== undefined) result[key] = Boolean(stop[key])
    }
    if (Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude))) {
      result.latitude = Number(stop.latitude)
      result.longitude = Number(stop.longitude)
    }
    return result
  })
  const safeItems = items.map((item, index) => {
    if (!item || typeof item !== 'object') throw failure(`路线快照第 ${index + 1} 个安排格式不正确`, 400)
    const result = {}
    for (const key of ['id', 'type', 'title', 'date', 'start', 'end', 'endDate', 'variant']) {
      if (item[key] !== undefined && item[key] !== null) result[key] = String(item[key]).slice(0, 160)
    }
    if (!result.id || !result.title) throw failure('路线快照安排缺少必要字段', 400)
    return result
  })
  const safeRequest = {}
  const request = snapshot.request && typeof snapshot.request === 'object' ? snapshot.request : {}
  for (const key of ['startDate', 'days', 'budget', 'budgetType', 'people', 'preference', 'pace', 'allowNight', 'needHotel', 'hotelLevel']) {
    if (request[key] !== undefined && request[key] !== null && typeof request[key] !== 'object') safeRequest[key] = typeof request[key] === 'string' ? request[key].slice(0, 80) : request[key]
  }
  if (snapshot.days !== undefined && safeRequest.days === undefined) safeRequest.days = Number(snapshot.days)
  return { version: 1, stops: safeStops, items: safeItems, request: safeRequest, isDemo: Boolean(snapshot.isDemo) }
}

function normalizePostInput(input, existing = null) {
  const source = Object.assign({}, existing || {}, input || {})
  const type = cleanText(source.type, 1, 20, '类型')
  if (!TYPES.has(type)) throw failure('帖子类型不支持', 400)
  const title = cleanText(source.title, 1, 60, '标题')
  const content = cleanText(source.content, 1, 5000, '正文')
  const places = normalizePlaces(source)
  const placeNames = normalizePlaceNames(source, places)
  const photos = normalizePhotos(source)
  const visibility = source.visibility === undefined || source.visibility === null || source.visibility === ''
    ? (existing && existing.visibility ? existing.visibility : 'public')
    : source.visibility
  if (visibility !== 'public' && visibility !== 'private') throw failure('公开范围不正确', 400)
  const routeSnapshot = type === 'route' ? sanitizeRouteSnapshot(source.routeSnapshot) : null
  if (type === 'route' && !routeSnapshot) throw failure('路线帖请选择一个现有方案或已完成行程', 400)
  if (type === 'review' && !places.length) throw failure('评价帖请选择一个已确认地点', 400)
  let rating = null
  if (type === 'review') {
    if (!Number.isInteger(Number(source.rating)) || Number(source.rating) < 1 || Number(source.rating) > 5) throw failure('推荐程度需为 1–5 整数', 400)
    rating = Number(source.rating)
  }
  const visitDate = type === 'review' ? cleanDate(source.visitDate, '旅行日期', true) : cleanDate(source.visitDate, '旅行日期', false)
  const duration = optionalText(source.duration, 80, '游玩时长')
  const sourceKey = optionalText(source.sourceKey, 128, '来源标识')
  return { type, title, content, places, placeNames, photos, routeSnapshot, rating, visitDate, duration, visibility, sourceKey }
}

function validateUploadInput(input) {
  const mime = typeof input?.mime === 'string' ? input.mime.trim().toLowerCase() : ''
  const size = Number(input?.size)
  if (!IMAGE_MIME.has(mime)) throw failure('仅支持 JPG、PNG 或 WebP 图片', 400)
  if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) throw failure('图片大小不能超过 10 MB', 413)
  return { mime, size }
}

module.exports = { TYPES, MAX_PHOTOS, MAX_PLACES, MAX_IMAGE_BYTES, IMAGE_MIME, clone, stable, hash, requestKey, cleanText, normalizePlaces, normalizePlaceNames, normalizePhotos, sanitizeRouteSnapshot, normalizePostInput, validateUploadInput }
