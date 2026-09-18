const assert = require('node:assert/strict')

const storage = {}
let currentProfile = { id: 'user-1', nickname: '微信用户', bio: '', avatarMediaId: null, profileVersion: 1 }
const updatedProfile = { id: 'user-1', nickname: '新昵称', bio: '', avatarMediaId: 'cloud://avatar', profileVersion: 2 }
const requests = []
global.wx = {
  getStorageSync(key) { return storage[key] },
  setStorageSync(key, value) { storage[key] = value },
  showToast() {},
  cloud: {
    async callContainer(options) {
      requests.push(options)
      if (options.path === '/auth/wechat') return { statusCode: 200, data: { token: 'token-1', user: { id: 'user-1', nickname: '微信用户', bio: '', avatarMediaId: null, profileVersion: 1 }, expiresAt: 9 } }
      if (options.path === '/auth/session') return { statusCode: 200, data: { user: currentProfile } }
      if (options.path === '/me') return { statusCode: 200, data: { user: currentProfile, stats: {}, posts: [], favorites: [], notifications: [], unreadCount: 0 } }
      if (options.path === '/me/profile') { currentProfile = updatedProfile; return { statusCode: 200, data: { user: currentProfile } } }
      if (options.path === '/travel/sync') return { statusCode: 200, data: { plans: [], trips: [], reminderMinutes: 60, serverTime: Date.now() } }
      throw new Error('unexpected path ' + options.path)
    }
  }
}

let definition
global.Page = value => { definition = value }
const service = require('../utils/travel-services')
const store = require('../utils/travel-store')
require('../pages/me/me')

async function main() {
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback() }
  })
  await page.login()
  assert.equal(requests.filter(request => request.path === '/me/profile').length, 0, '登录不应附带修改头像昵称')
  page.editProfile()
  page.nickname({ detail: { value: '新昵称' } })
  page.chooseAvatar({ detail: { avatarUrl: 'cloud://avatar' } })
  await page.saveProfile()
  const session = store.session()
  assert.equal(session.kind, 'wechat')
  assert.equal(session.nickname, '新昵称')
  assert.equal(session.avatarMediaId, 'cloud://avatar')
  assert.equal(session.profileVersion, 2)
  assert.equal(page.data.user.nickname, '新昵称')
  assert.equal(page.data.user.avatarMediaId, 'cloud://avatar')
  assert.ok(requests.some(request => request.path === '/me/profile' && request.data.nickname === '新昵称'))
  console.log('PASS login stays separate from profile editing; updates persist avatar, nickname and version')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
