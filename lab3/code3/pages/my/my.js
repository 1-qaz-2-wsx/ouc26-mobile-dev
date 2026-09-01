const app = getApp()
const common = require('../../utils/common.js')
const store = require('../../utils/store.js')

Page({
  data: {
    isLogin: false, userInfo: null, newsList: [], number: 0, historyCount: 0,
    isManaging: false, selectedIds: [], allSelected: false,
    isLogging: false, isChoosingAvatar: false, isDark: false,
    showAccountPanel: false, isEditingNickname: false, nicknameDraft: ''
  },

  onShow() { this.refreshPage() },
  refreshPage() {
    const session = store.getSession()
    app.globalData.userInfo = session
    const displayedSession = session ? Object.assign({}, session, { loginAtText: store.formatTime(session.loginAt) }) : null
    this.setData({
      isLogin: Boolean(session), userInfo: displayedSession,
      historyCount: store.getHistory().length, isDark: store.applyAppearance(store.getSettings()),
      isManaging: false, selectedIds: [], allSelected: false
    })
    this.getMyFavorites()
  },
  getMyFavorites() {
    if (!store.getSession()) { this.setData({ newsList: [], number: 0 }); return }
    const list = common.getNewsByIds(store.getFavoriteIds()).map(item => Object.assign({}, item, { selected: false }))
    this.setData({ newsList: list, number: list.length })
  },

  beginAvatarChoice() {
    if (this.data.isChoosingAvatar) return
    this.setData({ isChoosingAvatar: true })
    if (this.avatarChoiceTimer) clearTimeout(this.avatarChoiceTimer)
    this.avatarChoiceTimer = setTimeout(() => {
      this.setData({ isChoosingAvatar: false })
      this.avatarChoiceTimer = null
    }, 5000)
  },
  finishAvatarChoice() {
    if (this.avatarChoiceTimer) clearTimeout(this.avatarChoiceTimer)
    this.avatarChoiceTimer = null
    this.setData({ isChoosingAvatar: false })
  },
  onLoginAvatarChosen(e) {
    this.finishAvatarChoice()
    const avatarUrl = e.detail && e.detail.avatarUrl
    if (!avatarUrl) return
    this.setData({ isLogging: true })
    this.persistAvatar(avatarUrl, savedAvatar => this.connectWechat(savedAvatar))
  },
  persistAvatar(avatarUrl, done) {
    if (!wx.saveFile) { done(avatarUrl); return }
    wx.saveFile({
      tempFilePath: avatarUrl,
      success: res => done(res.savedFilePath),
      fail: err => {
        console.warn('save avatar failed, use temporary path:', err)
        done(avatarUrl)
      }
    })
  },
  connectWechat(avatarUrl) {
    wx.login({
      success: loginRes => {
        if (!loginRes.code) { this.loginFailed('微信连接失败'); return }
        this.finishLogin({ nickName: store.generateRandomNickname(), avatarUrl }, loginRes.code)
      },
      fail: err => {
        console.error('wx.login failed:', err)
        this.loginFailed('无法连接微信，请稍后重试')
      }
    })
  },
  finishLogin(userInfo, code) {
    const session = store.createSession(userInfo, code)
    app.globalData.userInfo = session
    this.setData({ isLogging: false, isChoosingAvatar: false, showAccountPanel: false, isEditingNickname: false })
    wx.showToast({ title: '微信登录成功', icon: 'success' })
    this.refreshPage()
  },
  loginFailed(message) {
    this.setData({ isLogging: false, isChoosingAvatar: false })
    wx.showToast({ title: message, icon: 'none' })
  },
  toggleAccountPanel() {
    const willShow = !this.data.showAccountPanel
    const session = store.getSession()
    this.setData({
      showAccountPanel: willShow,
      isEditingNickname: false,
      nicknameDraft: session ? session.nickName : ''
    })
  },
  onChangeAvatar(e) {
    this.finishAvatarChoice()
    const avatarUrl = e.detail && e.detail.avatarUrl
    if (!avatarUrl) return
    this.persistAvatar(avatarUrl, savedAvatar => {
      const session = store.updateSession({ avatarUrl: savedAvatar })
      app.globalData.userInfo = session
      wx.showToast({ title: '头像已更新', icon: 'success' })
      this.refreshPage()
      this.setData({ showAccountPanel: true })
    })
  },
  startNicknameEdit() {
    const session = store.getSession()
    this.setData({ isEditingNickname: true, nicknameDraft: session ? session.nickName : '' })
  },
  onNicknameInput(e) {
    this.setData({ nicknameDraft: e.detail.value })
  },
  cancelNicknameEdit() {
    this.setData({ isEditingNickname: false, nicknameDraft: '' })
  },
  saveNickname() {
    const nickName = this.data.nicknameDraft.trim()
    if (!nickName) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    if (nickName.length > 20) { wx.showToast({ title: '昵称不能超过20个字符', icon: 'none' }); return }
    const session = store.updateSession({ nickName })
    app.globalData.userInfo = session
    this.setData({ isEditingNickname: false, nicknameDraft: '' })
    wx.showToast({ title: '昵称已更新', icon: 'success' })
    this.refreshPage()
    this.setData({ showAccountPanel: true })
  },
  logout() {
    wx.showModal({
      title: '退出登录', content: '收藏、历史记录和设置会继续保留。', confirmColor: '#d9485f',
      success: res => {
        if (!res.confirm) return
        store.clearSession(); app.globalData.userInfo = null
        this.setData({ showAccountPanel: false, isEditingNickname: false, nicknameDraft: '' })
        this.refreshPage(); wx.showToast({ title: '已退出登录', icon: 'none' })
      }
    })
  },

  onUnload() {
    if (this.avatarChoiceTimer) clearTimeout(this.avatarChoiceTimer)
  },

  toggleManage() {
    this.setData({ isManaging: !this.data.isManaging, selectedIds: [], allSelected: false })
  },
  toggleSelect(e) {
    const id = e.currentTarget.dataset.id
    const selectedIds = this.data.selectedIds.slice()
    const index = selectedIds.indexOf(id)
    index >= 0 ? selectedIds.splice(index, 1) : selectedIds.push(id)
    const newsList = this.data.newsList.map(item => Object.assign({}, item, { selected: selectedIds.includes(item.id) }))
    this.setData({ selectedIds, newsList, allSelected: selectedIds.length === newsList.length })
  },
  toggleSelectAll() {
    const selectedIds = this.data.allSelected ? [] : this.data.newsList.map(item => item.id)
    const newsList = this.data.newsList.map(item => Object.assign({}, item, { selected: !this.data.allSelected }))
    this.setData({ selectedIds, newsList, allSelected: !this.data.allSelected })
  },
  removeOne(e) {
    store.removeFavorites([e.currentTarget.dataset.id])
    wx.showToast({ title: '已取消收藏', icon: 'none' })
    this.getMyFavorites()
  },
  batchRemove() {
    if (!this.data.selectedIds.length) { wx.showToast({ title: '请先选择新闻', icon: 'none' }); return }
    wx.showModal({
      title: '批量取消收藏', content: `确定取消收藏选中的 ${this.data.selectedIds.length} 条新闻吗？`, confirmColor: '#d9485f',
      success: res => {
        if (!res.confirm) return
        store.removeFavorites(this.data.selectedIds)
        this.setData({ selectedIds: [], allSelected: false, isManaging: false })
        this.getMyFavorites()
      }
    })
  },
  handleFavoriteTap(e) {
    this.data.isManaging ? this.toggleSelect(e) : this.goToDetail(e)
  },
  goToDetail(e) { wx.navigateTo({ url: '../detail/detail?id=' + e.currentTarget.dataset.id }) },
  goHistory() { wx.navigateTo({ url: '../history/history' }) },
  goSettings() { wx.navigateTo({ url: '../settings/settings' }) },
  onShareAppMessage(e) {
    const mode = e.target && e.target.dataset.mode
    if (mode === 'collection' && this.data.selectedIds.length) {
      const ids = encodeURIComponent(this.data.selectedIds.join(','))
      return { title: `我收藏的 ${this.data.selectedIds.length} 条海大新闻`, path: '/pages/collection/collection?ids=' + ids, imageUrl: '/images/newsimage1.jpg' }
    }
    const id = e.target && e.target.dataset.id
    const article = common.getNewsDetail(id).news
    return { title: article.title || '海大新闻网', path: '/pages/detail/detail?id=' + id, imageUrl: article.poster }
  }
})
