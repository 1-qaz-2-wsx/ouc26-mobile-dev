const photoUtils = require('../../utils/photo')
const social = require('../../utils/social')
const db = wx.cloud.database()
const photos = db.collection('photos')

function sortByCreatedAt(list) {
  return list.sort(function (a, b) {
    var timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    var timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    if (timeA !== timeB) {
      return timeB - timeA
    }
    return String(b.addDate || '').localeCompare(String(a.addDate || ''))
  })
}

Page({
  data: {
    openid: '',
    photoList: [],
    profile: null,
    following: false,
    loading: true,
    loadingMore: false,
    hasMore: true,
    loadError: '',
    pageSize: 8
  },

  onLoad: function (options) {
    if (!options.id) {
      this.setData({
        loading: false,
        loadError: '缺少用户标识，无法打开个人主页'
      })
      return
    }
    this.setData({ openid: options.id })
    this.setData({ following: Boolean(social.getFollowing()[options.id]) })
    this.loadPhotos(true)
  },

  onReachBottom: function () {
    this.loadPhotos(false)
  },

  loadPhotos: function (reset) {
    var that = this
    var currentList = reset ? [] : that.data.photoList

    if (!that.data.openid || (!reset && !that.data.hasMore) || that.data.loadingMore) {
      return
    }

    that.setData({
      loading: reset,
      loadingMore: !reset,
      loadError: ''
    })

    photos
      .where({ _openid: that.data.openid })
      .skip(currentList.length)
      .limit(that.data.pageSize)
      .get()
      .then(function (res) {
        var merged = sortByCreatedAt(currentList.concat(res.data))
        var normalized = merged.map(photoUtils.normalizePhoto)
        that.setData({
          photoList: normalized,
          profile: normalized.length ? normalized[0] : null,
          hasMore: res.data.length === that.data.pageSize
        })
      })
      .catch(function (error) {
        console.error('个人主页加载失败', error)
        that.setData({
          loadError: photoUtils.friendlyError(error, '个人主页加载失败，点击重试')
        })
      })
      .then(function () {
        that.setData({ loading: false, loadingMore: false })
      })
  },

  retryLoad: function () {
    this.loadPhotos(true)
  },

  toggleFollow: function () {
    if (!this.data.profile) return
    var active = social.toggleFollow(this.data.openid, this.data.profile.displayName)
    this.setData({ following: active })
    wx.showToast({ title: active ? '关注成功' : '已取消关注', icon: 'none' })
  }
})
