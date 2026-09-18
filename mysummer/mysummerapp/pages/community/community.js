const u = require('../../utils/travel-ui')
const store = require('../../utils/travel-store')
const service = require('../../utils/travel-services')

const labels = { route: '旅行路线', review: '地点评价', question: '问题' }

/** 展示层日期：后端 publishedAt 是毫秒时间戳，本机内容 createdAt 是 ISO 字符串。 */
function dateText(value) {
  if (value === undefined || value === null || value === '') return ''
  const raw = typeof value === 'number' ? value : (/^\d+$/.test(String(value)) ? Number(value) : Date.parse(value))
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => (number < 10 ? '0' + number : String(number))
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** presentation mapping：只做字段投影，不新增任何后端能力。 */
function view(item) {
  const author = item.author || {}
  const text = String(item.content || '').replace(/\s+/g, ' ')
  return Object.assign({}, item, {
    authorName: author.nickname || item.authorName || '微信用户',
    authorAvatar: author.avatarUrl || item.authorAvatar || author.avatarMediaId || '',
    placeText: Array.isArray(item.placeNames) ? item.placeNames.join(' · ') : (item.placeNames || ''),
    typeLabel: labels[item.type] || '内容',
    summary: text ? text.slice(0, 96) + (text.length > 96 ? '…' : '') : '',
    publishedText: dateText(item.publishedAt || item.createdAt),
    photo: Array.isArray(item.photos) && item.photos.length ? item.photos[0] : '',
    actionBusy: false
  })
}

Page({
  data: {
    posts: [],
    keyword: '',
    draftKeyword: '',
    error: '',
    tab: 'recommend',
    type: 'all',
    cloud: false,
    cloudScope: false,
    busy: false,
    hasMore: false,
    cursor: null,
    requiresLogin: false,
    emptyTitle: '没有匹配的内容',
    emptyMessage: '换个关键词或类型再试一次。',
    loadingMore: false
  },

  onShow() {
    const identity = store.sessionIdentity()
    if (this.pageIdentity && !store.isCurrentSession(this.pageIdentity)) {
      this.actionKeys = {}
      this.setData({ busy: false, loadingMore: false, posts: [], cloud: false, cursor: null, hasMore: false, requiresLogin: false, error: '' })
    }
    this.pageIdentity = identity
    // 顶部范围说明必须与真实数据源一致：只有云端会话才显示「云端公开内容 · 提交后即可展示」，
    // 本机会话显示本机口径，避免把仅本机可见的内容读成已发布。
    this.setData({ cloudScope: service.cloudReady() && store.session().kind !== 'demo' })
    if (!this.data.busy) this.refresh(true)
  },

  onUnload() { this.querySeq = (this.querySeq || 0) + 1 },

  active(identity, seq, criteria) {
    return store.isCurrentSession(identity)
      && this.querySeq === seq
      && this.data.tab === criteria.tab
      && this.data.keyword === criteria.keyword
      && this.data.type === criteria.type
  },

  async refresh(reset) {
    if (this.data.busy && !reset) return
    const identity = store.sessionIdentity()
    const seq = (this.querySeq || 0) + 1
    this.querySeq = seq
    const criteria = { tab: this.data.tab, keyword: this.data.keyword, type: this.data.type, cursor: reset ? null : this.data.cursor }
    const useCloud = service.cloudReady() && store.session().kind !== 'demo'
    if (reset) this.setData({ busy: true, error: '', cursor: null, hasMore: false, requiresLogin: false, posts: [] })
    else this.setData({ loadingMore: true, error: '' })
    try {
      if (useCloud) {
        const out = await service.communityFeed({ tab: criteria.tab, keyword: criteria.keyword, type: criteria.type, cursor: criteria.cursor, limit: 20 })
        if (!this.active(identity, seq, criteria)) return
        const incoming = (out.items || []).map(view)
        const seen = new Set(reset ? [] : this.data.posts.map(item => item.id))
        const posts = (reset ? [] : this.data.posts).concat(incoming.filter(item => !seen.has(item.id)))
        const requiresLogin = criteria.tab === 'following' && out.requiresLogin === true
        this.setData({
          posts,
          cloud: true,
          cursor: out.nextCursor || null,
          hasMore: out.hasMore === true,
          requiresLogin,
          emptyTitle: requiresLogin ? '登录后查看关注流' : (criteria.tab === 'following' ? '还没有关注的内容' : '没有匹配的内容'),
          emptyMessage: requiresLogin ? '关注流只展示你关注的作者的公开内容。' : (posts.length ? '' : (criteria.keyword ? '换个关键词再试一次。' : (criteria.tab === 'following' ? '关注作者后，他们的更新会出现在这里' : '下拉可以刷新，或去发布第一条内容。')))
        })
        return
      }
      if (criteria.tab === 'following') {
        if (this.active(identity, seq, criteria)) {
          this.setData({
            posts: [],
            cloud: false,
            requiresLogin: false,
            emptyTitle: '本机模式没有关注流',
            emptyMessage: '登录微信账号后才能查看关注的人。'
          })
        }
        return
      }
      const q = criteria.keyword.trim().toLowerCase()
      const incoming = u.posts()
        .filter(p => criteria.type === 'all' || p.type === criteria.type)
        .filter(p => (`${p.title} ${(p.placeNames || []).join(' ')} ${p.content || ''}`).toLowerCase().includes(q))
        .map(view)
      if (this.active(identity, seq, criteria)) {
        this.setData({
          posts: incoming,
          cloud: false,
          hasMore: false,
          requiresLogin: false,
          emptyTitle: '本机演示里没有匹配的内容',
          emptyMessage: incoming.length ? '' : '本机演示内容只在当前设备可见。'
        })
      }
    } catch (error) {
      if (this.active(identity, seq, criteria)) {
        // 加载失败不得被空态文案伪装成「没有内容」：失败原因同时进入错误条与空态，
        // 保证「拉取失败」和「确实没有」在界面上一眼可区分（test-community-flow 有断言）。
        this.setData({
          error: u.friendlyError(error),
          cloud: useCloud,
          requiresLogin: false,
          emptyTitle: '社区内容暂时不可用',
          emptyMessage: '加载失败，请重试'
        })
      }
    } finally {
      if (this.active(identity, seq, criteria)) {
        this.setData({ busy: false, loadingMore: false })
        if (reset && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh()
      }
    }
  },

  input(e) { this.setData({ draftKeyword: e.detail.value }) },
  search() { this.setData({ keyword: (this.data.draftKeyword || '').trim() }); this.refresh(true) },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); this.refresh(true) },
  switchType(e) { this.setData({ type: e.currentTarget.dataset.type }); this.refresh(true) },
  retry() { this.refresh(true) },
  goLogin() { store.recordLoginSource('社区关注流'); wx.switchTab({ url: '/pages/me/me' }) },
  onPullDownRefresh() { this.refresh(true) },
  onReachBottom() { if (this.data.cloud && this.data.hasMore && !this.data.loadingMore) this.refresh(false) },

  async like(e) {
    if (!u.requireAccount(this, '社区点赞') || !this.data.cloud) return
    const index = Number(e.currentTarget.dataset.index)
    const p = this.data.posts[index]
    if (!p || p.actionBusy) return
    const postId = p.id
    const desired = !p.viewerLiked
    const requestKey = this.actionRequestKey('like', postId, desired)
    const identity = store.sessionIdentity()
    this.setData({ ['posts[' + index + '].actionBusy']: true, error: '' })
    try {
      const out = await service.toggleLike(postId, desired, requestKey)
      if (!store.isCurrentSession(identity)) return
      delete this.actionKeys['like:' + postId + ':' + (desired ? 'on' : 'off')]
      const current = this.data.posts.findIndex(item => item.id === postId)
      if (current >= 0) this.setData({ ['posts[' + current + '].viewerLiked']: out.active, ['posts[' + current + '].likeCount']: out.counts.likeCount, ['posts[' + current + '].actionBusy']: false })
    } catch (err) {
      if (store.isCurrentSession(identity)) {
        const current = this.data.posts.findIndex(item => item.id === postId)
        const update = { error: u.friendlyError(err) }
        if (current >= 0) update['posts[' + current + '].actionBusy'] = false
        this.setData(update)
      }
    }
  },

  async favorite(e) {
    if (!u.requireAccount(this, '社区收藏') || !this.data.cloud) return
    const index = Number(e.currentTarget.dataset.index)
    const p = this.data.posts[index]
    if (!p || p.actionBusy) return
    const postId = p.id
    const desired = !p.viewerFavorited
    const requestKey = this.actionRequestKey('favorite', postId, desired)
    const identity = store.sessionIdentity()
    this.setData({ ['posts[' + index + '].actionBusy']: true, error: '' })
    try {
      const out = await service.toggleFavorite(postId, desired, requestKey)
      if (!store.isCurrentSession(identity)) return
      delete this.actionKeys['favorite:' + postId + ':' + (desired ? 'on' : 'off')]
      const current = this.data.posts.findIndex(item => item.id === postId)
      if (current >= 0) this.setData({ ['posts[' + current + '].viewerFavorited']: out.active, ['posts[' + current + '].favoriteCount']: out.counts.favoriteCount, ['posts[' + current + '].actionBusy']: false })
    } catch (err) {
      if (store.isCurrentSession(identity)) {
        const current = this.data.posts.findIndex(item => item.id === postId)
        const update = { error: u.friendlyError(err) }
        if (current >= 0) update['posts[' + current + '].actionBusy'] = false
        this.setData(update)
      }
    }
  },

  actionRequestKey(kind, postId, desired) {
    this.actionKeys = this.actionKeys || {}
    const key = kind + ':' + postId + ':' + (desired ? 'on' : 'off')
    return this.actionKeys[key] || (this.actionKeys[key] = store.id('community-' + kind))
  },

  open(e) { u.open('post-detail', 'id=' + encodeURIComponent(e.currentTarget.dataset.id)) },
  compose() { u.open('post-edit') },
  member(e) { u.open('member', 'id=' + encodeURIComponent(e.currentTarget.dataset.id)) }
})
