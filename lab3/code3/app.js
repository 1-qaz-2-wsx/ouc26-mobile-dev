App({
  onLaunch() {
    const store = require('./utils/store.js')
    this.globalData.userInfo = store.getSession()
    this.globalData.settings = store.getSettings()
  },

  globalData: {
    userInfo: null,
    settings: null
  }
})
