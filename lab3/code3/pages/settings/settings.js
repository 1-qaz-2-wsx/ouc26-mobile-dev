const store = require('../../utils/store.js')
Page({
  data: { settings: {}, isDark: false, storageSize: 0, version: '开发版' },
  onShow() { this.loadSettings() },
  loadSettings() {
    const settings = store.getSettings()
    let storageSize = 0
    try { storageSize = wx.getStorageInfoSync().currentSize || 0 } catch (e) {}
    let version = '开发版'
    try { version = wx.getAccountInfoSync().miniProgram.version || '开发版' } catch (e) {}
    this.setData({ settings, storageSize, version, isDark: store.applyAppearance(settings) })
  },
  chooseTheme(e) { store.saveSettings({ theme: e.currentTarget.dataset.value }); this.loadSettings() },
  chooseFont(e) { store.saveSettings({ fontSize: e.currentTarget.dataset.value }); this.loadSettings() },
  clearHistory() { wx.showModal({ title: '清除阅读历史', content: '确定清除全部阅读记录吗？', success: res => { if (res.confirm) { store.clearHistory(); wx.showToast({ title: '已清除' }); this.loadSettings() } } }) },
  clearFavorites() { wx.showModal({ title: '清除全部收藏', content: '此操作无法撤销，登录状态和设置会保留。', confirmColor: '#d9485f', success: res => { if (res.confirm) { store.saveFavoriteIds([]); wx.showToast({ title: '已清除' }); this.loadSettings() } } }) }
})
