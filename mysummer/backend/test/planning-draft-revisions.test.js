const test = require('node:test')
const assert = require('node:assert/strict')
const { createPlanningService } = require('../src/planning/service')
const p = id => ({ provider: 'manual', providerPlaceId: id, name: id, type: 'poi', coordinate: { lat: 43, lng: 125 }, coordinateSystem: 'GCJ02' })
function request(locks = []) {
  return { schemaVersion: 'real-travel-plan-request.v1', clientRequestId: 'revision-test', origin: p('origin'), endDestination: p('end'),
    startAt: '2026-09-16T08:00:00+08:00', endBy: '2026-09-18T20:00:00+08:00', timezone: 'Asia/Shanghai',
    travelers: { adults: 1, children: [] }, budget: { amountMinor: 100000, currency: 'CNY', basis: 'party', includedCategories: ['transport'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true, maxTransfers: 1, seatType: 'hard_seat', cabin: 'economy' },
    lodgingPreferences: { rooms: 1 }, interests: [], pace: 'balanced',
    menuItems: [{ menuItemId: 'a', occurrenceId: 'a-occ', placeRef: p('a'), role: 'must_visit', inputOrder: 0, required: true,
      stayRequirement: 'must_visit', visitDuration: { minutes: 60 }, preferredWindow: { startAt: '2026-09-16T09:00:00+08:00', endAt: '2026-09-18T18:00:00+08:00' } }],
    optimizeOrder: false, locks, confirmedConstraints: [], sourceInput: { type: 'manual_menu' } }
}
function fixture(input = request()) {
  const service = createPlanningService()
  const plan = service.buildRulePlan({ request: input })
  const drafts = service.draftRevisions
  const initial = drafts.create({ ownerId: 'alice', result: { schemaVersion: 'planning-result.v1', plan, partial: true } })
  return { service, drafts, initial, input }
}

test('draft preview is isolated, commits monotonically, rejects stale previews and restores as a new version', async () => {
  const { drafts, initial, input } = fixture()
  const next = structuredClone(input); next.budget.amountMinor = 200000
  const args = { ownerId: 'alice', draftId: initial.id, expectedVersion: 1, request: next }
  const preview = await drafts.preview(args)
  const competing = await drafts.preview(args)
  assert.deepEqual(preview.changedFields, ['budget'])
  assert.equal(preview.requiresRequote, true)
  assert.equal(drafts.get(args).version, 1)
  const applied = drafts.commit({ ...args, previewId: preview.id })
  assert.equal(applied.version, 2)
  assert.throws(() => drafts.commit({ ...args, previewId: competing.id }), { code: 'VERSION_CONFLICT' })
  applied.result.plan.inputSnapshot.budget.amountMinor = 9
  assert.equal(drafts.get(args).result.plan.inputSnapshot.budget.amountMinor, 200000)
  const restored = drafts.restore({ ...args, expectedVersion: 2, sourceVersion: 1 })
  assert.equal(restored.version, 3)
  assert.equal(restored.result.plan.inputSnapshot.budget.amountMinor, 100000)
})

test('draft ownership, cancellation and confirmed locks are protected without supplier calls', async () => {
  const locks = [{ lockId: 'locked', targetId: 'a', kind: 'order', value: { position: 0 }, source: 'user', createdAt: '2026-09-15T08:00:00+08:00' }]
  const { drafts, initial, input } = fixture(request(locks))
  const args = { ownerId: 'alice', draftId: initial.id, expectedVersion: 1, request: input }
  assert.throws(() => drafts.get({ ...args, ownerId: 'bob' }), { code: 'NOT_FOUND' })
  const changed = structuredClone(input); changed.menuItems[0].visitDuration.minutes = 120
  await assert.rejects(drafts.preview({ ...args, request: changed }), { code: 'LOCK_PROTECTED' })
  const removed = structuredClone(input); removed.locks = []
  await assert.rejects(drafts.preview({ ...args, request: removed }), { code: 'LOCK_PROTECTED' })
  const preview = await drafts.preview(args)
  drafts.cancel({ ...args, previewId: preview.id })
  assert.throws(() => drafts.commit({ ...args, previewId: preview.id }), { code: 'VERSION_CONFLICT' })
})
