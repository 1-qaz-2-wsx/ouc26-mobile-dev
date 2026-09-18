const test = require('node:test')
const assert = require('node:assert/strict')
const { createLiveEvidenceReaders } = require('../src/planning/live-evidence')
test('map session budget counts every provider attempt and stops before excess requests', async () => {
  let calls = 0
  const readers = createLiveEvidenceReaders({ config: { tencentMapKey: 'fixture-key' }, mapLimit: 1,
    fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ status: 0, result: [] }) } } })
  await assert.rejects(readers.evidenceForCity({ placeRef: { name: '城市' }, signal: new AbortController().signal }))
  assert.equal(calls, 1)
  assert.equal(readers.usage().map, 1)
  await assert.rejects(readers.evidenceForCity({ placeRef: { name: '城市' }, signal: new AbortController().signal }))
  assert.equal(calls, 1)
})
test('cancelled evidence request performs no provider fetch', async () => {
  const readers = createLiveEvidenceReaders({ config: {}, mapLimit: 1, fetchImpl: async () => { throw new Error('must not fetch') } })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readers.evidenceForCity({ placeRef: { name: '城市' }, signal: controller.signal }))
  assert.equal(readers.usage().map, 0)
})

test('live direction wiring shares the map quota and never substitutes driving for train', async () => {
  let calls = 0
  const readers = createLiveEvidenceReaders({ config: { tencentMapKey: 'fixture-key' }, mapLimit: 1,
    fetchImpl: async url => { calls++; assert.match(url, /direction\/v1\/driving\//); return { ok: true, json: async () => ({ status: 0,
      result: { routes: [{ mode: 'DRIVING', duration: 20, distance: 100, restriction: { status: 0 }, polyline: [43, 125, 0, 100] }] } }) } } })
  const place = id => ({ provider: 'tencent-map', providerPlaceId: id, coordinateSystem: 'GCJ-02', coordinate: { lat: 43, lng: 125 } })
  const args = { demands: [{ demandId: 'a-b', from: place('a'), to: place('b'), readyAt: '2026-09-17T08:00:00+08:00', arriveBy: '2026-09-17T18:00:00+08:00' }],
    timezone: 'Asia/Shanghai', signal: new AbortController().signal }
  assert.deepEqual(await readers.evidenceForRoutes({ ...args, transportPreferences: { modes: ['train'] } }), [])
  assert.equal(calls, 0)
  const rows = await readers.evidenceForRoutes({ ...args, transportPreferences: { modes: ['car'] } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].legs[0].provenance.environment, 'production')
  assert.equal(rows[0].legs[0].status, 'unknown')
  await readers.evidenceForRoutes({ ...args, transportPreferences: { modes: ['car'] } })
  assert.equal(calls, 1)
  assert.equal(readers.usage().map, 1)
})

test('a flight demand stays disabled and never degrades into a train query', async () => {
  let calls = 0
  const readers = createLiveEvidenceReaders({ config: { juheTrainKey: 'fixture-key', juheTrainEnabled: true }, trainLimit: 2,
    fetchImpl: async () => { calls++; throw new Error('must not fetch') } })
  const signal = new AbortController().signal
  const flight = { mode: 'flight', serviceDate: '2026-09-20', departure: { name: '长春' }, arrival: { name: '哈尔滨' } }
  assert.deepEqual(await readers.evidenceForTransport({ demand: flight, signal }), { status: 'disabled', quotes: [] })
  assert.equal(calls, 0)
  assert.equal(readers.usage().train, 0)
  // 同一 reader 的火车需求仍会真实尝试并计入额度，证明上面的守卫不是把查询整体关掉。
  const serviceDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await assert.rejects(readers.evidenceForTransport({ demand: { mode: 'train', serviceDate, departure: { name: '长春' }, arrival: { name: '哈尔滨' } }, signal }),
    { code: 'PROVIDER_NETWORK_ERROR' })
  assert.equal(calls, 1)
  assert.equal(readers.usage().train, 1)
})

// ---------------------------------------------------------------- B4-2 附近住宿地点证据

function hotelRow(id, title, lat, lng) {
  return { id, title, address: `${title}市人民大街 1 号`, category: '住宿服务;宾馆酒店', location: { lat, lng },
    ad_info: { province: '吉林省', city: '长春市', district: '朝阳区', adcode: '220102' } }
}

function mapFetch(rows) {
  return async () => ({ ok: true, json: async () => ({ status: 0, data: typeof rows === 'function' ? rows() : rows }) })
}

function lodgingReaders(fetchImpl, limits = {}) {
  return createLiveEvidenceReaders({ config: { tencentMapKey: 'fixture-key' }, mapLimit: limits.map === undefined ? 4 : limits.map,
    trainLimit: limits.train === undefined ? 0 : limits.train, fetchImpl })
}

test('lodging evidence queries nearby accommodation POIs through the shared map platform', async () => {
  const urls = []
  const readers = lodgingReaders(async url => {
    urls.push(url)
    return { ok: true, json: async () => ({ status: 0, data: [hotelRow('1001', '汉庭酒店', 43.9, 125.32)] }) }
  })
  const result = await readers.evidenceForLodging({ location: { lat: 43.88, lng: 125.3 }, signal: new AbortController().signal })
  assert.equal(urls.length, 1)
  const url = new URL(urls[0])
  assert.ok(url.pathname.endsWith('/ws/place/v1/search'))
  assert.equal(url.searchParams.get('keyword'), '酒店')
  assert.equal(url.searchParams.get('boundary'), 'nearby(43.88,125.3,3000,0)')
  assert.equal(url.searchParams.get('page_size'), '20')
  assert.equal(url.searchParams.get('key'), 'fixture-key')
  assert.equal(result.status, 'available')
  assert.equal(result.options.length, 1)
  assert.equal(result.options[0].providerPlaceId, '1001')
  assert.deepEqual(result.options[0].coordinate, { lat: 43.9, lng: 125.32 })
  assert.equal(result.environment, 'production')
  assert.equal(result.sourceRef, 'tencent-map:place/v1/search')
  // 住宿检索自动计入 map 额度，且只计一次。
  assert.equal(readers.usage().map, 1)
  // 地点证据里不得出现任何会被读成“有房/有价”的字段。
  const serialized = JSON.stringify(result).toLowerCase()
  for (const token of ['price', 'amountminor', 'inventory', 'roomtype', 'availability', 'bookable', 'url', 'deeplink', 'bookingtarget']) {
    assert.equal(serialized.includes(token), false, `住宿证据不得包含 ${token}`)
  }
})

test('lodging evidence reserves the map quota exactly once per search', async () => {
  let fetches = 0
  const readers = lodgingReaders(async () => { fetches++; return { ok: true, json: async () => ({ status: 0, data: [hotelRow('1001', '汉庭酒店', 43.9, 125.32)] }) } })
  await readers.evidenceForLodging({ location: { lat: 43.88, lng: 125.3 }, signal: new AbortController().signal })
  assert.equal(fetches, 1)
  assert.equal(readers.usage().map, 1, '一次住宿检索只能占用一次 map 额度')
  await readers.evidenceForLodging({ location: { lat: 43.88, lng: 125.3 }, signal: new AbortController().signal })
  assert.equal(fetches, 2)
  assert.equal(readers.usage().map, 2)
})

test('lodging evidence never retries with a second keyword', async () => {
  const urls = []
  const readers = lodgingReaders(async url => {
    urls.push(url)
    return { ok: true, json: async () => ({ status: 0, data: [] }) }
  })
  const signal = new AbortController().signal
  const empty = await readers.evidenceForLodging({ location: { lat: 43.88, lng: 125.3 }, signal })
  assert.equal(empty.status, 'no_results')
  assert.deepEqual(empty.options, [])
  assert.equal(urls.length, 1, '酒店查不到时不得自动改查第二个关键词')
  // 调用方显式指定关键词时按原样执行，一次调用仍只查一个关键词。
  const explicit = await readers.evidenceForLodging({ location: { lat: 43.88, lng: 125.3 }, keyword: '住宿', signal })
  assert.equal(explicit.status, 'no_results')
  assert.equal(urls.length, 2)
  assert.deepEqual(urls.map(url => new URL(url).searchParams.get('keyword')), ['酒店', '住宿'])
})

test('a cancelled lodging request performs no provider fetch', async () => {
  let fetches = 0
  const readers = lodgingReaders(async () => { fetches++; return { ok: true, json: async () => ({ status: 0, data: [hotelRow('1', 'H', 43, 125)] }) } })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readers.evidenceForLodging({ location: { lat: 43, lng: 125 }, signal: controller.signal }))
  assert.equal(fetches, 0)
  assert.equal(readers.usage().map, 0)
})

test('lodging evidence re-checks the signal after a completed query', async () => {
  const controller = new AbortController()
  const readers = lodgingReaders(async () => {
    controller.abort()
    return { ok: true, json: async () => ({ status: 0, data: [hotelRow('1', 'H', 43, 125)] }) }
  })
  await assert.rejects(readers.evidenceForLodging({ location: { lat: 43, lng: 125 }, signal: controller.signal }))
  // 请求确实发生过（额度被计），但结果不允许被当成有效证据。
  assert.equal(readers.usage().map, 1)
})

test('an exhausted map quota stays a machine error instead of becoming no_results', async () => {
  let fetches = 0
  const readers = lodgingReaders(async () => { fetches++; return { ok: true, json: async () => ({ status: 0, data: [hotelRow('1', 'H', 43, 125)] }) } }, { map: 1 })
  const signal = new AbortController().signal
  const first = await readers.evidenceForLodging({ location: { lat: 43, lng: 125 }, signal })
  assert.equal(first.status, 'available')
  assert.equal(readers.usage().map, 1)
  await assert.rejects(readers.evidenceForLodging({ location: { lat: 43, lng: 125 }, signal }), { code: 'PROVIDER_SESSION_LIMIT' })
  assert.equal(fetches, 1, '额度用尽后不得再发起请求')
  // 额度耗尽是一次性终态：不理解成“没查到”，也不理解成“供应商不可用”。
  await assert.rejects(readers.evidenceForLodging({ location: { lat: 43, lng: 125 }, signal }), { code: 'PROVIDER_SESSION_LIMIT' })
  assert.equal(fetches, 1)
})

test('a map failure other than the quota stays a plain provider failure', async () => {
  const readers = lodgingReaders(async () => ({ ok: true, json: async () => ({ status: 120, message: '此key每日调用量已达到上限' }) }))
  await assert.rejects(readers.evidenceForLodging({ location: { lat: 43, lng: 125 }, signal: new AbortController().signal }))
  const invalid = await lodgingReaders(mapFetch([])).evidenceForLodging({ location: null, signal: new AbortController().signal })
    .then(() => null, error => error)
  assert.equal(invalid.status, 400, '非法坐标在发起请求之前就被拒绝')
})
