const photoUtils = require('../../utils/photo')
const social = require('../../utils/social')
const db = wx.cloud.database()
const photos = db.collection('photos')
const app = getApp()

function sortByCreatedAt(list) {
  return list.sort(function (a, b) {
    var timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    var timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    if (timeA !== timeB) return timeB - timeA
    return String(b.addDate || '').localeCompare(String(a.addDate || ''))
  })
}

Page({
  data: { photoList: [], profile: null, loading: true, loadError: '', editing: false, editName: '', editBio: '', profileSaving: false, loggedOut: false, deletingId: '' },

  onShow: function () {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 1, hidden: false })
    if (app.globalData.loggedOut) {
      this.setData({ loggedOut: true, photoList: [], profile: null, loading: false })
      return
    }
    this.setData({ loggedOut: false })
    this.loadMine()
  },

  onPullDownRefresh: function () { this.loadMine() },

  loadMine: function () {
    var that = this
    that.setData({ loading: true, loadError: '' })
    app.ensureOpenId().then(function (openid) {
      return photos.where({ _openid: openid }).limit(20).get()
    }).then(function (res) {
      var normalized = sortByCreatedAt(res.data).map(photoUtils.normalizePhoto)
      var savedProfile = social.getProfile() || app.globalData.userInfo
      var profile = normalized.length ? normalized[0] : null
      if (savedProfile) {
        var places = [savedProfile.province, savedProfile.country].filter(function (item, index, list) {
          return item && list.indexOf(item) === index
        })
        profile = {
          avatarUrl: savedProfile.avatarUrl || '',
          displayName: savedProfile.nickName || '微信用户',
          displayLocation: savedProfile.bio || places.join(' · ') || '图片分享社区成员',
          avatarLetter: (savedProfile.nickName || '微').slice(0, 1)
        }
      }
      that.setData({ photoList: normalized, profile: profile })
    }).catch(function (error) {
      console.error('我的作品加载失败', error)
      that.setData({ loadError: photoUtils.friendlyError(error, '暂时无法加载你的作品') })
    }).then(function () {
      that.setData({ loading: false })
      wx.stopPullDownRefresh()
    })
  },

  deletePhoto: function (event) {
    var that = this
    var id = event.currentTarget.dataset.id
    var photo = this.data.photoList.find(function (item) { return item._id === id })
    if (!photo || that.data.deletingId) return

    wx.showModal({
      title: '删除这张照片？',
      content: '照片删除后无法恢复，同时会从云存储和社区列表中移除。',
      confirmColor: '#e95a3f',
      success: function (result) {
        if (!result.confirm) return
        that.setData({ deletingId: id })
        var removeFile = photo.photoUrl ? wx.cloud.deleteFile({ fileList: [photo.photoUrl] }) : Promise.resolve()
        Promise.resolve(removeFile).then(function () {
          return photos.doc(id).remove()
        }).then(function () {
          that.setData({
            photoList: that.data.photoList.filter(function (item) { return item._id !== id }),
            deletingId: ''
          })
          wx.showToast({ title: '已删除' })
        }).catch(function (error) {
          console.error('删除照片失败', error)
          that.setData({ deletingId: '' })
          wx.showToast({ title: photoUtils.friendlyError(error, '删除失败，请重试'), icon: 'none' })
        })
      }
    })
  },

  logout: function () {
    var that = this
    wx.showModal({
      title: '退出登录',
      content: '将清理本机保存的用户资料、互动记录和当前会话，云端照片不会被删除。',
      confirmColor: '#e95a3f',
      success: function (result) {
        if (!result.confirm) return
        social.clearSession()
        app.clearSession()
        that.setData({ loggedOut: true, photoList: [], profile: null, loading: false, editing: false })
        wx.showToast({ title: '已退出登录', icon: 'none' })
      }
    })
  },

  loginAgain: function () {
    var that = this
    app.globalData.loggedOut = false
    that.setData({ loading: true, loggedOut: false })
    Promise.all([app.requestUserProfile(), app.ensureOpenId()]).then(function () {
      that.loadMine()
    }).catch(function (error) {
      app.globalData.loggedOut = true
      that.setData({ loading: false, loggedOut: true })
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) return
      wx.showToast({ title: photoUtils.friendlyError(error, '登录失败，请重试'), icon: 'none' })
    })
  },

  completeProfile: function () {
    var that = this
    app.requestUserProfile().then(function () { that.loadMine() }).catch(function (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) return
      wx.showToast({ title: '未能获取用户资料', icon: 'none' })
    })
  },

  openEdit: function () {
    var profile = this.data.profile || {}
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ hidden: true })
    this.setData({ editing: true, editName: profile.displayName || '', editBio: profile.displayLocation || '' })
  },

  closeEdit: function () {
    this.setData({ editing: false })
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  },
  noop: function () {},
  onNameInput: function (event) { this.setData({ editName: event.detail.value || '' }) },
  onBioInput: function (event) { this.setData({ editBio: event.detail.value || '' }) },

  saveProfile: function () {
    var that = this
    if (that.data.profileSaving) return
    var name = this.data.editName.trim()
    if (!name) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    var original = social.getProfile() || app.globalData.userInfo || {}
    var saved = Object.assign({}, original, { nickName: name, bio: this.data.editBio.trim() })
    that.setData({ profileSaving: true })
    app.ensureOpenId().then(function (openid) {
      return photos.where({ _openid: openid }).update({
        data: {
          nickName: saved.nickName,
          bio: saved.bio,
          profileUpdatedAt: db.serverDate()
        }
      })
    }).then(function () {
      social.saveProfile(saved)
      app.globalData.userInfo = saved
      that.setData({ editing: false, profileSaving: false })
      if (that.getTabBar && that.getTabBar()) that.getTabBar().setData({ hidden: false })
      that.loadMine()
      wx.showToast({ title: '资料已同步' })
    }).catch(function (error) {
      console.error('个人资料同步失败', error)
      that.setData({ profileSaving: false })
      wx.showToast({ title: photoUtils.friendlyError(error, '资料保存失败，请重试'), icon: 'none' })
    })
  },

  goToAdd: function () {
    app.requestUserProfile().then(function () {
      wx.navigateTo({ url: '../add/add' })
    }).catch(function (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) return
      wx.showToast({ title: photoUtils.friendlyError(error, '需要授权用户资料后才能上传'), icon: 'none' })
    })
  }
})
