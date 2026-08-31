const { tripDays, getPlace, getSegment, enrichSegment } = require('../../utils/data-query')

Page({
  data: { days: [] },
  onLoad() {
    // 将 id 转成页面可直接显示的对象；原始数据仍保持单一来源。
    const days = tripDays.map((day) => ({
      ...day,
      dateText: day.date || '日期待补',
      places: day.placeIds.map(getPlace).filter(Boolean),
      segments: day.segmentIds.map(getSegment).map(enrichSegment).filter(Boolean),
      expanded: day.day === 1 || day.segmentIds.length > 0
    }))
    this.setData({ days })
  },
  toggleDay(event) {
    const index = event.currentTarget.dataset.index
    this.setData({ [`days[${index}].expanded`]: !this.data.days[index].expanded })
  },
  openPlace(event) { wx.navigateTo({ url: `/pages/place-detail/place-detail?id=${event.currentTarget.dataset.id}` }) },
  openSegment(event) { wx.navigateTo({ url: `/pages/segment-detail/segment-detail?id=${event.currentTarget.dataset.id}` }) }
})
