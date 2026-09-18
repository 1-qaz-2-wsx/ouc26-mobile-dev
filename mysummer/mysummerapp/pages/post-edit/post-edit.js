const s = require('../../utils/travel-store')
const u = require('../../utils/travel-ui')
const api = require('../../utils/travel-services')

function asPhoto(item) {
  if (item && typeof item === 'object') return Object.assign({}, item, { path: item.path || item.tempFilePath || item.mediaId || '' })
  const value = String(item || '')
  return { path: value, mediaId: /^media[-_a-zA-Z0-9]/.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : '' }
}
function placeList() {
  const catalog = s.read().catalog || []
  const seed = require('../../utils/travel-engine').seedPlaces || []
  const result = []
  const seen = new Set()
  catalog.concat(seed).forEach(item => {
    if (!item || !item.id || seen.has(item.id)) return
    seen.add(item.id)
    result.push(Object.assign({}, item, { id: String(item.id), name: String(item.name || item.title || item.id) }))
  })
  return result
}

Page({
  data: {
    types: ['route', 'review', 'question'],
    labels: ['旅行方案', '地点评价', '提出问题'],
    typeHints: [
      '路线帖：附带一个已保存方案或已完成行程，别人可以按地点参考。',
      '评价帖：必须选择一个已确认地点，并给出推荐程度与旅行日期。',
      '问题帖：把想问的写清楚，地点可以手填。'
    ],
    typeIndex: 0,
    title: '', content: '', places: '', selectedPlaces: [], placeOptions: [], placeIndex: 0, routeSnapshot: null,
    rating: '', ratingOptions: [1, 2, 3, 4, 5], duration: '', visitDate: '', photos: [], error: '',
    plans: [], planIndex: 0,
    public: true, busy: false, loading: false, cloud: false, preview: false, editingId: '', version: 1,
    draftSavedAt: '', requestKey: ''
  },
  onLoad(options = {}) {
    const current = s.session()
    this.setData({ plans: s.read().plans.map(p => ({ id: p.id, name: p.request.startDate + ' ' + p.stops.map(x => x.name).join('→') })), placeOptions: placeList(), cloud: current.kind === 'wechat' })
    const draft = s.readPostDraft()
    if (options.id) {
      this.setData({ editingId: String(options.id) })
      this.loadExisting(String(options.id), draft)
      return
    }
    if (draft) this.restoreDraft(draft)
    this.saveDraft()
  },
  onUnload() { this.saveDraft() },
  restoreDraft(draft) {
    const photos = (draft.photos || []).map(asPhoto)
    const selectedPlaces = Array.isArray(draft.selectedPlaces) ? draft.selectedPlaces : []
    const typeIndex = Math.max(0, Math.min(this.data.types.length - 1, Number(draft.typeIndex) || 0))
    this.setData({ typeIndex, title: draft.title || '', content: draft.content || '', places: draft.places || selectedPlaces.map(p => p.name).join('、'), selectedPlaces, routeSnapshot: draft.routeSnapshot || null, rating: draft.rating || '', duration: draft.duration || '', visitDate: draft.visitDate || '', photos, planIndex: Number(draft.planIndex) || 0, public: draft.public !== false, requestKey: draft.requestKey || '', draftSavedAt: draft.updatedAt || '' })
  },
  draft() {
    return { editingId: this.data.editingId || '', version: this.data.version || 1, typeIndex: this.data.typeIndex, title: this.data.title, content: this.data.content, places: this.data.places, selectedPlaces: this.data.selectedPlaces, routeSnapshot: this.data.routeSnapshot || null, rating: this.data.rating, duration: this.data.duration, visitDate: this.data.visitDate, photos: this.data.photos, planIndex: this.data.planIndex, public: this.data.public, requestKey: this.data.requestKey || '' }
  },
  saveDraft() {
    if (this._published) return
    try {
      const saved = s.savePostDraft(this.draft())
      if (this.data && saved.updatedAt) this.setData({ draftSavedAt: saved.updatedAt })
    } catch (_) {}
  },
  async loadExisting(id, draft) {
    const draftMatches = Boolean(draft && draft.editingId === id)
    if (draftMatches) this.restoreDraft(draft)
    if (!this.data.cloud) {
      const post = s.read().posts.find(item => item.id === id)
      if (post) {
        this.setData({ version: Number(post.version || 1), typeIndex: Math.max(0, this.data.types.indexOf(post.type)), title: post.title || '', content: post.content || '', places: Array.isArray(post.placeNames) ? post.placeNames.join('、') : '', selectedPlaces: Array.isArray(post.places) ? post.places : [], routeSnapshot: post.routeSnapshot || (post.plan ? u.publicPlan(post.plan) : null), rating: post.rating || '', duration: post.duration || '', visitDate: post.visitDate || '', photos: (post.photos || []).map(asPhoto), public: post.visibility !== 'private', loading: false })
        if (draftMatches) this.restoreDraft(draft)
      }
      return
    }
    const identity = s.sessionIdentity()
    this.setData({ loading: true, error: '' })
    try {
      const out = await api.postDetail(id)
      if (!s.isCurrentSession(identity)) return
      if (!out || !out.post || !(out.isOwner || out.permissions && out.permissions.isOwner)) throw new Error('只有作者可以编辑该内容')
      const post = out.post
      const selected = Array.isArray(post.places) ? post.places : []
      this.setData({ editingId: id, version: Number(post.version || 1), typeIndex: Math.max(0, this.data.types.indexOf(post.type)), title: post.title || '', content: post.content || '', places: Array.isArray(post.placeNames) ? post.placeNames.join('、') : '', selectedPlaces: selected, routeSnapshot: post.routeSnapshot || null, rating: post.rating || '', duration: post.duration || '', visitDate: post.visitDate || '', photos: (post.mediaIds || post.photos || []).map(asPhoto), public: post.visibility !== 'private', requestKey: s.id('post-edit'), loading: false })
      if (draftMatches) {
        this.restoreDraft(draft)
        this.setData({ editingId: id, version: Number(post.version || 1), loading: false })
      }
      this.saveDraft()
    } catch (error) {
      if (s.isCurrentSession(identity)) { this.setData({ loading: false }); u.fail(this, error) }
    }
  },
  field(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }); this.saveDraft() },
  setType(e) { this.setData({ typeIndex: Number(e.currentTarget.dataset.index), preview: false }); this.saveDraft() },
  setRating(e) { this.setData({ rating: Number(e.currentTarget.dataset.rating), preview: false }); this.saveDraft() },
  date(e) { this.setData({ visitDate: e.detail.value, preview: false }); this.saveDraft() },
  setVisibility(e) { this.setData({ public: e.currentTarget.dataset.public === 'true', preview: false }); this.saveDraft() },
  plan(e) { this.setData({ planIndex: Number(e.detail.value), preview: false }); this.saveDraft() },
  choosePlace(e) {
    const item = this.data.placeOptions[Number(e.detail.value)]
    if (!item) return
    const selected = this.data.selectedPlaces.filter(place => place.id !== item.id).concat([item]).slice(0, 12)
    this.setData({ selectedPlaces: selected, places: selected.map(place => place.name).join('、'), preview: false })
    this.saveDraft()
  },
  removePlace(e) {
    const index = Number(e.currentTarget.dataset.index)
    const selected = this.data.selectedPlaces.filter((_, i) => i !== index)
    this.setData({ selectedPlaces: selected, places: selected.map(place => place.name).join('、'), preview: false })
    this.saveDraft()
  },
  photo() {
    if (this.data.photos.length >= 6) return
    wx.chooseMedia({ count: Math.max(1, 6 - this.data.photos.length), mediaType: ['image'], success: result => {
      const incoming = (result.tempFiles || []).map(file => ({ path: file.tempFilePath, size: Number(file.size || 0), mime: file.type === 'image' ? 'image/jpeg' : '', mediaId: '' }))
      const invalid = incoming.find(file => file.size && file.size > 10 * 1024 * 1024)
      if (invalid) this.setData({ error: '单张图片不能超过 10 MB' })
      else this.setData({ photos: this.data.photos.concat(incoming).slice(0, 6), error: '', preview: false })
      this.saveDraft()
    }, fail: () => this.saveDraft() })
  },
  removePhoto(e) { const index = Number(e.currentTarget.dataset.index); this.setData({ photos: this.data.photos.filter((_, i) => i !== index), preview: false }); this.saveDraft() },
  cancel() { this.saveDraft(); wx.navigateBack({ delta: 1 }) },
  togglePreview() { this.setData({ preview: !this.data.preview }) },
  validateDraft() {
    const d = this.data
    if (!String(d.title || '').trim() || !String(d.content || '').trim()) throw new Error('请填写标题和正文')
    if (d.typeIndex === 0 && !d.plans[d.planIndex] && !(d.editingId && d.routeSnapshot)) throw new Error('路线帖请选择一个现有方案或已完成行程')
    if (d.typeIndex === 1) {
      if (!d.selectedPlaces.length) throw new Error('评价帖请选择一个已确认地点')
      if (!Number.isInteger(Number(d.rating)) || Number(d.rating) < 1 || Number(d.rating) > 5) throw new Error('推荐程度为 1–5 整数')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.visitDate || '')) throw new Error('评价帖请填写旅行日期')
    }
    if (d.photos.some(file => file.size && file.size > 10 * 1024 * 1024)) throw new Error('单张图片不能超过 10 MB')
  },
  payload(photoIds, plan) {
    const d = this.data
    return { type: d.types[d.typeIndex], title: String(d.title).trim(), content: String(d.content).trim(), places: d.selectedPlaces, placeNames: String(d.places || '').split(/[,，、]/).map(p => p.trim()).filter(Boolean).slice(0, 12), photos: photoIds, routeSnapshot: d.typeIndex === 0 ? (plan ? u.publicPlan(plan) : d.editingId ? d.routeSnapshot : null) : null, rating: d.typeIndex === 1 ? Number(d.rating) : null, duration: String(d.duration || '').trim() || null, visitDate: d.typeIndex === 1 ? d.visitDate : null, visibility: d.public ? 'public' : 'private', version: d.version, requestKey: d.requestKey }
  },
  async publish() {
    if (!u.requireAccount(this, '发帖')) return
    if (this.data.busy || this.data.loading) return
    try { this.validateDraft() } catch (error) { this.setData({ error: error.message }); this.saveDraft(); return }
    const identity = s.sessionIdentity()
    const requestId = this.data.requestKey || s.id(this.data.editingId ? 'post-edit' : 'post')
    this.setData({ busy: true, error: '', requestKey: requestId })
    this.saveDraft()
    try {
      const d = this.data
      const plan = d.typeIndex === 0 && d.plans[d.planIndex] ? s.getPlan(d.plans[d.planIndex].id) : null
      if (d.cloud) {
        const photoIds = await api.uploadPhotos(d.photos, { requestKey: d.requestKey, onProgress: async (index, mediaId) => {
          const photos = this.data.photos.map((file, i) => i === index ? Object.assign({}, asPhoto(file), { mediaId }) : asPhoto(file))
          this.setData({ photos }); this.saveDraft()
        } })
        if (!s.isCurrentSession(identity)) return
        const payload = this.payload(photoIds, plan)
        const out = this.data.editingId ? await api.updatePost(this.data.editingId, payload) : await api.createPost(payload)
        if (!s.isCurrentSession(identity)) return
        this._published = true
        s.clearPostDraft()
        wx.showToast({ title: out.status === 'pending' ? '已提交审核' : d.public ? '已发布' : '已保存', icon: 'none' })
        wx.redirectTo({ url: '/pages/post-detail/post-detail?id=' + encodeURIComponent(out.postId || this.data.editingId) })
        return
      }
      const user = s.session()
      const id = this.data.editingId || s.id('post')
      s.mutate(state => {
        const post = { id, authorId: user.id, authorName: user.nickname, type: d.types[d.typeIndex], title: String(d.title).trim(), content: String(d.content).trim(), placeNames: String(d.places || '').split(/[,，、]/).map(p => p.trim()).filter(Boolean), places: d.selectedPlaces, rating: d.rating, duration: d.duration, visitDate: d.visitDate, photos: d.photos.map(file => file.path || file), plan: u.publicPlan(plan), visibility: d.public ? 'public' : 'private', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, answers: [], moderation: '本地演示：未接入真实审核' }
        state.posts = state.posts.filter(item => item.id !== id).concat([post])
      })
      this._published = true
      s.clearPostDraft()
      wx.redirectTo({ url: '/pages/post-detail/post-detail?id=' + id })
    } catch (error) {
      if (s.isCurrentSession(identity)) { this.setData({ error: u.friendlyError(error) }); this.saveDraft() }
    } finally {
      if (s.isCurrentSession(identity)) this.setData({ busy: false })
    }
  }
})
