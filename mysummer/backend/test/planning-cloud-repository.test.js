const test = require('node:test')
const assert = require('node:assert/strict')
const { createPlanningRepository } = require('../src/planning/cloud-repository')

test('planning repository never writes CloudBase immutable _id back to a document', async () => {
  let written
  const document = {
    async get() { return { data: [{ _id: 'job-1', id: 'job-1', taskStatus: 'queued' }] } },
    async set(value) { assert.equal(Object.hasOwn(value, '_id'), false); written = value; return {} }
  }
  const database = { collection: () => ({ doc: () => document }) }
  const db = { ...database, async runTransaction(work) { return work(database) } }
  const repository = createPlanningRepository(db)
  await repository.transaction(async tx => {
    const row = await tx.get('planning_jobs', 'job-1')
    row.taskStatus = 'running'
    await tx.set('planning_jobs', 'job-1', row)
  })
  assert.equal(written.taskStatus, 'running')
})
