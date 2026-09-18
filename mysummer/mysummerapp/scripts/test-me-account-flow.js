const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const memory = {}
let confirm = true
global.wx = {
  getStorageSync: key => memory[key],
  setStorageSync: (key, value) => { memory[key] = JSON.parse(JSON.stringify(value)) },
  showToast() {}, showModal: options => options.success({ confirm }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  cloud: { callContainer: async () => ({ statusCode: 401, data: { message: '登录已过期' } }) }
}
const store = require('../utils/travel-store')
const service = require('../utils/travel-services')
const sync = require('../utils/travel-sync')
let definition
global.Page = value => { definition = value }
require('../pages/me/me')
const makePage = () => Object.assign({}, definition, {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(value, cb) { Object.assign(this.data, value); if (cb) cb() }
})
const guest = () => store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
const account = name => store.setSession({ kind: 'wechat', id: 'wx-' + name, token: 'token-' + name, nickname: name })
const profile = { user: { id: 'a', nickname: 'A', profileVersion: 1 }, posts: [{ id: 'p', title: 'A帖子' }], unreadCount: 1 }

async function main() {
  guest()
  let page = makePage()
  page.onLoad()
  // 2026-09-18：本地演示方案链路下线，「进入本地演示数据」入口与 demo() 处理器一并删除。
  assert.equal(page.data.developer, undefined)
  assert.equal(typeof page.demo, 'undefined')
  assert.equal(store.session().kind, 'guest')

  // A's failed validation arriving after switching to B must not log B out.
  account('a')
  let resolveValidation
  wx.cloud.callContainer = () => new Promise(resolve => { resolveValidation = resolve })
  const validation = service.validateSession()
  account('b')
  resolveValidation({ statusCode: 401, data: { message: 'expired' } })
  await assert.rejects(validation)
  assert.equal(store.session().id, 'wx-b')

  // Expiration clears stale page content and leaves a usable login button.
  account('a')
  page.applyLocal()
  page.applyCloud(profile)
  wx.cloud.callContainer = async () => ({ statusCode: 401, data: { message: '登录已过期' } })
  await page.onShow()
  assert.equal(page.data.user.kind, 'guest')
  assert.equal(page.data.busy, false)
  assert.deepEqual(page.data.activeItems, [])
  assert.match(page.data.error, /过期/)

  // Login lock is acquired before any asynchronous work; no profile mutation.
  let resolveLogin, loginCalls = 0, updateCalls = 0
  service.login = () => { loginCalls++; return new Promise(resolve => { resolveLogin = () => { account('a'); resolve() } }) }
  service.me = async () => profile
  service.validateSession = async () => {}
  service.updateProfile = async () => { updateCalls++; return profile }
  sync.syncNow = async () => { throw new Error('offline') }
  const login = page.login()
  await page.login()
  assert.equal(loginCalls, 1)
  resolveLogin()
  await login
  assert.equal(page.data.cloud, true)
  assert.equal(page.data.busy, false)
  assert.equal(updateCalls, 0)
  assert.match(page.data.syncError, /同步失败/)
  assert.doesNotMatch(page.data.syncText, /已完成/)

  // Refresh must not destroy a profile draft; validation is local before upload.
  page.editProfile()
  page.nickname({ detail: { value: '未保存的昵称' } })
  await page.onShow()
  assert.equal(page.data.nicknameDraft, '未保存的昵称')
  assert.equal(page.data.editing, true)
  page.nickname({ detail: { value: '  ' } })
  await page.saveProfile()
  assert.equal(updateCalls, 0)
  assert.match(page.data.error, /昵称/)

  confirm = false
  await page.logout()
  assert.equal(store.session().kind, 'wechat')
  confirm = true
  await page.logout()
  assert.equal(page.data.user.kind, 'guest')
  assert.equal(page.data.editing, false)
  assert.equal(page.data.nicknameDraft, '')
  assert.equal(page.data.unreadCount, 0)

  service.login = async () => { throw new Error('offline') }
  await page.login()
  assert.equal(page.data.busy, false)
  assert.equal(page.data.user.kind, 'guest')
  assert.match(page.data.error, /登录未完成/)

  // Rejecting migration leaves guest data intact and does not send it.
  store.mutate(s => { s.plans = [{ id: 'guest-plan' }] })
  confirm = false
  service.login = async () => account('a')
  let syncOptions
  sync.syncNow = async options => { syncOptions = options; return {} }
  await page.login()
  assert.equal(syncOptions.state, undefined)
  await page.logout() // canceled
  confirm = true
  await page.logout()
  assert.equal(store.read().plans[0].id, 'guest-plan')

  // Accepted migration stays available for explicit retry after failure.
  sync.syncNow = async () => { throw new Error('offline') }
  await page.login()
  assert.equal(page._pendingMigration.plans[0].id, 'guest-plan')
  sync.syncNow = async options => { syncOptions = options; return {} }
  await page.refreshAccount()
  assert.equal(syncOptions.state.plans[0].id, 'guest-plan')
  assert.equal(page._pendingMigration, null)
  assert.equal(page.data.syncError, '')

  // 2026-09-18：行程提醒废弃，本页不再有默认提前量输入与落库路径。
  assert.equal(typeof page.saveReminder, 'undefined')
  assert.equal(typeof page.field, 'undefined')
  assert.equal(store.read().reminderMinutes, undefined)
  const markup = fs.readFileSync(path.join(__dirname, '../pages/me/me.wxml'), 'utf8')
  assert.equal((markup.match(/bindtap="login"/g) || []).length, 1)
  assert.doesNotMatch(markup, /同步微信资料|启用微信账号|登录并同步资料/)
  assert.doesNotMatch(markup, /行程提醒|进入本地演示数据/)
  console.log('PASS Me: single login, expiration, stale 401, duplicate login, draft, logout, migration/retry, honest sync and removing the reminder/demo entries')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
