const test = require('node:test')
const assert = require('node:assert/strict')
const { buildJourneyDays } = require('../src/planning/journey-days')
function fixture() {
  return { plan: { inputSnapshot: { startAt: '2026-09-17T08:00:00+08:00', endBy: '2026-09-18T20:00:00+08:00',
    timezone: 'Asia/Shanghai', travelers: { adults: 2, children: [8] }, lodgingPreferences: { rooms: 2 } },
    items: [{ itemId: 'a', placeRef: { name: '景点' }, startAt: '2026-09-17T10:00:00+08:00', endAt: '2026-09-17T11:00:00+08:00', sourceMenuItemIds: ['a'] }],
    legs: [{ legId: 'night-train', mode: 'train', status: 'available', from: { name: '甲站' }, to: { name: '乙站' },
      departureAt: '2026-09-17T21:00:00+08:00', arrivalAt: '2026-09-18T07:00:00+08:00' }] } }
}
test('cross-day transport appears on both local dates and night-train lodging is conditional', () => {
  const result = buildJourneyDays(fixture())
  assert.equal(result.days.length, 2)
  assert.equal(result.days[0].transport[0].continuesIntoNextDay, true)
  assert.equal(result.days[1].transport[0].continuesFromPreviousDay, true)
  assert.equal(result.lodgingNeeds[0].status, 'night_train_rest_pending_confirmation')
  assert.equal(result.lodgingNeeds[0].rooms, 2)
  assert.equal(result.confirmedHotelNights, 0)
  assert.equal(result.lodgingNeeds[0].amountMinor, null)
})
test('partial night train does not silently remove hotel need; user choice is preserved', () => {
  const data = fixture()
  data.plan.legs[0].arrivalAt = '2026-09-18T03:00:00+08:00'
  assert.equal(buildJourneyDays(data).lodgingNeeds[0].status, 'needs_review')
  data.plan.inputSnapshot.lodgingPreferences.required = false
  assert.equal(buildJourneyDays(data).lodgingNeeds[0].status, 'not_required_by_user')
  assert.equal(buildJourneyDays(data).requestedNights, 0)
})
test('transport overlapping explicit or expanded activities is a real conflict', () => {
  const data = fixture()
  data.plan.items[0].startAt = '2026-09-18T06:00:00+08:00'
  data.plan.items[0].endAt = '2026-09-18T08:00:00+08:00'
  assert.equal(buildJourneyDays(data).conflicts[0].code, 'ACTIVITY_TRANSPORT_OVERLAP')
})
