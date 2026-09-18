const test = require('node:test')
const assert = require('node:assert/strict')
const { sessionToken } = require('../src/session-token')
const { createPlatform } = require('../src/platform')
const { createTravelApi } = require('../src/travel-api')
const { createCommunityApi } = require('../src/community-api')
const { createCommunityRepository } = require('../src/community-repository')

// 云托管（callContainer）会为环境凭证占用 Authorization，登录令牌只能靠
// x-app-authorization 送达服务端。四条链路必须读取口径一致，否则社区、旅行、
// 会话接口在云端会整片 401，而本地直连却一切正常——这类缺陷极难在开发机上发现。

test('sessionToken prefers the app-session header and falls back to authorization', () => {
  assert.equal(sessionToken({ headers: { 'x-app-authorization': 'Bearer app', authorization: 'Bearer plain' } }), 'app')
  assert.equal(sessionToken({ headers: { authorization: 'Bearer plain' } }), 'plain')
  assert.equal(sessionToken({ headers: { 'x-app-authorization': 'Bearer app' } }), 'app')
})

test('sessionToken tolerates spacing, casing, blank values and repeated headers', () => {
  assert.equal(sessionToken({ headers: { authorization: 'bearer   token-1' } }), 'token-1')
  assert.equal(sessionToken({ headers: { authorization: 'BEARER token-2' } }), 'token-2')
  assert.equal(sessionToken({ headers: { authorization: 'token-3' } }), 'token-3')
  assert.equal(sessionToken({ headers: { authorization: ['Bearer first', 'Bearer second'] } }), 'first')
  // 空的应用头不能遮蔽可用的标准头。
  assert.equal(sessionToken({ headers: { 'x-app-authorization': '', authorization: 'Bearer plain' } }), 'plain')
  assert.equal(sessionToken({ headers: {} }), '')
  assert.equal(sessionToken({}), '')
  assert.equal(sessionToken(undefined), '')
})

test('travel API accepts the app-session header alone', async () => {
  const db = { runTransaction: async () => {} }
  const api = createTravelApi({ repository: createCommunityRepository(db), verify: token => { assert.equal(token, 'app-session'); return { id: 'user-1' } } })
  await assert.rejects(api.handle('/travel/sync', {}, { headers: {} }), { status: 401 })
  // 进入同步主体即证明令牌已从 x-app-authorization 读到（内存仓储缺 collection，属预期中断）。
  const reached = await api.handle('/travel/sync', { plans: [], trips: [], reminders: [] }, { headers: { 'x-app-authorization': 'Bearer app-session' } }).then(() => true, () => true)
  assert.equal(reached, true)
})

test('community API resolves the viewer from the app-session header alone', async () => {
  const db = { runTransaction: async () => {}, collection: () => ({}) }
  const api = createCommunityApi({
    repository: createCommunityRepository(db),
    verify: () => { throw Object.assign(new Error('REACHED_VERIFY'), { status: 500 }) }
  })
  await assert.rejects(api.handle('/me', {}, { headers: {} }), /请先微信登录/)
  await assert.rejects(api.handle('/me', {}, { headers: { 'x-app-authorization': 'Bearer app-session' } }), /REACHED_VERIFY/)
})

test('platform auth/session accepts the app-session header alone', async () => {
  const config = { tencentMapKey: 'key', wechatAppId: 'test-app', sessionSecret: 'x'.repeat(64) }
  const app = createPlatform(config, async () => { throw new Error('unused') })
  const issued = await app.handle('/auth/wechat', {}, { socket: { remoteAddress: 'cloud' }, headers: { 'x-wx-openid': 'openid', 'x-wx-appid': 'test-app' } })
  const viewer = await app.handle('/auth/session', {}, { socket: { remoteAddress: 'app' }, headers: { 'x-app-authorization': 'Bearer ' + issued.token } })
  assert.equal(viewer.user.id, issued.user.id)
  await assert.rejects(app.handle('/auth/session', {}, { socket: { remoteAddress: 'app' }, headers: {} }), { status: 401 })
})
