const { places, segments, getPlace, enrichSegment, formatMoney } = require('../../utils/data-query')

const scoreLabels = { budget: '预算友好', transport: '公共交通', nature: '自然景观', solo: '独行友好', recommend: '推荐程度' }
const costLabels = { hotel: '住宿', food: '餐饮', localTransport: '当地交通', ticket: '门票', other: '其他' }

Page({
  data: { place: null, notFound: false, costRows: [], scoreRows: [], relatedSegments: [] },
  onLoad(options) {
    const place = getPlace(options.id)
    if (!place) {
      this.setData({ notFound: true })
      return
    }
    // 只汇总已知金额；未知金额保留为“待补”，绝不按 0 参与总计。
    const costRows = Object.keys(costLabels).map((key) => ({ key, label: costLabels[key], text: formatMoney(place.costs[key]), known: typeof place.costs[key] === 'number' }))
    const knownTotal = Object.values(place.costs).filter((value) => typeof value === 'number').reduce((sum, value) => sum + value, 0)
    const hasKnownCost = Object.values(place.costs).some((value) => typeof value === 'number')
    const hasUnknownCost = Object.values(place.costs).some((value) => value === null || value === undefined)
    const scoreRows = place.scores ? Object.keys(scoreLabels).filter((key) => typeof place.scores[key] === 'number').map((key) => ({ key, label: scoreLabels[key], value: place.scores[key] })) : []
    const relatedSegments = segments.filter((segment) => segment.fromPlaceId === place.id || segment.toPlaceId === place.id).map(enrichSegment)
    this.setData({ place: { ...place, visitDaysText: place.visitDays.join(' / ') }, costRows, scoreRows, relatedSegments, knownTotal, hasKnownCost, hasUnknownCost, allPlacesCount: places.length })
  },
  openSegment(event) { wx.navigateTo({ url: `/pages/segment-detail/segment-detail?id=${event.currentTarget.dataset.id}` }) }
})
