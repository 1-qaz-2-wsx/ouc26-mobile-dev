const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPlatform } = require('../src/platform')
const req = { socket: { remoteAddress: 'test' }, headers: {} }
const cloudReq = { socket: { remoteAddress: 'cloud' }, headers: { 'x-wx-openid': 'private-openid', 'x-wx-appid': 'test-app' } }
const config = { tencentMapKey: 'test-key', wechatAppId: 'test-app', sessionSecret: 'x'.repeat(64) }
test('CloudBase identity creates a verifiable session without exposing OpenID', async () => {
  const app = createPlatform(config, async () => { throw new Error('login must not call code2session') })
  const result = await app.handle('/auth/wechat', {}, cloudReq)
  assert.equal(app.verify(result.token).id, result.user.id)
  assert.ok(result.expiresAt > Date.now())
  assert.ok(!JSON.stringify(result).includes('private-'))
  assert.throws(() => app.verify(result.token + 'x'))
  await assert.rejects(app.handle('/auth/wechat', {}, req), { status: 401 })
})
test('CloudBase identity rejects a mismatched Mini Program AppID', async () => {
  const app = createPlatform(config, async () => { throw new Error('unused') })
  await assert.rejects(app.handle('/auth/wechat', {}, { socket: { remoteAddress: 'other' }, headers: { 'x-wx-openid': 'openid', 'x-wx-appid': 'other-app' } }), { status: 403 })
})
test('Map POI requires a unique exact nearby match', async () => {
  const app = createPlatform(config, async () => ({ ok: true, json: async () => ({ status: 0, data: [{ id: '1', title: '其他地点', location: { lat: 39, lng: 116 } }] }) }))
  const result = await app.handle('/maps/poi', { name: '目标', latitude: 39, longitude: 116 }, req)
  assert.equal(result.place, null)
  assert.equal(result.recognitionStatus, 'candidate')
  assert.equal(result.candidates[0].recognitionStatus, 'candidate')
  await assert.rejects(app.handle('/maps/poi', { name: '目标', latitude: null, longitude: 116 }, req), { status: 400 })
})
test('Bare city names fall back to a nearby administrative result', async () => {
  const app = createPlatform(config, async url => {
    const u = new URL(url)
    if (u.pathname.includes('district')) return { ok: true, json: async () => ({ status: 0, result: [[{ id: '230100', name: '哈尔滨', fullname: '哈尔滨市', location: { lat: 45.75, lng: 126.64 } }]] }) }
    return { ok: true, json: async () => ({ status: 0, data: [] }) }
  })
  const result = await app.handle('/maps/poi', { name: '哈尔滨', latitude: 45.75, longitude: 126.64 }, req)
  assert.equal(result.place.name, '哈尔滨市')
  assert.equal(result.place.isCity, true)
  assert.equal(result.place.isAdministrative, true)
  assert.equal(result.place.category, '城市')
  assert.equal(result.place.objectType, 'administrative')
  assert.equal(result.place.providerKind, 'district')
  assert.equal(result.place.planningRole, 'destination_area')
  assert.equal(result.place.canAdd, true)
})

test('Bare city names do not depend on a city suffix list', async () => {
  const cities = [
    ['北京', '北京市', '110000', 39.90, 116.40],
    ['上海', '上海市', '310000', 31.23, 121.47],
    ['长春', '长春市', '220100', 43.88, 125.32],
    ['哈尔滨', '哈尔滨市', '230100', 45.75, 126.64],
    ['沈阳', '沈阳市', '210100', 41.80, 123.43]
  ]
  for (const [name, fullname, id, latitude, longitude] of cities) {
    const app = createPlatform(config, async url => {
      const u = new URL(url)
      if (u.pathname.includes('district')) return { ok: true, json: async () => ({ status: 0, result: [[{ id, name, fullname, location: { lat: latitude, lng: longitude } }]] }) }
      return { ok: true, json: async () => ({ status: 0, data: [] }) }
    })
    const result = await app.handle('/maps/poi', { name, latitude, longitude }, req)
    assert.equal(result.place.name, fullname)
    assert.equal(result.place.objectType, 'administrative')
    assert.equal(result.place.planningRole, 'destination_area')
  }
})

test('Administrative province is returned as a choose-city object, not a POI', async () => {
  const app = createPlatform(config, async url => {
    const u = new URL(url)
    if (u.pathname.includes('district')) return { ok: true, json: async () => ({ status: 0, result: [[{ id: '440000', name: '广东', fullname: '广东省', location: { lat: 23.13, lng: 113.26 } }]] }) }
    if (u.pathname.includes('geocoder')) return { ok: true, json: async () => ({ status: 0, result: { address_components: { province: '广东省', city: '广州市', district: '天河区' } } }) }
    return { ok: true, json: async () => ({ status: 0, data: [] }) }
  })
  const result = await app.handle('/maps/poi', { name: '广东', latitude: 23.13, longitude: 113.26 }, req)
  assert.equal(result.place.objectType, 'administrative')
  assert.equal(result.place.providerKind, 'district')
  assert.equal(result.place.planningRole, 'choose_city')
  assert.equal(result.place.canAdd, false)
  assert.equal(result.place.isProvince, true)
  assert.equal(result.place.province, '广东省')
})

test('Exact POI keeps its actual category and uses the POI detail contract', async () => {
  const app = createPlatform(config, async url => {
    const u = new URL(url)
    if (u.pathname.includes('detail')) return { ok: true, json: async () => ({ status: 0, data: [{ id: 'poi-1', title: '中央车站', address: '车站路 1 号', category: '交通设施;火车站', type: 1, location: { lat: 39, lng: 116 }, ad_info: { province: '北京市', city: '北京市', district: '东城区' } }] }) }
    return { ok: true, json: async () => ({ status: 0, data: [{ id: 'poi-1', title: '中央车站', location: { lat: 39, lng: 116 } }] }) }
  })
  const result = await app.handle('/maps/poi', { name: '中央车站', latitude: 39, longitude: 116 }, req)
  assert.equal(result.place.objectType, 'poi')
  assert.equal(result.place.providerKind, 'poi')
  assert.equal(result.place.category, '交通设施;火车站')
  assert.equal(result.place.categoryGroup, '人文')
  assert.equal(result.place.city, '北京市')
  assert.equal(result.recognitionStatus, 'confirmed')
})
test('City search returns city and attraction results, not keyword suggestions', async () => {
  const app = createPlatform(config, async url => {
    const u = new URL(url)
    assert.equal(u.searchParams.get('key'), 'test-key')
    if (u.pathname.includes('geocoder')) return { ok: true, json: async () => ({ status: 0, result: { address_components: { province: '北京市', city: '北京市', district: '东城区' } } }) }
    const data = u.pathname.includes('district') ? { status: 0, result: [[{ id: '110000', name: '北京', fullname: '北京市', location: { lat: 39.9, lng: 116.4 } }]] } : { status: 0, data: [{ id: '1', title: '故宫', location: { lat: 39.92, lng: 116.4 } }] }
    if (!u.pathname.includes('district')) assert.equal(u.searchParams.get('keyword'), '景点')
    return { ok: true, json: async () => data }
  })
  const result = await app.handle('/maps/search', { keyword: '北京' }, req)
  assert.equal(result.places[0].isCity, true)
  assert.equal(result.places[0].province, '北京市')
  assert.equal(result.places[1].name, '故宫')
})

// ===== B4-1 queryNearby =====

function nearbyHotels() {
  return [
    { id: '1001', title: '汉庭酒店(王府井店)', address: '北京市东城区王府井大街 1 号', category: '住宿服务;宾馆酒店', type: 1, location: { lat: 39.91, lng: 116.41 }, ad_info: { province: '北京市', city: '北京市', district: '东城区', adcode: '110101' } },
    { id: '1002', title: '如家酒店(东单店)', address: '北京市东城区东单北大街 2 号', category: '住宿服务;宾馆酒店', type: 1, location: { lat: 39.92, lng: 116.42 }, ad_info: { province: '北京市', city: '北京市', district: '东城区', adcode: '110101' } }
  ]
}

test('Nearby search calls place/v1/search with an exact nearby boundary', async () => {
  const urls = []
  const app = createPlatform(config, async url => {
    urls.push(url)
    return { ok: true, json: async () => ({ status: 0, data: nearbyHotels() }) }
  })
  const result = await app.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店' })
  assert.equal(urls.length, 1)
  const u = new URL(urls[0])
  assert.equal(u.hostname, 'apis.map.qq.com')
  assert.ok(u.pathname.endsWith('/ws/place/v1/search'))
  assert.equal(u.searchParams.get('boundary'), 'nearby(39,116,3000,0)')
  assert.equal(u.searchParams.get('keyword'), '酒店')
  assert.equal(u.searchParams.get('page_size'), '20')
  assert.equal(u.searchParams.get('key'), 'test-key')
  assert.deepEqual(Object.keys(result).sort(), ['places', 'radius', 'source'])
  assert.equal(result.source, '腾讯位置服务')
  assert.equal(result.radius, 3000)
  assert.deepEqual(result.places.map(p => p.name), ['汉庭酒店(王府井店)', '如家酒店(东单店)'])
  assert.deepEqual(result.places.map(p => p.id), ['qq-1001', 'qq-1002'])
  assert.equal(result.places[0].providerKind, 'poi')
  assert.equal(result.places[0].objectType, 'poi')
  assert.equal(result.places[0].providerId, '1001')
  assert.equal(result.places[0].address, '北京市东城区王府井大街 1 号')
  assert.equal(result.places[0].city, '北京市')
  assert.equal(result.places[0].district, '东城区')
  assert.equal(result.places[0].adcode, '110101')
  assert.equal(result.places[0].category, '住宿服务;宾馆酒店')
  assert.equal(result.places[0].latitude, 39.91)
  assert.equal(result.places[0].longitude, 116.41)
  assert.equal(result.places[0].source, '腾讯位置服务')
  assert.ok(!JSON.stringify(result).includes('ad_info'))
})

test('Nearby search honours an explicit valid radius', async () => {
  const urls = []
  const app = createPlatform(config, async url => {
    urls.push(url)
    return { ok: true, json: async () => ({ status: 0, data: nearbyHotels() }) }
  })
  const result = await app.queryNearby({ location: { lat: 45.75, lng: 126.64 }, keyword: '住宿', radius: 800 })
  assert.equal(result.radius, 800)
  const u = new URL(urls[0])
  assert.equal(u.searchParams.get('boundary'), 'nearby(45.75,126.64,800,0)')
  assert.equal(u.searchParams.get('keyword'), '住宿')
  const maxed = await app.queryNearby({ location: { lat: 45.75, lng: 126.64 }, keyword: '住宿', radius: 5000 })
  assert.equal(maxed.radius, 5000)
  assert.equal(new URL(urls[1]).searchParams.get('boundary'), 'nearby(45.75,126.64,5000,0)')
})

test('Nearby search rejects an out-of-range or malformed radius without fetching', async () => {
  let calls = 0
  const app = createPlatform(config, async () => { calls += 1; return { ok: true, json: async () => ({ status: 0, data: [] }) } })
  for (const radius of [5001, 6000, 0, -100, 3000.5, '3000', Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(app.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店', radius }), { status: 400 })
  }
  assert.equal(calls, 0)
})

test('Nearby search rejects invalid coordinates without fetching', async () => {
  let calls = 0
  const app = createPlatform(config, async () => { calls += 1; return { ok: true, json: async () => ({ status: 0, data: [] }) } })
  const bad = [
    undefined,
    null,
    {},
    { lat: 39 },
    { lat: '39', lng: 116 },
    { lat: 91, lng: 116 },
    { lat: 39, lng: 181 },
    { lat: Number.NaN, lng: 116 },
    [39, 116]
  ]
  for (const location of bad) {
    await assert.rejects(app.queryNearby({ location, keyword: '酒店' }), { status: 400 })
  }
  await assert.rejects(app.queryNearby({ keyword: '酒店' }), { status: 400 })
  await assert.rejects(app.queryNearby(), { status: 400 })
  assert.equal(calls, 0)
})

test('Nearby search rejects an empty or non-string keyword without fetching', async () => {
  let calls = 0
  const app = createPlatform(config, async () => { calls += 1; return { ok: true, json: async () => ({ status: 0, data: [] }) } })
  for (const keyword of ['', '   ', undefined, null, 123, ['酒店']]) {
    await assert.rejects(app.queryNearby({ location: { lat: 39, lng: 116 }, keyword }), { status: 400 })
  }
  assert.equal(calls, 0)
})

test('Nearby search treats an empty result as no places, not as an error', async () => {
  const app = createPlatform(config, async () => ({ ok: true, json: async () => ({ status: 0, data: [] }) }))
  const empty = await app.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店' })
  assert.deepEqual(empty.places, [])
  assert.equal(empty.radius, 3000)
  const noResultStatus = createPlatform(config, async () => ({ ok: true, json: async () => ({ status: 347, message: '无结果' }) }))
  const none = await noResultStatus.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店' })
  assert.deepEqual(none.places, [])
  assert.equal(none.source, '腾讯位置服务')
})

test('Nearby search keeps the existing truthful error for a non-zero Tencent status', async () => {
  const app = createPlatform(config, async () => ({ ok: true, json: async () => ({ status: 111, message: '签名校验失败' }) }))
  await assert.rejects(app.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店' }), { status: 502 })
  const quota = createPlatform(config, async () => ({ ok: true, json: async () => ({ status: 120, message: '此key每日调用量已达到上限' }) }))
  await assert.rejects(quota.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店' }), { status: 502 })
  const http = createPlatform(config, async () => ({ ok: false, status: 503, json: async () => ({}) }))
  await assert.rejects(http.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店' }), { status: 502 })
})

test('Nearby search needs a configured map key', async () => {
  const app = createPlatform({ wechatAppId: 'test-app', sessionSecret: 'x'.repeat(64) }, async () => { throw new Error('must not fetch without a key') })
  await assert.rejects(app.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店' }), { status: 503 })
})

test('Nearby search drops unusable entries instead of failing the whole search', async () => {
  const app = createPlatform(config, async () => ({
    ok: true,
    json: async () => ({ status: 0, data: [nearbyHotels()[0], { id: '2002', title: '缺坐标酒店', location: null }, null, { id: '2003', title: '坐标非法', location: { lat: 'abc', lng: 116 } }] })
  }))
  const result = await app.queryNearby({ location: { lat: 39, lng: 116 }, keyword: '酒店' })
  assert.deepEqual(result.places.map(p => p.name), ['汉庭酒店(王府井店)'])
})
