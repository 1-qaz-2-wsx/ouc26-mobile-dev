const test = require('node:test')
const assert = require('node:assert/strict')
const { createPersistentPlanningJobService } = require('../src/planning/persistent-jobs')
const { createPlanningService } = require('../src/planning/service')

function repository() {
  const rows = new Map(); let tail = Promise.resolve()
  const api = {
    async get(table, id) { return structuredClone(rows.get(`${table}:${id}`) || null) },
    async set(table, id, value) { rows.set(`${table}:${id}`, structuredClone(value)) }
  }
  api.transaction = work => { const result = tail.then(() => work(api)); tail = result.catch(() => {}); return result }
  return api
}
const place = id => ({ provider: 'manual', providerPlaceId: id, name: id, type: 'poi', coordinate: { lat: 43, lng: 125 }, coordinateSystem: 'GCJ02' })
function request() {
  return { schemaVersion: 'real-travel-plan-request.v1', clientRequestId: 'persistent-test', origin: place('origin'), endDestination: place('end'),
    startAt: '2026-09-16T08:00:00+08:00', endBy: '2026-09-18T20:00:00+08:00', timezone: 'Asia/Shanghai', travelers: { adults: 1, children: [] },
    budget: { amountMinor: 100000, currency: 'CNY', basis: 'party', includedCategories: ['transport'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true, maxTransfers: 1, seatType: 'hard_seat', cabin: 'economy' }, lodgingPreferences: { rooms: 1 }, interests: [], pace: 'balanced',
    menuItems: [{ menuItemId: 'a', occurrenceId: 'a-occ', placeRef: place('a'), role: 'must_visit', inputOrder: 0, required: true, stayRequirement: 'must_visit', visitDuration: { minutes: 60 }, preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-18T18:00:00+08:00' } }],
    optimizeOrder: false, locks: [], confirmedConstraints: [], sourceInput: { type: 'manual_menu' } }
}

test('persistent jobs enforce idempotency, ownership and durable terminal results', async () => {
  const repo = repository()
  const jobs = createPersistentPlanningJobService({ repository: repo, executor: async ({ request }) => ({ echoed: request.value }) })
  const created = await jobs.create({ ownerId: 'alice', idempotencyKey: 'same', request: { value: 1 } })
  assert.equal(created.job.persistence, 'cloudbase')
  assert.equal((await jobs.create({ ownerId: 'alice', idempotencyKey: 'same', request: { value: 1 } })).reused, true)
  await assert.rejects(jobs.create({ ownerId: 'alice', idempotencyKey: 'same', request: { value: 2 } }), { code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(jobs.get({ ownerId: 'bob', jobId: created.job.id }), { code: 'NOT_FOUND' })
  const done = await jobs.run({ ownerId: 'alice', jobId: created.job.id })
  assert.equal(done.taskStatus, 'succeeded'); assert.deepEqual(done.result, { echoed: 1 })
  assert.equal((await jobs.get({ ownerId: 'alice', jobId: created.job.id })).taskStatus, 'succeeded')
})

test('planning service uses durable drafts when a repository is supplied', async () => {
  const repo = repository(), service = createPlanningService({ repository: repo })
  const input = request(), plan = service.buildRulePlan({ request: input })
  const draft = await service.draftRevisions.create({ ownerId: 'alice', result: { schemaVersion: 'planning-result.v1', plan, partial: true } })
  assert.equal(draft.persistence, 'cloudbase')
  const next = structuredClone(input); next.budget.amountMinor = 200000
  const preview = await service.draftRevisions.preview({ ownerId: 'alice', draftId: draft.id, expectedVersion: 1, request: next })
  const committed = await service.draftRevisions.commit({ ownerId: 'alice', draftId: draft.id, expectedVersion: 1, previewId: preview.id })
  assert.equal(committed.version, 2); assert.equal(committed.result.plan.inputSnapshot.budget.amountMinor, 200000)
})
