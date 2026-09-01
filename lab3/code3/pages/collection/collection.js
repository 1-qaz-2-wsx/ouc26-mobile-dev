const common = require('../../utils/common.js')
const store = require('../../utils/store.js')
Page({
  data: { ids: [], newsList: [], isDark: false },
  onLoad(options) {
    let raw = options.ids || ''
    try { raw = decodeURIComponent(raw) } catch (e) {}
    const ids = raw.split(',').filter(Boolean)
    this.setData({ ids, newsList: common.getNewsByIds(ids), isDark: store.applyAppearance(store.getSettings()) })
  },
  goToDetail(e) { wx.navigateTo({ url: '../detail/detail?id=' + e.currentTarget.dataset.id }) },
  onShareAppMessage() {
    return { title: `海大新闻精选 · ${this.data.newsList.length} 条`, path: '/pages/collection/collection?ids=' + encodeURIComponent(this.data.ids.join(',')), imageUrl: '/images/newsimage1.jpg' }
  }
})
