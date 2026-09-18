const engine = require('./travel-engine')
function placeRef(place) {
  if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number' ||
      !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || !place.name) throw new Error('请在地图中确认地点和坐标')
  const providerId = place.providerId || place.providerPlaceId
  return { provider: providerId ? 'tencent-map' : 'user-coordinate',
    providerPlaceId: String(providerId || ('coordinate-' + place.latitude + '-' + place.longitude)),
    name: place.name, type: place.isCity || place.objectType === 'administrative' ? 'city' : 'confirmed_coordinate',
    coordinate: { lat: place.latitude, lng: place.longitude }, coordinateSystem: 'GCJ-02',
    ...(place.adcode ? { adcode: String(place.adcode) } : {}) }
}
function buildRequest(req, menu, requestId) {
  if (!Array.isArray(menu) || !menu.length) throw new Error('请先加入至少一个地点')
  const departureStation = String(req.departureStation || '').trim()
  const arrivalStation = String(req.arrivalStation || '').trim()
  if (Boolean(departureStation) !== Boolean(arrivalStation)) throw new Error('火车出发站和到达站必须同时填写')
  if (req.trainToFirstPlace === true && !departureStation) throw new Error('开启火车到达绑定前，请填写出发站和到达站')
  if (departureStation && !(req.modes || []).some(mode => ['火车', '高铁'].includes(mode))) throw new Error('已填写火车查询，请在交通方式中勾选火车或高铁')
  if (!req.originPlace || req.originPlace.name !== req.origin) throw new Error('请用“地图确认出发地”重新确认出发地点')
  if (req.specialNeeds || req.constraints || req.reference) throw new Error('新规划暂不能执行自由文本约束；请先移除这些内容，或等待约束确认功能完成。不会静默忽略。')
  const startAt = req.startDate + 'T' + (req.departureTime || '08:00') + ':00+08:00'
  const endBy = engine.day(req.startDate, Number(req.days) - 1) + 'T' + (req.returnTime || '20:00') + ':00+08:00'
  if (![req.departureTime || '08:00', req.returnTime || '20:00'].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new Error('时间请填写有效的 HH:mm 格式')
  if (!(Date.parse(endBy) > Date.parse(startAt))) throw new Error('结束时间必须晚于出发时间')
  const adults = Number(req.people)
  const ageParts = String(req.childAges || '').trim() ? String(req.childAges).split(/[，,]/) : []
  if (ageParts.some(value => !value.trim())) throw new Error('儿童年龄不能留空')
  const children = ageParts.map(value => Number(value.trim()))
  if (children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) throw new Error('儿童年龄请填写 0–17 的整数，用逗号分隔')
  const rooms = Number(req.rooms || 1)
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > 10) throw new Error('房间数为 1–10 间，不会按人数自动推算')
  const map = { 高铁: 'train', 火车: 'train', 飞机: 'flight', 大巴: 'bus', 自驾: 'car' }
  return {
    schemaVersion: 'real-travel-plan-request.v1', clientRequestId: requestId,
    origin: placeRef(req.originPlace), endDestination: placeRef(req.endPlace || req.originPlace),
    startAt, endBy, timezone: 'Asia/Shanghai', travelers: { adults, children },
    budget: { amountMinor: Math.round(Number(req.budget) * 100), currency: 'CNY', basis: req.budgetType === '人均' ? 'person' : 'party',
      includedCategories: ['transport', 'local_transfer', 'ticket'].concat(req.needHotel ? ['lodging'] : []), strict: req.strictBudget === true },
    transportPreferences: { modes: [...new Set(req.modes.map(mode => map[mode]))], allowNightTrain: req.allowNight === true },
    lodgingPreferences: { rooms, required: req.needHotel === true }, interests: [req.preference], pace: { 松弛: 'relaxed', 均衡: 'balanced', 紧凑: 'intense' }[req.pace],
    menuItems: menu.map((place, index) => ({ menuItemId: String(place.id), occurrenceId: String(place.id),
      placeRef: placeRef(place), role: 'must_visit', inputOrder: index, required: true,
      stayRequirement: place.isCity || place.objectType === 'administrative' ? 'city_anchor' : 'must_visit',
      ...(place.isCity || place.objectType === 'administrative' ? { stayDays: Number(place.stayDays) } : {}),
      visitDuration: { minutes: Number(req.visitMinutes || 120) }, preferredWindow: { startAt, endAt: endBy } })),
    optimizeOrder: req.optimizeOrder !== false, locks: [], confirmedConstraints: [], sourceInput: { type: 'manual_menu' }
    ,...(departureStation && arrivalStation ? { transportDemand: { mode: 'train', serviceDate: req.startDate,
      departure: { name: departureStation }, arrival: { name: arrivalStation },
      ...(req.trainToFirstPlace === true ? { targetMenuItemId: String(menu[0].id) } : {}) } } : {})
  }
}
function localTime(value, timezone = 'Asia/Shanghai') {
  const epoch = Date.parse(value)
  if (!Number.isFinite(epoch) || timezone !== 'Asia/Shanghai') return value
  return new Date(epoch + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + '（北京时间）'
}

// 服务端 PlanRequest 的字段路径 → 表单上的可读位置。
// 服务端只回传 path/message（见 backend/src/planning/schema.js），这里翻译成用户看得懂的字段名，
// 让「本地预检」和「服务端兜底」指向同一处输入。
const FIELD_LABELS = [
  ['menuItems', '地点清单'],
  ['origin', '出发地'],
  ['endDestination', '目的地'],
  ['startAt', '出发日期与最早出发时间'],
  ['endBy', '天数与最晚到达时间'],
  ['travelers.children', '儿童年龄'],
  ['travelers.adults', '出行人数'],
  ['budget.includedCategories', '住宿选项'],
  ['budget.amountMinor', '预算'],
  ['budget.basis', '预算口径（人均 / 全团）'],
  ['budget.strict', '预算是否硬约束'],
  ['transportPreferences.modes', '交通方式'],
  ['transportPreferences.allowNightTrain', '夜车选项'],
  ['transportDemand', '火车查询出发站 / 到达站'],
  ['lodgingPreferences.rooms', '房间数'],
  ['lodgingPreferences.required', '是否需要酒店'],
  ['interests', '偏好'],
  ['pace', '节奏'],
  ['optimizeOrder', '优化游玩顺序'],
  ['locks', '锁定项'],
  ['sourceInput', '来源信息']
]

function fieldLabel(path) {
  const value = String(path || '')
  const hit = FIELD_LABELS.find(pair => value === pair[0] || value.startsWith(pair[0] + '.') || value.startsWith(pair[0] + '['))
  return hit ? hit[1] : (value || '请求内容')
}

// 服务端校验失败时的可读摘要。取前 3 条，其余折叠为计数，避免一次刷屏。
function fieldErrorText(error) {
  const rows = error && Array.isArray(error.fieldErrors) ? error.fieldErrors : []
  if (!rows.length) return ''
  const parts = rows.slice(0, 3).map(row => {
    const where = fieldLabel(row.path)
    const reason = String(row.message || '').trim()
    return reason ? where + '：' + reason : where
  })
  if (rows.length > 3) parts.push('另有 ' + (rows.length - 3) + ' 处需修改')
  return parts.join('；')
}

// 数据源就绪状态。hotel provider 由 unavailable.js 生成，不带 status/enabled，
// 因此所有判断都必须对缺字段容错，不能假定字段存在。
const PROVIDER_NAMES = { 'juhe-train-817': '火车票', 'juhe-flight-818': '航班', 'hotel-provider': '酒店房价与库存' }
const STATUS_TEXT = {
  ready: '可用',
  disabled: '已停用',
  not_configured: '未配置',
  unavailable: '等待合作资格'
}

// transport.status 取值来自 backend/src/planning/pipeline.js 与 planning/providers/*。
// 未列出的取值原样回显，避免后端新增状态被静默显示成「已查询」这类乐观措辞。
const TRANSPORT_STATUS = {
  not_queried: '尚未查询',
  available: '已查询到班次',
  unknown: '查询无结果',
  unavailable: '供应商不可用',
  not_configured: '未配置供应商账号',
  disabled: '供应商已停用',
  out_of_window: '超出可查询日期窗口',
  budget_exhausted: '本次查询额度已用尽'
}
function transportText(status) {
  const value = String(status === undefined || status === null ? '' : status).trim()
  return TRANSPORT_STATUS[value] || value || '尚未查询'
}
function capabilityRows(capabilities) {
  const providers = capabilities && Array.isArray(capabilities.providers) ? capabilities.providers : []
  return providers.map(provider => {
    const id = String(provider.id || '')
    const ready = provider.enabled === true && provider.status === 'ready'
    return {
      id,
      name: provider.name || PROVIDER_NAMES[id] || (provider.kind === 'lodging' ? '住宿' : '交通'),
      ready,
      statusText: STATUS_TEXT[provider.status] || (ready ? '可用' : '不可用'),
      note: String((Array.isArray(provider.limitations) ? provider.limitations[0] : '') || '')
    }
  })
}

// 真实方案展示只消费后端 `display` 投影（planning-display.v1）。
// 页面文案、状态、费用与缺口都来自 display.notes / display.header，绝不读取
// plan.validation.errors/warnings 的自由文本 message。
function costText(cost) {
  if (!cost) return '未知'
  const money = minor => '¥' + (minor / 100).toFixed(2)
  if (cost.status === 'known' && Number.isInteger(cost.knownMinor)) return money(cost.knownMinor)
  if (Number.isInteger(cost.knownMinor)) return '已知部分 ' + money(cost.knownMinor)
  if (cost.estimatedRange) return '预估 ' + money(cost.estimatedRange.minMinor) + '–' + money(cost.estimatedRange.maxMinor)
  return '未知'
}

// ——— 真实方案视图：两条通道必须在代码结构上分开 ———
//
// 冻结边界（display-contract.md §1.2 / §1.3）：
//   有 display 时，用户可见的文案 / 状态 / 费用 / 缺口 / feasibility 只能来自 display；
//   原始 result 只允许继续服务地图 marker / polyline / includePoints 等纯几何通道（real-plan-map.js）；
//   没有 display 的历史缓存走受限 legacy 适配，但绝不恢复 validation.message 通道。

const DISPLAY_SCHEMA = 'planning-display.v1'
const DRAFT_LABEL = '待核实草案，不代表可预订'
const BLOCKED_LABEL = '不可行：请修改条件'
const LODGING_STATUS_TEXT = {
  not_required_by_user: '用户选择不安排住宿',
  night_train_rest_pending_confirmation: '夜车覆盖休息时段，请确认是否仍需住宿',
  needs_review: '住宿地点、房型与价格待查询'
}

function text(value, fallback) {
  const out = value === undefined || value === null ? '' : String(value)
  return out.trim() || (fallback === undefined ? '' : fallback)
}

function displayOf(result) {
  const display = result && result.display
  return display && display.schemaVersion === DISPLAY_SCHEMA ? display : null
}

// section.id 形如 place:<itemId> / leg:<legId> / lodging:<needId> / unresolved:<code>:<targetId>。
// 只剥掉首段类型前缀得到目标标识，供页面与地图 adapter 复用；不反向解析 facts。
function sectionTarget(section) {
  const id = text(section && section.id)
  const index = id.indexOf(':')
  return index >= 0 ? id.slice(index + 1) : id
}

function sectionFact(section, label) {
  const facts = section && Array.isArray(section.facts) ? section.facts : []
  const hit = facts.find(fact => fact && fact.label === label)
  return hit ? text(hit.value) : ''
}

// display 只提供「已格式化的时间 fact」（`HH:MM–HH:MM`，U+2013），没有独立 startAt/endAt。
// 按投影器的固定格式拆出起止时间并补上 dayKey；格式不符时留受控空值，不猜。
const TIME_RANGE_SEPARATOR = '\u2013'
function timeRange(section) {
  const parts = sectionFact(section, '时间').split(TIME_RANGE_SEPARATOR)
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return { start: '', end: '' }
  const day = text(section.dayKey)
  const at = value => (day ? day + ' ' + value.trim() : value.trim())
  return { start: at(parts[0]), end: at(parts[1]) }
}

// 交通查询状态：文案全部复用后端受控的 note.title，前端不另建 code → 文案表。
// display 不表达 provider 级状态（not_configured / out_of_window / budget_exhausted 等），
// 这些情况后端都会落到 TRANSPORT_QUOTE_MISSING，故没有对应 note 时用通用未知占位。
const TRANSPORT_STATUS_CODES = ['TRANSPORT_QUOTE_UNSELECTED', 'TRANSPORT_QUOTE_UNBOUND', 'TRANSPORT_QUOTE_MISSING', 'TRANSPORT_QUOTE_REJECTED']
const UNKNOWN_TEXT = '—'

function transportStatusOf(notes) {
  for (const code of TRANSPORT_STATUS_CODES) {
    const note = notes.find(row => row.code === code)
    if (note && text(note.title)) return text(note.title)
  }
  return UNKNOWN_TEXT
}

// display section → 日期行的通用结果行。模板只有 label/value/note，因此可以无损承载。
function displayRow(section) {
  if (section.kind === 'leg') return { id: sectionTarget(section), kind: 'transport',
    label: text(section.title, '交通段'), value: text(section.subtitle, '时间待确认'), note: sectionFact(section, '来源') }
  if (section.kind === 'lodging') return { id: sectionTarget(section), kind: 'lodging',
    label: text(section.title, '住宿'), value: text(section.subtitle, '住宿信息待确认'), note: '' }
  return { id: sectionTarget(section), kind: 'place',
    label: text(section.title, '地点'), value: text(section.subtitle, '时间待确认'), note: '' }
}

// 按 dayKey 分组：地点、交通、住宿进同一条时间线，与旧 journey 视图的分日语义一致。
// 只有地点会清掉 noActivities，交通/住宿不算「已落实的游玩」。
function displayDays(sections) {
  const groups = new Map()
  for (const section of sections) {
    if (!section || !['place', 'leg', 'lodging'].includes(section.kind)) continue
    const key = text(section.dayKey, '日期未定')
    if (!groups.has(key)) groups.set(key, { key, title: key, noActivities: true, rows: [] })
    const group = groups.get(key)
    if (section.kind === 'place') group.noActivities = false
    group.rows.push(displayRow(section))
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// 有 display：全部用户可见语义只来自 display。
// 签名刻意不接收 result —— display 通道在结构上就无法读取原始工程字段（地图由 real-plan-map.js 单独负责）。
function displayView(display) {
  const header = display.header || {}
  const cost = header.cost || {}
  const sections = Array.isArray(display.sections) ? display.sections : []
  const notes = (Array.isArray(display.notes) ? display.notes : []).filter(Boolean)
  const blocked = header.feasibility === 'blocked'
  // 同一 code 只保留一条缺口，避免页面 wx:key="code" 重复。
  const checklist = []
  const seenCodes = new Set()
  for (const note of notes) {
    if (seenCodes.has(note.code)) continue
    seenCodes.add(note.code)
    checklist.push({ code: note.code, title: note.title, action: note.action })
  }
  const unknown = (Array.isArray(cost.unknownCategories) ? cost.unknownCategories : []).join('、')
  const label = blocked ? BLOCKED_LABEL : DRAFT_LABEL
  // 交通查询状态与菜单预览地点清单都只由 display 生成：
  // 前者复用后端 note.title，后者来自 place section（id / title / 时间 fact）。
  const transportStatusText = transportStatusOf(notes)
  const items = sections.filter(section => section.kind === 'place').map(section => {
    const range = timeRange(section)
    return { id: sectionTarget(section), name: text(section.title, '地点'), startAt: range.start, endAt: range.end }
  })
  return { label, tone: blocked ? 'risk' : 'warn', checklist,
    conditionRows: [
      { label: '目的地', value: text(header.title, '待确认') },
      { label: '时间范围', value: text(header.range, '待确认') },
      { label: '出行人数', value: text(header.party, '待确认') }
    ],
    statusRows: [
      { label: '可执行性', value: label, tone: blocked ? 'risk' : 'warn' },
      { label: '已知费用', value: costText(cost) },
      { label: '未知类别', value: text(unknown, '无') },
      { label: '交通查询状态', value: transportStatusText }
    ],
    warnings: notes.map(note => note.action ? note.title + '：' + note.action : note.title),
    unknown, known: costText(cost), transportStatusText,
    // 菜单页「修改预览」需要地点清单：只由 display 的 place section 生成，
    // 不再读 plan.items；城市锚点不是可执行地点，投影器本就不生成 place section，故不出现在这里。
    items,
    days: displayDays(sections),
    // 交通段 / 住宿需求 / 城市候选三个旧区块的行模板要求原始字段（from/to、rooms、candidates 数组），
    // planning-display.v1 无法无损表达，按任务要求先留空并上报，交由 G4 页面重构重做。
    legs: [], lodging: [], candidates: []
  }
}

// 没有 display：受限 legacy 视图。只用日期、地点、交通、费用的基础字段，
// 不读 plan.validation.errors/warnings/assumptions，也不透传 message。
function legacyView(result) {
  const plan = result.plan || {}
  const input = plan.inputSnapshot || {}
  const time = value => localTime(value, input.timezone)
  const blocked = plan.feasibility === 'blocked'
  const journey = result.journey
  const legs = (Array.isArray(plan.legs) ? plan.legs : []).concat((result.routeAudit && result.routeAudit.legs) || [])
  const travelers = input.travelers || { adults: 0, children: [] }
  const lodging = input.lodgingPreferences || {}
  return { label: blocked ? BLOCKED_LABEL : DRAFT_LABEL, tone: blocked ? 'risk' : 'warn', checklist: [],
    conditionRows: [
      { label: '出发地 → 目的地', value: text((input.origin && input.origin.name) + ' → ' + (input.endDestination && input.endDestination.name), '—') },
      { label: '时间范围', value: text(time(input.startAt) + ' — ' + time(input.endBy), '—') },
      { label: '出行人数', value: '成人 ' + travelers.adults + ' · 儿童 ' + (Array.isArray(travelers.children) ? travelers.children.length : 0) },
      { label: '游玩顺序', value: input.optimizeOrder ? '路线择优' : '遵循菜单顺序' },
      { label: '住宿', value: lodging.required !== false ? '需要住宿' : '不安排住宿' }
    ],
    statusRows: [
      { label: '可执行性', value: blocked ? BLOCKED_LABEL : DRAFT_LABEL, tone: blocked ? 'risk' : 'warn' },
      { label: '已知费用', value: plan.costSummary && plan.costSummary.knownTotal !== null && plan.costSummary.knownTotal !== undefined ? '¥' + (plan.costSummary.knownTotal / 100).toFixed(2) : '未知' },
      { label: '未知类别', value: text((plan.costSummary && plan.costSummary.unknownCategories || []).join('、'), '无') },
      { label: '交通查询状态', value: transportText(result.transportStatus) }
    ],
    warnings: [], unknown: (plan.costSummary && plan.costSummary.unknownCategories || []).join('、'),
    known: plan.costSummary && plan.costSummary.knownTotal !== null && plan.costSummary.knownTotal !== undefined ? '¥' + (plan.costSummary.knownTotal / 100).toFixed(2) : '未知',
    transportStatusText: transportText(result.transportStatus),
    items: (Array.isArray(plan.items) ? plan.items : []).map(item => ({ id: item.itemId, name: item.placeRef && item.placeRef.name,
      startAt: time(item.startAt), endAt: time(item.endAt) })),
    days: journey && Array.isArray(journey.days) ? journey.days.map(day => ({ key: day.date, title: day.date,
      noActivities: !(day.activities || []).length,
      rows: (day.activities || []).map(activity => ({ id: activity.id, kind: 'activity', label: text(activity.name, '活动'),
        value: text(time(activity.startAt), '待定') + ' — ' + text(time(activity.endAt), '待定'), note: '' }))
        .concat((day.transport || []).map(leg => ({ id: leg.id, kind: 'transport', label: '交通 · ' + text(leg.serviceNo || leg.mode, '未命名'),
          value: text(leg.from && leg.from.name, '起点待确认') + ' → ' + text(leg.to && leg.to.name, '终点待确认'), note: '' }))) })) : [],
    legs: legs.map(leg => { const provenance = leg.provenance || {}
      return { id: leg.legId, name: leg.serviceNo || leg.mode, from: text(leg.from && leg.from.name, '起点待确认'),
        to: text(leg.to && leg.to.name, '终点待确认'), departureAt: time(leg.departureAt), arrivalAt: time(leg.arrivalAt),
        durationText: Number.isFinite(Number(leg.durationMinutes)) ? Number(leg.durationMinutes) + ' 分钟' : '',
        source: text(provenance.provider, '来源待核实'), estimated: provenance.sourceType === 'estimate', test: provenance.environment === 'test' } }),
    lodging: journey && Array.isArray(journey.lodgingNeeds) ? journey.lodgingNeeds.map(need => ({ id: need.id,
      date: need.checkInDate, rooms: need.rooms, label: LODGING_STATUS_TEXT[need.status] })) : [],
    // 城市候选区块的 gaps 是内部 code，前端不得自建 code → 文案表，故两条通道都不再输出该区块。
    candidates: []
  }
}

function viewResult(result) {
  const display = displayOf(result)
  return display ? displayView(display) : legacyView(result)
}

// ——— 真实方案 → 行程 / 补充信息（2026-09-18 Owner 口径）———
//
// 方案页与行程页共用同一份卡片身份：display section id（place:<itemId> / leg:<legId> / lodging:<needId>）。
// 这里提供两个纯函数，不读 validation / costSummary / quotes 的展示语义：
//   tripPlanFromReal —— 开启行程时把机器字段（items / legs / journey + inputSnapshot）物化成
//                       行程页认识的 item 形状，文案优先复用同一 section 的 display 文案；
//   bookingPrefill   —— 打开「补充信息」页时给出该卡片可以直接预填的原值。

const LEG_ITEM_TYPE = { train: 'train', flight: 'flight' }

// 与 localTime 相同的口径：只对 Asia/Shanghai 做 +8 换算，其它时区不猜，按原始字符串取日期与时刻。
function localParts(value, timezone = 'Asia/Shanghai') {
  const raw = text(value)
  if (!raw) return { date: '', time: '' }
  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed) && timezone === 'Asia/Shanghai') {
    const iso = new Date(parsed + 8 * 3600000).toISOString()
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
  }
  return { date: raw.slice(0, 10), time: raw.slice(11, 16) }
}

// 首尾都算的旅行天数；日期不合法时退回 1，不编造更长行程。
function dayCountBetween(startDate, endDate) {
  const start = Date.parse(startDate + 'T12:00:00+08:00')
  const end = Date.parse(endDate + 'T12:00:00+08:00')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1
  return Math.round((end - start) / 86400000) + 1
}

function sectionTitleMap(display) {
  const map = new Map()
  for (const section of (display && display.sections) || []) {
    if (section && typeof section.id === 'string') map.set(section.id, text(section.title))
  }
  return map
}

function planTimezone(plan) {
  const input = (plan && plan.inputSnapshot) || {}
  return text(input.timezone, 'Asia/Shanghai')
}

// 真实结果 → travel-engine 形状的行程计划。
// 城市锚点不生成 item（AGENTS §9：城市不能作为可执行活动）；住宿按 journey.lodgingNeeds 生成。
function tripPlanFromReal(result, options = {}) {
  const plan = (result && result.plan) || null
  const input = (plan && plan.inputSnapshot) || null
  if (!plan || !plan.id || !input) return null
  const timezone = planTimezone(plan)
  const start = localParts(input.startAt, timezone)
  const end = localParts(input.endBy, timezone)
  const travelers = input.travelers || {}
  const adults = Number(travelers.adults) || 1
  const children = Array.isArray(travelers.children) ? travelers.children.length : 0
  const display = displayOf(result)
  const titles = sectionTitleMap(display)
  const items = []

  for (const item of plan.items || []) {
    if (!item || !item.itemId) continue
    if (item.kind === 'lodging') continue
    const placeRef = item.placeRef || {}
    if (placeRef.type === 'city') continue
    const from = localParts(item.startAt, timezone)
    const to = localParts(item.endAt, timezone)
    const sectionId = `place:${item.itemId}`
    items.push({
      id: item.itemId, type: 'ticket',
      title: titles.get(sectionId) || text(placeRef.name, '活动'),
      date: from.date, start: from.time, end: to.time,
      source: '真实规划', sourceRef: { kind: 'place', id: item.itemId, sectionId }
    })
  }

  for (const leg of plan.legs || []) {
    if (!leg || !leg.legId) continue
    const departure = localParts(leg.departureAt, timezone)
    const arrival = localParts(leg.arrivalAt, timezone)
    const fromName = text(leg.from && leg.from.name, '起点待确认')
    const toName = text(leg.to && leg.to.name, '终点待确认')
    const sectionId = `leg:${leg.legId}`
    items.push({
      id: leg.legId, type: LEG_ITEM_TYPE[leg.mode] || 'transfer',
      title: titles.get(sectionId) || (fromName + ' → ' + toName),
      serviceNo: text(leg.serviceNo), from: fromName, to: toName,
      date: departure.date, start: departure.time, end: arrival.time,
      endDate: arrival.date && arrival.date !== departure.date ? arrival.date : '',
      source: '真实规划', sourceRef: { kind: 'leg', id: leg.legId, sectionId }
    })
  }

  const needs = (result.journey && Array.isArray(result.journey.lodgingNeeds)) ? result.journey.lodgingNeeds : []
  for (const need of needs) {
    if (!need || !need.id || need.status === 'not_required_by_user') continue
    const sectionId = `lodging:${need.id}`
    items.push({
      id: need.id, type: 'hotel',
      title: titles.get(sectionId) || '住宿',
      date: text(need.checkInDate), endDate: text(need.checkOutDate),
      start: '', end: '', rooms: Number(need.rooms) || 1,
      source: '真实规划', sourceRef: { kind: 'lodging', id: need.id, sectionId }
    })
  }

  const stops = ((input.menuItems) || []).filter(entry => entry && entry.menuItemId).map(entry => {
    const placeRef = entry.placeRef || {}
    const coordinate = placeRef.coordinate || {}
    return Object.assign({
      id: String(entry.menuItemId), placeId: String(entry.menuItemId),
      name: text(placeRef.name, '地点'), category: placeRef.type === 'city' ? '城市目的地' : '具体地点'
    }, Number.isFinite(coordinate.lat) ? { latitude: coordinate.lat } : {}, Number.isFinite(coordinate.lng) ? { longitude: coordinate.lng } : {})
  })

  return {
    id: plan.id,
    schemaVersion: 'travel-trip-plan.v1',
    request: {
      startDate: start.date, days: dayCountBetween(start.date, end.date),
      people: adults + children, adults, children,
      origin: text(input.origin && input.origin.name), endPlace: text(input.endDestination && input.endDestination.name)
    },
    stops,
    items,
    sourceReal: {
      jobId: text(options && options.jobId),
      generatedAt: text(plan.updatedAt),
      dataMode: text(plan.dataMode, 'manual')
    }
  }
}

// 「补充信息」页的预填：只给方案里已经确定的原值（车次/时刻/日期/房间），
// 金额与席别一律留空，由用户填写自己实际买到的信息。
function bookingPrefill(result, sectionId) {
  const plan = (result && result.plan) || null
  const id = text(sectionId)
  if (!plan || !id) return null
  const timezone = planTimezone(plan)
  if (id.slice(0, 'leg:'.length) === 'leg:') {
    const legId = id.slice('leg:'.length)
    const leg = (plan.legs || []).find(row => row && row.legId === legId)
    if (!leg) return null
    const departure = localParts(leg.departureAt, timezone)
    const arrival = localParts(leg.arrivalAt, timezone)
    const from = text(leg.from && leg.from.name)
    const to = text(leg.to && leg.to.name)
    if (leg.mode === 'flight') {
      return { kind: 'flight', fields: { flightNo: text(leg.serviceNo), from, to, date: departure.date, departTime: departure.time, arriveTime: arrival.time, cabin: '', unitPrice: '', quantity: '' } }
    }
    return { kind: 'train', fields: { serviceNo: text(leg.serviceNo), from, to, date: departure.date, departTime: departure.time, arriveTime: arrival.time, seatClass: '', unitPrice: '', quantity: '' } }
  }
  if (id.slice(0, 'lodging:'.length) === 'lodging:') {
    const needId = id.slice('lodging:'.length)
    const need = ((result.journey && result.journey.lodgingNeeds) || []).find(row => row && row.id === needId)
    if (!need) return null
    const checkInDate = text(need.checkInDate)
    const checkOutDate = text(need.checkOutDate)
    return { kind: 'hotel', fields: {
      name: '', checkInDate, checkOutDate, checkInTime: '', checkOutTime: '', roomType: '',
      rooms: String(Number(need.rooms) || 1),
      nights: checkInDate && checkOutDate ? String(dayCountBetween(checkInDate, checkOutDate) - 1) : '',
      unitPrice: '', totalPrice: ''
    } }
  }
  return null
}

module.exports = {
  placeRef, buildRequest, viewResult, localTime, capabilityRows, fieldErrorText, fieldLabel,
  transportText, costText, displayOf, localParts, dayCountBetween, tripPlanFromReal, bookingPrefill
}
