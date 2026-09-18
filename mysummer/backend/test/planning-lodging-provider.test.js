const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPlatform } = require('../src/platform')
const { DATA_SCOPE, DEFAULT_KEYWORD, DEFAULT_RADIUS, createTencentLodgingProvider } = require('../src/planning/providers/tencent-lodging')

const config = { tencentMapKey: 'test-key', wechatAppId: 'test-app', sessionSecret: 'x'.repeat(64) }
const ORIGIN = { lat: 39.9, lng: 116.4 }

// platform.queryNearby() 的稳定输出形状（normalize() 风格），作为 provider 的输入夹具。
function normalizedHotel(overrides = {}) {
  return Object.assign({
    id: 'qq-1001', providerId: '1001', providerKind: 'poi', objectType: 'poi',
    recognitionStatus: 'confirmed', detailStatus: 'available', planningRole: 'stop', canAdd: true,
    name: '汉庭酒店(王府井店)', address: '北京市东城区王府井大街 1 号',
    province: '北京市', city: '北京市', district: '东城区', adcode: '110101',
    latitude: 39.91, longitude: 116.41, telephone: '010-00000000',
    category: '住宿服务;宾馆酒店', categoryGroup: '人文', summary: '住宿服务;宾馆酒店', poiType: '宾馆酒店',
    source: '腾讯位置服务', stayDays: 1
  }, overrides)
}

function deepKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach(item => deepKeys(item, keys))
    return keys
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key)
      deepKeys(item, keys)
    }
  }
  return keys
}

// 只记录调用、不发网络请求的伪 queryNearby。
function spyQueryNearby(places = [normalizedHotel()], extra = {}) {
  const calls = []
  return {
    calls,
    impl: async (request) => {
      calls.push(request)
      return { places, source: '腾讯位置服务', radius: request.radius === undefined ? DEFAULT_RADIUS : request.radius, ...extra }
    }
  }
}

test('Lodging provider defaults to the 酒店 keyword and the 3000m radius', async () => {
  const spy = spyQueryNearby()
  const provider = createTencentLodgingProvider({ queryNearby: spy.impl })
  const result = await provider.searchNearby({ location: ORIGIN })
  assert.equal(spy.calls.length, 1)
  assert.deepEqual(spy.calls[0], { location: ORIGIN, keyword: '酒店', radius: 3000 })
  assert.equal(DEFAULT_KEYWORD, '酒店')
  assert.equal(DEFAULT_RADIUS, 3000)
  assert.equal(result.query.keyword, '酒店')
  assert.equal(result.query.radius, 3000)
})

test('Lodging provider accepts an explicit 住宿 keyword and radius without a second query', async () => {
  const spy = spyQueryNearby()
  const provider = createTencentLodgingProvider({ queryNearby: spy.impl })
  const result = await provider.searchNearby({ location: ORIGIN, keyword: '住宿', radius: 1500 })
  assert.equal(spy.calls.length, 1)
  assert.deepEqual(spy.calls.map(call => call.keyword), ['住宿'])
  assert.deepEqual(spy.calls.map(call => call.radius), [1500])
  assert.equal(result.query.keyword, '住宿')
  assert.equal(result.query.radius, 1500)
  assert.equal(result.status, 'available')
})

test('Lodging options keep the Tencent place identity and coordinate', async () => {
  const spy = spyQueryNearby([normalizedHotel(), normalizedHotel({ id: 'qq-1002', providerId: '1002', name: '如家酒店(东单店)', latitude: 39.92, longitude: 116.42, address: '北京市东城区东单北大街 2 号' })])
  const provider = createTencentLodgingProvider({ queryNearby: spy.impl })
  const result = await provider.searchNearby({ location: ORIGIN, keyword: '酒店' })
  assert.equal(result.options.length, 2)
  const [first, second] = result.options
  assert.equal(first.provider, 'tencent-map')
  assert.equal(first.providerPlaceId, '1001')
  assert.equal(first.placeId, 'qq-1001')
  assert.equal(first.name, '汉庭酒店(王府井店)')
  assert.equal(first.address, '北京市东城区王府井大街 1 号')
  assert.equal(first.province, '北京市')
  assert.equal(first.city, '北京市')
  assert.equal(first.district, '东城区')
  assert.equal(first.adcode, '110101')
  assert.deepEqual(first.coordinate, { lat: 39.91, lng: 116.41 })
  assert.equal(first.coordinateSystem, 'gcj02')
  assert.equal(first.category, '住宿服务;宾馆酒店')
  assert.equal(first.source, '腾讯位置服务')
  assert.equal(first.provenance.sourceRef, 'place/v1/search')
  assert.equal(first.provenance.provider, 'tencent-map')
  assert.equal(first.provenance.sourceType, 'live')
  assert.ok(first.provenance.fetchedAt)
  assert.equal(second.providerPlaceId, '1002')
  assert.deepEqual(second.coordinate, { lat: 39.92, lng: 116.42 })
})

test('Lodging options never carry a jump or purchase target', async () => {
  const spy = spyQueryNearby()
  const provider = createTencentLodgingProvider({ queryNearby: spy.impl })
  const result = await provider.searchNearby({ location: ORIGIN })
  const keys = deepKeys(result)
  for (const forbidden of ['url', 'deeplink', 'bookingTarget', 'bookingUrl', 'purchaseUrl', 'jumpUrl', 'link']) {
    assert.ok(!keys.includes(forbidden), `option/result must not contain ${forbidden}`)
  }
  assert.ok(!JSON.stringify(result).toLowerCase().includes('url'))
  assert.ok(!JSON.stringify(result).toLowerCase().includes('deeplink'))
  assert.ok(!JSON.stringify(result).toLowerCase().includes('bookingtarget'))
  assert.ok(!JSON.stringify(result).includes('http'))
})

test('Lodging options never carry price, inventory, room type or room availability', async () => {
  const spy = spyQueryNearby()
  const provider = createTencentLodgingProvider({ queryNearby: spy.impl })
  const result = await provider.searchNearby({ location: ORIGIN })
  const option = result.options[0]
  const keys = deepKeys(result)
  for (const forbidden of ['amountMinor', 'amount', 'price', 'priceMinor', 'currency', 'inventory', 'roomType', 'rooms', 'availability', 'detailStatus', 'stayDays', 'planningRole', 'canAdd']) {
    assert.ok(!keys.includes(forbidden), `option/result must not contain ${forbidden}`)
  }
  const serialized = JSON.stringify(result).toLowerCase()
  assert.ok(!serialized.includes('price'))
  assert.ok(!serialized.includes('inventory'))
  assert.ok(!serialized.includes('roomtype'))
  assert.ok(!serialized.includes('availability'))
  assert.deepEqual(Object.keys(option).sort(), ['provider', 'providerName', 'providerPlaceId', 'placeId', 'name', 'address', 'province', 'city', 'district', 'adcode', 'coordinate', 'coordinateSystem', 'category', 'source', 'provenance'].sort())
})

test('Lodging provider reports no_results without inventing options', async () => {
  const spy = spyQueryNearby([])
  const provider = createTencentLodgingProvider({ queryNearby: spy.impl })
  const result = await provider.searchNearby({ location: ORIGIN, keyword: '住宿' })
  assert.equal(result.status, 'no_results')
  assert.deepEqual(result.options, [])
  assert.equal(spy.calls.length, 1)
  assert.deepEqual(spy.calls.map(call => call.keyword), ['住宿'], 'no automatic retry with a second keyword')
})

test('Lodging status available only means the place information is available', async () => {
  const spy = spyQueryNearby()
  const provider = createTencentLodgingProvider({ queryNearby: spy.impl })
  const result = await provider.searchNearby({ location: ORIGIN })
  assert.equal(result.status, 'available')
  // 这里的 available 与房态无关：结果里不存在任何可被读成“有房/可订”的字段。
  assert.equal(result.statusScope, DATA_SCOPE)
  assert.equal(result.capabilities.dataScope, DATA_SCOPE)
  const keys = deepKeys(result)
  for (const forbidden of ['availability', 'roomAvailability', 'inventory', 'bookable', 'roomType', 'price', 'amountMinor']) {
    assert.ok(!keys.includes(forbidden), `available must not imply room state (${forbidden})`)
  }
  assert.deepEqual([...result.options[0].provenance.fieldScope].sort(), ['address', 'administrative', 'category', 'coordinate', 'place_identity'])
})

test('Lodging provider calls queryNearby exactly once per searchNearby', async () => {
  const spy = spyQueryNearby()
  const provider = createTencentLodgingProvider({ queryNearby: spy.impl })
  await provider.searchNearby({ location: ORIGIN })
  await provider.searchNearby({ location: ORIGIN, keyword: '住宿' })
  await provider.searchNearby({ location: ORIGIN, keyword: '酒店', radius: 800 })
  assert.equal(spy.calls.length, 3)
})

test('Lodging provider surfaces a failed map query instead of pretending there are no hotels', async () => {
  const provider = createTencentLodgingProvider({ queryNearby: async () => { throw Object.assign(new Error('腾讯地图查询失败（120），请联系开发者检查配额和服务权限'), { status: 502 }) } })
  await assert.rejects(provider.searchNearby({ location: ORIGIN }), { status: 502 })
  const invalid = createTencentLodgingProvider({ queryNearby: async () => { throw Object.assign(new Error('坐标无效'), { status: 400 }) } })
  await assert.rejects(invalid.searchNearby({ location: null }), { status: 400 })
})

test('Lodging provider refuses to run without a queryNearby implementation', async () => {
  const provider = createTencentLodgingProvider({})
  await assert.rejects(provider.searchNearby({ location: ORIGIN }), { status: 500 })
  assert.equal(provider.id, 'tencent-lodging')
  assert.equal(provider.capabilities().kind, 'lodging')
  assert.equal(provider.capabilities().defaultKeyword, DEFAULT_KEYWORD)
})

test('Lodging provider only talks to the Tencent map endpoint through injected mocks', async () => {
  const urls = []
  const mapPlatform = createPlatform(config, async url => {
    urls.push(url)
    const u = new URL(url)
    // 测试中唯一允许出现的上游主机：任何真实第三方调用都会在这里失败。
    assert.equal(u.hostname, 'apis.map.qq.com')
    return { ok: true, json: async () => ({ status: 0, data: [{ id: '1001', title: '汉庭酒店(王府井店)', address: '北京市东城区王府井大街 1 号', category: '住宿服务;宾馆酒店', location: { lat: 39.91, lng: 116.41 }, ad_info: { province: '北京市', city: '北京市', district: '东城区', adcode: '110101' } }] }) }
  })
  const provider = createTencentLodgingProvider({ queryNearby: request => mapPlatform.queryNearby(request) })
  const result = await provider.searchNearby({ location: ORIGIN })
  assert.equal(urls.length, 1)
  assert.equal(new URL(urls[0]).searchParams.get('boundary'), 'nearby(39.9,116.4,3000,0)')
  assert.equal(result.status, 'available')
  assert.equal(result.options[0].providerPlaceId, '1001')
  assert.deepEqual(result.options[0].coordinate, { lat: 39.91, lng: 116.41 })
})
