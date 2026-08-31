/**
 * P0 的唯一业务数据源。
 * 页面只保存对象 id，通过查询函数取得对象，避免地图、行程和详情各写一份数据。
 * null 表示真实资料尚未补齐，页面必须显示“待补”，不能误当成 0。
 */
const places = [
  { id: 'qingdao', name: '青岛', latitude: 36.0671, longitude: 120.3826, summary: '从海边出发，开始一路向北。', tags: ['起点', '海滨'], impression: '旅程从熟悉的海风里出发。', visitDays: [1], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: null, tips: ['确认随身证件与长途交通票据。'] },
  { id: 'yantai', name: '烟台', latitude: 37.4638, longitude: 121.4479, summary: '连接海路与铁路的沿海停靠点。', tags: ['轮渡', '海滨'], impression: '在海岸线上完成第一次转场。', visitDays: [1, 17], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: null, tips: ['轮渡班次可能受天气影响，出发前需复核。'] },
  { id: 'dalian', name: '大连', latitude: 38.9140, longitude: 121.6147, summary: '渡海后进入东北的第一座城市。', tags: ['轮渡', '城市'], impression: '从海路抵达东北，旅行的尺度开始变大。', visitDays: [2], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: null, tips: ['注意码头与火车站之间的换乘时间。'] },
  { id: 'changchun', name: '长春', latitude: 43.8171, longitude: 125.3235, summary: '继续向北的重要铁路节点。', tags: ['铁路', '城市'], impression: '长距离铁路旅行在这里逐渐进入节奏。', visitDays: [3], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: null, tips: ['长途换乘预留充足候车时间。'] },
  { id: 'nancha', name: '南岔', latitude: 47.1379, longitude: 129.2836, summary: '进入小兴安岭前后的铁路小城。', tags: ['铁路', '小城'], impression: '城市逐渐退后，森林越来越近。', visitDays: [4], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: null, tips: ['小站班次较少，补给应提前准备。'] },
  { id: 'tangwanghe', name: '汤旺河', latitude: 48.4547, longitude: 129.5709, summary: '真正感到进入小兴安岭的地方。', tags: ['森林', '小兴安岭'], impression: '真正让我感觉进入小兴安岭的地方。', visitDays: [5], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: { budget: 4, transport: 3, nature: 5, solo: 4, recommend: 5 }, tips: ['公共交通选择有限，先确认到达和返程班次。', '林区昼夜温差明显，准备外套和防蚊用品。'] },
  { id: 'harbin', name: '哈尔滨', latitude: 45.8038, longitude: 126.5349, summary: '两次经过的关键换乘中心。', tags: ['铁路枢纽', '经过 2 次'], impression: '整条路线中承上启下的交通节点。', visitDays: [6, 15], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: null, tips: ['本路线两次经过哈尔滨，查看详情时注意对应 Day。'] },
  { id: 'mohe', name: '漠河', latitude: 52.9723, longitude: 122.5386, summary: '长途北上后抵达的极北小城。', tags: ['极北', '森林'], impression: '长途火车之后，抵达地图上遥远的北方。', visitDays: [8], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: { budget: 3.5, transport: 3, nature: 5, solo: 3.5, recommend: 4.5 }, tips: ['热门日期住宿和交通应提前确认。', '不要把历史班次当作当前班次。'] },
  { id: 'mangui', name: '满归', latitude: 52.0351, longitude: 121.2313, summary: '森林深处的偏远停靠点。', tags: ['大兴安岭', '小镇'], impression: '路程不轻松，却更接近森林旅行本身。', visitDays: [10], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: { budget: 4, transport: 2, nature: 5, solo: 3, recommend: 4.5 }, tips: ['班次和补给有限，需准备备用方案。'] },
  { id: 'hailaer', name: '海拉尔', latitude: 49.2122, longitude: 119.7364, summary: '从森林走向草原的重要节点。', tags: ['草原', '城市'], impression: '风景从林海逐渐过渡到开阔草原。', visitDays: [12], costs: { hotel: null, food: null, localTransport: null, ticket: null, other: null }, scores: null, tips: ['区域跨度大，市内与周边交通需分开规划。'] }
]

const rawSegments = [
  ['s01', 'qingdao', 'yantai', '轮渡/交通', 1, false], ['s02', 'yantai', 'dalian', '轮渡', 2, true],
  ['s03', 'dalian', 'changchun', '火车', 3, true], ['s04', 'changchun', 'nancha', '火车', 4, true],
  ['s05', 'nancha', 'tangwanghe', '火车', 5, false], ['s06', 'tangwanghe', 'harbin', '火车', 6, true],
  ['s07', 'harbin', 'mohe', '火车', 8, true], ['s08', 'mohe', 'mangui', '客运/换乘', 10, false],
  ['s09', 'mangui', 'hailaer', '火车/客运', 12, true], ['s10', 'hailaer', 'harbin', '火车', 15, true],
  ['s11', 'harbin', 'yantai', '火车/轮渡', 17, true], ['s12', 'yantai', 'qingdao', '轮渡/交通', 18, false]
]

const segments = rawSegments.map((item, index) => ({
  id: item[0], fromPlaceId: item[1], toPlaceId: item[2], transportType: item[3], day: item[4], crossDay: item[5], displayOrder: index + 1,
  distanceKm: null, durationMinutes: null, actualCost: null,
  summary: '该路段的真实班次、时间与费用正在根据旅行记录补充。', timeline: [],
  tips: item[5] ? ['这是跨日路段，购票时同时核对出发日期和到达日期。'] : ['班次可能变化，出发前再次核对。']
}))

const tripDays = Array.from({ length: 18 }, (_, index) => {
  const day = index + 1
  const daySegments = segments.filter((segment) => segment.day === day)
  const placeIds = []
  daySegments.forEach((segment) => [segment.fromPlaceId, segment.toPlaceId].forEach((id) => { if (!placeIds.includes(id)) placeIds.push(id) }))
  return {
    id: `day-${day}`, day, date: null,
    title: placeIds.length ? placeIds.map((id) => places.find((place) => place.id === id).name).join(' → ') : '旅途停留与整理',
    summary: daySegments.length ? '沿真实路线继续移动。' : '当日详细旅行记录待补。',
    placeIds, segmentIds: daySegments.map((segment) => segment.id)
  }
})

const guides = [
  { id: 'first-xinganling', title: '第一次走兴安岭', category: '路线', summary: '先看懂这条从海边向森林与草原延伸的完整路线。', readingMinutes: 6, displayOrder: 1, sections: [{ title: '路线是什么', content: '这不是一份目的地合集，而是一条真实发生过的长距离公共交通路线。' }, { title: '适合什么人', content: '适合预算有限、愿意乘坐长途公共交通并接受较长移动时间的旅行者。' }], relatedPlaceIds: ['tangwanghe', 'mohe', 'mangui'], relatedSegmentIds: ['s07', 's08'] },
  { id: 'public-transport', title: '公共交通穿越东北', category: '交通', summary: '火车、轮渡和客运如何连接成长距离路线。', readingMinutes: 8, displayOrder: 2, sections: [{ title: '我的实际路线', content: '路线以火车为骨架，并使用轮渡、客运和当地交通完成连接。' }, { title: '最困难的一段', content: '偏远地区班次少，换乘和补给需要预留余量。' }], relatedPlaceIds: ['harbin', 'mohe'], relatedSegmentIds: ['s07', 's08', 's09'] },
  { id: 'budget', title: '我的穷游预算', category: '预算', summary: '理解交通、住宿、饮食和门票如何组成总预算。', readingMinutes: 5, displayOrder: 3, sections: [{ title: '预算口径', content: '历史实付与当前预计必须分开。计算器使用参考单价，不代表实时票价。' }, { title: '应急预算', content: '建议在基础总额之外预留 15% 的应急预算。' }], relatedPlaceIds: [], relatedSegmentIds: [], toolTarget: 'budget' },
  { id: 'accommodation', title: '低预算住宿', category: '住宿', summary: '如何在青旅、经济住宿和普通住宿之间选择。', readingMinutes: 4, displayOrder: 4, sections: [{ title: '选择标准', content: '除价格外，还要考虑到达时间、车站距离、行李寄存和夜间安全。' }], relatedPlaceIds: ['harbin', 'mohe'], relatedSegmentIds: [] },
  { id: 'pitfalls', title: '踩坑记录', category: '经验', summary: '整理班次、换乘、补给和信息时效方面的真实风险。', readingMinutes: 7, displayOrder: 5, sections: [{ title: '班次不是永久不变', content: '历史旅行记录只能证明当时可行，出发前仍需向官方复核。' }, { title: '偏远地区要留余量', content: '不要把换乘安排到没有容错的程度，并准备必要补给。' }], relatedPlaceIds: ['nancha', 'mangui'], relatedSegmentIds: ['s08', 's09'] }
]

// 原型参考值只用于验证计算功能，界面会明确提示并非实时价格。
const budgetPlans = [
  { id: 'five-day', name: '5 天精简线', days: 5, nights: 4, transportCost: 520, ticketCost: 120, otherCost: 0, note: '哈尔滨 → 漠河方向的原型参考方案' },
  { id: 'seven-day', name: '7 天兴安岭线', days: 7, nights: 6, transportCost: 870, ticketCost: 190, otherCost: 0, note: '哈尔滨 → 漠河 → 满归 → 海拉尔' },
  { id: 'full-route', name: '18 天完整线', days: 18, nights: 17, transportCost: 1680, ticketCost: 360, otherCost: 120, note: '复刻 PRD 中的完整往返路线' }
]
const lodgingOptions = [{ id: 'hostel', name: '青旅', pricePerNight: 70 }, { id: 'economy', name: '经济住宿', pricePerNight: 140 }, { id: 'standard', name: '普通住宿', pricePerNight: 240 }]
const foodOptions = [40, 70, 120]

module.exports = { places, segments, tripDays, guides, budgetPlans, lodgingOptions, foodOptions }
