const common = require('../../utils/common.js')
const store = require('../../utils/store.js')
Page({
  data: { newsList: [], isDark: false },
  onShow() { this.loadHistory() },
  loadHistory() {
    const history = store.getHistory()
    const list = history.map(record => {
      const result = common.getNewsDetail(record.id)
      return result.code === '200' ? Object.assign({}, result.news, { readAtText: store.formatTime(record.readAt) }) : null
    }).filter(Boolean)
    this.setData({ newsList: list, isDark: store.applyAppearance(store.getSettings()) })
  },
  goToDetail(e) { wx.navigateTo({ url: '../detail/detail?id=' + e.currentTarget.dataset.id }) },
  clearAll() {
    wx.showModal({ title: '清空阅读历史', content: '此操作不会删除收藏。', success: res => { if (res.confirm) { store.clearHistory(); this.loadHistory() } } })
  }
})
