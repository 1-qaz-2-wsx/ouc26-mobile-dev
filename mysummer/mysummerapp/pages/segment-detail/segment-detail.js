const { getSegment, enrichSegment } = require('../../utils/data-query')

Page({
  data: { segment: null, notFound: false },
  onLoad(options) {
    const segment = enrichSegment(getSegment(options.id))
    if (!segment) this.setData({ notFound: true })
    else this.setData({ segment })
  },
  openPlace(event) { wx.navigateTo({ url: `/pages/place-detail/place-detail?id=${event.currentTarget.dataset.id}` }) }
})
