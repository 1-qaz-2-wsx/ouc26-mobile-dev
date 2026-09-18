const test = require('node:test')
const assert = require('node:assert/strict')
const { createPlanningApi } = require('../src/planning/http-api')
test('planning HTTP ownership comes from verified token and disabled mode never creates jobs', async () => {
  let calls = 0
  const planning = { jobs: { create: value => { calls++; assert.equal(value.ownerId, 'verified-user'); return { reused: true, job: { id: 'job' } } } } }
  const req = { headers: { authorization: 'Bearer valid' } }
  const verify = token => { assert.equal(token, 'valid'); return { id: 'verified-user' } }
  await assert.rejects(createPlanningApi({ planning, verify })('/planning/jobs/create', {}, req), { code: 'PLANNING_NOT_ENABLED' })
  const handle = createPlanningApi({ planning, verify, enabled: true })
  await assert.rejects(handle('/planning/jobs/create', { ownerId: 'forged' }, req), { code: 'INVALID_REQUEST' })
  await assert.rejects(handle('/planning/jobs/create', {}, { headers: {} }), { code: 'UNAUTHENTICATED' })
  const response = await handle('/planning/jobs/create', { idempotencyKey: 'key', request: {} }, req)
  assert.equal(response.job.id, 'job')
  assert.equal(calls, 1)
})

test('planning API accepts the signed app-session header used by server-side CloudBase calls', async () => {
  let verified
  const planning = { jobs: { create: async value => ({ reused: true, job: { id: value.ownerId } }) } }
  const handle = createPlanningApi({ planning, verify: token => { verified = token; return { id: 'server-sdk-user' } }, enabled: true })
  const response = await handle('/planning/jobs/create', { idempotencyKey: 'key', request: {} }, { headers: { authorization: 'Bearer cloudbase-reserved', 'x-app-authorization': 'Bearer app-session' } })
  assert.equal(verified, 'app-session')
  assert.equal(response.job.id, 'server-sdk-user')
})

test('draft creation uses an owned completed job, not client supplied result or identity', async () => {
  let created
  const trusted = { plan: { id: 'trusted' } }
  const planning = { jobs: { get: args => { assert.equal(args.ownerId, 'alice'); return { taskStatus: 'partial', result: trusted } } },
    draftRevisions: { create: args => { created = args; return { id: 'draft' } } } }
  const handle = createPlanningApi({ planning, verify: () => ({ id: 'alice' }), enabled: true })
  const req = { headers: { authorization: 'Bearer valid' } }
  await handle('/planning/drafts/create', { jobId: 'job', result: { plan: { id: 'forged' } } }, req)
  assert.deepEqual(created, { ownerId: 'alice', result: trusted })
  planning.jobs.get = () => ({ taskStatus: 'running', result: null })
  await assert.rejects(handle('/planning/drafts/create', { jobId: 'job' }, req), { code: 'JOB_NOT_READY' })
})
