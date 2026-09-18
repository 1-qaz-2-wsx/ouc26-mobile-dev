const test = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../src/app')

test('planning capabilities route is safe to call before provider authorization', async (t) => {
  let upstreamCalls = 0
  const app = createApp({
    apiKey: '',
    model: 'test',
    apiUrl: 'https://mock.invalid/chat/completions',
    timeoutMs: 50,
    maxConcurrency: 1,
    maxUpstreamCalls: 1,
    maxOutputTokens: 64,
    juheTrainDailyLimit: 10,
    juheFlightDailyLimit: 3
  }, { fetchImpl: async () => { upstreamCalls += 1; throw new Error('provider must not be called') } })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => app.server.close(resolve)))
  const address = app.server.address()
  const response = await fetch(`http://127.0.0.1:${address.port}/planning/capabilities`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.providers.find((item) => item.id === 'juhe-train-817').status, 'not_configured')
  assert.equal(body.providers.find((item) => item.id === 'juhe-flight-818').enabled, false)
  assert.equal(body.providers.find((item) => item.id === 'hotel-provider').status, 'cooperation_required')
  assert.equal(upstreamCalls, 0)
})

test('planning request validation route normalizes input without calling providers', async (t) => {
  let upstreamCalls = 0
  const app = createApp({
    apiKey: '', model: 'test', apiUrl: 'https://mock.invalid/chat/completions', timeoutMs: 50,
    maxConcurrency: 1, maxUpstreamCalls: 1, maxOutputTokens: 64, juheTrainDailyLimit: 10, juheFlightDailyLimit: 3
  }, { fetchImpl: async () => { upstreamCalls += 1; throw new Error('provider must not be called') } })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => app.server.close(resolve)))
  const address = app.server.address()
  const response = await fetch(`http://127.0.0.1:${address.port}/planning/requests/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      schemaVersion: 'real-travel-plan-request.v1', clientRequestId: 'client-001',
      origin: { provider: 'tencent-map', providerPlaceId: 'origin', name: '长春', type: 'city', coordinate: { lat: 43.8, lng: 125.3 }, coordinateSystem: 'GCJ-02' },
      endDestination: { provider: 'tencent-map', providerPlaceId: 'destination', name: '哈尔滨', type: 'city', coordinate: { lat: 45.8, lng: 126.6 }, coordinateSystem: 'GCJ-02' },
      startAt: '2026-09-16T08:00:00+08:00', endBy: '2026-09-19T20:00:00+08:00', timezone: 'Asia/Shanghai',
      travelers: { adults: 1, children: [] }, budget: { amountMinor: null, currency: 'CNY', basis: 'party', includedCategories: [], strict: false },
      transportPreferences: { modes: ['train'], allowNightTrain: false }, lodgingPreferences: { rooms: 1 }, interests: [], pace: 'balanced',
      menuItems: [{ menuItemId: 'item-001', occurrenceId: 'occ-001', placeRef: { provider: 'tencent-map', providerPlaceId: 'place-1', name: '景点', type: 'poi', coordinate: { lat: 43.8, lng: 125.3 }, coordinateSystem: 'GCJ-02' }, role: 'must_visit', inputOrder: 0, required: true, stayRequirement: 'must_visit', visitDuration: { minutes: 60 }, preferredWindow: { startAt: '2026-09-17T09:00:00+08:00', endAt: '2026-09-17T18:00:00+08:00' } }],
      optimizeOrder: true, locks: [], confirmedConstraints: [], sourceInput: { type: 'manual_menu' }
    })
  })
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.match(body.inputHash, /^[a-f0-9]{64}$/)
  assert.equal(body.normalizedRequest.budget.currency, 'CNY')
  assert.equal(upstreamCalls, 0)
})
