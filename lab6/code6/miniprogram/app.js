App({
  onLaunch: function () {
    this.globalData = {
      userInfo: null,
      openid: null,
      openidPromise: null,
      loggedOut: false
    }

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }

    // 未显式填写 env 时，使用开发者工具当前选择的云环境。
    wx.cloud.init({
      traceUser: true
    })
  },

  ensureOpenId: function () {
    var that = this

    if (that.globalData.openid) {
      return Promise.resolve(that.globalData.openid)
    }

    if (that.globalData.openidPromise) {
      return that.globalData.openidPromise
    }

    that.globalData.openidPromise = wx.cloud.callFunction({
      name: 'getOpenid'
    }).then(function (res) {
      var openid = res.result && res.result.openid
      if (!openid) {
        throw new Error('未获取到用户标识')
      }
      that.globalData.openid = openid
      return openid
    }).catch(function (error) {
      that.globalData.openidPromise = null
      throw error
    })

    return that.globalData.openidPromise
  },

  requestUserProfile: function () {
    var that = this

    if (that.globalData.userInfo) {
      return Promise.resolve(that.globalData.userInfo)
    }

    return new Promise(function (resolve, reject) {
      wx.getUserProfile({
        desc: '用于展示图片作者的头像和昵称',
        success: function (res) {
          that.globalData.userInfo = res.userInfo
          resolve(res.userInfo)
        },
        fail: reject
      })
    })
  },

  clearSession: function () {
    this.globalData.userInfo = null
    this.globalData.openid = null
    this.globalData.openidPromise = null
    this.globalData.loggedOut = true
  }
})
