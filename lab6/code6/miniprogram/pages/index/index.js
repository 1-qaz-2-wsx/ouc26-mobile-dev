const photoUtils = require('../../utils/photo')
const social = require('../../utils/social')
const db = wx.cloud.database()
const photos = db.collection('photos')
const app = getApp()

Page({
  data: {
    photoList: [],
    visiblePhotos: [],
    feedTab: 'community',
    keyword: '',
    unreadCount: 0,
    loading: false,
    loadingMore: false,
    hasMore: true,
    loadError: '',
    pageSize: 8
  },

  onShow: function () {
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.setData({ unreadCount: social.unreadCount() })
    this.loadPhotos(true)
  },

  onPullDownRefresh: function () {
    this.loadPhotos(true)
  },

  onReachBottom: function () {
    this.loadPhotos(false)
  },

  loadPhotos: function (reset) {
    var that = this
    var shouldReset = reset === true
    var currentList = shouldReset ? [] : that.data.photoList

    if ((!shouldReset && !that.data.hasMore) || that.data.loading || that.data.loadingMore) {
      wx.stopPullDownRefresh()
      return
    }

    that.setData({
      loading: shouldReset,
      loadingMore: !shouldReset,
      loadError: ''
    })

    photos
      .orderBy('createdAt', 'desc')
      .skip(currentList.length)
      .limit(that.data.pageSize)
      .get()
      .then(function (res) {
        var nextList = currentList.concat(res.data)
        that.setData({
          photoList: nextList.map(photoUtils.normalizePhoto),
          hasMore: res.data.length === that.data.pageSize
        })
        that.applyFilters()
      })
      .catch(function (error) {
        console.error('首页图片加载失败', error)
        that.setData({
          loadError: photoUtils.friendlyError(error, '图片加载失败，下拉可重试')
        })
      })
      .then(function () {
        that.setData({ loading: false, loadingMore: false })
        wx.stopPullDownRefresh()
      })
  },

  retryLoad: function () {
    this.loadPhotos(true)
  },

  switchFeed: function (event) {
    this.setData({ feedTab: event.currentTarget.dataset.tab })
    this.applyFilters()
  },

  onSearchInput: function (event) {
    this.setData({ keyword: event.detail.value || '' })
    this.applyFilters()
  },

  clearSearch: function () {
    this.setData({ keyword: '' })
    this.applyFilters()
  },

  applyFilters: function () {
    var keyword = this.data.keyword.trim().toLowerCase()
    var following = social.getFollowing()
    var onlyFollowing = this.data.feedTab === 'following'
    var list = this.data.photoList.filter(function (item) {
      var matchesTab = !onlyFollowing || Boolean(following[item._openid])
      var text = [item.displayName, item.displayLocation, item.caption].join(' ').toLowerCase()
      return matchesTab && (!keyword || text.indexOf(keyword) !== -1)
    }).map(social.decoratePhoto)
    this.setData({ visiblePhotos: list, unreadCount: social.unreadCount() })
  },

  toggleLike: function (event) {
    social.toggleLike(event.currentTarget.dataset.id)
    this.applyFilters()
  },

  toggleFavorite: function (event) {
    var active = social.toggleFavorite(event.currentTarget.dataset.id)
    this.applyFilters()
    wx.showToast({ title: active ? '已收藏' : '已取消收藏', icon: 'none' })
  },

  openComments: function (event) {
    wx.navigateTo({ url: '../detail/detail?id=' + event.currentTarget.dataset.id + '&comment=1' })
  },

  openMessages: function () {
    wx.navigateTo({ url: '../messages/messages' })
  },

  goToAdd: function () {
    wx.showLoading({ title: '正在准备' })
    Promise.all([
      app.requestUserProfile(),
      app.ensureOpenId()
    ]).then(function () {
      wx.hideLoading()
      wx.navigateTo({ url: '../add/add' })
    }).catch(function (error) {
      wx.hideLoading()
      console.error('进入上传页失败', error)
      wx.showToast({
        title: photoUtils.friendlyError(error, '需要授权用户资料后才能上传'),
        icon: 'none',
        duration: 2600
      })
    })
  }
})
