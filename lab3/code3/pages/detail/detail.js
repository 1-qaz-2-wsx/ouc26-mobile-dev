const common = require('../../utils/common.js')
const store = require('../../utils/store.js')

Page({
  data: { article: null, isFavorite: false, notFound: false, related: [], fontSize: 'medium', isDark: false },
  onLoad(options) {
    const result = common.getNewsDetail(options.id)
    if (result.code !== '200') { this.setData({ notFound: true }); return }
    store.recordHistory(options.id)
    const settings = store.getSettings()
    const related = common.getNewsList().filter(item => item.id !== options.id).slice(0, 2)
    this.setData({ article: result.news, related, fontSize: settings.fontSize, isDark: store.applyAppearance(settings) })
    this.updateFavoriteState()
  },
  onShow() { if (this.data.article) this.updateFavoriteState() },
  updateFavoriteState() { this.setData({ isFavorite: store.isFavorite(this.data.article.id) }) },
  toggleFavorite() {
    if (!store.requireLogin()) return
    const added = store.toggleFavorite(this.data.article.id)
    this.setData({ isFavorite: added })
    wx.showToast({ title: added ? '收藏成功' : '已取消收藏', icon: 'none' })
  },
  copyTitle() {
    wx.setClipboardData({ data: this.data.article.title, success: () => wx.showToast({ title: '标题已复制' }) })
  },
  changeFontSize() {
    const sizes = ['small', 'medium', 'large']
    const next = sizes[(sizes.indexOf(this.data.fontSize) + 1) % sizes.length]
    store.saveSettings({ fontSize: next })
    this.setData({ fontSize: next })
  },
  goToDetail(e) { wx.redirectTo({ url: '../detail/detail?id=' + e.currentTarget.dataset.id }) },
  onShareAppMessage() {
    return { title: this.data.article.title, path: '/pages/detail/detail?id=' + this.data.article.id, imageUrl: this.data.article.poster }
  }
})
