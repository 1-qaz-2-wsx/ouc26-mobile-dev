const s = require('../../utils/travel-store')
const u = require('../../utils/travel-ui')
const api = require('../../utils/travel-services')
// 路由单一来源：翻页需要 cursor/limit 参数，命名包装 api.member(id) 不接受参数，
// 因此沿用 pages/menu 对 planning 族的同一范式：services.api(注册表端点, payload)。
const C = require('../../config/endpoints').community

const labels = { route: '旅行路线', review: '地点评价', question: '问题' }
const PAGE_SIZE = 20

/** 展示层日期：后端 publishedAt 是毫秒时间戳，本机内容 createdAt 是 ISO 字符串。 */
function dateText(value) {
  if (value === undefined || value === null || value === '') return ''
  const raw = typeof value === 'number' ? value : (/^\d+$/.test(String(value)) ? Number(value) : Date.parse(value))
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => (number < 10 ? '0' + number : String(number))
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** presentation mapping：只投影公开帖子字段，不臆造后端数据。 */
function view(item) {
  return Object.assign({}, item, {
    typeLabel: labels[item.type] || '内容',
    placeText: Array.isArray(item.placeNames) ? item.placeNames.join(' · ') : (item.placeNames || ''),
    publishedText: dateText(item.publishedAt || item.createdAt),
    photo: Array.isArray(item.photos) && item.photos.length ? item.photos[0] : ''
  })
}

Page({
  data: {
    user: null,
    stats: {},
    posts: [],
    following: false,
    canFollow: false,
    isSelf: false,
    error: '',
    busy: true,
    followBusy: false,
    cloud: false,
    // C1 已上线：/users/:id 支持 cursor/limit 并稳定返回 nextCursor/hasMore。
    // 初次加载仍是 20 条；只有拿到真实 nextCursor 时才会出现「加载更多」。
    hasMore: false,
    nextCursor: null,
    canLoadMore: false,
    loadingMore: false
  },

  onLoad(query) { this.id = query.id; this.pageIdentity = s.sessionIdentity(); this.load(true) },

  onShow() {
    const identity = s.sessionIdentity()
    if (this.pageIdentity && !s.isCurrentSession(this.pageIdentity)) {
      // 账号切换：丢弃在途请求与旧列表，重新按新身份加载第一页。
      this.pageIdentity = identity
      this.requestSeq = (this.requestSeq || 0) + 1
      this.setData({ user: null, stats: {}, posts: [], following: false, canFollow: false, isSelf: false, followBusy: false, cloud: false, hasMore: false, nextCursor: null, canLoadMore: false, loadingMore: false })
      this.load(true)
    }
  },

  onUnload() { this.requestSeq = (this.requestSeq || 0) + 1 },

  isActive(identity, seq) { return s.isCurrentSession(identity) && this.requestSeq === seq },

  /** 每个请求独占一个序号：刷新 / 翻页 / 账号切换都会让更早的在途响应失效。 */
  beginRequest() {
    const seq = (this.requestSeq || 0) + 1
    this.requestSeq = seq
    return seq
  },

  async load(reset = true) {
    if (!reset && (this.data.loadingMore || !this.data.canLoadMore)) return
    const cursor = reset ? null : this.data.nextCursor
    if (!reset && !cursor) return
    const identity = s.sessionIdentity()
    const seq = this.beginRequest()
    if (reset) this.setData({ busy: true, error: '', posts: [], hasMore: false, nextCursor: null, canLoadMore: false, loadingMore: false })
    else this.setData({ loadingMore: true, error: '' })
    try {
      const useCloud = api.cloudReady() && s.session().kind !== 'demo'
      if (useCloud) {
        const out = cursor
          ? await api.api(C.user(this.id), { cursor, limit: PAGE_SIZE })
          : await api.member(this.id)
        if (!this.isActive(identity, seq)) return
        const incoming = (out.posts || []).map(view)
        const seen = new Set(reset ? [] : this.data.posts.map(item => item.id))
        const posts = (reset ? [] : this.data.posts).concat(incoming.filter(item => item && item.id && !seen.has(item.id)))
        const nextCursor = out.nextCursor || null
        const hasMore = out.hasMore === true && Boolean(nextCursor)
        const isSelf = out.user.id === s.session().id
        this.setData({
          user: reset ? out.user : (this.data.user || out.user),
          stats: out.stats || this.data.stats || {},
          posts,
          following: reset ? !!out.viewerFollowing : this.data.following,
          canFollow: reset ? !isSelf : this.data.canFollow,
          isSelf: reset ? isSelf : this.data.isSelf,
          cloud: true,
          hasMore,
          nextCursor,
          // 没有真实 nextCursor 时不显示加载入口（不做假按钮）
          canLoadMore: hasMore
        })
        return
      }
      if (!reset) return
      // 本机模式：只展示公开内容，自己的 private 帖子不进入成员页；本机内容一次性完整返回。
      const posts = u.posts().filter(p => p.authorId === this.id).map(view)
      if (this.isActive(identity, seq)) {
        this.setData({
          user: { id: this.id, nickname: posts[0] ? posts[0].authorName : '社区成员' },
          stats: {},
          posts,
          following: false,
          canFollow: false,
          isSelf: false,
          cloud: false,
          hasMore: false,
          nextCursor: null,
          canLoadMore: false
        })
      }
    } catch (e) {
      if (this.isActive(identity, seq)) u.fail(this, e)
    } finally {
      if (this.isActive(identity, seq)) this.setData({ busy: false, loadingMore: false })
    }
  },

  retry() { if (!this.data.busy) this.load(true) },

  loadMore() {
    if (!this.data.cloud || !this.data.canLoadMore || !this.data.nextCursor || this.data.loadingMore) return
    this.load(false)
  },

  onReachBottom() {
    if (this.data.canLoadMore && !this.data.loadingMore) this.loadMore()
  },

  async follow() {
    if (!u.requireAccount(this, '成员关注') || !this.data.cloud || !this.data.canFollow || !this.data.user || this.data.followBusy) return
    const identity = s.sessionIdentity()
    const previous = Boolean(this.data.following)
    const desired = !previous
    this.setData({ followBusy: true, error: '', following: desired })
    try {
      const following = Boolean((await api.toggleFollow(this.id, desired)).following)
      if (s.isCurrentSession(identity)) {
        const delta = Number(following) - Number(previous)
        const stats = Object.assign({}, this.data.stats)
        if (delta) stats.followerCount = Math.max(0, Number(stats.followerCount || 0) + delta)
        this.setData({ following, stats })
      }
    } catch (e) {
      if (s.isCurrentSession(identity)) this.setData({ following: previous }, () => u.fail(this, e))
    } finally {
      if (s.isCurrentSession(identity)) this.setData({ followBusy: false })
    }
  },

  open(e) { u.open('post-detail', 'id=' + encodeURIComponent(e.currentTarget.dataset.id)) }
})
