const store = require('../../utils/travel-store')
const ui = require('../../utils/travel-ui')
const service = require('../../utils/travel-services')
const travelSync = require('../../utils/travel-sync')
function postView(item) {
  const placeText = Array.isArray(item.placeNames) ? item.placeNames.join(' · ') : (item.placeNames || '')
  const statusText = item.unavailable ? '内容已不可用' : item.deleted ? '已删除' : item.moderationStatus === 'pending' ? '审核中' : item.moderationStatus === 'rejected' ? '未通过' + (item.moderationReason ? '：' + item.moderationReason : '') : item.visibility === 'private' ? '仅自己可见' : '公开'
  // 行内一行说明：异常/私有状态优先，其次地点，最后互动数据（后端返回统计时才显示，不伪造）
  const likes = Number(item.likeCount), comments = Number(item.commentCount)
  const metricText = Number.isFinite(likes) || Number.isFinite(comments)
    ? (Number.isFinite(likes) ? likes : 0) + ' 赞 · ' + (Number.isFinite(comments) ? comments : 0) + ' 评论'
    : ''
  return Object.assign({}, item, { placeText, statusText,
    metaLine: [statusText === '公开' ? '' : statusText, placeText, metricText].filter(Boolean).join(' · ') })
}
// G6：把接口/本机字段翻译成页面直接可读的展示数据，WXML 不再承担长三元表达式。
const NOTICE_TEXT = { follow: '关注了你', like: '赞了你的帖子', reply: '回复了你的评论', comment: '评论了你的帖子' }
const DATA_RULE = '游客与微信账号的数据分别保存；退出账号不会删除本机缓存，登录也不会自动带入游客行程。'
function noticeView(item) {
  return Object.assign({}, item, { text: (item && item.actorName || '有人') + (NOTICE_TEXT[item && item.type] || '与你有新的互动') })
}
Page({
  data: {
    user: { kind: 'guest', nickname: '游客' }, trips: [], posts: [], favorites: [], activeItems: [], notifications: [], stats: {},
    myTab: 'posts', error: '', loginSource: '', syncError: '', syncText: '', editing: false, busy: false, profileBusy: false, noticeBusy: false,
    cloud: false, unreadCount: 0, avatarDraft: '', avatarChanged: false, nicknameDraft: '', bioDraft: '',
    settingsOpen: false, notificationsOpen: false,
    // 2026-09-18：行程提醒与本地演示方案入口下线；本页不再有提醒档位与方案列表二级态。
    relationOpen: false, relationTab: 'following', relationItems: [], relationCursor: null, relationHasMore: false,
    relationBusy: false, relationActionBusy: false, relationError: '', favoriteBusy: false, legacyPosts: [], republishBusy: false,
    // G6：页面派生状态（身份文案 / 卡片 meta），由 syncAccountView / loadTravel / syncActive 统一计算
    account: { wechat: false, statsReady: false, stateLabel: '本机模式 · 数据仅存于此设备', idLine: 'ID · 未登录', bioText: '', dataNote: DATA_RULE },
    travelMeta: '0 个行程'
  },
  onLoad() {
    // 开发测试选项（进入本地演示数据）已随演示方案链路一并下线，本页不再读取开发版环境。
  },
  async onShow() {
    if (this.data.busy || this.data.profileBusy) return
    this.applyLocal()
    const loginSource = store.takeLoginSource()
    // 来源提示只在社区内容区渲染一次（社区内容常驻可见），不再重复顶到顶部 error 条
    if (loginSource && store.session().kind === 'guest') this.setData({ loginSource })
    if (store.session().kind === 'wechat') await this.refreshAccount()
  },
  loadTravel() {
    const s = store.read(), kind = store.session().kind, conflicts = store.syncConflicts(s)
    // 本地方案链路已下线：这里只统计行程。真实方案保存在规划缓存里，从菜单/方案页进入。
    this.setData({ trips: s.trips.slice().reverse(),
      travelMeta: s.trips.length + ' 个行程',
      syncText: kind !== 'wechat' ? '仅保存在本机，与微信账号数据分开。'
        : conflicts.length ? '有 ' + conflicts.length + ' 项改动在云端已有更新版本，已采用云端版本。'
        : s.sync && s.sync.dirty ? '本机有待同步的修改。'
        : s.sync && s.sync.lastSyncedAt ? '上次同步已完成；离线时可查看本机缓存。' : '当前显示本机缓存，尚未确认同步。' })
  },
  // 身份卡的展示文案只在 session / cloud 变化时重算，避免 WXML 里散落长三元
  syncAccountView() {
    const user = this.data.user || { kind: 'guest' }, cloud = Boolean(this.data.cloud)
    const guest = user.kind === 'guest', demo = user.kind === 'demo'
    this.setData({ account: {
      wechat: user.kind === 'wechat',
      statsReady: user.kind === 'wechat' && cloud,
      stateLabel: guest ? '本机模式 · 数据仅存于此设备'
        : demo ? '本地演示 · 数据仅存于此设备'
        : cloud ? '微信账号 · 资料已加载' : '微信账号 · 资料待加载',
      idLine: guest ? 'ID · 未登录'
        : demo ? 'ID · 本地演示'
        : cloud ? 'ID · 微信账号已绑定' : 'ID · 资料待加载',
      bioText: guest ? '登录后可关注旅友、收藏内容，把方案与行程同步到云端。'
        : demo ? '本地演示数据不会上传云端；退出当前账号后可回到游客空间。'
        : String(user.bio || '').trim() || '还没有写简介。记录你的旅行偏好，让同行者更了解你。',
      dataNote: (guest ? '当前是游客空间：方案、行程与帖子只保存在本机。'
        : demo ? '当前是本地演示空间：数据只保存在本机，不上传云端。'
        : '当前是微信账号：资料与旅行数据同步到云端。') + DATA_RULE
    } })
  },
  syncActive() {
    this.setData({ activeItems: this.data.myTab === 'favorites' ? this.data.favorites : this.data.posts })
  },
  applyLocal() {
    const user = store.session()
    const changed = !this._displayIdentity || !store.isCurrentSession(this._displayIdentity)
    if (changed) {
      this._pendingMigration = null
      this.relationActionKeys = {}
      this.favoriteRemoveKeys = {}
      this.setData({ user, cloud: false, posts: [], favorites: [], activeItems: [], notifications: [], stats: {}, unreadCount: 0,
        editing: false, profileBusy: false, noticeBusy: false, avatarDraft: '', avatarChanged: false, nicknameDraft: '', bioDraft: '',
        myTab: 'posts', notificationsOpen: false, error: '', loginSource: '', syncError: '',
        relationOpen: false, relationTab: 'following', relationItems: [], relationCursor: null, relationHasMore: false,
        relationBusy: false, relationActionBusy: false, relationError: '', favoriteBusy: false, legacyPosts: [], republishBusy: false })
      this._displayIdentity = store.sessionIdentity()
    } else this.setData({ user })
    if (user.kind !== 'wechat') this.setData({ cloud: false, posts: store.read().posts.slice().reverse().map(postView), favorites: [] }, () => this.syncActive())
    this.syncAccountView()
    this.loadTravel()
  },
  persistCloudSession(user) {
    if (!user) return
    store.setSession(Object.assign({}, store.session(), { nickname: user.nickname || '微信用户', bio: user.bio || '', avatarMediaId: user.avatarMediaId || null, avatarUrl: user.avatarUrl || null, profileVersion: user.profileVersion || 1 }))
  },
  applyCloud(out) {
    if (!out || !out.user) throw new Error('账号资料返回不完整，请重试。')
    this.persistCloudSession(out.user)
    this.setData({ user: Object.assign({}, out.user, { kind: 'wechat' }), stats: out.stats || {}, posts: (out.posts || []).map(postView),
      favorites: (out.favorites || []).map(postView), notifications: (out.notifications || []).map(noticeView),
      unreadCount: out.unreadCount || 0, cloud: true }, () => this.syncActive())
    this.syncAccountView()
    this.loadTravel()
    this.loadLegacyPosts()
    if (this.data.relationOpen) this.loadRelations(true)
  },
  async refreshAccount() {
    if (this.data.busy || store.session().kind !== 'wechat') return
    const identity = store.sessionIdentity()
    this.setData({ busy: true, error: '', syncError: '' })
    try {
      await service.validateSession()
      if (!store.isCurrentSession(identity)) return
      const out = await service.me()
      if (!store.isCurrentSession(identity)) return
      this.applyCloud(out)
      await this.syncTravel(identity)
    } catch (error) {
      if (store.isCurrentSession(identity)) { this.setData({ cloud: false, error: ui.friendlyError(error) }); this.syncAccountView() }
      else if (error.status === 401 && store.session().kind === 'guest') {
        this.applyLocal()
        this.setData({ error: '微信登录已过期，请重新登录。本机数据仍保留。' })
      }
    } finally { this.setData({ busy: false }) }
  },
  async syncTravel(identity) {
    try {
      const result = await travelSync.syncNow(this._pendingMigration ? { state: this._pendingMigration } : {})
      if (!store.isCurrentSession(identity)) return
      if (result) this._pendingMigration = null
      this.loadTravel()
      // 冲突项是「本机改动被云端版本取代」，必须显式告知，不能报成同步成功。
      const conflicts = store.syncConflicts(result || store.read())
      this.setData({ syncError: conflicts.length
        ? '有 ' + conflicts.length + ' 项改动在云端已有更新版本，已采用云端版本；请核对后再修改。'
        : result ? '' : '同步尚未完成，请稍后重试。' })
    } catch (error) {
      if (store.isCurrentSession(identity)) this.setData({ syncError: '旅行数据同步失败，本机数据未删除。请重试同步。' })
    }
  },
  async login() {
    if (this.data.busy || this.data.profileBusy || store.session().kind === 'wechat') return
    this.setData({ busy: true, error: '', syncError: '' })
    let identity = store.sessionIdentity(), loggedIn = false
    try {
      const localState = store.read()
      await service.login()
      identity = store.sessionIdentity()
      loggedIn = true
      this.applyLocal()
      if (localState.plans.length || localState.trips.length) {
        const migrate = await ui.confirm('带入本机旅行数据？', '确定：将刚才的方案和行程同步到此微信账号。取消：跳过同步，原数据仍留在游客或演示空间，退出账号后可查看。')
        if (!store.isCurrentSession(identity)) return
        if (migrate) this._pendingMigration = localState
      }
      const out = await service.me()
      if (!store.isCurrentSession(identity)) return
      this.applyCloud(out)
      await this.syncTravel(identity)
    } catch (error) {
      if (store.isCurrentSession(identity) && !service.isSessionChanged(error))
        this.setData({ error: loggedIn ? '微信身份已确认，但资料加载未完成。请重试。' : '登录未完成：' + ui.friendlyError(error) })
    } finally { this.setData({ busy: false }) }
  },
  editProfile() {
    if (!this.data.cloud || this.data.busy) return
    this.setData({ editing: true, nicknameDraft: this.data.user.nickname || '', bioDraft: this.data.user.bio || '', avatarDraft: this.data.user.avatarUrl || this.data.user.avatarMediaId || '', avatarChanged: false, error: '' })
  },
  cancelProfile() { if (!this.data.profileBusy) this.setData({ editing: false, avatarDraft: '', avatarChanged: false, nicknameDraft: '', bioDraft: '', error: '' }) },
  chooseAvatar(e) { if (!this.data.profileBusy) this.setData({ avatarDraft: e.detail.avatarUrl || '', avatarChanged: true }) },
  nickname(e) { this.setData({ nicknameDraft: e.detail.value }) },
  bio(e) { this.setData({ bioDraft: e.detail.value }) },
  async saveProfile() {
    if (this.data.profileBusy || this.data.busy || !this.data.cloud || store.session().kind !== 'wechat') return
    const nickname = String(this.data.nicknameDraft || '').trim()
    if (!nickname || nickname.length > 20) { this.setData({ error: '昵称需填写 1–20 个字。' }); return }
    const identity = store.sessionIdentity()
    this.setData({ profileBusy: true, error: '' })
    try {
      let avatar = this.data.avatarChanged ? this.data.avatarDraft : (this.data.user.avatarMediaId || null)
      // chooseAvatar may return http://tmp/... in DevTools: it is still a local file.
      if (avatar && this.data.avatarChanged && !/^cloud:/.test(avatar)) avatar = await service.uploadMedia(avatar, 'community/avatars')
      if (!store.isCurrentSession(identity)) return
      const out = await service.updateProfile({ version: this.data.user.profileVersion, nickname, bio: this.data.bioDraft, avatarMediaId: avatar || null })
      if (!store.isCurrentSession(identity)) return
      this.persistCloudSession(out.user)
      this.setData({ user: Object.assign({}, out.user, { kind: 'wechat' }), editing: false, avatarDraft: '', avatarChanged: false, nicknameDraft: '', bioDraft: '' })
      this.syncAccountView()
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) { if (store.isCurrentSession(identity)) this.setData({ error: ui.friendlyError(error) }) }
    finally { this.setData({ profileBusy: false }) }
  },
  async logout() {
    if (this.data.busy || this.data.profileBusy) return
    const identity = store.sessionIdentity()
    if (!await ui.confirm('退出当前账号？', '退出后回到游客空间；当前账号的本机缓存会保留，不会与游客数据混在一起。')) return
    if (!store.isCurrentSession(identity)) return
    store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
    this.applyLocal()
  },
  toggleSettings() { this.setData({ settingsOpen: !this.data.settingsOpen }) },
  closeSettings() { if (this.data.settingsOpen) this.setData({ settingsOpen: false }) },
  // 抽屉遮罩：拦截滑动，避免滚动穿透到背后的页面
  preventMove() {},
  toggleNotifications() { this.setData({ notificationsOpen: !this.data.notificationsOpen }) },
  openRelations(e) {
    if (!this.data.cloud) return
    const tab = e.currentTarget.dataset.relation === 'followers' ? 'followers' : 'following'
    if (this.data.relationOpen && this.data.relationTab === tab) { this.setData({ relationOpen: false }); return }
    this.setData({ relationOpen: true, relationTab: tab, relationItems: [], relationCursor: null, relationHasMore: false, relationError: '' }, () => this.loadRelations(true))
  },
  relationActive(identity, seq, tab) { return store.isCurrentSession(identity) && this.relationSeq === seq && this.data.relationTab === tab && this.data.relationOpen },
  async loadRelations(reset) {
    if (!this.data.cloud || store.session().kind !== 'wechat' || (!reset && this.data.relationBusy)) return
    const tab = this.data.relationTab, identity = store.sessionIdentity(), seq = (this.relationSeq || 0) + 1
    this.relationSeq = seq
    const cursor = reset ? null : this.data.relationCursor
    this.setData({ relationBusy: true, relationError: '', ...(reset ? { relationItems: [], relationCursor: null, relationHasMore: false } : {}) })
    try {
      const out = tab === 'followers' ? await service.followers({ cursor, limit: 20 }) : await service.following({ cursor, limit: 20 })
      if (!this.relationActive(identity, seq, tab)) return
      const incoming = Array.isArray(out.items) ? out.items : [], seen = new Set(reset ? [] : this.data.relationItems.map(item => item.id)), items = (reset ? [] : this.data.relationItems).concat(incoming.filter(item => item && !seen.has(item.id)))
      this.setData({ relationItems: items, relationCursor: out.nextCursor || null, relationHasMore: out.hasMore === true })
    } catch (error) {
      if (this.relationActive(identity, seq, tab)) this.setData({ relationError: ui.friendlyError(error) })
    } finally {
      if (this.relationActive(identity, seq, tab)) this.setData({ relationBusy: false })
    }
  },
  relationMore() { if (this.data.relationHasMore && !this.data.relationBusy) this.loadRelations(false) },
  openMember(e) { const id = e.currentTarget.dataset.id; if (id) ui.open('member', 'id=' + encodeURIComponent(id)) },
  async relationAction(e) {
    if (this.data.relationActionBusy || !this.data.cloud || store.session().kind !== 'wechat') return
    const index = Number(e.currentTarget.dataset.index), item = this.data.relationItems[index], targetId = item && item.targetId
    if (!item || !targetId || targetId === store.session().id) return
    const previous = Boolean(item.following), desired = !previous, identity = store.sessionIdentity()
    this.relationActionKeys = this.relationActionKeys || {}
    const keyName = targetId + ':' + (desired ? 'on' : 'off'), requestKey = this.relationActionKeys[keyName] || (this.relationActionKeys[keyName] = store.id('community-follow'))
    this.setData({ relationActionBusy: true, relationError: '', ['relationItems[' + index + '].following']: desired })
    try {
      const out = await service.toggleFollow(targetId, desired, requestKey)
      if (!store.isCurrentSession(identity)) return
      delete this.relationActionKeys[keyName]
      const following = Boolean(out.following), delta = Number(following) - Number(previous), stats = Object.assign({}, this.data.stats)
      if (delta) stats.followingCount = Math.max(0, Number(stats.followingCount || 0) + delta)
      this.setData({ ['relationItems[' + index + '].following']: following, stats })
    } catch (error) {
      if (store.isCurrentSession(identity)) this.setData({ ['relationItems[' + index + '].following']: previous, relationError: ui.friendlyError(error) })
    } finally {
      if (store.isCurrentSession(identity)) this.setData({ relationActionBusy: false })
    }
  },
  switchTab(e) { this.setData({ myTab: e.currentTarget.dataset.tab }, () => this.syncActive()) },
  async markNotifications() {
    if (!this.data.unreadCount || !this.data.cloud || this.data.noticeBusy) return
    const identity = store.sessionIdentity()
    this.setData({ noticeBusy: true })
    try {
      await service.markNotificationsRead([])
      if (store.isCurrentSession(identity)) this.setData({ unreadCount: 0, notifications: this.data.notifications.map(n => Object.assign({}, n, { readAt: n.readAt || Date.now() })) })
    } catch (error) { if (store.isCurrentSession(identity)) this.setData({ error: ui.friendlyError(error) }) }
    finally { this.setData({ noticeBusy: false }) }
  },
  async openNotification(e) {
    if (!this.data.cloud || this.data.noticeBusy) return
    const index = Number(e.currentTarget.dataset.index), item = this.data.notifications[index]
    if (!item) return
    const identity = store.sessionIdentity()
    this.setData({ noticeBusy: true })
    try {
      if (!item.readAt) {
        await service.markNotificationsRead([item.id])
        if (store.isCurrentSession(identity)) this.setData({ ['notifications[' + index + '].readAt']: Date.now(), unreadCount: Math.max(0, Number(this.data.unreadCount || 0) - 1) })
      }
      if (!store.isCurrentSession(identity)) return
      if (item.postId) ui.open('post-detail', 'id=' + encodeURIComponent(item.postId))
      else if (item.actorId) ui.open('member', 'id=' + encodeURIComponent(item.actorId))
    } catch (error) {
      if (store.isCurrentSession(identity)) this.setData({ error: ui.friendlyError(error) })
    } finally { if (store.isCurrentSession(identity)) this.setData({ noticeBusy: false }) }
  },
  post(e) {
    const index = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index)
    const item = Number.isInteger(index) && index >= 0 ? this.data.activeItems[index] : null
    if (item && item.unavailable) { this.setData({ error: '内容已不可用，请先移除收藏。' }); return }
    ui.open('post-detail', 'id=' + encodeURIComponent(e.currentTarget.dataset.id))
  },
  async removeFavorite(e) {
    if (!this.data.cloud || store.session().kind !== 'wechat' || this.data.favoriteBusy) return
    const index = Number(e.currentTarget.dataset.index), item = this.data.activeItems[index]
    if (!item || !item.id) return
    this.favoriteRemoveKeys = this.favoriteRemoveKeys || {}
    const requestKey = this.favoriteRemoveKeys[item.id] || (this.favoriteRemoveKeys[item.id] = store.id('favorite-remove'))
    const identity = store.sessionIdentity()
    this.setData({ favoriteBusy: true, error: '' })
    try {
      await service.toggleFavorite(item.id, false, requestKey)
      if (!store.isCurrentSession(identity)) return
      delete this.favoriteRemoveKeys[item.id]
      const favorites = this.data.favorites.filter(favorite => favorite.id !== item.id)
      this.setData({ favorites }, () => this.syncActive())
    } catch (error) {
      if (store.isCurrentSession(identity)) this.setData({ error: ui.friendlyError(error) })
    } finally { if (store.isCurrentSession(identity)) this.setData({ favoriteBusy: false }) }
  },
  // 「生成旅行方案」= 去菜单；本地方案列表已下线，不再有 plan-detail?id= 入口。
  start() { ui.tab('menu') },
  trip() { ui.tab('itinerary') },
  community() { ui.tab('community') },
  compose() { ui.open('post-edit') },
  readPublishedMap() {
    const map = wx.getStorageSync(store.PREFIX + ':republished:' + store.session().id)
    return map && typeof map === 'object' ? map : {}
  },
  legacyPosts() {
    const published = this.readPublishedMap()
    const result = []
    ;[['guest', '游客'], ['demo', '演示']].forEach(pair => {
      const key = pair[0], label = pair[1]
      const raw = wx.getStorageSync(store.PREFIX + ':' + key)
      const posts = raw && Array.isArray(raw.posts) ? raw.posts : []
      posts.forEach(post => {
        if (!post || !post.id || !String(post.title || '').trim()) return
        const sourceKey = 'local:' + key + ':' + post.id
        result.push({ id: key + ':' + post.id, source: key, sourceLabel: label, post,
          typeLabel: post.type === 'route' ? '旅行路线' : post.type === 'review' ? '地点评价' : '问题',
          placeText: Array.isArray(post.placeNames) ? post.placeNames.join(' · ') : '',
          photoCount: Array.isArray(post.photos) ? post.photos.length : 0,
          published: Boolean(published[sourceKey]), publishedId: published[sourceKey] || '', open: false })
      })
    })
    return result
  },
  markLegacyPublished(source, postId, cloudPostId) {
    const key = store.PREFIX + ':republished:' + store.session().id
    const map = this.readPublishedMap()
    map['local:' + source + ':' + postId] = cloudPostId
    wx.setStorageSync(key, map)
  },
  loadLegacyPosts() { this.setData({ legacyPosts: this.legacyPosts() }) },
  previewLegacy(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || !this.data.legacyPosts[index]) return
    this.setData({ ['legacyPosts[' + index + '].open']: !this.data.legacyPosts[index].open })
  },
  async uploadLegacyPhotos(post, requestKey) {
    const photos = Array.isArray(post.photos) ? post.photos : []
    const ids = []
    for (let i = 0; i < photos.length; i++) {
      const raw = photos[i]
      const path = raw && typeof raw === 'object' ? (raw.path || raw.tempFilePath || '') : String(raw || '')
      if (!path) continue
      try { ids.push(await service.uploadMedia(path, 'community/posts', { requestKey: requestKey + '-p' + i })) } catch (_) { /* 本地路径已失效则跳过该照片 */ }
    }
    return ids
  },
  async republishLegacy(e) {
    if (!this.data.cloud || store.session().kind !== 'wechat' || this.data.republishBusy) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.legacyPosts[index]
    if (!item || item.published) return
    const identity = store.sessionIdentity()
    const requestKey = store.id('legacy-republish')
    this.setData({ republishBusy: true, error: '' })
    try {
      const p = item.post
      const photoIds = await this.uploadLegacyPhotos(p, requestKey)
      if (!store.isCurrentSession(identity)) return
      const payload = {
        type: p.type, title: String(p.title).trim(), content: String(p.content).trim(),
        places: Array.isArray(p.places) ? p.places : [], placeNames: Array.isArray(p.placeNames) ? p.placeNames : [],
        photos: photoIds,
        routeSnapshot: p.type === 'route' ? (p.plan || p.routeSnapshot || null) : null,
        rating: p.type === 'review' ? Number(p.rating) : null,
        duration: p.duration || null,
        visitDate: p.type === 'review' ? p.visitDate : null,
        visibility: p.visibility === 'private' ? 'private' : 'public',
        sourceKey: 'local:' + item.source + ':' + p.id,
        requestKey
      }
      const out = await service.createPost(payload)
      if (!store.isCurrentSession(identity)) return
      this.markLegacyPublished(item.source, p.id, out.postId)
      this.loadLegacyPosts()
      wx.showToast({ title: out.duplicated ? '该帖已在云端发布过' : '已重新发布到云端', icon: 'none' })
    } catch (error) {
      if (store.isCurrentSession(identity)) this.setData({ error: ui.friendlyError(error) })
    } finally {
      if (store.isCurrentSession(identity)) this.setData({ republishBusy: false })
    }
  }
})
