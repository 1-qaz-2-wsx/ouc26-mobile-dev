const social = require('../../utils/social')

Page({
  data: { notifications: [], unreadCount: 0 },
  onShow: function () { this.loadMessages() },
  loadMessages: function () {
    this.setData({ notifications: social.getNotifications(), unreadCount: social.unreadCount() })
  },
  markAllRead: function () {
    social.markAllRead()
    this.loadMessages()
    wx.showToast({ title: '已全部读完', icon: 'none' })
  }
})
