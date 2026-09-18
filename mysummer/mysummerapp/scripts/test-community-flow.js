/**
 * G7 · Community UI 行为验收（community / member / post-detail / post-edit 四页）
 *
 * 用桩替换 utils/travel-services，只驱动页面自身的 presentation mapping / 交互状态机，
 * 不联网、不写真实存储、不新增后端调用。覆盖本轮验收清单：
 *   Community：guest feed / recommend / following / login required / search / type filter /
 *              refresh / load more / like / favorite / open post / open member
 *   Member：guest read / logged-in read / follow / unfollow / self member / public posts only /
 *           无假分页（member 只带 1 个参数调用）
 *   Post detail：public detail / private owner / like / favorite / follow / comments / reply /
 *               delete own comment / report
 *   Post edit：create / edit / public / private / media / route / review / question / validation / draft
 */
const assert = require('node:assert/strict')

/* ------------------------------------------------------------------ wx mock */
const memory = new Map()
const clone = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)))
const wxCalls = { toasts: [], navigation: [], modals: [], previews: [], pullDown: 0 }

global.wx = {
  getStorageSync(key) { return memory.has(key) ? clone(memory.get(key)) : '' },
  setStorageSync(key, value) { memory.set(key, clone(value)) },
  removeStorageSync(key) { memory.delete(key) },
  getAccountInfoSync() { return { miniProgram: { envVersion: 'develop' } } },
  showToast(options) { wxCalls.toasts.push(options && options.title) },
  showModal(options) { wxCalls.modals.push(options && options.title); if (options && options.success) options.success({ confirm: true }) },
  navigateTo(options) { wxCalls.navigation.push(options.url) },
  redirectTo(options) { wxCalls.navigation.push(options.url) },
  switchTab(options) { wxCalls.navigation.push(options.url) },
  navigateBack() { wxCalls.navigation.push('back') },
  stopPullDownRefresh() { wxCalls.pullDown += 1 },
  previewImage(options) { wxCalls.previews.push(options) },
  chooseMedia(options) {
    wxCalls.chooseMediaCount = (wxCalls.chooseMediaCount || 0) + 1
    if (options && options.success) options.success({ tempFiles: [{ tempFilePath: 'tmp/photo-a.jpg', size: 1024, type: 'image' }] })
  }
}

/* ------------------------------------------------------- services stub (桩) */
const calls = {
  feed: [], like: [], favorite: [], follow: [], comments: [], deleteComment: [],
  report: [], postDetail: [], createPost: [], updatePost: [], uploadPhotos: [], member: [], visibility: [], deletePost: [], api: []
}
let cloudReady = true
let responses = {}

const servicesPath = require.resolve('../utils/travel-services')
require.cache[servicesPath] = {
  id: servicesPath,
  filename: servicesPath,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    cloudReady: () => cloudReady,
    communityFeed: async options => { calls.feed.push(options); return responses.feed(options) },
    member: async function (id) { calls.member.push({ id, argc: arguments.length }); return responses.member(id) },
    // 翻页走服务层低层 api() + 路由注册表（与 pages/menu 的 planning 调用同一范式）
    api: async function (endpoint, payload) {
      calls.api.push({ endpoint, payload: clone(payload), argc: arguments.length })
      return responses.api ? responses.api(endpoint, payload) : responses.member(payload && payload.cursor)
    },
    postDetail: async id => { calls.postDetail.push(id); return responses.postDetail(id) },
    comments: async (id, data) => { calls.comments.push(Object.assign({ id }, data)); return responses.comments(id, data) },
    deleteComment: async (id, data) => { calls.deleteComment.push(Object.assign({ id }, data)); return responses.deleteComment(id, data) },
    toggleLike: async (id, active, requestKey) => { calls.like.push({ id, active, requestKey }); return responses.like(id, active) },
    toggleFavorite: async (id, active, requestKey) => { calls.favorite.push({ id, active, requestKey }); return responses.favorite(id, active) },
    toggleFollow: async (id, active, requestKey) => { calls.follow.push({ id, active, requestKey }); return responses.follow(id, active) },
    report: async data => { calls.report.push(data); return { id: 'r1', status: 'pending' } },
    createPost: async data => { calls.createPost.push(data); return { postId: 'new-post', status: 'approved' } },
    updatePost: async (id, data) => { calls.updatePost.push(Object.assign({ id }, data)); return { postId: id, status: 'approved' } },
    changePostVisibility: async (id, data) => { calls.visibility.push(Object.assign({ id }, data)); return { status: 'approved' } },
    deletePost: async (id, data) => { calls.deletePost.push(Object.assign({ id }, data)); return { ok: true } },
    uploadPhotos: async (photos, options) => {
      calls.uploadPhotos.push({ photos: clone(photos), requestKey: options && options.requestKey })
      return (photos || []).map((file, index) => (file && file.mediaId) || 'media-' + index)
    }
  }
}

const store = require('../utils/travel-store')

/* ------------------------------------------------------------- page helper */
function parsePath(key) {
  const parts = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let match
  while ((match = re.exec(key))) parts.push(match[1] !== undefined ? match[1] : Number(match[2]))
  return parts
}
function definitionOf(name) {
  let def = null
  global.Page = value => { def = value }
  const file = require.resolve('../pages/' + name + '/' + name)
  delete require.cache[file]
  require(file)
  assert.ok(def, name + ' 未注册 Page')
  return def
}
function pageOf(name) {
  const def = definitionOf(name)
  return Object.assign({}, def, {
    data: clone(def.data),
    setData(values) {
      Object.entries(values).forEach(([key, value]) => {
        const parts = parsePath(key)
        let node = this.data
        for (let i = 0; i < parts.length - 1; i += 1) {
          const part = parts[i]
          if (node[part] === undefined || node[part] === null) node[part] = typeof parts[i + 1] === 'number' ? [] : {}
          node = node[part]
        }
        node[parts[parts.length - 1]] = value
      })
    }
  })
}
const tick = async (rounds = 4) => { for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setTimeout(resolve, 0)) }
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } })
const last = list => list[list.length - 1]

/* ----------------------------------------------------------------- fixtures */
function cloudPost(over) {
  return Object.assign({
    id: 'p1', authorId: 'u1', type: 'route', title: '哈尔滨到漠河的公共交通路线',
    content: '这是一段用于验证摘要截断的正文。'.repeat(8), placeNames: ['哈尔滨', '漠河'],
    photos: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'], places: [], rating: null, visitDate: null,
    duration: null, visibility: 'public', moderationStatus: 'approved', publishedAt: Date.UTC(2026, 8, 12, 8, 0, 0),
    createdAt: Date.UTC(2026, 8, 12, 8, 0, 0), version: 3, likeCount: 3, favoriteCount: 1, commentCount: 2,
    viewerLiked: false, viewerFavorited: false, isOwner: false,
    permissions: { isOwner: false, canLike: true, canFavorite: true, canComment: true },
    author: { id: 'u1', nickname: '路线资料员', bio: '常年在东北跑', avatarUrl: '', avatarMediaId: null }
  }, over || {})
}
function commentFixture(over) {
  return Object.assign({
    id: 'c1', postId: 'p1', authorId: 'u2', rootId: null, replyToId: null, replyToUserId: null, replyToUserName: '',
    content: '这条路线我走过，冬天班次少。', moderationStatus: 'approved', deletedAt: null,
    createdAt: Date.UTC(2026, 8, 13, 10, 30, 0), statusText: '', canReply: true, canDelete: false,
    author: { id: 'u2', nickname: '早起的鸟', bio: '', avatarUrl: '', avatarMediaId: null }
  }, over || {})
}
function resetResponses() {
  responses = {
    feed: () => ({ items: [], nextCursor: null, hasMore: false }),
    member: () => ({ user: { id: 'u1', nickname: '路线资料员', bio: '常年在东北跑', avatarUrl: '', avatarMediaId: null }, stats: { followingCount: 4, followerCount: 9, likeReceivedCount: 12 }, posts: [], viewerFollowing: false }),
    postDetail: () => ({ post: cloudPost(), author: { id: 'u1', nickname: '路线资料员' }, viewerFollowing: false, isOwner: false }),
    comments: () => ({ items: [commentFixture()], nextCursor: null, hasMore: false }),
    deleteComment: () => ({ counts: { commentCount: 1 } }),
    like: () => ({ active: true, counts: { likeCount: 4, favoriteCount: 1, commentCount: 2 } }),
    favorite: () => ({ active: true, counts: { likeCount: 3, favoriteCount: 2, commentCount: 2 } }),
    follow: (id, active) => ({ following: active !== false })
  }
}
function cloudSession() { store.setSession({ kind: 'wechat', id: 'wx-1', nickname: '我' }) }

/* --------------------------------------------------------------- 1 community */
async function communityFeed() {
  cloudSession()
  resetResponses()
  responses.feed = options => options.cursor
    ? { items: [cloudPost({ id: 'p1' }), cloudPost({ id: 'p2', title: '第二篇', photos: [] }), cloudPost({ id: 'p3', title: '第三篇', photos: [] })], nextCursor: null, hasMore: false }
    : { items: [cloudPost()], nextCursor: 'cursor-1', hasMore: true }

  const page = pageOf('community')
  await page.refresh(true)
  assert.equal(page.data.cloud, true, '云端模式应标记 cloud=true')
  assert.equal(page.data.posts.length, 1)
  assert.equal(page.data.cursor, 'cursor-1')
  assert.equal(page.data.hasMore, true)
  const post = page.data.posts[0]
  assert.equal(post.title, '哈尔滨到漠河的公共交通路线')
  assert.equal(post.typeLabel, '旅行路线', '类型标签应映射为中文')
  assert.equal(post.placeText, '哈尔滨 · 漠河')
  assert.equal(post.publishedText, '2026-09-12', 'ISO/时间戳都应归一成 YYYY-MM-DD')
  assert.equal(post.photo, 'https://cdn.example/1.jpg', '列表只取首图')
  assert.ok(post.summary.endsWith('…'), '超长正文摘要应带省略号')
  assert.equal(page.data.emptyMessage, '')

  // search
  page.input({ detail: { value: '  漠河  ' } })
  page.search()
  await tick()
  assert.equal(page.data.keyword, '漠河')

  // type filter
  page.switchType(event({ type: 'review' }))
  await tick()
  assert.equal(page.data.type, 'review')

  // refresh（下拉刷新）
  const pullsBefore = wxCalls.pullDown
  page.onPullDownRefresh()
  await tick()
  assert.ok(wxCalls.pullDown > pullsBefore, '下拉刷新完成后应调用 wx.stopPullDownRefresh')

  // load more：翻页请求必须带 cursor，并按 id 去重
  page.onReachBottom()
  await tick()
  assert.equal(last(calls.feed).cursor, 'cursor-1', 'load more 必须带真实 cursor')
  assert.equal(page.data.posts.length, 3, '重复 id 不应重复插入')
  assert.equal(page.data.posts[0].id, 'p1')
  assert.equal(page.data.posts[1].id, 'p2')

  // like / favorite
  await page.like(event({ index: 0 }))
  assert.equal(page.data.posts[0].viewerLiked, true)
  assert.equal(page.data.posts[0].likeCount, 4)
  assert.ok(last(calls.like).requestKey, '点赞必须带幂等键')
  await page.favorite(event({ index: 0 }))
  assert.equal(page.data.posts[0].viewerFavorited, true)
  assert.equal(page.data.posts[0].favoriteCount, 2)

  // open post / open member
  page.open(event({ id: 'p1' }))
  assert.equal(last(wxCalls.navigation), '/pages/post-detail/post-detail?id=p1')
  page.member(event({ id: 'u1' }))
  assert.equal(last(wxCalls.navigation), '/pages/member/member?id=u1')
  page.compose()
  assert.equal(last(wxCalls.navigation), '/pages/post-edit/post-edit')

  // following + login required
  responses.feed = () => ({ items: [], nextCursor: null, hasMore: false, requiresLogin: true })
  page.switchTab(event({ tab: 'following' }))
  await tick()
  assert.equal(page.data.posts.length, 0)
  assert.equal(page.data.requiresLogin, true, '未登录关注流应回 requiresLogin')
  assert.equal(page.data.emptyTitle, '登录后查看关注流')
  page.goLogin()
  assert.equal(last(wxCalls.navigation), '/pages/me/me')
  assert.equal(store.takeLoginSource(), '社区关注流')

  // guest 互动必须被拦截并回到我的页
  store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
  const guest = pageOf('community')
  guest.setData({ posts: [Object.assign({}, page.data.posts[0])], cloud: true })
  await guest.like(event({ index: 0 }))
  assert.equal(calls.like.length, 1, '游客点赞不应发出请求')
  assert.match(guest.data.error, /登录/)
  assert.equal(last(wxCalls.navigation), '/pages/me/me')
  assert.equal(store.takeLoginSource(), '社区点赞')

  // 云端失败：不能伪装成本机演示，且保留重试入口
  cloudSession()
  responses.feed = () => { throw new Error('cloud.callContainer:fail request timeout') }
  const failing = pageOf('community')
  await failing.refresh(true)
  assert.equal(failing.data.cloud, true)
  assert.match(failing.data.error, /云端暂时没有响应/)
  assert.equal(failing.data.emptyMessage, '加载失败，请重试')

  // guest feed：未登录也能读公开内容流（公开读路径）
  store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
  resetResponses()
  responses.feed = () => ({ items: [cloudPost({ id: 'guest-visible' })], nextCursor: null, hasMore: false })
  const guestFeed = pageOf('community')
  await guestFeed.refresh(true)
  assert.equal(guestFeed.data.posts.length, 1, '游客应能读取公开内容流')
  assert.equal(guestFeed.data.posts[0].id, 'guest-visible')
  assert.equal(guestFeed.data.cloud, true)
  assert.equal(calls.feed.at(-1).tab, 'recommend')
  console.log('PASS community: recommend/following/search/type filter/refresh/load more/like/favorite/open/guest gate/cloud failure')
}

/* ------------------------------------------------------------------ 2 member */
async function memberProfile() {
  const endpoints = require('../config/endpoints')
  cloudSession()
  resetResponses()
  const memberHead = {
    user: { id: 'u1', nickname: '路线资料员', bio: '常年在东北跑', avatarUrl: '', avatarMediaId: null },
    stats: { followingCount: 4, followerCount: 9, likeReceivedCount: 12 },
    viewerFollowing: false
  }
  responses.member = () => Object.assign({}, memberHead, {
    posts: [cloudPost({ photos: ['https://cdn.example/1.jpg'] })],
    nextCursor: 'member-cursor-1',
    hasMore: true
  })
  // 第二页：包含一条与第一页重复的 id，用来验证去重合并
  responses.api = () => Object.assign({}, memberHead, {
    posts: [cloudPost({ id: 'p1', photos: [] }), cloudPost({ id: 'p2', title: '第二页内容', photos: [] })],
    nextCursor: null,
    hasMore: false
  })

  const page = pageOf('member')
  page.onLoad({ id: 'u1' })
  await tick()
  assert.equal(page.data.cloud, true)
  assert.equal(page.data.busy, false)
  assert.equal(page.data.isSelf, false)
  assert.equal(page.data.canFollow, true)
  assert.equal(page.data.stats.followerCount, 9)
  assert.equal(page.data.posts.length, 1)
  assert.equal(page.data.posts[0].typeLabel, '旅行路线')
  assert.equal(page.data.posts[0].placeText, '哈尔滨 · 漠河')
  assert.equal(page.data.posts[0].likeCount, 3)
  assert.equal(page.data.hasMore, true)
  assert.equal(page.data.nextCursor, 'member-cursor-1')
  assert.equal(page.data.canLoadMore, true)
  assert.equal(calls.member[0].argc, 1, '首屏沿用命名包装，按后端默认 limit=20 取第一页')

  // 翻页：必须带真实 cursor + 显式 limit=20，并按 id 去重合并
  await page.loadMore()
  assert.equal(calls.api.length, 1, '翻页应走一次注册表端点调用')
  assert.equal(calls.api[0].endpoint, endpoints.community.user('u1'), '翻页必须使用路由注册表端点')
  assert.deepEqual(calls.api[0].payload, { cursor: 'member-cursor-1', limit: 20 })
  assert.equal(calls.api[0].argc, 2)
  assert.equal(page.data.posts.length, 2, '重复 id 不应重复插入')
  assert.deepEqual(page.data.posts.map(item => item.id), ['p1', 'p2'])
  assert.equal(page.data.hasMore, false)
  assert.equal(page.data.nextCursor, null)
  assert.equal(page.data.canLoadMore, false, '没有更多数据时不得显示加载入口')
  page.loadMore()
  page.onReachBottom()
  await tick()
  assert.equal(calls.api.length, 1, 'canLoadMore=false 时不得再发请求')

  // 竞态 1：连点两次只发一次请求
  const double = pageOf('member')
  double.onLoad({ id: 'u1' })
  await tick()
  const gate = deferred()
  responses.api = () => gate.promise
  const first = double.loadMore()
  double.loadMore()
  double.onReachBottom()
  gate.resolve(Object.assign({}, memberHead, { posts: [cloudPost({ id: 'p2', photos: [] })], nextCursor: null, hasMore: false }))
  await first
  await tick()
  assert.equal(calls.api.length, 2, '并发点击只能产生一次翻页请求')
  assert.equal(double.data.loadingMore, false)

  // 竞态 2：翻页在途时账号切换 → 旧响应必须被丢弃
  const switching = pageOf('member')
  switching.onLoad({ id: 'u1' })
  await tick()
  const pending = deferred()
  responses.api = () => pending.promise
  responses.member = () => Object.assign({}, memberHead, { posts: [cloudPost({ id: 'wx2-post', photos: [] })], nextCursor: null, hasMore: false })
  const inflight = switching.loadMore()
  store.setSession({ kind: 'wechat', id: 'wx-2', nickname: '另一个账号' })
  switching.onShow()
  await tick()
  pending.resolve(Object.assign({}, memberHead, { posts: [cloudPost({ id: 'stale-post', photos: [] })], nextCursor: null, hasMore: false }))
  await inflight
  await tick()
  assert.deepEqual(switching.data.posts.map(item => item.id), ['wx2-post'], '账号切换后不得把旧会话的翻页结果合并进来')

  // 竞态 3：翻页在途时刷新 → 旧翻页响应必须被丢弃
  const refreshing = pageOf('member')
  responses.member = () => Object.assign({}, memberHead, { posts: [cloudPost({ id: 'head-post', photos: [] })], nextCursor: 'c-head', hasMore: true })
  refreshing.onLoad({ id: 'u1' })
  await tick()
  const slow = deferred()
  responses.api = () => slow.promise
  const late = refreshing.loadMore()
  responses.member = () => Object.assign({}, memberHead, { posts: [cloudPost({ id: 'fresh-post', photos: [] })], nextCursor: null, hasMore: false })
  await refreshing.load(true)
  slow.resolve(Object.assign({}, memberHead, { posts: [cloudPost({ id: 'stale-post', photos: [] })], nextCursor: null, hasMore: false }))
  await late
  await tick()
  assert.deepEqual(refreshing.data.posts.map(item => item.id), ['fresh-post'], '刷新之后在途的翻页响应不得回灌')

  // 恢复默认桩，继续后面的用例
  delete responses.api
  responses.member = () => Object.assign({}, memberHead, {
    posts: [cloudPost({ photos: ['https://cdn.example/1.jpg'] })], nextCursor: 'member-cursor-1', hasMore: true
  })

  // follow / unfollow（返回计数做同步）
  const follower = pageOf('member')
  follower.onLoad({ id: 'u1' })
  await tick()
  await follower.follow()
  assert.equal(follower.data.following, true)
  assert.equal(last(calls.follow).active, true)
  assert.equal(follower.data.stats.followerCount, 10)
  await follower.follow()
  assert.equal(follower.data.following, false)
  assert.equal(follower.data.stats.followerCount, 9)

  // 单页满 20 条时仍以真实 hasMore 为准（不因为条数猜「到底了」）
  responses.member = () => ({
    user: { id: 'u2', nickname: '高产作者', bio: '', avatarUrl: '', avatarMediaId: null },
    stats: {}, posts: new Array(20).fill(0).map((_, index) => cloudPost({ id: 'p' + index })),
    viewerFollowing: false, nextCursor: 'cursor-20', hasMore: true
  })
  const full = pageOf('member')
  full.onLoad({ id: 'u2' })
  await tick()
  assert.equal(full.data.posts.length, 20, '初次加载仍为 20 条')
  assert.equal(full.data.canLoadMore, true, '后端说还有下一页时不得提前宣称到底')

  // 后端 hasMore=true 但没给 cursor（异常信封）：不得显示假入口
  responses.member = () => ({
    user: { id: 'u3', nickname: '异常作者', bio: '', avatarUrl: '', avatarMediaId: null },
    stats: {}, posts: [cloudPost()], viewerFollowing: false, nextCursor: null, hasMore: true
  })
  const broken = pageOf('member')
  broken.onLoad({ id: 'u3' })
  await tick()
  assert.equal(broken.data.canLoadMore, false, '没有真实 cursor 时不得显示加载入口')

  // self member：不出现关注按钮
  cloudSession()
  responses.member = () => ({
    user: { id: 'wx-1', nickname: '我', bio: '', avatarUrl: '', avatarMediaId: null },
    stats: { followerCount: 1 }, posts: [], viewerFollowing: false
  })
  const self = pageOf('member')
  self.onLoad({ id: 'wx-1' })
  await tick()
  assert.equal(self.data.isSelf, true)
  assert.equal(self.data.canFollow, false, '自己的成员页不应出现关注操作')

  // 本机模式：只展示 public
  cloudReady = false
  store.setSession({ kind: 'demo', id: 'demo', nickname: '本地演示用户' })
  store.mutate(state => {
    state.posts = [
      { id: 'local-public', authorId: 'seed', authorName: '路线资料员', type: 'question', title: '公开问题', content: 'x', placeNames: ['漠河'], places: [], photos: [], visibility: 'public', createdAt: '2026-09-14T00:00:00Z', answers: [] },
      { id: 'local-private', authorId: 'seed', authorName: '路线资料员', type: 'question', title: '私密草稿', content: 'x', placeNames: [], places: [], photos: [], visibility: 'private', createdAt: '2026-09-15T00:00:00Z', answers: [] }
    ]
  })
  const local = pageOf('member')
  local.onLoad({ id: 'seed' })
  await tick()
  assert.equal(local.data.cloud, false)
  assert.equal(local.data.canFollow, false)
  assert.ok(local.data.posts.every(item => item.visibility === 'public'), '成员页不得出现 private 内容')
  assert.ok(!local.data.posts.some(item => item.id === 'local-private'))
  cloudReady = true

  // guest read：未登录也能读公开帖子，但关注操作会被拦截回「我的」
  store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
  responses.member = () => Object.assign({}, memberHead, { posts: [cloudPost({ id: 'guest-post' })], nextCursor: null, hasMore: false })
  const guestView = pageOf('member')
  guestView.onLoad({ id: 'u1' })
  await tick()
  assert.equal(guestView.data.cloud, true)
  assert.equal(guestView.data.posts.length, 1, '游客应能读取公开帖子')
  assert.equal(guestView.data.canFollow, true)
  const followsBefore = calls.follow.length
  await guestView.follow()
  assert.equal(calls.follow.length, followsBefore, '游客关注不得发请求')
  assert.match(guestView.data.error, /登录/)
  assert.equal(last(wxCalls.navigation), '/pages/me/me')
  console.log('PASS member: guest/cloud read, real cursor pagination + dedupe, race guards, follow toggle, self member, public-only local list')
}

/* ------------------------------------------------------------- 3 post detail */
async function postDetail() {
  cloudSession()
  resetResponses()
  let owner = false
  responses.postDetail = () => ({ post: cloudPost({ isOwner: owner, permissions: { isOwner: owner } }), author: { id: 'u1', nickname: '路线资料员' }, viewerFollowing: false, isOwner: owner })
  responses.comments = () => ({
    items: [
      commentFixture(),
      commentFixture({ id: 'c2', rootId: 'c1', replyToId: 'c1', replyToUserId: 'u2', replyToUserName: '早起的鸟', content: '同意，冬天要多留一天。', canDelete: true })
    ],
    nextCursor: null,
    hasMore: false
  })

  const page = pageOf('post-detail')
  page.onLoad({ id: 'p1' })
  await tick()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.cloud, true)
  assert.equal(page.data.owned, false)
  assert.equal(page.data.typeLabel, '旅行路线')
  assert.equal(page.data.publishedText, '2026-09-12')
  assert.equal(page.data.placeText, '哈尔滨 · 漠河')
  assert.equal(page.data.post.photoLayout, 'double', '两张图应为双列布局档位')
  assert.equal(page.data.post.photos.length, 2)
  assert.equal(page.data.comments.length, 2)
  assert.equal(page.data.comments[0].authorName, '早起的鸟', '评论作者名应取 author.nickname')
  assert.equal(page.data.comments[1].replyToUserName, '早起的鸟')
  assert.equal(page.data.comments[1].canDelete, true)
  assert.equal(page.data.viewerFollowing, false)

  // like / favorite / follow
  await page.like()
  assert.equal(page.data.viewerLiked, true)
  assert.equal(page.data.post.likeCount, 4)
  await page.favorite()
  assert.equal(page.data.viewerFavorited, true)
  assert.equal(page.data.post.favoriteCount, 2)
  await page.follow()
  assert.equal(page.data.viewerFollowing, true)
  assert.equal(last(calls.follow).active, true)

  // 图片预览
  page.previewPhoto(event({ index: 1 }))
  assert.equal(wxCalls.previews.length, 1)
  assert.equal(wxCalls.previews[0].current, 'https://cdn.example/2.jpg')

  // 回复 + 提交评论
  page.reply(event({ index: 1 }))
  assert.equal(page.data.replyTarget.id, 'c2')
  page.field({ detail: { value: '谢谢，我按这个试试。' } })
  await page.submitComment()
  const submit = calls.comments.filter(entry => entry.content).pop()
  assert.equal(submit.content, '谢谢，我按这个试试。')
  assert.equal(submit.replyToId, 'c2', '回复必须带上被回复的评论 id')
  assert.ok(submit.requestKey, '评论必须带幂等键')
  assert.equal(page.data.commentDraft, '')
  assert.equal(page.data.replyTarget, null)
  assert.ok(wxCalls.toasts.includes('评论已发布'))

  // 删除自己的评论：只有 canDelete 才允许
  const before = calls.deleteComment.length
  await page.removeComment(event({ index: 0 }))
  assert.equal(calls.deleteComment.length, before, 'canDelete=false 的评论不得被删除')
  await page.removeComment(event({ index: 1 }))
  assert.equal(calls.deleteComment.length, before + 1)
  assert.ok(last(calls.deleteComment).requestKey, '删除评论必须带幂等键')
  assert.ok(wxCalls.modals.some(title => /删除这条评论/.test(title || '')), '删除评论应先二次确认')

  // 举报（低频二级动作）
  page.openReport(event({ targetType: 'post', targetId: 'p1' }))
  assert.equal(page.data.reportOpen, true)
  assert.equal(page.data.reportTarget.id, 'p1')
  page.reportReason({ detail: { value: '1' } })
  page.reportField({ detail: { value: '重复广告' } })
  await page.submitReport()
  assert.equal(last(calls.report).reason, 'abuse')
  assert.equal(last(calls.report).details, '重复广告')
  assert.ok(last(calls.report).requestKey, '举报必须带幂等键')
  assert.equal(page.data.reportOpen, false)

  // private owner：作者看自己的私密帖
  owner = true
  responses.postDetail = () => ({ post: cloudPost({ isOwner: true, visibility: 'private', moderationStatus: 'pending', permissions: { isOwner: true } }), author: { id: 'u1', nickname: '路线资料员' }, viewerFollowing: false, isOwner: true })
  const mine = pageOf('post-detail')
  mine.onLoad({ id: 'p1' })
  await tick()
  assert.equal(mine.data.owned, true)
  assert.equal(mine.data.post.visibility, 'private')
  assert.equal(mine.data.post.moderationStatus, 'pending')
  console.log('PASS post-detail: public detail, private owner, like/favorite/follow, comments/reply/delete-own, report, photo preview')
}

/* --------------------------------------------------------------- 4 post edit */
async function postEdit() {
  cloudSession()
  resetResponses()

  // create（问题帖，public / private 两种可见范围）
  const create = pageOf('post-edit')
  create.onLoad({})
  assert.equal(create.data.cloud, true)
  create.setType(event({ index: 2 }))
  assert.equal(create.data.typeIndex, 2)
  create.field(event({ key: 'title' }, '漠河冬天怎么去'))
  create.field(event({ key: 'content' }, '想坐火车，预算有限。'))
  create.field(event({ key: 'places' }, '漠河，哈尔滨'))
  create.setVisibility(event({ public: 'false' }))
  assert.equal(create.data.public, false)
  await create.publish()
  assert.equal(calls.uploadPhotos.length, 1)
  const created = last(calls.createPost)
  assert.equal(created.type, 'question')
  assert.equal(created.visibility, 'private')
  assert.deepEqual(created.placeNames, ['漠河', '哈尔滨'])
  assert.ok(created.requestKey, '发布必须带幂等键')
  assert.equal(last(wxCalls.navigation), '/pages/post-detail/post-detail?id=new-post')
  assert.equal(store.readPostDraft(), null, '发布成功后应清空草稿')
  assert.equal(last(wxCalls.toasts), '已保存')

  // 校验：问题帖也要有标题和正文
  const invalid = pageOf('post-edit')
  invalid.onLoad({})
  invalid.setType(event({ index: 2 }))
  invalid.field(event({ key: 'title' }, '只有标题'))
  await invalid.publish()
  assert.equal(invalid.data.error, '请填写标题和正文')
  assert.equal(calls.createPost.length, 1, '校验失败不得发请求')

  // route 帖必须有方案
  const route = pageOf('post-edit')
  route.onLoad({})
  route.setType(event({ index: 0 }))
  route.field(event({ key: 'title' }, '路线分享'))
  route.field(event({ key: 'content' }, '正文'))
  await route.publish()
  assert.equal(route.data.error, '路线帖请选择一个现有方案或已完成行程')

  // review 帖：地点 + 推荐程度 + 旅行日期
  const review = pageOf('post-edit')
  review.onLoad({})
  review.setType(event({ index: 1 }))
  review.field(event({ key: 'title' }, '漠河体验'))
  review.field(event({ key: 'content' }, '值得去。'))
  await review.publish()
  assert.equal(review.data.error, '评价帖请选择一个已确认地点')
  review.setData({ selectedPlaces: [{ id: 'seed-1', name: '漠河' }] })
  await review.publish()
  assert.equal(review.data.error, '推荐程度为 1–5 整数')
  review.setRating(event({ rating: '4' }))
  assert.equal(review.data.rating, 4)
  await review.publish()
  assert.equal(review.data.error, '评价帖请填写旅行日期')
  review.date({ detail: { value: '2026-01-18' } })
  await review.publish()
  const reviewPayload = last(calls.createPost)
  assert.equal(reviewPayload.type, 'review')
  assert.equal(reviewPayload.rating, 4)
  assert.equal(reviewPayload.visitDate, '2026-01-18')
  assert.equal(reviewPayload.visibility, 'public')

  // media：选图 / 移除 / 上限
  const media = pageOf('post-edit')
  media.onLoad({})
  media.photo()
  assert.equal(media.data.photos.length, 1)
  assert.equal(media.data.photos[0].path, 'tmp/photo-a.jpg')
  media.removePhoto(event({ index: 0 }))
  assert.equal(media.data.photos.length, 0)

  // edit：载入已有内容，保留 version 与 mediaId，改完后走 updatePost
  responses.postDetail = () => ({
    post: cloudPost({
      isOwner: true, type: 'review', title: '旧标题', content: '旧正文', visibility: 'public', version: 7,
      rating: 5, visitDate: '2026-01-02', duration: '半天', mediaIds: ['media-existing'],
      places: [{ id: 'seed-1', name: '漠河' }], permissions: { isOwner: true }
    }),
    author: { id: 'u1', nickname: '路线资料员' },
    isOwner: true
  })
  const edit = pageOf('post-edit')
  edit.onLoad({ id: 'p1' })
  await tick()
  assert.equal(edit.data.editingId, 'p1')
  assert.equal(edit.data.title, '旧标题')
  assert.equal(edit.data.rating, 5)
  assert.equal(edit.data.visitDate, '2026-01-02')
  assert.equal(edit.data.photos[0].mediaId, 'media-existing', '编辑态必须保留已有图片标识')
  assert.deepEqual(edit.data.selectedPlaces.map(place => place.id), ['seed-1'])
  edit.field(event({ key: 'title' }, '新标题'))
  await edit.publish()
  const updated = last(calls.updatePost)
  assert.equal(updated.id, 'p1')
  assert.equal(updated.title, '新标题')
  assert.equal(updated.version, 7)
  assert.deepEqual(updated.photos, ['media-existing'])

  // draft：字段变化即保存，重新进入可恢复
  const draftPage = pageOf('post-edit')
  draftPage.onLoad({})
  draftPage.setType(event({ index: 2 }))
  draftPage.field(event({ key: 'title' }, '草稿标题'))
  draftPage.field(event({ key: 'content' }, '草稿正文'))
  assert.equal(store.readPostDraft().title, '草稿标题')
  const restored = pageOf('post-edit')
  restored.onLoad({})
  assert.equal(restored.data.title, '草稿标题')
  assert.equal(restored.data.content, '草稿正文')
  assert.equal(restored.data.typeIndex, 2)
  assert.ok(restored.data.draftSavedAt, '草稿时间应回填到页面')
  console.log('PASS post-edit: create/edit, public+private, media, route/review/question validation, draft restore')
}

async function main() {
  await communityFeed()
  await memberProfile()
  await postDetail()
  await postEdit()
  console.log('\nAll community flow checks passed. No network calls, no real storage writes.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
