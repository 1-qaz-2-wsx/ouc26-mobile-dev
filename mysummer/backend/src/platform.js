const { createHmac, timingSafeEqual } = require('node:crypto');
const { sessionToken } = require('./session-token');

// ===== 通用配置清洗函数 =====
function cleanConfigValue(value) {
  if (!value || typeof value !== 'string') return value;
  // 去除首尾的引号（单引号或双引号）和空格
  return value.trim().replace(/^['"]+|['"]+$/g, '');
}
// ===== 清洗函数结束 =====

function failure(message, status = 502) { return Object.assign(new Error(message), { status }) }
function text(value, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw failure('参数格式不正确', 400)
  return value.trim()
}
function coordinates(input) {
  const { latitude, longitude } = input
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw failure('坐标无效', 400)
  return `${latitude},${longitude}`
}
function placeId(p, prefix = 'qq') {
  const providerId = p && p.id !== undefined && p.id !== null ? String(p.id) : ''
  if (providerId) return prefix + '-' + providerId
  const name = String(p && (p.title || p.fullname || p.name) || '地点').trim().replace(/[^\w\u4e00-\u9fff-]+/g, '-').slice(0, 48)
  const latitude = Number(p && p.location && p.location.lat).toFixed(6)
  const longitude = Number(p && p.location && p.location.lng).toFixed(6)
  return prefix + '-coordinate-' + name + '-' + latitude + '-' + longitude
}
function categoryGroup(category) { return /公园|自然|风景|森林|湿地|山|湖|河|景区/.test(String(category || '')) ? '自然' : '人文' }
function administrativeLevel(p, name) {
  const explicit = [p && p.level, p && p.adminLevel, p && p.admin_level, p && p.adminType].filter(value => value !== undefined && value !== null).map(value => String(value).toLowerCase()).join(' ')
  const textValue = String((p && (p.fullname || p.name)) || name || '').trim()
  if (/province|省|自治区/.test(explicit + ' ' + textValue)) return 'province'
  if (/municipality|直辖市/.test(explicit)) return 'municipality'
  if (/city|城市|市|地区|自治州|盟|prefecture/.test(explicit + ' ' + textValue)) return 'city'
  if (/county|县|区|旗/.test(explicit + ' ' + textValue)) return 'county'
  if (/town|乡|镇|街道/.test(explicit + ' ' + textValue)) return 'town'
  return 'administrative'
}
function normalize(p, options = {}) {
  if (!p || !p.location || !Number.isFinite(Number(p.location.lat)) || !Number.isFinite(Number(p.location.lng))) throw failure('地点坐标缺失')
  const providerId = p.id !== undefined && p.id !== null ? String(p.id) : ''
  const name = p.title || p.fullname || p.name || '未命名地点'
  const categoryText = String(p.category || '').trim()
  return {
    id: placeId(p, options.idPrefix || 'qq'), providerId, providerKind: 'poi', objectType: 'poi',
    recognitionStatus: options.recognitionStatus || 'confirmed', detailStatus: options.detailStatus || 'available',
    planningRole: options.planningRole || 'stop', canAdd: options.canAdd !== false,
    name, address: p.address || p.fullname || '',
    province: p.ad_info?.province || p.province || '', city: p.ad_info?.city || p.city || '', district: p.ad_info?.district || p.district || '', adcode: p.ad_info?.adcode || p.adcode || '',
    latitude: Number(p.location.lat), longitude: Number(p.location.lng), telephone: p.tel || '',
    category: categoryText || '地点', categoryGroup: categoryText ? categoryGroup(categoryText) : '', summary: categoryText,
    poiType: p.type, source: options.source || '腾讯位置服务', stayDays: 1
  }
}
function normalizeAdministrative(p, options = {}) {
  if (!p || !p.location || !Number.isFinite(Number(p.location.lat)) || !Number.isFinite(Number(p.location.lng))) throw failure('行政区坐标缺失')
  const name = p.fullname || p.name || p.title || '未命名行政区'
  const level = options.administrativeLevel || administrativeLevel(p, name)
  const isProvince = level === 'province'
  const components = p.address_components || {}
  const province = p.province || p.ad_info?.province || components.province || (isProvince ? name : '')
  const city = p.city || p.ad_info?.city || components.city || (level === 'city' || level === 'municipality' ? name : '')
  const district = p.district || p.ad_info?.district || components.district || ''
  const providerId = p.id !== undefined && p.id !== null ? String(p.id) : ''
  const category = isProvince ? '省/自治区' : (level === 'county' ? '县域目的地' : '城市')
  return {
    id: placeId(p, options.idPrefix || 'qq'), providerId, providerKind: 'district', objectType: 'administrative',
    recognitionStatus: options.recognitionStatus || 'confirmed', detailStatus: options.detailStatus || 'available',
    planningRole: options.planningRole || (isProvince ? 'choose_city' : 'destination_area'), canAdd: options.canAdd !== undefined ? options.canAdd : !isProvince,
    name, address: name, province, city, district, adcode: providerId,
    latitude: Number(p.location.lat), longitude: Number(p.location.lng), telephone: '',
    category, categoryGroup: 'administrative', summary: isProvince ? '请继续选择省内城市' : '城市目的地；加入后将作为旅行目的地安排市内游玩',
    administrativeLevel: level, adminLevel: level, adminType: '行政区', isCity: !isProvince, isAdministrative: true, isProvince,
    source: options.source || '腾讯位置服务·行政区', stayDays: 1
  }
}
function normalizeCity(p, options = {}) { return normalizeAdministrative(p, options) }
function sameAdministrativeName(place, name) {
  const input = String(name || '').trim()
  if (!input || !place) return false
  const stripSuffix = value => String(value || '').trim().replace(/(?:省|市|自治区|地区|自治州|盟|县|区|旗)$/, '')
  return [place.name, place.fullname].some(value => value === input || stripSuffix(value) === stripSuffix(input))
}
function distanceMeters(a, latitude, longitude) {
  if (!a || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng))) return Infinity
  const lat = Number(latitude), lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Infinity
  return Math.hypot((Number(a.lat) - lat) * 111000, (Number(a.lng) - lng) * 111000 * Math.cos(lat * Math.PI / 180))
}

// ===== 附近检索（B4-1）=====
// 只做“以某点为中心的关键词地点检索”，不涉及任何报价/库存语义。
const DEFAULT_NEARBY_RADIUS = 3000
const MAX_NEARBY_RADIUS = 5000
const NEARBY_PAGE_SIZE = 20
function nearbyPoint(location) {
  const lat = location && location.lat, lng = location && location.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw failure('坐标无效', 400)
  return { lat, lng }
}
function nearbyKeyword(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw failure('检索关键词无效', 400)
  return value.trim()
}
function nearbyRadius(value) {
  if (value === undefined || value === null) return DEFAULT_NEARBY_RADIUS
  if (!Number.isInteger(value) || value <= 0 || value > MAX_NEARBY_RADIUS) throw failure('检索半径无效', 400)
  return value
}
function withUsableCoordinate(place) {
  return Boolean(place && place.location) && Number.isFinite(Number(place.location.lat)) && Number.isFinite(Number(place.location.lng))
}
// ===== 附近检索结束 =====

function createPlatform(config, fetchImpl, options = {}) {
  // ===== 清洗所有配置项 =====
  const cleanConfig = {
    ...config,
    tencentMapKey: cleanConfigValue(config.tencentMapKey),
    wechatAppId: cleanConfigValue(config.wechatAppId),
    // 会话密钥属于本项目自身的数据，不按第三方凭据规则清洗，
    // 避免正式发布后改变签名密钥并导致现有登录令牌失效。
    sessionSecret: config.sessionSecret,
    tencentMapSk: cleanConfigValue(config.tencentMapSk),
  };
  
  // 记录清洗后的配置（便于调试）
  if (config.tencentMapKey !== cleanConfig.tencentMapKey) {
    console.log(`🔑 腾讯Key已清洗: ${config.tencentMapKey.length}字符 → ${cleanConfig.tencentMapKey.length}字符`);
  }
  if (config.wechatAppId !== cleanConfig.wechatAppId) {
    console.log(`🔑 微信AppID已清洗: ${config.wechatAppId?.length || 0}字符 → ${cleanConfig.wechatAppId?.length || 0}字符`);
  }
  // ===== 清洗结束 =====

  const limits = new Map()
  function limit(ip) {
    const now = Date.now()
    for (const [key, value] of limits) if (value.until < now) limits.delete(key)
    const value = limits.get(ip) || { count: 0, until: now + 60000 }
    if (++value.count > 60 || limits.size > 10000) throw failure('请求过于频繁，请稍后再试', 429)
    limits.set(ip, value)
  }
  async function upstream(url) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw failure('第三方服务暂不可用')
      return await response.json()
    } catch { throw failure('第三方服务连接失败或超时，请重试') }
  }
  
  async function maps(path, params) {
    // 使用清洗后的 Key
    if (!cleanConfig.tencentMapKey) throw failure('地图服务尚未由开发者配置', 503)
    const query = new URLSearchParams({ ...params, key: cleanConfig.tencentMapKey })
    
    if (cleanConfig.tencentMapSk) {
      const { createHash } = require('node:crypto')
      const sorted = [...query.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')
      query.set('sig', createHash('md5').update('/ws/' + path + '?' + sorted + cleanConfig.tencentMapSk).digest('hex'))
    }
    
    const data = await upstream('https://apis.map.qq.com/ws/' + path + '?' + query)
    if (data.status === 347) return Object.assign({}, data, { data: Array.isArray(data.data) ? data.data : [], result: Array.isArray(data.result) ? data.result : [] })
    if (data.status !== 0) {
      if (data.status === 311) {
        console.error(`❌ Key格式错误，清洗后长度: ${cleanConfig.tencentMapKey.length}`);
        throw failure('腾讯地图Key格式错误，请检查是否包含多余的引号或空格', 502);
      }
      throw failure('腾讯地图查询失败（' + Number(data.status) + '），请联系开发者检查配额和服务权限', 502)
    }
    return data
  }

  async function enrichAdministrative(place, location) {
    try {
      const data = await maps('geocoder/v1/', { location })
      const components = data.result?.address_components || {}
      return normalizeAdministrative(Object.assign({}, place, { address_components: components }), { source: '腾讯位置服务·行政区' })
    } catch (_) {
      // 行政区身份已经由 district/search + 名称 + 坐标确认；省市区补充字段失败不能把它伪装成“未识别”。
      return normalizeAdministrative(place)
    }
  }

  function nearbyCandidates(data, latitude, longitude, options = {}) {
    return (Array.isArray(data && data.data) ? data.data : []).filter(p => p && p.location && Number.isFinite(Number(p.location.lat)) && Number.isFinite(Number(p.location.lng))).map(p => ({
      raw: p, distance: distanceMeters(p.location, latitude, longitude)
    })).filter(item => item.distance <= (options.radius || 1000)).sort((a, b) => a.distance - b.distance).slice(0, options.limit || 5).map(item => normalize(item.raw, {
      recognitionStatus: 'candidate', detailStatus: 'available', planningRole: 'confirm', canAdd: false, source: '腾讯位置服务·候选地点'
    }))
  }
  
  // 使用清洗后的 sessionSecret
  const sign = value => createHmac('sha256', cleanConfig.sessionSecret).update(value).digest('base64url')
  
  function verify(token) {
    if (!cleanConfig.sessionSecret || typeof token !== 'string') throw failure('请重新微信登录', 401)
    const [body, signature, extra] = token.split('.')
    const expected = sign(body || '')
    if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw failure('请重新微信登录', 401)
    let payload
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()) } catch { throw failure('请重新微信登录', 401) }
    if (!payload.id || payload.exp <= Date.now()) throw failure('登录已过期，请重新登录', 401)
    return { id: payload.id, nickname: '微信用户' }
  }
  
  async function handle(path, input, req) {
    limit(req.socket.remoteAddress)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('请求体必须是对象', 400)
    if (path === '/auth/session') return { user: verify(sessionToken(req)) }
    if (path === '/auth/wechat') {
      if (!cleanConfig.sessionSecret || cleanConfig.sessionSecret.length < 32) throw failure('账号服务尚未由开发者配置', 503)
      const openid = req.headers['x-wx-openid']
      const appid = req.headers['x-wx-appid'] // 原始请求头，可能不含引号
      if (typeof openid !== 'string' || !openid) throw failure('未获得可信微信身份，请通过小程序云托管访问', 401)
      
      // AppID 比较（使用清洗后的值）
      if (cleanConfig.wechatAppId && appid) {
        // 请求头中的 AppID 一般不会有引号，但为了安全也清洗一下
        const cleanRequestAppId = cleanConfigValue(appid);
        if (cleanRequestAppId !== cleanConfig.wechatAppId) {
          console.warn(`⚠️ AppID不匹配: 配置="${cleanConfig.wechatAppId}", 请求="${cleanRequestAppId}"`);
          throw failure('小程序身份不匹配', 403);
        }
      }
      
      const legacyId = createHmac('sha256', cleanConfig.sessionSecret).update((appid || cleanConfig.wechatAppId || 'miniapp') + ':' + openid).digest('hex')
      const identity = options.identityService ? await options.identityService.resolve({ appid: cleanConfig.wechatAppId || appid, openid, legacyId }) : { user: { id: legacyId, nickname: '微信用户', bio: '', avatarMediaId: null, profileVersion: 1 } }
      const id = identity.user.id
      const expiresAt = Date.now() + 7 * 86400000
      const body = Buffer.from(JSON.stringify({ id, exp: expiresAt })).toString('base64url')
      return { token: body + '.' + sign(body), user: identity.user, expiresAt }
    }
    // ... 其余 handle 逻辑保持不变
    if (path === '/maps/regeo') {
      const data = await maps('geocoder/v1/', { location: coordinates(input) })
      return { formattedAddress: data.result.address, source: '腾讯位置服务' }
    }
    if (path === '/maps/detail') {
      const data = await maps('place/v1/detail', { id: text(input.id) })
      if (!data.data?.length) throw failure('暂未找到地点详情', 404)
      const item = data.data[0]
      return { place: item.type === 4 ? normalizeAdministrative(item) : normalize(item) }
    }
    if (path === '/maps/poi') {
      const location = coordinates(input), name = text(input.name)
      const data = await maps('place/v1/search', { keyword: name, boundary: `nearby(${location},1000,0)`, page_size: 20 })
      const exact = (data.data || []).filter(p => p.title === name && p.location && distanceMeters(p.location, input.latitude, input.longitude) < 300)
      if (exact.length === 1) {
        const detail = await maps('place/v1/detail', { id: exact[0].id })
        const item = detail.data?.[0] || exact[0]
        return { place: item.type === 4 ? normalizeAdministrative(item) : normalize(item, { detailStatus: detail.data?.[0] ? 'available' : 'missing' }), recognitionStatus: 'confirmed', detailStatus: detail.data?.[0] ? 'available' : 'missing', candidates: [] }
      }
      const district = await maps('district/v1/search', { keyword: name })
      const administrativeCandidates = Array.from(new Map((district.result || []).flat()
        .filter(place => sameAdministrativeName(place, name))
        .map(place => [String(place.id || place.fullname || place.name), place])).values())
        .map(place => ({ place, distance: distanceMeters(place.location, input.latitude, input.longitude) }))
        .filter(item => item.distance <= 100000)
        .sort((a, b) => a.distance - b.distance)
      if (administrativeCandidates.length === 1) {
        const place = await enrichAdministrative(administrativeCandidates[0].place, location)
        return { place, recognitionStatus: 'confirmed', detailStatus: 'available', candidates: [] }
      }
      const poiCandidates = nearbyCandidates(data, input.latitude, input.longitude, { radius: 1000, limit: 5 })
      const administrativeSuggestions = administrativeCandidates.slice(0, 5).map(item => normalizeAdministrative(item.place, { recognitionStatus: 'candidate', planningRole: 'confirm', canAdd: false, source: '腾讯位置服务·候选行政区' }))
      const candidates = administrativeSuggestions.concat(poiCandidates)
      return { place: null, recognitionStatus: candidates.length ? 'candidate' : 'unidentified', detailStatus: 'missing', candidates }
    }
    const keyword = text(input.keyword)
    const district = await maps('district/v1/search', { keyword })
    const cities = (district.result || []).flat().filter(p => sameAdministrativeName(p, keyword))
    const city = cities.length === 1 ? cities[0] : null
    const region = city ? city.fullname : (typeof input.city === 'string' && input.city.trim() ? input.city.trim() : '全国')
    const data = await maps('place/v1/search', { keyword: city ? '景点' : keyword, boundary: `region(${region},0)`, page_size: 20 })
    const places = (data.data || []).map(place => place.type === 4 ? normalizeAdministrative(place) : normalize(place))
    if (city) {
      const cityLocation = city.location && Number.isFinite(Number(city.location.lat)) && Number.isFinite(Number(city.location.lng)) ? `${city.location.lat},${city.location.lng}` : null
      places.unshift(cityLocation ? await enrichAdministrative(city, cityLocation) : normalizeCity(city))
    }
    return { places }
  }
  return { handle, verify,
    // 附近地点检索：复用同一套 maps()（key/sig/fetch），不返回腾讯原始响应，无结果不算错误。
    async queryNearby({ location, keyword, radius } = {}) {
      const point = nearbyPoint(location)
      const name = nearbyKeyword(keyword)
      const range = nearbyRadius(radius)
      const data = await maps('place/v1/search', {
        keyword: name,
        boundary: `nearby(${point.lat},${point.lng},${range},0)`,
        page_size: NEARBY_PAGE_SIZE
      })
      const raw = Array.isArray(data && data.data) ? data.data : []
      return { places: raw.filter(withUsableCoordinate).map(place => normalize(place)), source: '腾讯位置服务', radius: range }
    },
    queryDirection({ from, to, mode }) {
    if (!['car', 'walk'].includes(mode) || ![from, to].every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) throw failure('路线参数无效', 422)
    return maps(`direction/v1/${mode === 'car' ? 'driving' : 'walking'}/`, { from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` })
  } }
}
module.exports = { createPlatform }
