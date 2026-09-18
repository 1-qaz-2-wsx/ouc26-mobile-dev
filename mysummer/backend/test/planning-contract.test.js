const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizePlanRequest } = require('../src/planning/normalizer')
const { createPlanningJobService } = require('../src/planning/job-service')
const { inputHash } = require('../src/planning/schema')

test('timeout completes even when the executor ignores abort and late results cannot overwrite failure', async () => {
  let finish
  const service = createPlanningJobService({ timeoutMs: 10, executor: () => new Promise(resolve => { finish = resolve }) })
  const created = service.create({ ownerId: 'a', idempotencyKey: 'stuck', request: {} })
  const done = await service.run({ ownerId: 'a', jobId: created.job.id })
  assert.equal(done.error.code, 'PLANNING_TIMEOUT')
  finish({ partial: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(service.get({ ownerId: 'a', jobId: created.job.id }).taskStatus, 'failed')
})

test('expired lease does not start a second executor in the same process', async () => {
  let time = 0, calls = 0, finish
  const service = createPlanningJobService({ clock: () => time, leaseMs: 10, executor: () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  const created = service.create({ ownerId: 'a', idempotencyKey: 'lease', request: {} })
  const first = service.run({ ownerId: 'a', jobId: created.job.id })
  time = 20
  assert.equal((await service.run({ ownerId: 'a', jobId: created.job.id })).taskStatus, 'running')
  assert.equal(calls, 1)
  finish({})
  await first
})

function place(providerPlaceId, name) {
  return {
    provider: 'tencent-map',
    providerPlaceId,
    name,
    type: 'city',
    coordinate: { lat: 43.8171, lng: 125.3235 },
    coordinateSystem: 'GCJ-02',
    adcode: '220100'
  }
}

function request(overrides = {}) {
  return {
    schemaVersion: 'real-travel-plan-request.v1',
    clientRequestId: 'client-001',
    origin: place('origin', '长春'),
    endDestination: place('destination', '哈尔滨'),
    startAt: '2026-09-16T08:00:00+08:00',
    endBy: '2026-09-19T20:00:00+08:00',
    timezone: 'Asia/Shanghai',
    travelers: { adults: 2, children: [8] },
    budget: { amountMinor: 500000, currency: 'cny', basis: 'party', includedCategories: ['transport', 'lodging'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: false, maxTransfers: 1, seatType: 'second_class', cabin: 'economy' },
    lodgingPreferences: { rooms: 1, roomType: 'standard', bedType: 'double', breakfast: false },
    interests: ['人文'],
    pace: 'balanced',
    menuItems: [{
      menuItemId: 'item-001', occurrenceId: 'occ-001', placeRef: place('item-place', '伪满皇宫博物院'), role: 'must_visit', inputOrder: 0,
      required: true, stayRequirement: 'must_visit', visitDuration: { minutes: 180 },
      preferredWindow: { startAt: '2026-09-17T09:00:00+08:00', endAt: '2026-09-17T18:00:00+08:00' }
    }],
    optimizeOrder: true,
    locks: [],
    confirmedConstraints: [],
    sourceInput: { type: 'manual_menu' },
    ...overrides
  }
}

test('normalizer enforces the request contract and produces a stable hash', () => {
  const result = normalizePlanRequest(request())
  assert.equal(result.normalizedRequest.budget.currency, 'CNY')
  assert.equal(result.normalizedRequest.origin.coordinate.lat, 43.8171)
  assert.equal(result.inputHash, inputHash(result.normalizedRequest))
  assert.equal(result.normalizedRequest.schemaVersion, 'real-travel-plan-request.v1')
})

test('normalizer rejects unknown fields and local times without an offset', () => {
  assert.throws(() => normalizePlanRequest(request({ unknown: true })), error => error.code === 'INVALID_CONSTRAINTS' && error.fieldErrors.some(item => item.path === 'unknown'))
  assert.throws(() => normalizePlanRequest(request({ startAt: '2026-09-16T08:00' })), error => error.code === 'INVALID_CONSTRAINTS' && error.fieldErrors.some(item => item.path === 'startAt'))
  assert.throws(() => normalizePlanRequest(request({ endBy: '2026-09-15T20:00:00+08:00' })), error => error.code === 'INVALID_CONSTRAINTS' && error.fieldErrors.some(item => item.path === 'endBy'))
})

test('job service deduplicates by owner and idempotency key without exposing ownerId', async () => {
  let sequence = 0
  const service = createPlanningJobService({
    newId: () => `id-${++sequence}`,
    executor: async ({ recordCall }) => { recordCall('juhe-train-817'); return { planId: 'plan-1' } }
  })
  const first = service.create({ ownerId: 'owner-a', idempotencyKey: 'idem-1', request: request() })
  const reused = service.create({ ownerId: 'owner-a', idempotencyKey: 'idem-1', request: request() })
  assert.equal(reused.reused, true)
  assert.equal(reused.job.id, first.job.id)
  assert.equal(Object.hasOwn(reused.job, 'ownerId'), false)
  assert.throws(() => service.create({ ownerId: 'owner-a', idempotencyKey: 'idem-1', request: request({ clientRequestId: 'client-002' }) }), error => error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409)
  assert.throws(() => service.get({ ownerId: 'owner-b', jobId: first.job.id }), error => error.code === 'NOT_FOUND' && error.status === 404)
  const finished = await service.run({ ownerId: 'owner-a', jobId: first.job.id })
  assert.equal(finished.taskStatus, 'succeeded')
  assert.equal(finished.providerCalls['juhe-train-817'], 1)
  assert.deepEqual(finished.result, { planId: 'plan-1' })
})

test('job service records a truthful cancellation and enforces task call budget', async () => {
  const service = createPlanningJobService({
    timeoutMs: 500,
    maxExternalCalls: 1,
    executor: async ({ signal, recordCall }) => {
      recordCall('juhe-train-817')
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      })
      return { planId: 'never-used' }
    }
  })
  const cancelJob = service.create({ ownerId: 'owner-a', idempotencyKey: 'cancel-1', request: request() })
  const running = service.run({ ownerId: 'owner-a', jobId: cancelJob.job.id })
  await new Promise(resolve => setImmediate(resolve))
  const cancelled = service.cancel({ ownerId: 'owner-a', jobId: cancelJob.job.id })
  assert.equal(cancelled.cancellationRequested, true)
  const final = await running
  assert.equal(final.taskStatus, 'cancelled')

  const budgetService = createPlanningJobService({
    maxExternalCalls: 1,
    executor: async ({ recordCall }) => { recordCall('juhe-train-817', 2); return null }
  })
  const budgetJob = budgetService.create({ ownerId: 'owner-a', idempotencyKey: 'budget-1', request: request() })
  const failed = await budgetService.run({ ownerId: 'owner-a', jobId: budgetJob.job.id })
  assert.equal(failed.taskStatus, 'failed')
  assert.equal(failed.error.code, 'BUDGET_LIMIT')
})

test('job service distinguishes a timeout from a user cancellation', async () => {
  const service = createPlanningJobService({
    timeoutMs: 10,
    executor: async ({ signal }) => await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    })
  })
  const created = service.create({ ownerId: 'owner-a', idempotencyKey: 'timeout-1', request: request() })
  const finished = await service.run({ ownerId: 'owner-a', jobId: created.job.id })
  assert.equal(finished.taskStatus, 'failed')
  assert.equal(finished.error.code, 'PLANNING_TIMEOUT')
  assert.equal(finished.error.retryable, true)
})
