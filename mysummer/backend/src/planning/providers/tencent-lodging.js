// B4-1 — 腾讯附近住宿「地点信息」provider
//
// 定位：这不是 Quote provider，而是“附近住宿的地点信息”provider。
// 产品边界（不得越界，越界即视为伪造事实）：
//   - 只做地点检索（名称/地址/行政区/坐标/类别），复用 platform.js 的 queryNearby()。
//   - 不查询、不推测房价；不查询、不推测库存；不推测房型；不声称可预订/已预订。
//   - 不生成跳转或购买目标（url / deeplink / bookingTarget / purchase action）。
//   - 不调用第二种第三方服务；一次 searchNearby 只做一次地图检索。
//   - 地图 POI 存在 ≠ 有房、≠ 可订价、≠ 可预订。
// 关于 status：'available' 只表示“地点信息可用”，与房态 availability 无关；
// 结果里的 statusScope / capabilities.dataScope / 每个 option 的 provenance.fieldScope
// 都是正向字段清单，用于让下游明确这批字段只覆盖地点身份类事实。

const PROVIDER_ID = 'tencent-lodging'
const PROVIDER_NAME = '腾讯位置服务·附近住宿地点信息'
const PROVIDER_KEY = 'tencent-map'
const DEFAULT_KEYWORD = '酒店'
const DEFAULT_RADIUS = 3000
const SOURCE_REF = 'place/v1/search'
const SOURCE = '腾讯位置服务'
const DATA_SCOPE = 'place_information_only'
// 正向字段清单：只声明本 provider 确实提供的字段域，不声明负数清单。
const FIELD_SCOPE = ['place_identity', 'address', 'administrative', 'coordinate', 'category']

function lodgingError(code, message, status = 502, details = {}) {
  return Object.assign(new Error(message), { code, status, provider: PROVIDER_ID, details })
}

function nowValue(clock) {
  return typeof clock === 'function' ? Number(clock()) : Number.isFinite(clock) ? Number(clock) : Date.now()
}

// keyword：缺省即是默认关键词；显式传入的值原样交给 platform 校验，provider 不自行改写或重试。
function keywordValue(value) {
  if (value === undefined || value === null) return DEFAULT_KEYWORD
  return typeof value === 'string' ? value.trim() : value
}

// radius：缺省用默认值；显式传入的值原样交给 platform 校验（provider 不复制第二套半径规则）。
function radiusValue(value) {
  return value === undefined || value === null ? DEFAULT_RADIUS : value
}

function lodgingOption(place, provenance) {
  return {
    provider: PROVIDER_KEY,
    providerName: SOURCE,
    providerPlaceId: place.providerId || null,
    placeId: place.id || null,
    name: place.name || '未命名地点',
    address: place.address || '',
    province: place.province || '',
    city: place.city || '',
    district: place.district || '',
    adcode: place.adcode || '',
    coordinate: { lat: place.latitude, lng: place.longitude },
    coordinateSystem: 'gcj02',
    category: place.category || '',
    source: place.source || SOURCE,
    provenance
  }
}

function optionProvenance(fetchedAt) {
  return {
    sourceType: 'live',
    provider: PROVIDER_KEY,
    sourceRef: SOURCE_REF,
    fetchedAt,
    fieldScope: [...FIELD_SCOPE]
  }
}

function createTencentLodgingProvider({ queryNearby, clock = Date.now } = {}) {
  function capabilities() {
    return {
      id: PROVIDER_ID,
      name: PROVIDER_NAME,
      kind: 'lodging',
      provider: PROVIDER_KEY,
      dataScope: DATA_SCOPE,
      supportedFields: [...FIELD_SCOPE],
      defaultKeyword: DEFAULT_KEYWORD,
      defaultRadius: DEFAULT_RADIUS,
      limitations: [
        '只提供附近住宿的地点信息（名称、地址、行政区、坐标、类别）',
        '一次检索只执行一个明确关键词，不做“酒店失败后再查住宿”的自动重试',
        '住宿地点被检索到，不代表该住宿当前空房、可入住或可代为预订'
      ]
    }
  }

  return {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    kind: 'lodging',
    capabilities,
    async searchNearby(input) {
      if (typeof queryNearby !== 'function') throw lodgingError('PROVIDER_RUNTIME_INVALID', '住宿地点检索缺少 queryNearby 实现', 500)
      const request = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
      const keyword = keywordValue(request.keyword)
      const radius = radiusValue(request.radius)
      // 只调用一次；坐标/关键词/半径的非法输入由 queryNearby 统一拒绝并抛出，这里不吞错、不降级成“无结果”。
      const result = await queryNearby({ location: request.location, keyword, radius })
      const places = Array.isArray(result && result.places) ? result.places : []
      const provenance = optionProvenance(new Date(nowValue(clock)).toISOString())
      const options = places.map(place => lodgingOption(place, { ...provenance, fieldScope: [...FIELD_SCOPE] }))
      return {
        status: options.length ? 'available' : 'no_results',
        options,
        query: { location: request.location, keyword, radius: Number.isInteger(result && result.radius) ? result.radius : radius },
        source: (result && result.source) || SOURCE,
        statusScope: DATA_SCOPE,
        capabilities: capabilities()
      }
    }
  }
}

module.exports = { DATA_SCOPE, DEFAULT_KEYWORD, DEFAULT_RADIUS, FIELD_SCOPE, PROVIDER_ID, createTencentLodgingProvider, lodgingOption, lodgingError }
