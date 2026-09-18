const { test } = require('node:test')
const assert = require('node:assert/strict')
const { diagnostic } = require('../src/error-diagnostics')
test('error diagnostics omit secrets and keep actionable location/category', () => {
  const error = new TypeError('Cannot read properties of null: private-user token-secret')
  error.headers = { authorization: 'Bearer token-secret' }
  error.code = 'secret-code'
  error.stack = 'TypeError: token-secret\n    at work (/app/src/community-api.js:83:19)\n    at async /app/src/app.js:169:40'
  const result = diagnostic(error, 'request-1', '/me')
  assert.equal(result.category, 'CODE_OR_DATA_SHAPE_ERROR')
  assert.deepEqual(result.frames, ['community-api.js:83:19', 'app.js:169:40'])
  assert.doesNotMatch(JSON.stringify(result), /token-secret|private-user|secret-code|authorization/)
})
test('database failures retain only a derived category', () => {
  assert.equal(diagnostic(new Error('collection not exist private-table'), 'id', '/me').category, 'DATABASE_COLLECTION_MISSING')
  assert.equal(diagnostic(new Error('permission denied key-secret'), 'id', '/me').category, 'DATABASE_OR_AUTH_PERMISSION')
  assert.equal(diagnostic(new Error('unknown secret'), 'id', '/me').category, 'UNCLASSIFIED')
})
test('/me HTTP 500 emits correlated diagnostics without leaking the exception', async () => {
  const { createHmac } = require('node:crypto')
  const { createApp } = require('../src/app')
  const sessionSecret = 'test-only-session-secret-at-least-32-chars'
  const body = Buffer.from(JSON.stringify({ id: 'test-user', exp: Date.now() + 60000 })).toString('base64url')
  const token = body + '.' + createHmac('sha256', sessionSecret).update(body).digest('base64url')
  const records = []
  const repository = {
    async get() { throw new TypeError('Cannot read properties of null secret-test-marker') },
    collection() { const query = { where() { return query }, orderBy() { return query }, limit() { return query }, async get() { return { data: [] } } }; return query }
  }
  const { server } = createApp({ sessionSecret }, { communityRepository: repository, logError: row => records.push(JSON.parse(row)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/me', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: '{}' })
    const result = await response.json()
    assert.equal(response.status, 500)
    assert.equal(result.message, '服务内部错误。')
    assert.equal(records.length, 1)
    assert.equal(records[0].requestId, result.requestId)
    assert.equal(records[0].route, '/me')
    assert.equal(records[0].category, 'CODE_OR_DATA_SHAPE_ERROR')
    assert.doesNotMatch(JSON.stringify({ records, result }), /secret-test-marker|test-user|Bearer/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
