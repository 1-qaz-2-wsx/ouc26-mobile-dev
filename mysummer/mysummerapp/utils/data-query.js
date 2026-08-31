const data = require('../data/trip-data')

// 集中查询可以让页面只关心 id，并统一处理“对象不存在”的异常。
function findById(list, id) { return list.find((item) => item.id === id) || null }
function getPlace(id) { return findById(data.places, id) }
function getSegment(id) { return findById(data.segments, id) }
function getGuide(id) { return findById(data.guides, id) }
function formatMoney(value) { return typeof value === 'number' ? `¥${value}` : '待补' }
function formatDuration(minutes) {
  if (typeof minutes !== 'number') return '时长待补'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours ? `${hours} h ` : ''}${rest ? `${rest} min` : ''}`.trim()
}
function enrichSegment(segment) {
  if (!segment) return null
  return { ...segment, fromPlace: getPlace(segment.fromPlaceId), toPlace: getPlace(segment.toPlaceId), costText: formatMoney(segment.actualCost), durationText: formatDuration(segment.durationMinutes), distanceText: typeof segment.distanceKm === 'number' ? `${segment.distanceKm} km` : '距离待补' }
}

module.exports = { ...data, getPlace, getSegment, getGuide, enrichSegment, formatMoney, formatDuration }
