const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const data = require('../data/trip-data')

const root = path.resolve(__dirname, '..')
const errors = []
const assert = (condition, message) => { if (!condition) errors.push(message) }
const unique = (list) => new Set(list).size === list.length
const nodeIds = data.routeNodes.map((item) => item.id)
const placeIds = data.places.map((item) => item.id)
const visitIds = data.visits.map((item) => item.id)
const segmentIds = data.segments.map((item) => item.id)
const expenseIds = data.expenses.map((item) => item.id)

assert(data.trip.dayCount === 11 && data.tripDays.length === 11, 'Trip 必须正好包含 11 天')
assert(data.trip.startDate === '2025-07-01' && data.trip.endDate === '2025-07-11', '旅行起止日期错误')
assert(data.trip.reconciledTotalCents === 405920, '最终历史总花费必须为 405920 分')
assert(data.tripDays.reduce((sum, day) => sum + day.recordedDailyTotalCents, 0) === 371220, '11 个原始日合计必须为 371220 分')
assert(data.trip.recordedDailyTotalCents + data.trip.recordedCashTopupCents + 7500 + 7200 === data.trip.reconciledTotalCents, '总额核对公式不闭合')
assert(unique(nodeIds) && unique(placeIds) && unique(visitIds) && unique(segmentIds) && unique(expenseIds), '实体 ID 必须唯一')

data.tripDays.forEach((day, index) => {
  const expectedDate = `2025-07-${String(index + 1).padStart(2, '0')}`
  assert(day.dayNumber === index + 1 && day.date === expectedDate, `${day.id} 日期或序号不连续`)
  day.visitIds.forEach((id) => assert(visitIds.includes(id), `${day.id} 引用不存在的 Visit ${id}`))
  day.segmentIds.forEach((id) => assert(segmentIds.includes(id), `${day.id} 引用不存在的 Segment ${id}`))
  day.expenseIds.forEach((id) => assert(expenseIds.includes(id), `${day.id} 引用不存在的 Expense ${id}`))
})
data.visits.forEach((visit) => {
  assert(nodeIds.includes(visit.routeNodeId), `${visit.id} 引用不存在的 RouteNode`)
  assert(!visit.placeId || placeIds.includes(visit.placeId), `${visit.id} 引用不存在的 Place`)
})
data.guides.forEach((guide) => {
  guide.relatedPlaceIds.forEach((id) => assert(placeIds.includes(id), `${guide.id} 引用不存在的 Place ${id}`))
  guide.relatedSegmentIds.forEach((id) => assert(segmentIds.includes(id), `${guide.id} 引用不存在的 Segment ${id}`))
})

const expectedPairs = ['qingdao>yantai', 'yantai>dalian', 'dalian>changchun', 'changchun>nancha', 'nancha>jinshantun', 'jinshantun>yichun', 'yichun>tangwanghe', 'tangwanghe>harbin', 'harbin>mohe', 'mohe>mangui', 'mangui>hailaer', 'hailaer>harbin', 'harbin>yantai', 'yantai>qingdao']
assert(data.segments.length === 14, '主线路段必须正好 14 个')
assert(data.segments.every((item) => item.segmentType === 'mainline'), '主线路段类型错误')
assert(data.segments.map((item) => `${item.fromNodeId}>${item.toNodeId}`).join('|') === expectedPairs.join('|'), '14 个主线路段顺序错误')
data.segments.forEach((segment) => {
  assert(nodeIds.includes(segment.fromNodeId) && nodeIds.includes(segment.toNodeId), `${segment.id} 存在失效节点引用`)
  assert(Number.isInteger(segment.historicalFareCents) && segment.historicalFareCents >= 0, `${segment.id} 历史票价不是非负整数分`)
  segment.expenseIds.forEach((id) => assert(expenseIds.includes(id), `${segment.id} 引用不存在的 Expense ${id}`))
})

data.places.forEach((place) => {
  const node = data.routeNodes.find((item) => item.id === place.routeNodeId)
  assert(node && node.placeId === place.id, `${place.id} 与 RouteNode 详情引用不一致`)
  place.childNodeIds.forEach((id) => {
    const child = data.routeNodes.find((item) => item.id === id)
    assert(child && child.parentNodeId === place.routeNodeId && child.placeId === null, `${place.id} 子节点 ${id} 归属或详情状态错误`)
  })
})
;['beiji-village', 'mergel-river'].forEach((id) => {
  const node = data.routeNodes.find((item) => item.id === id)
  assert(node && node.nodeType === 'visit_spot' && node.placeId === null, `${id} 不得拥有独立地点详情`)
})
const k1021 = data.segments.find((item) => item.serviceNumber === 'K1021')
assert(k1021 && k1021.originDepartureAt && k1021.travelerBoardedAt === null, 'K1021 始发时间与本人上车时间混淆')
const cashPool = data.cashPools[0]
assert(cashPool.allocatedCents === 10000 && cashPool.unclassifiedCents === 10000 && cashPool.status === 'pending', '现金池分类状态错误')
data.expenses.forEach((expense) => {
  assert(Number.isInteger(expense.amountCents) && expense.amountCents >= 0, `${expense.id} 金额不是非负整数分`)
  assert(!expense.tripDayId || data.tripDays.some((day) => day.id === expense.tripDayId), `${expense.id} 引用不存在的 TripDay`)
})
data.tripDays.forEach((day) => {
  const itemized = data.expenses.filter((expense) => expense.tripDayId === day.id && expense.includedInDailyTotal).reduce((sum, expense) => sum + expense.amountCents, 0)
  assert(itemized === day.itemizedTotalCents, `${day.id} Expense 逐项金额与精确日小计不一致`)
})
const exactTripExpenseTotal = data.expenses.filter((expense) => expense.includedInTripTotal).reduce((sum, expense) => sum + expense.amountCents, 0)
assert(exactTripExpenseTotal === 405839 && data.trip.reconciledTotalCents - exactTripExpenseTotal === 81, '精确逐项与记录总额的 ¥0.81 差异错误')
const allocatedCash = cashPool.allocatedExpenseIds.map((id) => data.expenses.find((expense) => expense.id === id)).filter(Boolean)
assert(allocatedCash.length === cashPool.allocatedExpenseIds.length && allocatedCash.reduce((sum, expense) => sum + expense.amountCents, 0) === cashPool.allocatedCents, '现金池分配引用或金额不闭合')
assert(!data.budgetPlans.some((plan) => plan.days === 18 || /18 天/.test(plan.name)), '旧 18 天预算仍然有效')
data.places.forEach((place) => assert(place.planningProfile && place.planningProfile.suitableFor && place.planningProfile.suggestedStay && place.planningProfile.transportChallenge && place.planningProfile.playIdeas.length, `${place.id} 缺少 v2 实用规划信息`))

const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const requiredPages = [
  'pages/me/me', 'pages/index/index', 'pages/map-search/map-search', 'pages/map-selection/map-selection',
  'pages/menu/menu', 'pages/itinerary/itinerary', 'pages/community/community', 'pages/plan-detail/plan-detail',
  'pages/place-detail/place-detail', 'pages/booking/booking', 'pages/post-edit/post-edit',
  'pages/post-detail/post-detail', 'pages/member/member'
]
// 真实数据草案与本地演示方案现在共用 pages/plan-detail（用 source 参数区分），
// 因此不再单独注册 real-plan 页面。
assert(appConfig.pages.length === requiredPages.length && requiredPages.every(page => appConfig.pages.includes(page)), '必须注册 5 个 Tab 与方案、社区详情、地图、成员等 ' + requiredPages.length + ' 个页面')
assert(appConfig.tabBar.list.length === 5 && appConfig.pages[0] === 'pages/me/me', '五 Tab 与 S18 我的启动入口必须正确')
appConfig.pages.forEach((page) => ['js', 'json', 'wxml', 'wxss'].forEach((ext) => assert(fs.existsSync(path.join(root, `${page}.${ext}`)), `${page}.${ext} 不存在`)))
function checkWxmlBalance(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  const tags = source.match(/<\/?[a-zA-Z][^>]*>/g) || []
  tags.forEach((token) => {
    const match = token.match(/^<(\/)?([\w-]+)/)
    if (!match || token.endsWith('/>')) return
    if (match[1]) {
      const opened = stack.pop()
      if (opened !== match[2]) errors.push(`${file} 标签不配对：${opened || '无'} / ${match[2]}`)
    } else stack.push(match[2])
  })
  if (stack.length) errors.push(`${file} 存在未闭合标签：${stack.join(', ')}`)
}
appConfig.pages.forEach((page) => checkWxmlBalance(path.join(root, `${page}.wxml`)))
const jsFiles = []
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
  const full = path.join(dir, entry.name)
  if (entry.isDirectory()) walk(full)
  else if (entry.name.endsWith('.js')) jsFiles.push(full)
  else if (entry.name.endsWith('.json')) { try { JSON.parse(fs.readFileSync(full, 'utf8')) } catch (error) { errors.push(`${full} JSON 解析失败：${error.message}`) } }
})
walk(root)
jsFiles.forEach((file) => {
  try { childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }) } catch (error) { errors.push(`${file} JS 语法检查失败`) }
})
const productText = appConfig.pages.map((page) => `${fs.readFileSync(path.join(root, `${page}.js`), 'utf8')}\n${fs.readFileSync(path.join(root, `${page}.wxml`), 'utf8')}`).join('\n')
assert(!/18 DAYS|18 天完整线|旅行天数[^\n]*18 天|2025-07-19/.test(productText), '注册页面仍包含旧 18 天或错误日期')
const placeDetailText = fs.readFileSync(path.join(root, 'pages/place-detail/place-detail.wxml'), 'utf8')
assert(!placeDetailText.includes('旅行照片待补') && !placeDetailText.includes('评分尚未整理') && !placeDetailText.includes('待补项目'), '地点页不得展示空图片、空评分或空费用壳')

// 用最小微信运行时桩执行各页面 onLoad，捕获字段迁移造成的运行时异常。
const storageValues = {}
let requestCount = 0
global.wx = {
  showToast() {}, navigateTo() {}, navigateBack() {}, switchTab() {},
  getStorageSync(key) { return storageValues[key] || null }, setStorageSync(key, value) { storageValues[key] = value },
  request(options) { requestCount += 1; options.fail({ errMsg: 'request:fail connection refused' }) }
}
function loadPage(relativePath, options) {
  let definition = null
  global.Page = (value) => { definition = value }
  const file = path.join(root, relativePath)
  delete require.cache[require.resolve(file)]
  require(file)
  const context = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(update, callback) { Object.keys(update).forEach((key) => { if (!key.includes('[')) this.data[key] = update[key] }); if (callback) callback() }
  }
  if (context.onLoad) context.onLoad(options || {})
  return context
}
try {
  const indexPage = loadPage('pages/index/index.js')
  assert(indexPage.data.markers.length === 0 && indexPage.data.places.length === 0, '地图首次进入必须为空，搜索后再展示地点与标记')
  const itineraryPage = loadPage('pages/itinerary/itinerary.js')
  itineraryPage.onShow()
  assert(itineraryPage.data.trips.length === 0, '首次行程应为空，不伪造用户旅程')
  data.places.forEach((place) => loadPage('pages/place-detail/place-detail.js', { id: place.id }))
  const travelEngine = require('../utils/travel-engine')
  const travelStore = require('../utils/travel-store')
  const plan = travelEngine.generate(travelEngine.defaults(), travelEngine.seedPlaces.slice(0, 2))
  travelStore.putPlan(plan)
  const planDetailPage = loadPage('pages/plan-detail/plan-detail.js', { id: plan.id })
  assert(planDetailPage.data.plan && planDetailPage.data.items.length > 0, '新方案详情必须恢复本地完整推荐')
  assert(requestCount === 0, '方案详情 onLoad 不得自动调用 AI')
  // 同一个页面也要能承接后端真实草案；没有缓存时必须给空状态，而不是抛错或伪造内容。
  const realPlanPage = loadPage('pages/plan-detail/plan-detail.js', { source: 'real' })
  assert(realPlanPage.data.source === 'real' && realPlanPage.data.view === null, '未生成真实草案时方案页必须给空状态')
} catch (error) {
  errors.push(`页面 onLoad 冒烟测试失败：${error.stack}`)
}

if (errors.length) {
  console.error(`校验失败（${errors.length} 项）：`)
  errors.forEach((error) => console.error(`- ${error}`))
  process.exit(1)
}
console.log('校验通过：v1.2 亲历基线、v2 三模板/8 地点规划资料、5 Tab + 完整方案、页面 onLoad、AI 默认不调用及 JS/JSON/WXML 静态检查均通过。')
