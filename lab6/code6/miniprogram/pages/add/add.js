const photoUtils = require('../../utils/photo')
const db = wx.cloud.database()
const photos = db.collection('photos')
const app = getApp()

function chooseOneImage() {
  return new Promise(function (resolve, reject) {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        resolve(res.tempFilePaths[0])
      },
      fail: reject
    })
  })
}

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
    caption: '',
    captionLength: 0,
    historyPhotos: [],
    historyLoading: true,
    historyError: '',
    uploading: false,
    uploadProgress: 0,
    userInfo: null
  },

  onLoad: function () {
    this.setData({ userInfo: app.globalData.userInfo })
    this.getHistoryPhotos()
  },

  onCaptionInput: function (event) {
    var value = event.detail.value || ''
    this.setData({
      caption: value,
      captionLength: value.length
    })
  },

  upload: function () {
    var that = this

    if (that.data.uploading) {
      return
    }

    var userInfo
    var openid

    // 授权弹窗和系统选图面板必须串行打开，避免两个原生弹窗互相抢占。
    app.requestUserProfile().then(function (profile) {
      userInfo = profile
      that.setData({ userInfo: profile })
      return app.ensureOpenId()
    }).then(function (userOpenid) {
      openid = userOpenid
      return chooseOneImage()
    }).then(function (filePath) {
      return that.uploadFile(filePath, openid, userInfo)
    }).catch(function (error) {
      if (error && error.errMsg && error.errMsg.indexOf('cancel') !== -1) {
        return
      }
      console.error('选择或上传图片失败', error)
      wx.showToast({
        title: photoUtils.friendlyError(error, '图片上传失败，请稍后重试'),
        icon: 'none',
        duration: 2800
      })
    })
  },

  uploadFile: function (filePath, openid, userInfo) {
    var that = this
    var extension = photoUtils.fileExtension(filePath)
    var cloudPath = 'photos/' + openid + '/' + Date.now() + '-' + Math.floor(Math.random() * 10000) + '.' + extension

    that.setData({ uploading: true, uploadProgress: 0 })

    return new Promise(function (resolve, reject) {
      var uploadTask = wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath,
        success: resolve,
        fail: reject
      })

      uploadTask.onProgressUpdate(function (progress) {
        that.setData({ uploadProgress: progress.progress })
      })
    }).then(function (uploadResult) {
      var today = photoUtils.formatDate()
      return photos.add({
        data: {
          photoUrl: uploadResult.fileID,
          avatarUrl: userInfo.avatarUrl || '',
          country: userInfo.country || '',
          province: userInfo.province || '',
          nickName: userInfo.nickName || '微信用户',
          bio: userInfo.bio || '',
          addDate: today,
          createdAt: db.serverDate(),
          caption: that.data.caption.trim()
        }
      }).catch(function (error) {
        // 数据写入失败时清理刚上传的文件，避免留下孤立云文件。
        wx.cloud.deleteFile({ fileList: [uploadResult.fileID] }).catch(function (cleanupError) {
          console.error('孤立文件清理失败', cleanupError)
        })
        throw error
      })
    }).then(function () {
      that.setData({
        caption: '',
        captionLength: 0,
        uploadProgress: 100
      })
      wx.showToast({ title: '发布成功' })
      return that.getHistoryPhotos()
    }).then(function () {
      that.setData({ uploading: false, uploadProgress: 0 })
    }).catch(function (error) {
      that.setData({ uploading: false, uploadProgress: 0 })
      throw error
    })
  },

  getHistoryPhotos: function () {
    var that = this
    that.setData({ historyLoading: true, historyError: '' })

    return app.ensureOpenId().then(function (openid) {
      return photos.where({ _openid: openid }).limit(20).get()
    }).then(function (res) {
      that.setData({
        historyPhotos: sortByCreatedAt(res.data).map(photoUtils.normalizePhoto)
      })
    }).catch(function (error) {
      console.error('历史图片加载失败', error)
      that.setData({
        historyError: photoUtils.friendlyError(error, '历史记录加载失败')
      })
    }).then(function () {
      that.setData({ historyLoading: false })
    })
  },

  previewHistory: function (event) {
    var current = event.currentTarget.dataset.url
    var urls = this.data.historyPhotos.map(function (item) {
      return item.photoUrl
    })
    wx.previewImage({ current: current, urls: urls })
  }
})
