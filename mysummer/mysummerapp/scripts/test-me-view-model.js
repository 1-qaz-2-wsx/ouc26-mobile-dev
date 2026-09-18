/**
 * G6 · pages/me 展示映射（派生状态）—— 运行时验收
 *
 * 只验证「字段 → 页面展示数据」的映射，不重复覆盖登录 / 同步 / 重发的业务时序
 * （那些在 test-me-account-flow.js / test-profile-sync.js / test-sync-race.js）：
 *   1. 游客 / 本地演示 / 微信账号三态共用同一份 account 派生状态；
 *   2. 方案行 planView：日期 / 天数 / 地点摘要；
 *   3. 社区 tabs 计数（posts / favorites / activeItems）与通知 noticeView 文案；
 *   4. 云端资料加载失败后，身份状态必须回落到「资料待加载」而不是假装已加载。
 */
const assert = require('node:assert/strict')

const memory = {}
global.wx = {
  getStorageSync: key => memory[key],
  setStorageSync: (key, value) => { memory[key] = JSON.parse(JSON.stringify(value)) },
  showToast() {},
  navigateTo(options) { memory.lastNavigation = options && options.url },
  switchTab(options) { memory.lastSwitch = options && options.url },
  showModal: options => options.success({ confirm: true }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  cloud: { callContainer: async () => ({ statusCode: 200, data: {} }) }
}

const store = require('../utils/travel-store')
const service = require('../utils/travel-services')

let definition
global.Page = value => { definition = value }
require('../pages/me/me')

/** 支持 setData 的路径键（'a.b' / 'list[0].field'），与真机行为一致 */
function setPath(target, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
  let node = target
  for (let i = 0; i < parts.length - 1; i++) {
    if (node[parts[i]] === undefined || node[parts[i]] === null) node[parts[i]] = {}
    node = node[parts[i]]
  }
  node[parts[parts.length - 1]] = value
}
const makePage = () => Object.assign({}, definition, {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(value, callback) { Object.keys(value).forEach(key => setPath(this.data, key, value[key])); if (callback) callback() }
})

async function main() {
  /* ---- 游客：本机身份 + 本机帖子映射 ---- */
  store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
  store.mutate(state => {
    state.posts = [{ id: 'local-1', title: '本机帖子', placeNames: ['哈尔滨'], type: 'review' }]
    state.plans = [{ id: 'plan-local', request: { startDate: '2026-10-01', days: 3 }, stops: [{ name: '哈尔滨' }, { name: '漠河' }] }]
    state.trips = [{ id: 'trip-local' }]
  })
  const page = makePage()
  page.applyLocal()
  assert.equal(page.data.user.kind, 'guest')
  assert.match(page.data.account.stateLabel, /本机模式/)
  assert.equal(page.data.account.statsReady, false)
  assert.match(page.data.account.bioText, /登录后/)
  assert.match(page.data.account.dataNote, /游客空间/)
  assert.equal(page.data.account.idLine, 'ID · 未登录')
  assert.equal(page.data.posts[0].statusText, '公开', '本机帖子状态文案')
  assert.equal(page.data.posts[0].placeText, '哈尔滨', '本机帖子地点文案')
  assert.equal(page.data.posts[0].metaLine, '哈尔滨', '本机帖子没有互动统计时不伪造数字')
  // 2026-09-18：本地方案列表下线（演示链路废弃），我的旅行只统计行程。
  assert.equal(page.data.travelMeta, '1 个行程')
  assert.equal(page.data.plans, undefined)
  assert.match(page.data.syncText, /仅保存在本机/)

  /* ---- 折叠态翻转都是本页二级 state，不触发任何路由 ---- */
  page.toggleNotifications()
  assert.equal(page.data.notificationsOpen, true, '互动通知可以展开')
  page.toggleSettings()
  assert.equal(page.data.settingsOpen, true, '设置与数据说明可以展开')
  page.closeSettings()
  assert.equal(page.data.settingsOpen, false, '设置抽屉可以关闭')
  // 提醒档位与开发测试（本地演示）两个二级态已随功能下线，处理器必须一起删除。
  assert.equal(typeof page.togglePlans, 'undefined')
  assert.equal(typeof page.toggleReminderCustom, 'undefined')
  assert.equal(typeof page.toggleDeveloper, 'undefined')

  /* ---- 微信账号 + 云端加载成功 ---- */
  store.setSession({ kind: 'wechat', id: 'wx-a', token: 'token-a', nickname: 'A' })
  page.applyLocal()
  page.applyCloud({
    user: { id: 'wx-a', nickname: 'A', bio: '爱去北方', profileVersion: 2 },
    stats: { followingCount: 3, followerCount: 2, likeReceivedCount: 9 },
    posts: [{ id: 'cloud-1', title: '云端帖子', placeNames: ['北京'], likeCount: 12, commentCount: 5 }],
    favorites: [{ id: 'fav-1', title: '收藏帖子' }],
    notifications: [{ id: 'notice-1', type: 'like', actorName: '小明', postId: 'cloud-1' },
      { id: 'notice-2', type: 'follow', actorName: '', postId: '' }],
    unreadCount: 1
  })
  assert.equal(page.data.account.stateLabel, '微信账号 · 资料已加载')
  assert.equal(page.data.account.statsReady, true)
  assert.equal(page.data.account.idLine, 'ID · 微信账号已绑定')
  assert.equal(page.data.account.bioText, '爱去北方')
  assert.match(page.data.account.dataNote, /微信账号/)
  assert.equal(page.data.posts.length, 1, '社区 tabs 的帖子计数来自 data.posts')
  assert.equal(page.data.favorites.length, 1, '社区 tabs 的收藏计数来自 data.favorites')
  assert.equal(page.data.posts[0].metaLine, '北京 · 12 赞 · 5 评论', '云端帖子行内说明应含地点与互动统计')
  assert.equal(page.data.unreadCount, 1)
  assert.equal(page.data.notifications[0].text, '小明赞了你的帖子')
  assert.equal(page.data.notifications[1].text, '有人关注了你')
  assert.equal(page.data.stats.likeReceivedCount, 9)

  /* ---- 互动通知：单条已读 + 全部标为已读都要落到页面状态 ---- */
  service.markNotificationsRead = async () => ({ ok: true })
  await page.openNotification({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.unreadCount, 0, '打开未读通知后未读数必须 -1')
  assert.ok(page.data.notifications[0].readAt, '打开后该条通知必须标记已读')
  assert.equal(memory.lastNavigation, '/pages/post-detail/post-detail?id=cloud-1', '通知应跳到对应帖子')
  page.setData({ unreadCount: 2 })
  await page.markNotifications()
  assert.equal(page.data.unreadCount, 0, '全部标为已读后未读数必须归零')
  assert.ok(page.data.notifications.every(item => item.readAt), '全部标为已读要覆盖每一条')

  /* ---- 收藏 tab 切换后 activeItems 跟随，取消收藏后列表同步 ---- */
  page.switchTab({ currentTarget: { dataset: { tab: 'favorites' } } })
  assert.deepEqual(page.data.activeItems.map(item => item.id), ['fav-1'])
  service.toggleFavorite = async () => ({ ok: true })
  await page.removeFavorite({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(page.data.favorites, [])
  assert.deepEqual(page.data.activeItems, [], '取消收藏后当前列表必须同步')

  /* ---- 云端资料加载失败：身份状态回落到「资料待加载」，并保留可点重试入口 ---- */
  const failure = new Error('服务请求失败（500）')
  failure.status = 500
  service.validateSession = async () => { throw failure }
  await page.refreshAccount()
  assert.equal(page.data.cloud, false)
  assert.equal(page.data.account.stateLabel, '微信账号 · 资料待加载')
  assert.equal(page.data.account.statsReady, false)
  assert.match(page.data.error, /云端暂时没有响应/)

  /* ---- 同步冲突：必须显式告知，不能显示成「同步已完成」 ---- */
  store.mutate(state => { state.sync = Object.assign({}, state.sync, { lastConflicts: [{ type: 'plan', id: 'plan-1', serverVersion: 3 }] }) })
  page.loadTravel()
  assert.match(page.data.syncText, /云端已有更新版本/)
  assert.doesNotMatch(page.data.syncText, /上次同步已完成/)

  console.log('PASS Me view model: 三态身份与 ID 行、方案行、设置抽屉开合、通知已读、收藏减一、同步冲突与云端失败回落都在同一套派生状态里')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
