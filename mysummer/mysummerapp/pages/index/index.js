const { places, segments, getPlace } = require('../../utils/data-query')

Page({
  data: {
    markers: [],
    polyline: [],
    // 地图组件首次创建时就需要稳定的中心点和数组类型视野参数。
    centerLatitude: 45.8,
    centerLongitude: 124.5,
    mapScale: 4,
    includePoints: [],
    selectedPlace: null,
    mapFailed: false,
    tripStats: [
      { label: '旅行天数', value: '18 天' },
      { label: '停靠地点', value: `${places.length} 个` },
      { label: '总里程', value: '待补' },
      { label: '实际花费', value: '待补' }
    ]
  },

  onLoad() {
    // 哈尔滨等重复到访地点只创建一个 Marker，visitDays 用于卡片展示多次经过。
    const markers = places.map((place, index) => ({
      id: index + 1,
      placeId: place.id,
      latitude: place.latitude,
      longitude: place.longitude,
      width: 26,
      height: 32,
      // 暂不依赖额外 PNG 图标，使用常显标签确保地点在 Skyline 地图中可辨认。
      label: { content: `${place.name}${place.visitDays.length > 1 ? ` · ${place.visitDays.length}次` : ''}`, anchorX: -18, anchorY: -34, padding: 5, borderRadius: 7, color: '#244b3d', bgColor: '#fffdf8', fontSize: 11 },
      callout: { content: `${place.name}${place.visitDays.length > 1 ? ` · ${place.visitDays.length}次` : ''}`, display: 'BYCLICK', padding: 6, borderRadius: 8, color: '#244b3d', bgColor: '#fffdf8', fontSize: 12 }
    }))
    const routePoints = segments.map((segment) => getPlace(segment.fromPlaceId)).concat(getPlace(segments[segments.length - 1].toPlaceId)).map((place) => ({ latitude: place.latitude, longitude: place.longitude }))
    this.setData({ markers, includePoints: routePoints, polyline: [{ points: routePoints, color: '#bf5944', width: 4, dottedLine: false, arrowLine: true }] })
  },

  onMarkerTap(event) {
    const marker = this.data.markers.find((item) => item.id === event.detail.markerId)
    if (marker) {
      const place = getPlace(marker.placeId)
      this.setData({ selectedPlace: { ...place, visitDaysText: place.visitDays.join(' / ') } })
    }
  },

  closePlaceCard() { this.setData({ selectedPlace: null }) },
  openPlace(event) { wx.navigateTo({ url: `/pages/place-detail/place-detail?id=${event.currentTarget.dataset.id}` }) },
  onMapError(event) {
    // 保留错误日志，便于在开发者工具控制台区分网络问题和组件问题。
    console.error('地图组件加载失败：', event.detail)
    this.setData({ mapFailed: true })
  },
  retryMap() { this.setData({ mapFailed: false }) }
})
