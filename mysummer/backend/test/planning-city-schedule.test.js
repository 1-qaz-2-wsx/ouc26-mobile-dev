const test = require('node:test')
const assert = require('node:assert/strict')
const { cityStayWindows, scheduleCityCandidates, optimizeCityCandidates } = require('../src/planning/city-schedule')
const provenance = { sourceType: 'mock', environment: 'test', sourceRef: 'fixture', fetchedAt: '2026-09-16T00:00:00Z' }
const at = (date, time) => `2026-09-${date}T${time}:00+08:00`
function fixture() {
  const city = { menuItemId: 'city', occurrenceId: 'visit-1', placeRef: { type: 'city' }, stayDays: 2,
    preferredWindow: { startAt: at(17, '08:00'), endAt: at(18, '20:00') } }
  const input = { startAt: at(17, '18:00'), endBy: at(18, '20:00'), timezone: 'Asia/Shanghai', menuItems: [city] }
  const candidate = { candidateId: 'poi', expansionItemId: 'expanded', placeRef: { provider: 'tencent-map', providerPlaceId: 'poi' } }
  const fact = { candidateId: 'poi', provenance, visitDurationMinutes: 90,
    openWindows: [{ startAt: at(17, '09:00'), endAt: at(17, '17:00'), provenance },
      { startAt: at(18, '09:00'), endAt: at(18, '17:00'), provenance }],
    inboundTransfers: [{ fromCandidateId: 'city-arrival', readyAt: at(17, '18:00'), durationMinutes: 30, provenance }] }
  const stay = cityStayWindows(input, ['city'])[0]
  return { input, stay, candidates: [candidate], facts: [fact] }
}
test('late arrival never produces a full first-day visit; next-day opening is used', () => {
  const result = scheduleCityCandidates(fixture())
  assert.equal(result.activities.length, 1)
  assert.equal(result.activities[0].date, '2026-09-18')
  assert.deepEqual(result.activities[0].sourceMenuItemIds, ['city'])
  assert.equal(result.activities[0].sourceOccurrenceId, 'visit-1')
  assert.equal(result.activities[0].status, 'needs_review')
})

test('city windows respect actual same-day and next-day scheduled arrivals', () => {
  const data = fixture()
  data.input.startAt = at(17, '08:00')
  const sameDay = cityStayWindows(data.input, ['city'], [{ itemId: 'city', startAt: at(17, '15:30') }])[0]
  assert.equal(Date.parse(sameDay.windows[0].startAt), Date.parse(at(17, '15:30')))
  const nextDay = cityStayWindows(data.input, ['city'], [{ itemId: 'city', startAt: at(18, '15:30') }])[0]
  assert.equal(nextDay.status, 'blocked', 'two requested city days cannot fit after next-day arrival')
  assert.deepEqual(nextDay.dates, ['2026-09-18'])
  assert.equal(Date.parse(nextDay.windows[0].startAt), Date.parse(at(18, '15:30')))
})
test('missing or ambiguous facts do not create activities', () => {
  const data = fixture()
  assert.equal(scheduleCityCandidates({ ...data, facts: [] }).activities.length, 0)
  assert.equal(scheduleCityCandidates({ ...data, facts: [data.facts[0], data.facts[0]] }).pending[0].code, 'POI_FACTS_AMBIGUOUS')
  data.facts[0].inboundTransfers.push(data.facts[0].inboundTransfers[0])
  assert.equal(scheduleCityCandidates(data).pending[0].code, 'POI_TRANSFER_FACTS_MISSING')
})
test('explicit attractions and their transfer reservations stay protected', () => {
  const data = fixture()
  data.input.menuItems.push({ menuItemId: 'explicit', placeRef: data.candidates[0].placeRef })
  assert.equal(scheduleCityCandidates(data).pending[0].code, 'EXPLICIT_PLACE_ALREADY_INCLUDED')
  data.input.menuItems.pop()
  const result = scheduleCityCandidates({ ...data, occupied: [{ startAt: at(18, '08:00'), endAt: at(18, '09:00') }] })
  assert.equal(result.activities.length, 0)
  assert.equal(result.pending[0].code, 'POI_TRANSFER_OVERLAPS_REQUIRED_ITEM')
})
test('city stay over trip bounds is blocked and repeated visits retain occurrences', () => {
  const data = fixture()
  data.input.menuItems[0].stayDays = 3
  assert.equal(cityStayWindows(data.input, ['city'])[0].status, 'blocked')
  data.input.menuItems[0].stayDays = 1
  data.input.menuItems.push({ ...data.input.menuItems[0], menuItemId: 'return', occurrenceId: 'visit-2' })
  const stays = cityStayWindows(data.input, ['city', 'return'])
  assert.deepEqual(stays.map(stay => stay.dates[0]), ['2026-09-17', '2026-09-18'])
  assert.equal(stays[1].sourceOccurrenceId, 'visit-2')
})

test('city-local optimization can improve feasible activity count even with explicit optimization disabled', () => {
  const data = fixture()
  data.input.optimizeOrder = false
  const a = data.candidates[0]
  const b = { ...a, candidateId: 'b', expansionItemId: 'expanded-b' }
  data.candidates = [b, a]
  const bFact = { ...data.facts[0], candidateId: 'b',
    inboundTransfers: [{ fromCandidateId: 'poi', durationMinutes: 20, provenance }] }
  data.facts.push(bFact)
  assert.equal(scheduleCityCandidates(data).activities.length, 1)
  const result = optimizeCityCandidates(data)
  assert.equal(result.activities.length, 2)
  assert.equal(result.optimization.orderChanged, true)
  assert.equal(result.optimization.globallyOptimal, false)
  assert.ok(result.optimization.evaluations <= 25)
  assert.deepEqual(optimizeCityCandidates(data), result)
})
