const assert = require('node:assert/strict')
const { afterEach, test } = require('node:test')
const { createApp } = require('../src/app')

// 前端在生成前用 /planning/capabilities 说明数据源真实状态，并在提交前用
// /planning/requests/validate 做服务端兜底校验。两条链路都必须不依赖登录，
// 否则「生成前先告知」这件事在未登录时做不到。

const servers = []
const baseConfig = {
  apiKey: 'test-key-not-real', model: 'deepseek-v4-flash', apiUrl: 'https://mock.invalid/chat/completions',
  timeoutMs: 50, maxConcurrency: 2, maxUpstreamCalls: 20, maxOutputTokens: 800
}

async function start(overrides = {}) {
  const app = createApp({ ...baseConfig, ...overrides }, { fetchImpl: async () => new Response('{}', { status: 200 }) })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  servers.push(app.server)
  const { port } = app.server.address()
  return `http://127.0.0.1:${port}`
}

async function post(url, path, body, headers = {}) {
  const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

test('plan-request validation reports per-field reasons without requiring login', async () => {
  const url = await start()
  const { status, body } = await post(url, '/planning/requests/validate', {})
  assert.equal(status, 422)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'INVALID_CONSTRAINTS')
  assert.equal(typeof body.message, 'string')
  assert.equal(typeof body.requestId, 'string')
  // 逐字段原因是这次透传的核心：没有它，客户端只能显示笼统文案，指不出该改哪个输入。
  assert.ok(Array.isArray(body.fieldErrors) && body.fieldErrors.length > 0, 'fieldErrors must be forwarded')
  assert.ok(body.fieldErrors.every(row => typeof row.path === 'string' && typeof row.message === 'string'))
  assert.ok(body.fieldErrors.some(row => row.path === 'startAt'), 'field path must identify the offending input')
})

test('plan-request validation never echoes the submitted body', async () => {
  const url = await start()
  const marker = 'super-secret-marker-value'
  const { body } = await post(url, '/planning/requests/validate', { clientRequestId: marker, unexpectedField: marker })
  const serialized = JSON.stringify(body)
  assert.equal(serialized.includes(marker), false, 'validation errors must not echo request content')
  assert.ok(body.fieldErrors.some(row => row.path === 'unexpectedField'))
})

test('planning capabilities describe providers and limitations without login', async () => {
  const url = await start()
  const { status, body } = await post(url, '/planning/capabilities', {})
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.schemaVersion, 'planning-capabilities.v1')
  assert.ok(Array.isArray(body.providers) && body.providers.length > 0)
  assert.ok(Array.isArray(body.notes) && body.notes.length > 0)
  // 前端按 enabled === true 与 status === 'ready' 判定「可用」；未配置的供应商
  // 由 unavailable.js 生成，不带 status/enabled，断言其不会伪装成可用。
  const train = body.providers.find(provider => provider.id === 'juhe-train-817')
  assert.ok(train, 'train provider must be described')
  assert.equal(train.status, 'not_configured')
  assert.equal(train.enabled, false)
  const hotel = body.providers.find(provider => provider.id === 'hotel-provider')
  assert.ok(hotel, 'hotel provider must be described so the UI can state the real gap')
  assert.notEqual(hotel.status, 'ready')
})

test('draft routes require login first, then stay disabled until explicitly enabled', async () => {
  const url = await start({ planningDraftEnabled: false, sessionSecret: 'x'.repeat(64), wechatAppId: 'test-app' })
  // 鉴权先于开关判断：没有令牌时是 401，不是 503。
  const anonymous = await post(url, '/planning/drafts/get', { draftId: 'draft-1' })
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.body.code, 'UNAUTHENTICATED')

  const login = await post(url, '/auth/wechat', {}, { 'x-wx-openid': 'openid', 'x-wx-appid': 'test-app' })
  const authed = await post(url, '/planning/drafts/get', { draftId: 'draft-1' }, { authorization: 'Bearer ' + login.body.token })
  assert.equal(authed.status, 503)
  assert.equal(authed.body.code, 'PLANNING_NOT_ENABLED')
})
