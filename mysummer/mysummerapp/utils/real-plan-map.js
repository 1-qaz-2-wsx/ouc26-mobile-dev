function mapData(result, selected = '') {
  const plan = result.plan
  const entries = plan.items.filter(item => item.placeRef && item.placeRef.coordinate).slice().sort((a, b) => a.itemId.localeCompare(b.itemId))
  const used = new Set()
  const markers = entries.map(item => {
    let id = 2166136261
    for (const char of item.itemId) id = Math.imul(id ^ char.charCodeAt(0), 16777619) >>> 0
    id = (id % 2147483646) + 1
    while (used.has(id)) id = id === 2147483647 ? 1 : id + 1
    used.add(id)
    return { id, itemId: item.itemId, latitude: item.placeRef.coordinate.lat, longitude: item.placeRef.coordinate.lng,
      width: selected === item.itemId ? 32 : 24, height: selected === item.itemId ? 32 : 24,
      callout: { content: item.placeRef.name + (item.placeRef.type === 'city' ? '（城市锚点）' : ''), display: selected === item.itemId ? 'ALWAYS' : 'BYCLICK', padding: 6 } }
  })
  const legs = plan.legs.concat(result.routeAudit && result.routeAudit.legs || [])
  const leg = legs.find(item => item.legId === selected)
  const geometry = leg && leg.routeGeometry
  const polyline = geometry && ['GCJ02', 'GCJ-02'].includes(geometry.coordinateSystem) && Array.isArray(geometry.points)
    && geometry.points.length >= 2 && geometry.points.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
    ? [{ points: geometry.points.map(p => ({ latitude: p.lat, longitude: p.lng })), color: '#20242a', width: 4 }] : []
  const focus = markers.find(item => item.itemId === selected) || markers[0]
  return { markers, polyline, latitude: focus ? focus.latitude : plan.inputSnapshot.origin.coordinate.lat,
    longitude: focus ? focus.longitude : plan.inputSnapshot.origin.coordinate.lng, scale: 12,
    hasGeometry: polyline.length > 0 }
}
module.exports = { mapData }
