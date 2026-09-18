const test = require('node:test')
const assert = require('node:assert/strict')
const { createDailyBudget, createJuheTrainProvider, normalizeInput, normalizeRow } = require('../src/planning/providers/juhe-train')
const { createPlanningService } = require('../src/planning/service')

const fixedNow = Date.parse('2026-09-15T04:00:00.000Z')

test('train query enforces the provider date window before making a request', () => {
  const input = normalizeInput({ departureStation: '长春', arrivalStation: '南岔', date: '2026-10-01' }, fixedNow)
  assert.equal(input.outOfWindow, true)
  const provider = createJuheTrainProvider({ config: { juheTrainEnabled: true, juheTrainKey: 'not-real', juheTrainDailyLimit: 10 }, clock: () => fixedNow, fetchImpl: async () => { throw new Error('must not call') } })
  return provider.search({ departureStation: '长春', arrivalStation: '南岔', date: '2026-10-01' }).then((result) => assert.equal(result.status, 'out_of_window'))
})

test('train adapter posts the key in the form body and normalizes schedule, price, and availability', async () => {
  let request
  const provider = createJuheTrainProvider({
    config: { juheTrainEnabled: true, juheTrainKey: 'secret-not-real', juheTrainDailyLimit: 10, juheTrainEnvironment: 'test' },
    clock: () => fixedNow,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(JSON.stringify({ error_code: 0, result: [{
        train_no: 'K999', departure_station: '长春', arrival_station: '南岔', departure_station_code: 'CC', arrival_station_code: 'NC',
        departure_time: '23:40', arrival_time: '02:10', duration: '02:30', enable_booking: 'Y',
        prices: [{ seat_name: '硬卧', seat_type_code: '3', price: 120, num: '有' }], train_flags: ['测试列车']
      }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  const result = await provider.search({ departureStation: '长春', arrivalStation: '南岔', date: '2026-09-16', seatTypeCode: '3' })
  assert.equal(result.status, 'available')
  assert.equal(request.url, 'https://apis.juhe.cn/fapigw/train/query')
  assert.equal(request.options.method, 'POST')
  assert.match(request.options.body, /key=secret-not-real/)
  assert.equal(result.quotes[0].serviceNo, 'K999')
  assert.equal(result.quotes[0].arrivalDate, '2026-09-17')
  assert.equal(result.quotes[0].arrivalDateSource, 'derived_from_duration')
  assert.equal(result.quotes[0].amountMinor, 12000)
  assert.equal(result.quotes[0].availability, 'available')
  assert.equal(result.quotes[0].provenance.sourceType, 'live')
})

test('train daily guard refuses the 11th configured call without network access', async () => {
  let calls = 0
  const budget = createDailyBudget(10, () => fixedNow)
  const provider = createJuheTrainProvider({
    config: { juheTrainEnabled: true, juheTrainKey: 'not-real', juheTrainDailyLimit: 10 },
    clock: () => fixedNow,
    budget,
    fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ error_code: 0, result: [] }), { status: 200 }) }
  })
  const input = { departureStation: '长春', arrivalStation: '南岔', date: '2026-09-16' }
  for (let index = 0; index < 10; index += 1) await provider.search(input)
  const result = await provider.search(input)
  assert.equal(result.status, 'budget_exhausted')
  assert.equal(calls, 10)
})

test('capabilities expose flight disabled and hotel cooperation-required without calling either provider', async () => {
  const service = createPlanningService({ config: { juheTrainDailyLimit: 10, juheFlightDailyLimit: 3 } })
  const result = await service.capabilities()
  const flight = result.providers.find((item) => item.id === 'juhe-flight-818')
  const hotel = result.providers.find((item) => item.id === 'hotel-provider')
  assert.equal(flight.enabled, false)
  assert.equal(flight.status, 'disabled')
  assert.equal(hotel.status, 'cooperation_required')
  assert.equal(result.notes.some((item) => item.includes('航班当前禁用')), true)
})

test('train normalization preserves null and zero prices and never treats enable_booking=N as bookable', () => {
  const input = normalizeInput({ departureStation: '长春', arrivalStation: '南岔', date: '2026-09-16' }, fixedNow)
  const unknownPrice = normalizeRow({
    train_no: 'LONG-25', departure_station: '长春', arrival_station: '南岔', departure_time: '08:00', arrival_time: '09:00', duration: '25:00', enable_booking: 'Y',
    prices: [{ seat_name: '硬卧', seat_type_code: '3', price: null, num: '有' }]
  }, input, '2026-09-15T04:00:00.000Z', 'test')
  assert.equal(unknownPrice.amountMinor, null)
  assert.equal(unknownPrice.availability, 'available')
  assert.equal(unknownPrice.arrivalDate, '2026-09-17')
  assert.equal(unknownPrice.arrivalDateSource, 'derived_from_duration')
  assert.equal(unknownPrice.durationMinutes, 1500)

  const zeroPrice = normalizeRow({
    train_no: 'ZERO', departure_time: '08:00', arrival_time: '09:00', duration: '01:00', enable_booking: 'Y',
    prices: [{ seat_name: '二等座', seat_type_code: 'O', price: 0, num: '有' }]
  }, input, '2026-09-15T04:00:00.000Z', 'test')
  assert.equal(zeroPrice.amountMinor, 0)
  assert.equal(zeroPrice.availability, 'available')

  const notBookable = normalizeRow({
    train_no: 'NO-BOOK', departure_time: '08:00', arrival_time: '09:00', duration: '01:00', enable_booking: 'N',
    prices: [{ seat_name: '二等座', seat_type_code: 'O', price: 120, num: '有' }]
  }, input, '2026-09-15T04:00:00.000Z', 'test')
  assert.equal(notBookable.serviceCanBook, false)
  assert.equal(notBookable.availability, 'unknown')
  assert.equal(notBookable.status, 'unknown')
  assert.equal(notBookable.availabilityReason, 'service_not_bookable')
})

test('train normalization handles 49-hour duration and rejects duration/time conflicts as unknown', () => {
  const input = normalizeInput({ departureStation: '长春', arrivalStation: '南岔', date: '2026-09-16' }, fixedNow)
  const longTrip = normalizeRow({ train_no: 'LONG-49', departure_time: '08:00', arrival_time: '09:00', duration: '49:00', enable_booking: 'Y', prices: [{ price: 1, num: '有' }] }, input, '2026-09-15T04:00:00.000Z', 'test')
  assert.equal(longTrip.arrivalDate, '2026-09-18')
  assert.equal(longTrip.arrivalDateSource, 'derived_from_duration')
  assert.equal(longTrip.durationMinutes, 2940)

  const conflict = normalizeRow({ train_no: 'CONFLICT', departure_time: '08:00', arrival_time: '10:00', duration: '25:00', enable_booking: 'Y', prices: [{ price: 1, num: '有' }] }, input, '2026-09-15T04:00:00.000Z', 'test')
  assert.equal(conflict.arrivalDate, null)
  assert.equal(conflict.arrivalDateSource, 'conflict')
  assert.equal(conflict.availability, 'unknown')
  assert.equal(conflict.availabilityReason, 'ARRIVAL_TIME_DURATION_CONFLICT')
})
