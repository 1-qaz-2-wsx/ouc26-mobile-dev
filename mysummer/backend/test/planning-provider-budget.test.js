const test = require('node:test')
const assert = require('node:assert/strict')
const { createProviderBudget } = require('../src/planning/provider-budget')
function repo() {
  const rows = new Map()
  let tail = Promise.resolve()
  const api = { async get(table, id) { return structuredClone(rows.get(`${table}:${id}`) || null) }, async set(table, id, value) { rows.set(`${table}:${id}`, structuredClone(value)) } }
  api.transaction = work => { const result = tail.then(() => work(api)); tail = result.catch(() => {}); return result }
  return api
}
test('provider budget is shared atomically across instances and never resets by date', async () => {
  const repository = repo(), clock = () => Date.parse('2026-09-16T03:00:00Z')
  const a = createProviderBudget({ repository, limits: { map: 2, train: 1 }, scope: 'closure-2026-09-16', clock })
  const b = createProviderBudget({ repository, limits: { map: 2, train: 1 }, scope: 'closure-2026-09-16', clock: () => Date.parse('2026-09-17T03:00:00Z') })
  const results = await Promise.allSettled([a.reserve('map'), b.reserve('map'), a.reserve('map')])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 2)
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'PROVIDER_SESSION_LIMIT')
  assert.equal((await a.reserve('train')).used, 1)
  await assert.rejects(b.reserve('train'), { code: 'PROVIDER_SESSION_LIMIT' })
})
