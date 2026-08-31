const { guides } = require('../../utils/data-query')
Page({
  data: { guides: guides.slice().sort((a, b) => a.displayOrder - b.displayOrder) },
  openGuide(event) { wx.navigateTo({ url: `/pages/guide-detail/guide-detail?id=${event.currentTarget.dataset.id}` }) }
})
