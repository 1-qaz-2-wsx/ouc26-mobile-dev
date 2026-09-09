const photoUtils = require('../../utils/photo')
const social = require('../../utils/social')
const db = wx.cloud.database()
const photos = db.collection('photos')
const app = getApp()

Page({
  data: {
    photo: null,
    loading: true,
    loadError: '',
    comments: [],
    commentText: '',
    commentFocus: false
  },

  onLoad: function (options) {
    if (!options.id) {
      this.setData({ loading: false, loadError: '缺少图片标识' })
      return
    }
    this.photoId = options.id
    this.setData({ commentFocus: options.comment === '1' })
    this.loadPhoto()
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  },

  loadPhoto: function () {
    var that = this
    that.setData({ loading: true, loadError: '' })

    photos.doc(that.photoId).get().then(function (res) {
      var photo = social.decoratePhoto(photoUtils.normalizePhoto(res.data, 0))
      that.setData({ photo: photo, isOwner: false, comments: social.getComments(that.photoId) })
      if (app.globalData.loggedOut) return null
      return app.ensureOpenId().then(function (openid) {
        that.setData({ isOwner: photo._openid === openid })
      }).catch(function (identityError) {
        console.warn('详情页暂时无法确认照片归属', identityError)
        that.setData({ isOwner: false })
      })
    }).catch(function (error) {
      console.error('图片详情加载失败', error)
      that.setData({
        loadError: photoUtils.friendlyError(error, '图片不存在或暂时无法访问')
      })
    }).then(function () {
      that.setData({ loading: false })
    })
  },

  downloadPhoto: function () {
    var that = this
    if (!that.data.photo) {
      return
    }

    wx.showLoading({ title: '正在下载' })
    wx.cloud.downloadFile({
      fileID: that.data.photo.photoUrl,
      success: function (res) {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: function () {
            wx.hideLoading()
            wx.showToast({ title: '已保存到相册' })
          },
          fail: function (error) {
            wx.hideLoading()
            that.handleSaveError(error)
          }
        })
      },
      fail: function (error) {
        wx.hideLoading()
        console.error('图片下载失败', error)
        wx.showToast({ title: '下载失败，请重试', icon: 'none' })
      }
    })
  },

  handleSaveError: function (error) {
    var message = error && error.errMsg ? error.errMsg : ''
    if (message.indexOf('auth deny') !== -1 || message.indexOf('authorize') !== -1) {
      wx.showModal({
        title: '需要相册权限',
        content: '请在设置中允许保存图片到相册',
        confirmText: '去设置',
        success: function (res) {
          if (res.confirm) {
            wx.openSetting()
          }
        }
      })
      return
    }
    wx.showToast({ title: '保存失败，模拟器无相册时属正常现象', icon: 'none', duration: 3000 })
  },

  previewPhoto: function () {
    if (!this.data.photo) {
      return
    }
    wx.previewImage({
      current: this.data.photo.photoUrl,
      urls: [this.data.photo.photoUrl]
    })
  },

  deletePhoto: function () {
    var that = this
    var photo = this.data.photo
    if (!photo || !this.data.isOwner || this.data.deleting) return
    wx.showModal({
      title: '删除这张照片？',
      content: '删除后无法恢复，同时会从云存储和社区列表中移除。',
      confirmColor: '#e95a3f',
      success: function (result) {
        if (!result.confirm) return
        that.setData({ deleting: true })
        var removeFile = photo.photoUrl ? wx.cloud.deleteFile({ fileList: [photo.photoUrl] }) : Promise.resolve()
        Promise.resolve(removeFile).then(function () {
          return photos.doc(photo._id).remove()
        }).then(function () {
          wx.showToast({ title: '已删除' })
          setTimeout(function () { wx.navigateBack() }, 500)
        }).catch(function (error) {
          console.error('详情页删除照片失败', error)
          that.setData({ deleting: false })
          wx.showToast({ title: photoUtils.friendlyError(error, '删除失败，请重试'), icon: 'none' })
        })
      }
    })
  },

  toggleLike: function () {
    social.toggleLike(this.photoId)
    this.setData({ photo: social.decoratePhoto(this.data.photo) })
  },

  toggleFavorite: function () {
    var active = social.toggleFavorite(this.photoId)
    this.setData({ photo: social.decoratePhoto(this.data.photo) })
    wx.showToast({ title: active ? '已收藏' : '已取消收藏', icon: 'none' })
  },

  onCommentInput: function (event) { this.setData({ commentText: event.detail.value || '' }) },

  submitComment: function () {
    var value = this.data.commentText.trim()
    if (!value) { wx.showToast({ title: '先写点内容吧', icon: 'none' }); return }
    var profile = require('../../utils/social').getProfile() || {}
    var name = profile.nickName || '我'
    social.addComment(this.photoId, { id: String(Date.now()), name: name, letter: name.slice(0, 1), content: value, time: '刚刚' })
    this.setData({ comments: social.getComments(this.photoId), commentText: '', photo: social.decoratePhoto(this.data.photo) })
    wx.showToast({ title: '评论成功' })
  },

  onShareAppMessage: function () {
    var photo = this.data.photo
    return {
      title: photo && photo.caption ? photo.caption : '给你分享一张好看的图片',
      path: '/pages/detail/detail?id=' + (photo ? photo._id : this.photoId),
      imageUrl: photo ? photo.photoUrl : ''
    }
  },

  onShareTimeline: function () {
    var photo = this.data.photo
    return {
      title: photo && photo.caption ? photo.caption : '图片分享社区 · 今日影像',
      query: 'id=' + (photo ? photo._id : this.photoId),
      imageUrl: photo ? photo.photoUrl : ''
    }
  }
})
