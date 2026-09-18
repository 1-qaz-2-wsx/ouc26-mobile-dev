const assert = require('node:assert/strict')

const memory = {}
const pending = []
global.wx = {
  getStorageSync(key) { return memory[key] || null },
  setStorageSync(key, value) { memory[key] = JSON.parse(JSON.stringify(value)) },
  getDeviceInfo() { return { platform: 'devtools' } },
  getAccountInfoSync() { return { miniProgram: { envVersion: 'develop' } } },
  request(options) { pending.push(options) },
  cloud: { callContainer(options) { return new Promise(resolve => pending.push({ resolve, options })) } },
  showToast() {},
  showModal(options) { options.success({ confirm: true }) }
}

const store = require('../utils/travel-store')
const services = require('../utils/travel-services')

async function main() {
  store.setSession({ kind: 'wechat', id: 'wx-a', token: 'token-a', nickname: 'A' })
  const requestPromise = services.me()
  assert.equal(pending.length, 1)
  assert.match(pending[0].options.header.Authorization, /token-a/)
  store.setSession({ kind: 'wechat', id: 'wx-b', token: 'token-b', nickname: 'B' })
  pending[0].resolve({ statusCode: 200, data: { user: { id: 'wx-a', nickname: 'A迟到' } } })
  await assert.rejects(requestPromise, error => error && error.code === 'SESSION_CHANGED')

  let definition
  global.Page = value => { definition = value }
  delete require.cache[require.resolve('../pages/me/me')]
  require('../pages/me/me')
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback() }
  })
  services.validateSession = async () => {}
  let resolveMe
  services.me = () => new Promise(resolve => { resolveMe = resolve })
  const show = page.onShow()
  await Promise.resolve()
  assert.equal(typeof resolveMe, 'function')
  store.setSession({ kind: 'wechat', id: 'wx-c', token: 'token-c', nickname: 'C' })
  resolveMe({ user: { id: 'wx-b', nickname: 'B迟到' }, posts: [], favorites: [], notifications: [] })
  await show
  assert.notEqual(page.data.user.nickname, 'B迟到', '旧账号资料不得写入切换后的页面')
  console.log('PASS delayed A/B responses are rejected and cannot mutate the current account page')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
