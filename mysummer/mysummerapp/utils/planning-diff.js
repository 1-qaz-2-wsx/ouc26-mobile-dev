const LABELS = { origin: '出发地', endDestination: '结束地', startAt: '出发时间', endBy: '结束时间', timezone: '时区',
  travelers: '同行人数', budget: '预算及费用范围', transportPreferences: '交通偏好', transportDemand: '火车查询要求',
  lodgingPreferences: '住宿要求', interests: '兴趣', pace: '节奏', menuItems: '地点、停留与顺序', optimizeOrder: '顺序择优', locks: '锁定要求', confirmedConstraints: '确认约束' }
function describe(key, value) {
  if (value === null || value === undefined) return '未设置'
  if (key === 'origin' || key === 'endDestination') return value.name
  if (key === 'travelers') return value.adults + ' 成人，' + value.children.length + ' 儿童' + (value.children.length ? '（' + value.children.join('、') + ' 岁）' : '')
  if (key === 'budget') return '¥' + (value.amountMinor / 100).toFixed(2) + (value.basis === 'person' ? ' / 人' : ' / 全团') + (value.strict ? '，严格上限' : '，参考预算') + '，范围：' + value.includedCategories.map(v => ({ transport: '交通', local_transfer: '接驳', lodging: '住宿', ticket: '门票' }[v] || v)).join('、')
  if (key === 'menuItems') return value.map(v => v.placeRef.name + (v.stayDays ? '（' + v.stayDays + ' 天）' : '') + '，活动 ' + v.visitDuration.minutes + ' 分钟').join(' → ')
  if (key === 'optimizeOrder') return value ? '择优调整显式顺序' : '遵循显式顺序'
  if (key === 'lodgingPreferences') return (value.required === false ? '不安排住宿' : '需要住宿') + '，' + value.rooms + ' 间'
  if (key === 'transportPreferences') return value.modes.map(v => ({ train: '火车', flight: '飞机', bus: '大巴', car: '自驾' }[v] || v)).join('、') + (value.allowNightTrain ? '，允许夜车' : '，不允许夜车')
  if (key === 'transportDemand') return value.departure.name + ' → ' + value.arrival.name + '，' + value.serviceDate
  if (key === 'pace') return { relaxed: '松弛', balanced: '均衡', intense: '紧凑' }[value] || value
  if (Array.isArray(value)) return value.join('、') || '无'
  return String(value)
}
function diffRows(before, after, changedFields) {
  return changedFields.filter(key => LABELS[key]).map(key => ({ key, label: LABELS[key], before: describe(key, before[key]), after: describe(key, after[key]) }))
}
module.exports = { diffRows }
