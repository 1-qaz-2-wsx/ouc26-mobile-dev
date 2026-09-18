const s = require('../../utils/travel-store')
const u = require('../../utils/travel-ui')
const api = require('../../utils/travel-services')

const labels = { route: '旅行路线', review: '地点评价', question: '问题' }

function localPost(id) { return u.posts().concat(s.read().posts).find(p => p.id === id) }

/** 展示层日期：后端是毫秒时间戳，本机内容是 ISO 字符串。 */
function dateText(value, withTime) {
  if (value === undefined || value === null || value === '') return ''
  const raw = typeof value === 'number' ? value : (/^\d+$/.test(String(value)) ? Number(value) : Date.parse(value))
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => (number < 10 ? '0' + number : String(number))
  const day = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
  return withTime ? day + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) : day
}

/** presentation mapping：字段投影 + 图片布局档位，不触碰后端契约。 */
function view(item) {
  if (!item) return item
  const plan = item.plan || item.routeSnapshot || null
  const places = Array.isArray(item.places) ? item.places.map(place => Object.assign({}, place, {
    id: String(place.id || place.placeId || place.providerId || ''),
    placeId: String(place.placeId || place.id || place.providerId || ''),
    provider: String(place.provider || 'local')
  })).filter(place => place.id) : []
  const photos = Array.isArray(item.photos) ? item.photos.filter(Boolean) : []
  return Object.assign({}, item, {
    plan,
    places,
    photos,
    typeLabel: labels[item.type] || '社区内容',
    placeText: Array.isArray(item.placeNames) ? item.placeNames.join(' · ') : (item.placeNames || ''),
    publishedText: dateText(item.publishedAt || item.createdAt),
    photoLayout: photos.length === 1 ? 'single' : photos.length === 2 ? 'double' : 'many'
  })
}

function commentView(item) {
  return Object.assign({}, item, {
    authorName: (item.author && item.author.nickname) || item.authorName || '微信用户',
    authorAvatar: (item.author && (item.author.avatarUrl || item.author.avatarMediaId)) || '',
    replyToUserName: item.replyToUserName || '',
    statusText: item.statusText || '',
    publishedText: dateText(item.createdAt, true)
  })
}

function localOwner(authorId) {
  const id = String(s.session().id || '')
  return String(authorId || '') === id || String(authorId || '') === 'wx-' + id || id === 'wx-' + String(authorId || '')
}

Page({
  data: { post: null, author: null, typeLabel: '', publishedText: '', placeText: '', comments: [], commentDraft: '', answer: '', replyTarget: null, commentsCursor: null, commentsHasMore: false, error: '', commentsError: '', owned: false, cloud: false, loading: true, commentsLoading: false, commentsLoadingMore: false, commentBusy: false, actionBusy: false, followBusy: false, viewerLiked: false, viewerFavorited: false, viewerFollowing: false, referencePreview: null, referenceError: '', referenceBusy: false, reportOpen: false, reportTarget: null, reportReasons: ['垃圾/广告', '骚扰/辱骂', '隐私泄露', '不安全内容', '其他'], reportReasonValues: ['spam', 'abuse', 'privacy', 'unsafe', 'other'], reportReasonIndex: 0, reportDetails: '', reportBusy: false, reportError: '' },
  onLoad(query) { this.id = query.id; this.pageIdentity = s.sessionIdentity(); this.refresh() },
  onShow() {
    const identity = s.sessionIdentity()
    if (this.pageIdentity && !s.isCurrentSession(this.pageIdentity)) {
      this.pageIdentity = identity; this.requestSeq = (this.requestSeq || 0) + 1
      this.actionKeys = {}
      this.commentRequestKey = ''; this.commentRequestTarget = null; this.commentDeleteKeys = {}
      this.setData({ post: null, author: null, typeLabel: '', publishedText: '', placeText: '', comments: [], replyTarget: null, commentsCursor: null, commentsHasMore: false, owned: false, cloud: false, actionBusy: false, followBusy: false, viewerLiked: false, viewerFavorited: false, viewerFollowing: false, referencePreview: null, referenceError: '', referenceBusy: false, reportOpen: false, reportTarget: null, reportBusy: false, reportError: '' })
      this.refresh()
    }
  },
  onUnload() { this.requestSeq = (this.requestSeq || 0) + 1 },
  isActive(identity, seq) { return s.isCurrentSession(identity) && this.requestSeq === seq },
  async refresh() {
    const identity = s.sessionIdentity(), seq = (this.requestSeq || 0) + 1
    this.requestSeq = seq
    this.setData({ loading: true, error: '', commentsError: '', comments: [], replyTarget: null, commentsCursor: null, commentsHasMore: false, commentsLoadingMore: false, actionBusy: false, referencePreview: null, referenceError: '', referenceBusy: false, reportOpen: false, reportTarget: null, reportBusy: false, reportError: '' })
    try {
      const useCloud = api.cloudReady() && s.session().kind !== 'demo'
      if (useCloud) {
        const out = await api.postDetail(this.id)
        if (!this.isActive(identity, seq)) return
        const post = view(out.post)
        this.setData({
          post,
          author: out.author,
          typeLabel: post.typeLabel,
          publishedText: post.publishedText,
          placeText: post.placeText,
          owned: Boolean(out.isOwner || post.isOwner || post.permissions && post.permissions.isOwner),
          cloud: true,
          viewerLiked: !!post.viewerLiked,
          viewerFavorited: !!post.viewerFavorited,
          viewerFollowing: !!out.viewerFollowing,
          loading: false
        })
        this.loadComments(identity, seq, true)
        return
      }
      const post = localPost(this.id)
      if (!post) throw new Error('内容不存在、已隐藏或仅存储在发布者设备')
      if (this.isActive(identity, seq)) {
        const mapped = view(post)
        this.setData({
          post: mapped,
          author: { nickname: post.authorName },
          typeLabel: mapped.typeLabel,
          publishedText: mapped.publishedText,
          placeText: mapped.placeText,
          comments: (post.answers || []).map(x => commentView({ id: x.id, authorName: x.authorName, content: x.content, createdAt: x.createdAt })),
          owned: localOwner(post.authorId),
          cloud: false,
          loading: false
        })
      }
    } catch (error) {
      if (this.isActive(identity, seq)) u.fail(this, error)
    } finally {
      if (this.isActive(identity, seq) && this.data.loading) this.setData({ loading: false })
    }
  },
  retry() { if (!this.data.loading) this.refresh() },
  async loadComments(identity, seq, reset = true) {
    if (!this.data.post || !this.data.cloud) return
    const cursor = reset ? null : this.data.commentsCursor
    if (!reset && (!this.data.commentsHasMore || this.data.commentsLoadingMore || this.data.commentsLoading)) return
    this.setData(reset ? { commentsLoading: true, commentsLoadingMore: false, commentsError: '', comments: [], commentsCursor: null, commentsHasMore: false } : { commentsLoadingMore: true, commentsError: '' })
    try {
      const list = await api.comments(this.id, { action: 'list', limit: 50, cursor })
      if (!this.isActive(identity, seq)) return
      const incoming = (list.items || []).map(commentView)
      const seen = new Set(reset ? [] : this.data.comments.map(item => item.id))
      const comments = (reset ? [] : this.data.comments).concat(incoming.filter(item => item && !seen.has(item.id)))
      this.setData({ comments, commentsCursor: list.nextCursor || null, commentsHasMore: list.hasMore === true, commentsError: '' })
    } catch (error) {
      if (this.isActive(identity, seq)) this.setData({ commentsError: error.message || '评论暂不可用' })
    } finally {
      if (this.isActive(identity, seq)) this.setData({ commentsLoading: false, commentsLoadingMore: false })
    }
  },
  loadMoreComments() { if (this.data.cloud && this.data.commentsHasMore && !this.data.commentsLoadingMore) this.loadComments(s.sessionIdentity(), this.requestSeq, false) },
  retryComments() { if (this.data.cloud && this.data.post && !this.data.commentsLoading) this.loadComments(s.sessionIdentity(), this.requestSeq, true) },
  field(e) { this.setData({ commentDraft: e.detail.value, answer: e.detail.value }) },
  async submitComment() {
    if (!u.requireAccount(this, '帖子评论')) return
    const content = String(this.data.commentDraft || this.data.answer || '').trim()
    if (!content) { this.setData({ error: '请输入评论内容' }); return }
    if (this.data.cloud) {
      if (this.data.commentBusy) return
      const identity = s.sessionIdentity(), replyToId = this.data.replyTarget && this.data.replyTarget.id || null
      if (!this.commentRequestKey || this.commentRequestTarget !== replyToId) { this.commentRequestKey = s.id('comment'); this.commentRequestTarget = replyToId }
      const requestKey = this.commentRequestKey
      this.setData({ commentBusy: true, error: '' })
      try {
        const out = await api.comments(this.id, { content, replyToId, requestKey })
        if (!s.isCurrentSession(identity)) return
        this.commentRequestKey = ''
        this.commentRequestTarget = null
        this.setData({ commentDraft: '', answer: '', replyTarget: null, ['post.commentCount']: out && out.counts ? out.counts.commentCount : this.data.post.commentCount })
        wx.showToast({ title: out && out.status === 'pending' ? '已提交审核' : '评论已发布', icon: 'none' })
        await this.loadComments(identity, this.requestSeq, true)
      } catch (error) {
        if (s.isCurrentSession(identity)) u.fail(this, error)
      } finally {
        if (s.isCurrentSession(identity)) this.setData({ commentBusy: false })
      }
      return
    }
    u.run(this, () => {
      const post = localPost(this.id)
      if (!post) throw new Error('内容不可用')
      s.mutate(state => {
        const target = state.posts.find(item => item.id === this.id)
        if (!target) throw new Error('历史参考内容为只读')
        target.answers = target.answers || []
        target.answers.push({ id: s.id('answer'), authorName: s.session().nickname, content, createdAt: new Date().toISOString() })
      })
      this.setData({ commentDraft: '', answer: '' }); this.refresh()
    })
  },
  reply(e) {
    const hasTarget = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index !== undefined
    if (hasTarget) {
      const item = this.data.comments[Number(e.currentTarget.dataset.index)]
      if (item && item.canReply) this.setData({ replyTarget: { id: item.id, name: item.authorName || '微信用户' } })
      return
    }
    // 保留本地演示模式的“回答问题”兼容入口；云端模式使用上面的二级回复选择。
    if (this.data.cloud) return
    const content = String(this.data.commentDraft || this.data.answer || '').trim()
    if (!content) { this.setData({ error: '请输入回答内容' }); return }
    u.run(this, () => {
      const post = localPost(this.id)
      if (!post) throw new Error('内容不可用')
      s.mutate(state => {
        const target = state.posts.find(item => item.id === this.id)
        if (!target) throw new Error('历史参考内容为只读')
        target.answers = target.answers || []
        target.answers.push({ id: s.id('answer'), authorName: s.session().nickname, content, createdAt: new Date().toISOString() })
      })
      this.setData({ commentDraft: '', answer: '' }); this.refresh()
    })
  },
  cancelReply() { if (!this.data.commentBusy) { this.commentRequestKey = ''; this.commentRequestTarget = null; this.setData({ replyTarget: null }) } },
  actionRequestKey(kind, postId, desired) { this.actionKeys = this.actionKeys || {}; const key = kind + ':' + postId + ':' + (desired ? 'on' : 'off'); return this.actionKeys[key] || (this.actionKeys[key] = s.id('community-' + kind)) },
  async like() {
    if (!u.requireAccount(this, '帖子点赞') || !this.data.cloud || this.data.actionBusy) return
    const identity = s.sessionIdentity(); this.setData({ actionBusy: true })
    const desired = !this.data.viewerLiked, requestKey = this.actionRequestKey('like', this.id, desired)
    try { const out = await api.toggleLike(this.id, desired, requestKey); if (s.isCurrentSession(identity)) { delete this.actionKeys['like:' + this.id + ':' + (desired ? 'on' : 'off')]; this.setData({ viewerLiked: out.active, ['post.likeCount']: out.counts.likeCount }) } }
    catch (error) { if (s.isCurrentSession(identity)) u.fail(this, error) }
    finally { if (s.isCurrentSession(identity)) this.setData({ actionBusy: false }) }
  },
  async favorite() {
    if (!u.requireAccount(this, '帖子收藏') || !this.data.cloud || this.data.actionBusy) return
    const identity = s.sessionIdentity(); this.setData({ actionBusy: true })
    const desired = !this.data.viewerFavorited, requestKey = this.actionRequestKey('favorite', this.id, desired)
    try { const out = await api.toggleFavorite(this.id, desired, requestKey); if (s.isCurrentSession(identity)) { delete this.actionKeys['favorite:' + this.id + ':' + (desired ? 'on' : 'off')]; this.setData({ viewerFavorited: out.active, ['post.favoriteCount']: out.counts.favoriteCount }) } }
    catch (error) { if (s.isCurrentSession(identity)) u.fail(this, error) }
    finally { if (s.isCurrentSession(identity)) this.setData({ actionBusy: false }) }
  },
  async follow() {
    if (!u.requireAccount(this, '作者关注') || !this.data.cloud || !this.data.author || this.data.followBusy) return
    const identity = s.sessionIdentity(), previous = Boolean(this.data.viewerFollowing), desired = !previous, targetId = this.data.author.id, requestKey = this.actionRequestKey('follow', targetId, desired)
    this.setData({ followBusy: true, error: '', viewerFollowing: desired })
    try { const out = await api.toggleFollow(targetId, desired, requestKey); if (s.isCurrentSession(identity)) { delete this.actionKeys['follow:' + targetId + ':' + (desired ? 'on' : 'off')]; this.setData({ viewerFollowing: Boolean(out.following) }) } }
    catch (error) { if (s.isCurrentSession(identity)) this.setData({ viewerFollowing: previous }, () => u.fail(this, error)) }
    finally { if (s.isCurrentSession(identity)) this.setData({ followBusy: false }) }
  },
  edit() { if (this.data.owned) u.open('post-edit', 'id=' + encodeURIComponent(this.id)) },
  async visibility() {
    if (!this.data.owned || this.data.actionBusy) return
    const desired = this.data.post.visibility === 'public' ? 'private' : 'public'
    if (!this.data.cloud) { u.run(this, () => { s.mutate(state => { const post = state.posts.find(item => item.id === this.id); if (!post) throw new Error('内容不可用'); post.visibility = desired }); this.refresh() }); return }
    const identity = s.sessionIdentity(); this.setData({ actionBusy: true, error: '' })
    try { const out = await api.changePostVisibility(this.id, { visibility: desired, version: this.data.post.version, requestKey: s.id('visibility') }); if (!s.isCurrentSession(identity)) return; wx.showToast({ title: out.status === 'pending' ? '已重新提交审核' : desired === 'public' ? '已公开' : '已隐藏', icon: 'none' }); await this.refresh() }
    catch (error) { if (s.isCurrentSession(identity)) u.fail(this, error) }
    finally { if (s.isCurrentSession(identity)) this.setData({ actionBusy: false }) }
  },
  async remove() {
    if (!this.data.owned || this.data.actionBusy) return
    if (!await u.confirm('删除这篇内容？', '删除后会立即从公开区域消失，原互动不会转移。')) return
    if (!this.data.cloud) { s.mutate(state => { const post = state.posts.find(item => item.id === this.id); if (post) post.visibility = 'private' }); wx.navigateBack({ delta: 1 }); return }
    const identity = s.sessionIdentity(); this.setData({ actionBusy: true, error: '' })
    try { await api.deletePost(this.id, { version: this.data.post.version, requestKey: s.id('delete') }); if (s.isCurrentSession(identity)) { wx.showToast({ title: '已删除', icon: 'none' }); wx.navigateBack({ delta: 1 }) } }
    catch (error) { if (s.isCurrentSession(identity)) u.fail(this, error) }
    finally { if (s.isCurrentSession(identity)) this.setData({ actionBusy: false }) }
  },
  reference() {
    u.run(this, () => {
      if (this.data.loading || !this.data.post || this.data.post.type !== 'route') throw new Error('只有已加载的路线帖可以作为规划参考')
      const snapshot = this.data.post.routeSnapshot || this.data.post.plan
      if (!snapshot) throw new Error('该路线没有可公开的路线快照')
      const preview = s.previewRouteStops(snapshot)
      this.referenceSnapshot = snapshot
      this.setData({ referencePreview: Object.assign({}, preview, { title: this.data.post.title, total: preview.stops.length + preview.skipped.length, skippedMore: preview.skipped.length > 1 }), referenceError: preview.stops.length ? '' : '该路线没有可导入的已确认地点；请从地图确认后再加入菜单' })
    })
  },
  cancelReference() { if (!this.data.referenceBusy) this.setData({ referencePreview: null, referenceError: '' }) },
  confirmReference() {
    if (this.data.referenceBusy || !this.data.referencePreview) return
    const snapshot = this.referenceSnapshot || (this.data.post && (this.data.post.routeSnapshot || this.data.post.plan))
    this.setData({ referenceBusy: true, referenceError: '' })
    try {
      const result = s.importRouteStops(snapshot)
      if (!result.added.length) throw new Error(result.skipped[0] && result.skipped[0].reason || '没有可导入的地点')
      s.mutate(state => {
        state.requirements = Object.assign({}, state.requirements, {
          reference: this.data.post.title,
          referencePostId: this.id,
          referenceRouteVersion: Number(snapshot && snapshot.version || 1),
          referencePlaceKeys: result.added.map(place => s.stablePlaceKey(place)).filter(Boolean)
        })
      })
      wx.showToast({ title: '已加入 ' + result.added.length + ' 个地点', icon: 'none' })
      this.setData({ referencePreview: null, referenceBusy: false })
      u.tab('menu')
    } catch (error) {
      this.setData({ referenceBusy: false, referenceError: u.friendlyError(error) })
    }
  },
  openAuthor() {
    const id = this.data.author && this.data.author.id
    if (!id || this.data.owned) return
    u.open('member', 'id=' + encodeURIComponent(id))
  },
  previewPhoto(e) {
    const photos = (this.data.post && this.data.post.photos) || []
    const index = Number(e.currentTarget.dataset.index) || 0
    const current = photos[index]
    if (!current || typeof wx.previewImage !== 'function') return
    wx.previewImage({ urls: photos, current })
  },
  openPlace(e) {
    const id = String(e.currentTarget.dataset.placeId || '')
    if (!id) return
    const state = s.read()
    const place = s.place(id) || (state.catalog || []).find(item => String(item.id || '') === id || String(item.placeId || '') === id || String(item.providerId || '') === id) || null
    if (!place) { wx.showToast({ title: '该地点暂无本地详情页，请从地图确认', icon: 'none' }); return }
    u.open('place-detail', 'id=' + encodeURIComponent(place.id))
  },
  openReport(e) {
    if (!this.data.cloud || !u.requireAccount(this, '内容举报')) return
    const dataset = e && e.currentTarget && e.currentTarget.dataset || {}
    let target = { type: String(dataset.targetType || 'post'), id: String(dataset.targetId || this.id), label: dataset.targetLabel || '这篇内容' }
    if (dataset.index !== undefined) {
      const comment = this.data.comments[Number(dataset.index)]
      if (!comment) return
      target = { type: 'comment', id: String(comment.id), label: '这条评论' }
    }
    this.setData({ reportOpen: true, reportTarget: target, reportReasonIndex: 0, reportDetails: '', reportError: '' })
  },
  closeReport() { if (!this.data.reportBusy) this.setData({ reportOpen: false, reportTarget: null, reportError: '' }) },
  noop() {},
  reportReason(e) { this.setData({ reportReasonIndex: Number(e.detail.value) || 0, reportError: '' }) },
  reportField(e) { this.setData({ reportDetails: e.detail.value, reportError: '' }) },
  async submitReport() {
    if (this.data.reportBusy || !this.data.reportTarget) return
    const identity = s.sessionIdentity()
    const index = Math.max(0, Math.min(this.data.reportReasonValues.length - 1, Number(this.data.reportReasonIndex) || 0))
    this.setData({ reportBusy: true, reportError: '' })
    try {
      await api.report({ targetType: this.data.reportTarget.type, targetId: this.data.reportTarget.id, reason: this.data.reportReasonValues[index], details: String(this.data.reportDetails || '').trim(), requestKey: s.id('report') })
      if (!s.isCurrentSession(identity)) { this.setData({ reportBusy: false }); return }
      this.setData({ reportBusy: false, reportOpen: false, reportTarget: null, reportDetails: '', reportError: '' })
      wx.showToast({ title: '举报已收取', icon: 'none' })
    } catch (error) {
      if (s.isCurrentSession(identity)) this.setData({ reportBusy: false, reportError: u.friendlyError(error) })
    }
  },
  async removeComment(e) {
    if (!this.data.cloud || this.data.actionBusy) return
    const comment = this.data.comments[Number(e.currentTarget.dataset.index)]
    if (!comment || !comment.canDelete) return
    if (!await u.confirm('删除这条评论？', '删除后会保留必要的占位，不再显示正文。')) return
    const identity = s.sessionIdentity(); this.setData({ actionBusy: true })
    this.commentDeleteKeys = this.commentDeleteKeys || {}
    const requestKey = this.commentDeleteKeys[comment.id] || (this.commentDeleteKeys[comment.id] = s.id('comment-delete'))
    try { const out = await api.deleteComment(comment.id, { requestKey }); if (s.isCurrentSession(identity)) { delete this.commentDeleteKeys[comment.id]; if (out && out.counts) this.setData({ ['post.commentCount']: out.counts.commentCount }); await this.loadComments(identity, this.requestSeq, true) } }
    catch (error) { if (s.isCurrentSession(identity)) u.fail(this, error) }
    finally { if (s.isCurrentSession(identity)) this.setData({ actionBusy: false }) }
  },
  onShareAppMessage() {
    const post = this.data.post
    const shareable = Boolean(post && post.visibility === 'public' && (post.moderationStatus === 'approved' || post.moderationStatus === 'not_required'))
    return { title: shareable ? post.title : '旅行参考', path: shareable ? '/pages/post-detail/post-detail?id=' + this.id : '/pages/community/community' }
  }
})
