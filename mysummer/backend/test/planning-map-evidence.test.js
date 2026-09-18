const test = require('node:test')
const assert = require('node:assert/strict')
const { createPlanningService } = require('../src/planning/service')
const service = createPlanningService({ fetchImpl: () => { throw new Error('network forbidden') } })
const poi = { providerId: '1', name: '站点', objectType: 'poi', latitude: 43, longitude: 125, category: '交通设施;火车站' }
const evidence = places => ({ places, fetchedAt: '2026-09-15T10:00:00Z', environment: 'test', sourceRef: '/maps/search' })

test('map evidence keeps stable identity without inventing station codes or prices', () => {
  const result = service.adaptMapEvidence(evidence([poi]))
  assert.equal(result.candidates[0].kind, 'rail_station')
  assert.equal(result.candidates[0].transportStationCode, null)
  assert.equal(result.candidates[0].ticketQuote, null)
  assert.equal(result.candidates[0].provenance.environment, 'test')
  assert.equal(result.complete, false)
  assert.deepEqual(service.adaptMapEvidence(evidence([poi])).candidates, result.candidates)
})

test('map evidence rejects invalid and duplicate identities and unconfirmed provinces', () => {
  const result = service.adaptMapEvidence(evidence([poi, poi, { ...poi, providerId: '' },
    { ...poi, latitude: null }, { ...poi, isProvince: true }]))
  assert.equal(result.candidates.length, 1)
  assert.equal(result.rejected.length, 4)
  assert.throws(() => service.adaptMapEvidence({ places: [poi] }))
})

test('administrative and POI identifiers do not collide; cities are not attractions', () => {
  const result = service.adaptMapEvidence(evidence([poi, { ...poi, objectType: 'administrative' }]))
  assert.equal(result.candidates.length, 2)
  assert.equal(result.candidates[1].kind, 'destination_area')
  assert.notEqual(result.candidates[0].candidateId, result.candidates[1].candidateId)
})
