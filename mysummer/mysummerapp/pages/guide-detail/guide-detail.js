const { getGuide, getPlace, getSegment, enrichSegment } = require('../../utils/data-query')

Page({
  data: { guide: null, notFound: false, relatedPlaces: [], relatedSegments: [] },
  onLoad(options) {
    const guide = getGuide(options.id)
    if (!guide) {
      this.setData({ notFound: true })
      return
    }
    this.setData({ guide, relatedPlaces: guide.relatedPlaceIds.map(getPlace).filter(Boolean), relatedSegments: guide.relatedSegmentIds.map(getSegment).map(enrichSegment).filter(Boolean) })
  },
  openPlace(event) { wx.navigateTo({ url: `/pages/place-detail/place-detail?id=${event.currentTarget.dataset.id}` }) },
  openSegment(event) { wx.navigateTo({ url: `/pages/segment-detail/segment-detail?id=${event.currentTarget.dataset.id}` }) },
  openTools() { wx.switchTab({ url: '/pages/tools/tools' }) }
})
