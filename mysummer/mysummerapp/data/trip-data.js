/**
 * P0 唯一业务数据源（PRD / 数据模型 v1.2）。
 * 金额统一使用分；null 表示待补，不能在页面上当成 0。
 */
const trip = {
  id: 'xinganling-2025', title: '兴安岭穷游记', startDate: '2025-07-01', endDate: '2025-07-11',
  dayCount: 11, travelerCount: 1,
  routeNodeIds: ['qingdao', 'yantai', 'dalian', 'changchun', 'nancha', 'jinshantun', 'yichun', 'tangwanghe', 'harbin', 'mohe', 'mangui', 'hailaer'],
  recordedDailyTotalCents: 371220, recordedCashTopupCents: 20000, reconciledTotalCents: 405920,
  accountingStatus: 'total_confirmed_classification_partial', historicalAsOf: '2025-07',
  summary: '11 天内从海边出发，经铁路、轮渡、大巴和飞机穿越东北林区与草原，再回到青岛。',
  tags: ['单人', '公共交通', '低预算', '跨夜移动', '森林铁路', '小城']
}

const nodePlanningNotes = {
  qingdao: { routeRole: '亲历路线示例起终点', planningSummary: '用于理解完整往返结构；当前规划模板不默认包含你所在地往返青岛的交通。', transferNote: '亲历从青岛北出发，当前动车班次与接驳未核验。' },
  yantai: { routeRole: '动车、港口、机场换乘节点', planningSummary: '亲历中承担去程轮渡和返程高铁换乘，本轮不提供独立游玩详情。', transferNote: '站、港、机场并非同一地点，规划时必须另留市内接驳时间。' },
  dalian: { routeRole: '轮渡转铁路节点', planningSummary: '亲历从大连湾转往大连站后继续北上，本轮只保留换乘说明。', transferNote: '码头至车站的当前接驳与耗时未核验。' },
  changchun: { routeRole: '城市短停与铁路节点', planningSummary: '适合把城市短停嵌入铁路行程，但不要把 K1021 始发时间当本人上车时间。', transferNote: '后续车次和本人上车时间需要重新查询。' },
  nancha: { routeRole: '进入林区的历史接驳节点', planningSummary: '亲历中在这里转向金山屯；内容不足，不作为可加入计划的独立目的地。', transferNote: '当前拼车、出租和客运衔接均未核验。' },
  jinshantun: { routeRole: '森林与子景点目的地', planningSummary: '金祖峰、金山鹿苑归入这里，适合偏好森林和小城节奏的用户。', transferNote: '景区接驳与返程班次需要逐段核验。' },
  yichun: { routeRole: '林区住宿和客运节点', planningSummary: '可作为进入小兴安岭内容的停留点，并衔接金山屯、汤旺河方向。', transferNote: '当前城际和林区客运未核验。' },
  tangwanghe: { routeRole: '森林景区目的地', planningSummary: '适合森林景观兴趣，但公共交通容错空间有限。', transferNote: '亲历大巴与夜车仅是历史证据，当前时刻未核验。' },
  harbin: { routeRole: '主要交通枢纽与城市目的地', planningSummary: '可作为北段路线的建议起终点之一，也适合安排城市补给和休整。', transferNote: '机场、哈尔滨站与哈尔滨东站需区分，当前接驳未核验。' },
  mohe: { routeRole: '极北内容目的地', planningSummary: '北极村内容归入漠河，建议为往返和天气变化预留余量。', transferNote: '当前铁路、北极村大巴及去满归交通均未核验。' },
  mangui: { routeRole: '林区小镇目的地', planningSummary: '适合偏好小镇和森林节奏的用户，资料主要来自 2025 年亲历。', transferNote: '4182 与公路客运当前状态未核验。' },
  hailaer: { routeRole: '草原内容与铁路节点', planningSummary: '莫尔格勒河内容归入海拉尔，可与城市休整结合考虑。', transferNote: '景区直通与返程铁路当前信息未核验。' }
}

const mainNodeRows = [
  ['qingdao', '青岛', null, 36.0671, 120.3826], ['yantai', '烟台', null, 37.4638, 121.4479],
  ['dalian', '大连', null, 38.914, 121.6147], ['changchun', '长春', 'changchun', 43.8171, 125.3235],
  ['nancha', '南岔', null, 47.1379, 129.2836], ['jinshantun', '金山屯', 'jinshantun', 47.4125, 129.4291],
  ['yichun', '伊春', 'yichun', 47.7275, 128.8411], ['tangwanghe', '汤旺河', 'tangwanghe', 48.4547, 129.5709],
  ['harbin', '哈尔滨', 'harbin', 45.8038, 126.5349], ['mohe', '漠河', 'mohe', 52.9723, 122.5386],
  ['mangui', '满归', 'mangui', 52.0351, 121.2313], ['hailaer', '海拉尔', 'hailaer', 49.2122, 119.7364]
]
const routeNodes = mainNodeRows.map((row, index) => ({
  id: row[0], name: row[1], nodeType: 'main_place', parentNodeId: null, placeId: row[2], latitude: row[3], longitude: row[4],
  routeOrder: index + 1, showOnMap: true, dataStatus: 'confirmed', ...nodePlanningNotes[row[0]]
})).concat([
  ['jinzufeng', '金祖峰', 'jinshantun'], ['jinshan-deer-park', '金山鹿苑', 'jinshantun'],
  ['shilin-scenic', '汤旺河石林景区', 'tangwanghe'], ['beiji-village', '北极村', 'mohe'],
  ['mergel-river', '莫尔格勒河', 'hailaer']
].map((row) => ({ id: row[0], name: row[1], nodeType: 'visit_spot', parentNodeId: row[2], placeId: null, latitude: null, longitude: null, routeOrder: null, showOnMap: false, dataStatus: 'partial' })))

const planningProfiles = {
  jinshantun: { suitableFor: '喜欢森林、轻徒步和小城节奏的人', suggestedStay: '建议预留 1 天内容时间', transportChallenge: '多个子景点与城际接驳分散，当前班次未核验。', playIdeas: ['金祖峰与金山鹿苑择重点安排', '把补给和返程确认放在进景区前'], suggestion: '如果总天数紧，不要同时压缩景区游览和返程缓冲。' },
  yichun: { suitableFor: '希望以城市作为林区补给基地的人', suggestedStay: '建议 1 天或作为过夜节点', transportChallenge: '前往周边林区需依赖客运或接驳，当前信息待查。', playIdeas: ['安排补给与休整', '再决定金山屯或汤旺河方向'], suggestion: '先确定下一段官方班次，再反推市内停留。' },
  tangwanghe: { suitableFor: '森林景观优先、能接受交通余量的人', suggestedStay: '建议预留 1 天内容时间', transportChallenge: '林区客运选择有限，历史夜车不代表当前可用。', playIdeas: ['围绕石林内容安排半日至一日', '预留候车与用餐时间'], suggestion: '不建议把景区结束与长途交通压到没有容错。' },
  harbin: { suitableFor: '需要交通枢纽、城市补给或短暂停留的人', suggestedStay: '建议 1–2 天，或作为换乘缓冲', transportChallenge: '机场与不同火车站之间存在市内接驳。', playIdeas: ['早市与城市步行', '松花江、太阳岛一带择一安排', '作为北段路线起终点'], suggestion: '将换乘日和完整游览日分开估算，避免同一天任务过多。' },
  mohe: { suitableFor: '关注极北、森林与长距离铁路体验的人', suggestedStay: '建议至少 2 天内容时间', transportChallenge: '长途铁路、北极村接驳和后续去向都需重新核验。', playIdeas: ['漠河与北极村合并规划', '为天气和往返接驳留缓冲'], suggestion: '不要用历史大巴时刻直接锁定下一段行程。' },
  mangui: { suitableFor: '喜欢林区小镇、慢节奏和非热门停留的人', suggestedStay: '建议 1 天，时间充足可增加', transportChallenge: '进出交通选择少，现行状态未核验。', playIdeas: ['小镇步行与休整', '观察森林铁路沿途风景'], suggestion: '先确认进出方式，再决定是否加住。' },
  hailaer: { suitableFor: '想把草原内容与城市休整结合的人', suggestedStay: '建议 2–3 天', transportChallenge: '市区至草原景点距离较大，当前直通交通未核验。', playIdeas: ['安排一日草原内容', '保留雨天城市休整方案'], suggestion: '莫尔格勒河归入海拉尔规划，不额外制造一个住宿节点。' },
  changchun: { suitableFor: '喜欢城市短停与铁路旅行的人', suggestedStay: '建议半天–1 天', transportChallenge: '作为中转时需严格区分车次始发与本人上车时间。', playIdeas: ['城市步行与补给', '为下一段卧铺留足候车时间'], suggestion: '若只是换乘，不必为了“来都来了”强塞高成本项目。' }
}

const places = [
  { id: 'jinshantun', name: '金山屯', summary: '从南岔进入林区后，在金祖峰和金山鹿苑完成 Day 3 的主要游览。', impression: '森林、山路和小城接驳，把这一天真正带进小兴安岭。', tags: ['森林', '金祖峰', '金山鹿苑'], childNodeIds: ['jinzufeng', 'jinshan-deer-park'], visitDays: [3], costs: { lodging: null, food: null, localTransport: 4000, ticket: 7200, other: null }, tips: ['Day 3 三笔现金交通合计 ¥60，已计入现金补记。', '景区和返程接驳班次有限，出发前应重新核验。'] },
  { id: 'yichun', name: '伊春', summary: 'Day 3 抵达并住小旅馆，Day 4 从这里乘大巴前往汤旺河。', impression: '金山屯游览后的过夜点，也是继续深入林区的客运节点。', tags: ['林都', '客运', '过夜'], childNodeIds: [], visitDays: [3, 4], costs: { lodging: 7800, food: 600, localTransport: 1200, ticket: null, other: null }, tips: ['历史住宿实付 ¥78；只代表 2025 年 7 月。', '可先向住宿方核验大巴停靠点。'] },
  { id: 'tangwanghe', name: '汤旺河', summary: 'Day 4 乘大巴抵达，游览石林后乘 K7138 前往哈尔滨东。', impression: '一次公共交通选择有限的林区日游与夜车衔接。', tags: ['森林', '石林', '夜车'], childNodeIds: ['shilin-scenic'], visitDays: [4], costs: { lodging: null, food: 5400, localTransport: 2000, ticket: 6000, other: null }, tips: ['历史大巴发车时间 11:00，当前班次需核验。', 'K7138 为跨夜路段。'] },
  { id: 'harbin', name: '哈尔滨', summary: 'Day 5 短暂停留后北上，Day 10 返回游览并过夜，Day 11 飞返烟台。', impression: '早市、松花江与多次换乘叠在同一个交通枢纽里。', tags: ['换乘枢纽', '早市', '松花江'], childNodeIds: [], visitDays: [5, 10, 11], costs: { lodging: 15800, food: 21570, localTransport: 9017, ticket: null, other: 800 }, tips: ['多次到访对应不同日期，历史花费不是当前报价。', '机场大巴另有现金 ¥20。'] },
  { id: 'mohe', name: '漠河', summary: 'Day 6 清晨抵达，往返北极村后转乘大巴去满归。北极村内容归入本详情。', impression: '长途火车之后，在寒凉天气中完成极北村落的短暂停留。', tags: ['极北', '北极村', '大巴'], childNodeIds: ['beiji-village'], visitDays: [6], costs: { lodging: null, food: 5800, localTransport: 4200, ticket: 3400, other: null }, tips: ['北极村往返大巴历史实付各 ¥21，回程历史发车时间 13:30。', '预订方式只代表当时经验。'] },
  { id: 'mangui', name: '满归', summary: 'Day 6 傍晚抵达并住宾馆，Day 7 清晨乘 4182 前往海拉尔。', impression: '森林深处的小镇节奏，是本次旅途中很鲜明的一段。', tags: ['大兴安岭', '小镇', '4182'], childNodeIds: [], visitDays: [6, 7], costs: { lodging: 7000, food: null, localTransport: null, ticket: null, other: null }, tips: ['历史住宿实付 ¥70。', '4182 的购票与上车方式以官方现行规则为准。'] },
  { id: 'hailaer', name: '海拉尔', summary: 'Day 7 抵达，Day 8 休整，Day 9 往返莫尔格勒河后乘 K7092。莫尔格勒河内容归入本详情。', impression: '从林海进入草原城市，天气也让行程节奏慢了下来。', tags: ['草原', '莫尔格勒河', '休整'], childNodeIds: ['mergel-river'], visitDays: [7, 8, 9], costs: { lodging: 14700, food: 31400, localTransport: 13392, ticket: null, other: 2300 }, tips: ['Day 7/8 两晚住宿共 ¥147，均计入最终总额。', '莫尔格勒河当日交通 ¥114，部分接驳待细分。'] },
  { id: 'changchun', name: '长春', summary: 'Day 2 清晨抵达，市内短暂停留后乘 K1021 前往南岔。', impression: '一天城市漫游之后，继续乘卧铺进入林区。', tags: ['铁路', '城市漫游', 'K1021'], childNodeIds: [], visitDays: [2], costs: { lodging: null, food: 10300, localTransport: 1130, ticket: null, other: 3080 }, tips: ['K1021 的鞍山 16:26 是车次始发时间，不是本人上车时间。', '本人长春上车与南岔到达时间待补。'] }
].map((place) => ({ ...place, routeNodeId: place.id, detailStatus: 'ready', rating: null, dataStatus: 'partial', historicalExpenseSummary: place.costs, planningProfile: { ...planningProfiles[place.id], evidenceNote: '建议基于 2025 年 7 月亲历整理；当前交通、价格与开放状态未核验。' } }))

// id, day, from, to, mode, service, origin departure, boarded, alighted, crosses midnight, duration, fare, boarding point, alighting point
const segmentRows = [
  ['s01', 1, 'qingdao', 'yantai', '动车', 'C6451', null, '2025-07-01 07:04', null, false, null, 6200, '青岛北站', '烟台站'],
  ['s02', 1, 'yantai', 'dalian', '轮渡', '中华复兴轮渡', null, '2025-07-01 10:30', '2025-07-01 17:30', false, 420, 11100, '烟台港', '大连湾'],
  ['s03', 1, 'dalian', 'changchun', '普速火车·硬卧', 'K561', null, '2025-07-01 20:20', '2025-07-02 04:50', true, 510, 16300, '大连站', '长春站'],
  ['s04', 2, 'changchun', 'nancha', '普速火车·卧铺', 'K1021', '2025-07-02 16:26', null, null, true, null, 23050, '长春站', '南岔站'],
  ['s05', 3, 'nancha', 'jinshantun', '拼车/出租车', null, null, null, null, false, null, 2000, '南岔', '金山屯'],
  ['s06', 3, 'jinshantun', 'yichun', '大巴+公交', null, null, null, null, false, null, 1800, '金山屯', '伊春'],
  ['s07', 4, 'yichun', 'tangwanghe', '大巴', null, null, '2025-07-04 11:00', null, false, null, 2100, '伊春客运站', '汤旺河'],
  ['s08', 4, 'tangwanghe', 'harbin', '普速火车·卧铺', 'K7138', null, '2025-07-04 19:23', '2025-07-05 05:00', true, 577, 14400, '汤旺河站', '哈尔滨东站'],
  ['s09', 5, 'harbin', 'mohe', '普速火车·卧铺', 'K5171', null, '2025-07-05 12:05', '2025-07-06 07:00', true, 1135, 26400, '哈尔滨站', '漠河站'],
  ['s10', 6, 'mohe', 'mangui', '大巴', null, null, null, '2025-07-06 17:40', false, null, 3800, '漠河公路客运站', '满归'],
  ['s11', 7, 'mangui', 'hailaer', '普速火车', '4182', null, '2025-07-07 07:10', null, false, 720, 12600, '满归站', '海拉尔站'],
  ['s12', 9, 'hailaer', 'harbin', '普速火车·卧铺', 'K7092', null, '2025-07-09 21:45', null, true, null, 21500, '海拉尔站', '哈尔滨站'],
  ['s13', 11, 'harbin', 'yantai', '飞机', 'MU6616', null, '2025-07-11 08:40', null, false, null, 48800, '哈尔滨太平国际机场', '烟台蓬莱国际机场'],
  ['s14', 11, 'yantai', 'qingdao', '高铁', 'G5488', null, '2025-07-11 13:51', null, false, null, 5600, '烟台站', '青岛北站']
]
const segmentSummaries = [
  '从青岛北乘动车到烟台，随后转往港口；到达时间待补。', '学生票历史实付 ¥111，航程约 7 小时。',
  '轮渡后转往大连站，乘 K561 卧铺约次日 04:50 到长春。', 'K1021 从鞍山 16:26 始发；本人上车和到达时间待补。',
  'Day 3 清晨从南岔前往金山屯，现金实付 ¥20。', '大巴 ¥15 与市内公交 ¥3 组成。',
  '历史发车 11:00，到达时间待补。', 'K7138 约次日 05:00 到哈尔滨东。',
  'K5171 约次日 07:00 到漠河。', '约 17:40 到满归，预订方式需重新核验。',
  '4182 约 07:10 发、全程约 12 小时，到达时刻待补。', 'K7092 21:45 发，跨夜抵达时间待补。',
  'MU6616 历史起飞 08:40，到达时间待补。', 'G5488 历史发车 13:51，到达时间待补。'
]
const segments = segmentRows.map((row, index) => ({
  id: row[0], tripDayId: `day-${row[1]}`, segmentType: 'mainline', fromNodeId: row[2], toNodeId: row[3], mode: row[4], transportType: row[4],
  serviceNumber: row[5], originDepartureAt: row[6], travelerBoardedAt: row[7], travelerAlightedAt: row[8], arrivedAt: row[8],
  crossesMidnight: row[9], crossDay: row[9], durationMinutes: row[10], durationPrecision: row[10] === null ? null : 'approximate', distanceKm: null,
  boardedPrecision: row[0] === 's11' ? 'approximate' : (row[7] ? 'exact' : null),
  alightedPrecision: ['s02', 's03', 's08', 's09', 's10'].includes(row[0]) ? 'approximate' : (row[8] ? 'exact' : null),
  historicalFareCents: row[11], boardingPoint: row[12], alightingPoint: row[13], historicalDate: `2025-07-${String(row[1]).padStart(2, '0')}`,
  displayOrder: index + 1, expenseIds: [`expense-${row[0]}`], bookingNote: row[0] === 's10' ? '历史预订方式不作为当前建议。' : null,
  dynamicInfoWarning: '请通过官方渠道核验当前班次、票价和运行状态。', dataStatus: 'partial', summary: segmentSummaries[index],
  tips: [row[9] ? '这是跨夜路段，请同时核对出发与次日到达日期。' : '本页记录的是 2025 年 7 月历史行程。', '复刻时请通过官方渠道查询当前信息。']
}))

const visitRows = [
  [1, 'qingdao', '出发', '从青岛北出发。'], [1, 'yantai', '换乘', '动车、港口与轮渡连续衔接。'], [1, 'dalian', '换乘', '转往大连站乘夜车。'],
  [2, 'changchun', '城市漫游', '清晨抵达，短暂停留后继续乘卧铺。'], [2, 'nancha', '跨夜前往', '上车及到达时刻待补。'],
  [3, 'nancha', '接驳', '清晨前往金山屯。'], [3, 'jinshantun', '林区游览', '游览子节点后前往伊春。'], [3, 'jinzufeng', '游览', '金山屯所属子节点。'], [3, 'jinshan-deer-park', '游览', '金山屯所属子节点。'], [3, 'yichun', '过夜', '入住小旅馆。'],
  [4, 'yichun', '出发', '乘大巴前往汤旺河。'], [4, 'tangwanghe', '游览与夜车', '游览后乘 K7138。'], [4, 'shilin-scenic', '游览', '汤旺河所属子节点。'],
  [5, 'harbin', '短暂停留', '早市后从哈尔滨站北上。'], [5, 'mohe', '跨夜前往', '约次日 07:00 到达。'],
  [6, 'mohe', '极北游览', '往返北极村后去满归。'], [6, 'beiji-village', '游览', '归属漠河，不建独立详情。'], [6, 'mangui', '过夜', '约 17:40 抵达。'],
  [7, 'mangui', '清晨出发', '约 07:10 乘 4182。'], [7, 'hailaer', '抵达与过夜', '车站附近宾馆过夜。'],
  [8, 'hailaer', '雨天休整', '市内用餐、补给并入住青旅。'],
  [9, 'hailaer', '草原往返', '往返莫尔格勒河后乘 K7092。'], [9, 'mergel-river', '游览', '归属海拉尔，不建独立详情。'], [9, 'harbin', '跨夜前往', '21:45 乘 K7092。'],
  [10, 'harbin', '城市游览与过夜', '太阳岛、松花江、中央大街与洗浴中心。'],
  [11, 'harbin', '返程出发', '前往太平机场。'], [11, 'yantai', '返程换乘', '机场大巴转烟台站。'], [11, 'qingdao', '旅程结束', '返回青岛北。']
]
const visits = visitRows.map((row, index) => {
  const node = routeNodes.find((item) => item.id === row[1])
  return { id: `visit-${index + 1}`, tripDayId: `day-${row[0]}`, routeNodeId: row[1], placeId: node.placeId, sequence: index + 1, title: row[2], summary: row[3], dataStatus: 'confirmed' }
})

// day, date, title, overnight type, overnight place, recorded daily total, precise itemized total, summary
const dayRows = [
  [1, '2025-07-01', '青岛 → 烟台 → 大连 → 长春', '火车卧铺', null, 40300, 40300, '动车、轮渡和跨夜火车连续衔接。'],
  [2, '2025-07-02', '长春 → 南岔', '火车卧铺', null, 37560, 37560, 'K1021 关键时间仍待补。'],
  [3, '2025-07-03', '南岔 → 金山屯 → 伊春', '伊春小旅馆', 'yichun', 19900, 19900, '金祖峰、金山鹿苑和现金接驳集中在这一天。'],
  [4, '2025-07-04', '伊春 → 汤旺河 → 哈尔滨东', '火车卧铺', null, 29700, 29700, '大巴游览后乘 K7138，次日到达。'],
  [5, '2025-07-05', '哈尔滨 → 漠河', '火车卧铺', null, 35600, 35527, '日合计与逐项相差 ¥0.73，按原记录合计。'],
  [6, '2025-07-06', '漠河 → 北极村 → 满归', '满归宾馆', 'mangui', 24200, 24200, '北极村为漠河子节点。'],
  [7, '2025-07-07', '满归 → 海拉尔', '海拉尔宾馆', 'hailaer', 15100, 15100, '宾馆 ¥75 未计入当日日合计。'],
  [8, '2025-07-08', '海拉尔雨天休整', '海拉尔青旅', 'hailaer', 24400, 24392, '青旅 ¥72 未计入当日日合计；日合计按记录。'],
  [9, '2025-07-09', '海拉尔 → 莫尔格勒河 → 哈尔滨', '火车卧铺', null, 44200, 44200, '往返草原后 21:45 乘 K7092。'],
  [10, '2025-07-10', '哈尔滨城市游览', '洗浴中心', 'harbin', 35600, 35600, '太阳岛、松花江与中央大街。'],
  [11, '2025-07-11', '哈尔滨 → 烟台 → 青岛', '无', null, 64660, 64660, 'MU6616 08:40、G5488 13:51，完成返程。']
]
const tripDays = dayRows.map((row) => ({
  id: `day-${row[0]}`, tripId: trip.id, dayNumber: row[0], day: row[0], date: row[1], title: row[2],
  visitIds: visits.filter((visit) => visit.tripDayId === `day-${row[0]}`).map((visit) => visit.id),
  segmentIds: segments.filter((segment) => segment.tripDayId === `day-${row[0]}`).map((segment) => segment.id),
  overnightType: row[3], overnightPlaceId: row[4], recordedDailyTotalCents: row[5], itemizedTotalCents: row[6],
  expenseReconciliationStatus: row[5] === row[6] ? 'confirmed' : 'recorded_total_rounding_difference', summary: row[7], expenseIds: []
}))

// 已核对的主路段历史票价；现金路段不重复计入当日记录。
const expenses = segments.map((segment) => ({
  id: `expense-${segment.id}`, tripDayId: segment.tripDayId, category: 'transport', title: `${segment.serviceNumber || segment.mode} 历史实付`, amountCents: segment.historicalFareCents,
  paymentMethod: segment.id === 's05' ? 'cash' : 'unknown', segmentId: segment.id, includedInDailyTotal: segment.id !== 's05', includedInTripTotal: true,
  cashPoolId: segment.id === 's05' ? 'cash-2025-trip' : null, amountPrecision: 'exact', reconciliationStatus: 'confirmed', historicalAsOf: '2025-07'
})).concat([
  ['d01-local', 'day-1', 'transport', '学校至车站', 2100, true, null], ['d01-food', 'day-1', 'food', '途中餐食', 4600, true, null],
  ['d02-local', 'day-2', 'transport', '公交、电车与单车', 1130, true, null], ['d02-food', 'day-2', 'food', '餐饮与饮水', 10300, true, null], ['d02-other', 'day-2', 'other', '寄存与明信片', 3080, true, null],
  ['d03-food', 'day-3', 'food', '餐饮与饮水', 3100, true, null], ['d03-ticket', 'day-3', 'ticket', '金祖峰与金山鹿苑门票', 7200, true, null], ['d03-lodging', 'day-3', 'lodging', '伊春小旅馆', 7800, true, null],
  ['d04-local', 'day-4', 'transport', '伊春市内出租车', 1200, true, null], ['d04-food', 'day-4', 'food', '餐饮与饮水', 6000, true, null], ['d04-ticket', 'day-4', 'ticket', '汤旺河石林门票', 6000, true, null],
  ['d05-local', 'day-5', 'transport', '哈尔滨单车', 357, true, null], ['d05-food', 'day-5', 'food', '早市与餐食', 7970, true, null], ['d05-other', 'day-5', 'other', '寄存与明信片', 800, true, null],
  ['d06-excursion', 'day-6', 'transport', '漠河站↔北极村', 4200, true, null], ['d06-food', 'day-6', 'food', '餐饮', 5800, true, null], ['d06-ticket', 'day-6', 'ticket', '北极村门票', 3400, true, null], ['d06-lodging', 'day-6', 'lodging', '满归宾馆', 7000, true, null],
  ['d07-loss', 'day-7', 'loss', '退票损失', 2500, true, null],
  ['d08-local', 'day-8', 'transport', '出租车', 1992, true, null], ['d08-food', 'day-8', 'food', '蒙餐与牛肉干', 20600, true, null], ['d08-other', 'day-8', 'other', '雨伞', 1800, true, null],
  ['d09-excursion', 'day-9', 'transport', '莫尔格勒河往返与接驳', 11400, true, null], ['d09-food', 'day-9', 'food', '餐饮与饮水', 10800, true, null], ['d09-other', 'day-9', 'other', '行李寄存', 500, true, null],
  ['d10-local', 'day-10', 'transport', '骑行与松花江船票', 6200, true, null], ['d10-food', 'day-10', 'food', '餐饮', 13600, true, null], ['d10-lodging', 'day-10', 'lodging', '洗浴中心过夜', 15800, true, null],
  ['d11-local', 'day-11', 'transport', '机场与市内接驳（电子支付）', 3660, true, null], ['d11-food', 'day-11', 'food', '返程餐食', 6600, true, null],
  ['cash-day3-excursion', 'day-3', 'transport', '金山屯↔金山鹿苑现金接驳', 4000, false, 'cash-2025-trip'],
  ['cash-day4-excursion', 'day-4', 'transport', '汤旺河景区拼车', 2000, false, 'cash-2025-trip'],
  ['lodging-day7', 'day-7', 'lodging', '海拉尔车站附近宾馆', 7500, false, null],
  ['lodging-day8', 'day-8', 'lodging', '海拉尔机场附近青旅', 7200, false, null],
  ['cash-day11-airport', 'day-11', 'transport', '哈尔滨机场大巴现金', 2000, false, 'cash-2025-trip'],
  ['cash-unclassified', null, 'unclassified', '未分类现金', 10000, false, 'cash-2025-trip']
].map((row) => ({ id: `expense-${row[0]}`, tripDayId: row[1], category: row[2], title: row[3], amountCents: row[4], paymentMethod: row[6] ? 'cash' : 'unknown', segmentId: null, includedInDailyTotal: row[5], includedInTripTotal: true, cashPoolId: row[6], amountPrecision: 'exact', reconciliationStatus: row[2] === 'unclassified' ? 'unclassified' : 'confirmed', historicalAsOf: '2025-07' })))
tripDays.forEach((day) => { day.expenseIds = expenses.filter((expense) => expense.tripDayId === day.id).map((expense) => expense.id) })

const cashPools = [{ id: 'cash-2025-trip', recordedAmountCents: 20000, description: '原始记录为现金 200+，总额计算仅加 ¥200。', allocatedExpenseIds: ['expense-s05', 'expense-cash-day3-excursion', 'expense-cash-day4-excursion', 'expense-cash-day11-airport'], allocatedCents: 10000, unclassifiedCents: 10000, status: 'pending' }]

const guides = [
  { id: 'connections', title: '11 天连续换乘怎么衔接', category: '路线', summary: '从动车、轮渡到跨夜火车，理解全程 14 个主线路段。', readingMinutes: 6, displayOrder: 1, sections: [{ title: '完整主线', content: '14 个主线路段连接 12 个主路线节点，游览支线不计入主线城市数。' }, { title: '换乘留余量', content: '复刻时应按当前官方时刻重新计算，不照搬历史班次。' }], relatedPlaceIds: ['changchun', 'harbin'], relatedSegmentIds: ['s01', 's02', 's03'] },
  { id: 'overnight', title: '跨夜交通与住宿边界', category: '交通', summary: '分清当日出发、次日到达和真正的住宿支出。', readingMinutes: 5, displayOrder: 2, sections: [{ title: '跨夜移动', content: 'K561、K1021、K7138、K5171 和 K7092 按出发 Day 关联，并明确次日到达。' }, { title: '漏记住宿', content: 'Day 7 宾馆 ¥75 和 Day 8 青旅 ¥72 已补入最终总额。' }], relatedPlaceIds: ['mangui', 'hailaer'], relatedSegmentIds: ['s03', 's04', 's08', 's09', 's12'] },
  { id: 'local-bus-check', title: '林区客运怎样核验', category: '交通', summary: '历史搭乘经验只做证据，当前班次必须重新查询。', readingMinutes: 5, displayOrder: 3, sections: [{ title: '历史边界', content: '伊春至汤旺河、漠河至满归等记录只说明 2025 年 7 月当时可行。' }, { title: '安全复刻', content: '优先使用官方客运、铁路和航司渠道核验。' }], relatedPlaceIds: ['yichun', 'tangwanghe', 'mohe', 'mangui'], relatedSegmentIds: ['s07', 's10', 's11'] },
  { id: 'budget', title: '低预算路线如何取舍', category: '预算', summary: '先决定天数与兴趣，再把交通、住宿和应急空间分开考虑。', readingMinutes: 5, displayOrder: 4, sections: [{ title: '先分清范围', content: '规划页的生活费参考只包含住宿和饮食，不含往返大交通、城际交通、门票与临时支出。' }, { title: '给未知留空间', content: '林区交通和动态价格未核验时，不应用一个精确总额伪装成已确认预算。' }, { title: '从模板开始修改', content: '模板只是内容框架。选择后仍需按你的天数、夜车偏好和官方交通信息逐项调整。' }], relatedPlaceIds: [], relatedSegmentIds: [], toolTarget: 'budget' },
  { id: 'ticket-safety', title: '班次、票务与安全边界', category: '提醒', summary: '分清历史事实与出发前必须重查的信息。', readingMinutes: 4, displayOrder: 5, sections: [{ title: '不要混淆时刻', content: 'K1021 鞍山 16:26 是车次始发时间，不是本人长春上车时间。' }, { title: '可验证建议', content: '票价、开放状态、预订方式和班次都应以官方当前信息为准。' }], relatedPlaceIds: ['changchun', 'harbin'], relatedSegmentIds: ['s04', 's12', 's13', 's14'] }
].map((guide) => ({ ...guide, contentVersion: '2026-09-05' }))

// 与历史账独立的课程原型参考假设，不是当前报价。
const budgetPlans = [
  { id: 'five-day-reference', name: '5 天北段参考', days: 5, nights: 4, transportCents: 65000, ticketCents: 12000, otherCents: 5000, note: '短线估算，班次与单价需自行核验' },
  { id: 'seven-day-reference', name: '7 天兴安岭参考', days: 7, nights: 6, transportCents: 98000, ticketCents: 19000, otherCents: 7000, note: '覆盖更多林区节点，不是正式报价' },
  { id: 'eleven-day-reference', name: '11 天完整路线参考', days: 11, nights: 10, transportCents: 180000, ticketCents: 26000, otherCents: 10000, note: '按真实路线结构估算，不复制历史总额' }
].map((plan) => ({ ...plan, basis: 'current_reference', priceAsOf: null, status: 'draft_reference' }))
const lodgingOptions = [{ id: 'hostel', name: '青旅/床位', pricePerNightCents: 8000 }, { id: 'economy', name: '经济住宿', pricePerNightCents: 15000 }, { id: 'standard', name: '普通住宿', pricePerNightCents: 26000 }]
const foodOptions = [{ id: 'lean', label: '节省', pricePerDayCents: 4500 }, { id: 'balanced', label: '普通', pricePerDayCents: 7500 }, { id: 'comfortable', label: '宽松', pricePerDayCents: 12000 }]
const photoAssets = places.map((place) => ({ id: `photo-slot-${place.id}`, filePath: null, placeId: place.id, assetStatus: 'missing', privacyChecked: false, source: 'owner_photo_pending' }))

module.exports = { trip, routeNodes, places, visits, segments, tripDays, expenses, cashPools, guides, budgetPlans, lodgingOptions, foodOptions, photoAssets }
