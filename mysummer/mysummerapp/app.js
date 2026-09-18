const cloud = require('./config/cloud')
const travelSync = require('./utils/travel-sync')

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信版本不支持云开发，请升级微信')
      return
    }
    wx.cloud.init({ env: cloud.env, traceUser: true })
    travelSync.install()
  },
  globalData: {
    appName: '旅行规划助手',
    dataVersion: '2026-09-06-travel-mvp-v3'
  }
})
