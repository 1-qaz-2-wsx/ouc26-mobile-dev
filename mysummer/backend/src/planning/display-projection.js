'use strict'

// `planning-display.v1` 展示投影（B1）。
//
// 输入是工程态结果（plan / routeAudit / cityExpansions / journey），输出是唯一给真实方案页面
// 消费的展示结构。它只输出用户需要看的事实、受控文案和交互所需的稳定标识：
//   - 不透传 validation / provider 的自由文本（message / reason / details）；
//   - 不包含任何购买、预订或外部跳转地址（url / deeplink / bookingTarget）；
//   - 未知、估算、测试环境与演示数据都按契约标记，未知金额不补 0。
//
// 本模块只依赖 Node 内置能力，不引用排程逻辑，避免和 rule-planner / pipeline 形成循环依赖。

const DISPLAY_SCHEMA = 'planning-display.v1'

const SEVERITY_ORDER = Object.freeze({ info: 0, action_required: 1, blocked: 2 })

// 公共 code → 受控文案。页面只可用 code 做定位、样式和测试，不得展示 code 本身，
// 也不得在前端另写一套文案。新增公共 code 必须先补这里和对应测试。
const CODE_TEXT = Object.freeze({
  PLAN_VALID: { severity: 'info', title: '条件已通过校验', action: '可查看行程' },
  GENERAL_REVIEW_REQUIRED: { severity: 'action_required', title: '仍有事项待确认', action: '查看待确认事项' },
  GENERAL_BLOCKED: { severity: 'blocked', title: '当前条件无法执行', action: '修改条件后重新规划' },
  MOCK_DATA: { severity: 'action_required', title: '演示数据，不代表可购买', action: '按真实数据重新生成' },
  STATION_TRANSFERS_UNCONFIRMED: { severity: 'action_required', title: '车站接驳待确认', action: '核对车站与地点之间的交通' },
  TRANSPORT_PLACEMENT_UNCONFIRMED: { severity: 'action_required', title: '交通尚未放入完整行程', action: '确认交通对应的到达地点' },
  TRANSPORT_QUOTE_MISSING: { severity: 'info', title: '交通报价尚未查询', action: '可稍后补充交通信息' },
  // B3-4：显式 transport demand 的逐段失败状态必须是各自可区分的受控语义，
  // 不得全部塌缩成「尚未查询」。全部为 action_required（needs_review），只有硬时序冲突才 blocked。
  TRANSPORT_NO_QUOTES: { severity: 'action_required', title: '该段暂未取得可用交通报价', action: '调整日期、站点或稍后重试' },
  TRANSPORT_QUERY_BUDGET_EXHAUSTED: { severity: 'action_required', title: '本次交通查询额度已用完', action: '稍后重新查询该段交通' },
  TRANSPORT_QUERY_OUT_OF_WINDOW: { severity: 'action_required', title: '该日期超出当前交通查询范围', action: '调整日期或人工核对班次' },
  TRANSPORT_PROVIDER_DISABLED: { severity: 'action_required', title: '该交通数据源当前未启用', action: '改用已启用方式或人工核对' },
  TRANSPORT_PROVIDER_NOT_CONFIGURED: { severity: 'action_required', title: '交通数据源尚未配置', action: '人工核对该段交通' },
  TRANSPORT_QUERY_UNAVAILABLE: { severity: 'action_required', title: '交通查询暂不可用', action: '稍后重试或人工核对' },
  TRANSPORT_NOT_QUERIED: { severity: 'action_required', title: '该段交通尚未查询', action: '补充信息后重新查询' },
  TRANSPORT_QUOTE_UNSELECTED: { severity: 'action_required', title: '交通报价未通过校验', action: '复核日期、路线、席别和库存' },
  TRANSPORT_QUOTE_UNBOUND: { severity: 'action_required', title: '交通报价未绑定路线', action: '补充明确的交通需求' },
  TRANSPORT_QUOTE_REJECTED: { severity: 'info', title: '部分交通报价未采用', action: '查看已选交通的校验结果' },
  TEST_ENVIRONMENT: { severity: 'action_required', title: '当前交通数据来自测试环境', action: '核对正式班次、库存和价格' },
  HOTEL_QUOTE_MISSING: { severity: 'info', title: '住宿价格和库存待查询', action: '核对入住地、日期和房间' },
  TRANSFER_QUOTE_MISSING: { severity: 'info', title: '城市内接驳尚未查询', action: '人工复核路段时间' },
  LODGING_NOT_SEARCHED: { severity: 'info', title: '附近住宿尚未检索', action: '可查看或补充住宿候选' },
  CITY_EXPANSION_PENDING: { severity: 'action_required', title: '城市内景点尚未排入行程', action: '确认已验证的景点和游玩时间' },
  MAP_EVIDENCE_MISSING: { severity: 'action_required', title: '地点证据缺失', action: '重新确认地点' },
  MAP_EVIDENCE_UNAVAILABLE: { severity: 'action_required', title: '地点证据暂不可用', action: '稍后重试地点查询' },
  POI_SCHEDULE_EVIDENCE_UNAVAILABLE: { severity: 'action_required', title: '景点开放信息待确认', action: '人工核对开放时间' },
  CANDIDATE_CITY_MEMBERSHIP_UNCONFIRMED: { severity: 'action_required', title: '景点所属城市待确认', action: '选择同城的具体景点' },
  NO_ELIGIBLE_POI: { severity: 'action_required', title: '暂无已验证的具体景点', action: '调整地点或兴趣后重试' },
  UNRESOLVED_PLACE_LEVEL: { severity: 'blocked', title: '需要选择具体景点或详细地址', action: '返回地图选择具体地点' },
  CITY_STAY_EXCEEDS_TRIP: { severity: 'blocked', title: '城市停留要求超出旅行时间', action: '缩短停留或延长日期' },
  BUDGET_EXCEEDED: { severity: 'blocked', title: '已知费用超过严格预算', action: '调整预算或旅行条件' },
  OPTIMIZATION_FALLBACK_TO_FEASIBLE_BASELINE: { severity: 'info', title: '已保留原始可行顺序', action: '查看当前行程顺序' },
  ROUTE_EVIDENCE_UNAVAILABLE: { severity: 'action_required', title: '路段交通证据暂不可用', action: '人工复核路段时间' },
  TRANSFER_EVIDENCE_MISSING: { severity: 'action_required', title: '有路段缺少交通证据', action: '补齐或复核路段交通' },
  ROUTE_TIME_NEEDS_REVIEW: { severity: 'action_required', title: '路段时间需要人工复核', action: '核对当天路况和候车时间' },
  ROUTE_EVIDENCE_INVALID: { severity: 'blocked', title: '路段证据格式无效', action: '重新查询路段交通' },
  ROUTE_DEMAND_UNKNOWN: { severity: 'blocked', title: '路段需求无法识别', action: '修改地点顺序后重新规划' },
  ROUTE_CHAIN_AMBIGUOUS: { severity: 'blocked', title: '路段交通链不明确', action: '选择唯一的交通链' },
  ROUTE_LEG_INVALID: { severity: 'blocked', title: '路段信息不完整', action: '重新查询路段交通' },
  ROUTE_LEG_ID_DUPLICATE: { severity: 'blocked', title: '路段标识重复', action: '重新生成方案' },
  ROUTE_ENDPOINT_DISCONNECTED: { severity: 'blocked', title: '路段起终点未连通', action: '核对地点和接驳方式' },
  ROUTE_TIME_CONFLICT: { severity: 'blocked', title: '路段时间发生冲突', action: '调整地点或交通' },
  ROUTE_ARRIVES_TOO_LATE: { severity: 'blocked', title: '路段到达时间过晚', action: '调整交通或行程日期' },
  ROUTE_DURATION_MISMATCH: { severity: 'blocked', title: '路段时长与时间不一致', action: '重新查询路段交通' },
  ROUTE_PROVENANCE_MISSING: { severity: 'blocked', title: '路段来源无法核验', action: '重新查询路段交通' },
  ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED: { severity: 'blocked', title: '交通票据尚未绑定到路段', action: '补充交通绑定后重新规划' },
  ROUTE_LEG_BLOCKED: { severity: 'blocked', title: '有路段不可用', action: '调整交通方式' },
  ROUTE_DESTINATION_MISMATCH: { severity: 'blocked', title: '路段未到达目标地点', action: '核对起终点后重试' },
  LOCK_TARGET_NOT_FOUND: { severity: 'blocked', title: '锁定项目已不存在', action: '修改或移除锁定项' },
  ORDER_LOCK_POSITION_REQUIRED: { severity: 'blocked', title: '顺序锁缺少位置', action: '补充顺序锁位置' },
  ORDER_LOCK_POSITION_INVALID: { severity: 'blocked', title: '顺序锁位置无效', action: '修改顺序锁' },
  ORDER_LOCK_CONFLICT: { severity: 'blocked', title: '顺序锁互相冲突', action: '调整顺序锁' },
  ORDER_LOCK_DUPLICATE_TARGET: { severity: 'blocked', title: '多个顺序锁指向同一项目', action: '保留一个顺序锁' },
  ORDER_LOCK_VIOLATION: { severity: 'blocked', title: '行程未遵守顺序锁', action: '调整顺序或解除锁定' },
  ORDER_LOCK_CONFLICT_WITH_EXPLICIT_ORDER: { severity: 'blocked', title: '顺序锁与指定顺序冲突', action: '调整顺序或开启优化' },
  TIME_LOCK_INVALID: { severity: 'blocked', title: '固定时间锁无效', action: '修改固定时间' },
  TIME_LOCK_CONFLICT: { severity: 'blocked', title: '固定时间锁互相冲突', action: '调整固定时间' },
  TIME_LOCK_DURATION_CONFLICT: { severity: 'blocked', title: '固定时间与游玩时长冲突', action: '调整时间或游玩时长' },
  TIME_LOCK_VIOLATION: { severity: 'blocked', title: '行程未遵守固定时间', action: '调整行程或解除锁定' },
  LOCKED_TIME_CONFLICT: { severity: 'blocked', title: '固定时间与行程范围冲突', action: '调整日期或固定时间' },
  ITEM_OUTSIDE_REQUEST_WINDOW: { severity: 'blocked', title: '项目超出旅行时间范围', action: '调整项目或日期' },
  TIME_ORDER_CONFLICT: { severity: 'blocked', title: '行程顺序发生时间冲突', action: '调整地点顺序或时间' },
  TIME_WINDOW_CONFLICT: { severity: 'blocked', title: '项目无法放入可用时间窗', action: '调整游玩时长或日期' },
  SOURCE_CONSTRAINT_MISSING: { severity: 'blocked', title: '项目缺少必要来源约束', action: '重新确认地点和时间' },
  ACTIVITY_TRANSPORT_OVERLAP: { severity: 'blocked', title: '游玩与交通时间重叠', action: '调整游玩或交通' },
  TRANSPORT_ARRIVAL_TARGET_CONFLICT: { severity: 'blocked', title: '交通到达时间与地点安排冲突', action: '调整到达绑定或行程' }
})

const PUBLIC_CODE = /^[A-Z][A-Z0-9_]*$/

function severityRank(severity) {
  return Object.hasOwn(SEVERITY_ORDER, severity) ? SEVERITY_ORDER[severity] : SEVERITY_ORDER.action_required
}

function worse(first, second) {
  return severityRank(first) >= severityRank(second) ? first : second
}

// 已知 code 返回映射的严重度；未知 code 保守地按 action_required 处理，绝不静默丢弃。
function severityOf(code) {
  const entry = CODE_TEXT[code]
  return entry ? entry.severity : 'action_required'
}

// plan.feasibility 与 display.header.feasibility 共用的推导：
// 只有 action_required 及以上才影响可执行性；info 不降级方案。
function computeFeasibility(errors = [], warnings = []) {
  if (Array.isArray(errors) && errors.length) return 'blocked'
  const rows = Array.isArray(warnings) ? warnings : []
  const escalated = rows.some(row => row && row.code && severityRank(severityOf(row.code)) >= SEVERITY_ORDER.action_required)
  return escalated ? 'needs_review' : 'valid'
}

function localParts(iso, timezone) {
  const epoch = Date.parse(iso)
  if (!Number.isFinite(epoch)) return null
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(epoch))
    return Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type, item.value]))
  } catch {
    return null
  }
}

function localDateOf(iso, timezone) {
  const parts = localParts(iso, timezone)
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null
}

function localTimeOf(iso, timezone) {
  const parts = localParts(iso, timezone)
  return parts ? `${parts.hour}:${parts.minute}` : null
}

function shortDate(date) {
  return typeof date === 'string' && date.length >= 10 ? date.slice(5) : (date || '')
}

function partyText(travelers) {
  const adults = travelers && Number.isInteger(travelers.adults) ? travelers.adults : 0
  const children = travelers && Array.isArray(travelers.children) ? travelers.children.length : 0
  const parts = []
  if (adults) parts.push(`${adults} 位成人`)
  if (children) parts.push(`${children} 位儿童`)
  return parts.length ? parts.join(' · ') : '出行人数待确认'
}

// 统一收集工程态诊断，供 notes 使用。只取 code 与目标标识，不取自由文本。
function diagnosticRows(plan, routeAudit, journey) {
  const rows = []
  const push = (list, level) => {
    if (!Array.isArray(list)) return
    for (const row of list) {
      if (row && typeof row === 'object' && typeof row.code === 'string' && row.code) rows.push({ row, level })
    }
  }
  push(plan && plan.validation && plan.validation.errors, 'error')
  push(plan && plan.validation && plan.validation.warnings, 'warning')
  push(routeAudit && routeAudit.gaps, 'gap')
  push(routeAudit && routeAudit.errors, 'error')
  push(journey && journey.conflicts, 'error')
  return rows
}

function targetOf(row) {
  return row.targetId || row.itemId || row.menuItemId || row.legId || row.demandId || row.lockId || null
}

function itemDataStatus(item) {
  const refs = Array.isArray(item && item.evidenceRefs) ? item.evidenceRefs : []
  const types = [...new Set(refs.map(ref => ref && ref.sourceType).filter(Boolean))]
  if (!types.length) return 'unknown'
  if (types.length > 1) return 'mixed'
  return ['live', 'manual_verified', 'estimate', 'mock'].includes(types[0]) ? types[0] : 'unknown'
}

function legDataStatus(leg) {
  const provenance = (leg && leg.provenance) || {}
  if (provenance.environment === 'test') return 'unknown'
  if (provenance.sourceType === 'estimate') return 'estimate'
  if (provenance.sourceType === 'live' && provenance.environment === 'production') return 'live'
  if (provenance.sourceType === 'mock') return 'mock'
  if (provenance.sourceType === 'manual_verified') return 'manual_verified'
  return 'unknown'
}

function legSourceText(leg) {
  const provenance = (leg && leg.provenance) || {}
  if (provenance.environment === 'test') return '测试环境，不能证明生产可购买'
  if (provenance.sourceType === 'estimate') return '导航估算'
  if (provenance.sourceType === 'live') return '实时查询'
  if (provenance.sourceType === 'mock') return '演示数据，不代表可购买'
  if (provenance.sourceType === 'manual_verified') return '已人工确认'
  return '来源待核实'
}

const LEG_MODE_TEXT = Object.freeze({ train: '火车', flight: '航班', car: '驾车接驳', walk: '步行接驳', bus: '公交接驳', lodging_transfer: '住宿接驳' })

function sectionShell(overrides) {
  return Object.assign({
    id: '', kind: 'place', dayKey: null, title: '', subtitle: null,
    severity: 'info', dataStatus: 'unknown', collapsed: true,
    facts: [], options: [], actions: []
  }, overrides)
}

function buildPlaceSections(plan, timezone, cityAnchors) {
  const sections = []
  for (const item of plan.items || []) {
    if (!item || !item.itemId) continue
    if (cityAnchors.has(item.itemId)) continue
    if (item.placeRef && item.placeRef.type === 'city') continue
    const date = localDateOf(item.startAt, timezone)
    const start = localTimeOf(item.startAt, timezone)
    const end = localTimeOf(item.endAt, timezone)
    const isLodging = item.kind === 'lodging'
    sections.push(sectionShell({
      id: `${isLodging ? 'lodging' : 'place'}:${item.itemId}`,
      kind: isLodging ? 'lodging' : 'place',
      dayKey: date,
      title: (item.placeRef && item.placeRef.name) || '未命名地点',
      subtitle: date && start && end ? `${shortDate(date)} · ${start}–${end}` : (date || null),
      dataStatus: itemDataStatus(item),
      collapsed: true,
      facts: [
        { label: '时间', value: start && end ? `${start}–${end}` : '待确认' },
        { label: '安排', value: item.sourceMenuItemIds && item.sourceMenuItemIds.length ? '用户指定' : '按顺序安排' }
      ]
    }))
  }
  return sections
}

function buildLegSections(plan, routeAudit, timezone) {
  const legs = [...(plan.legs || []), ...((routeAudit && routeAudit.legs) || [])]
  const seen = new Set()
  const sections = []
  for (const leg of legs) {
    if (!leg || !leg.legId || seen.has(leg.legId)) continue
    seen.add(leg.legId)
    const date = localDateOf(leg.departureAt, timezone)
    const start = localTimeOf(leg.departureAt, timezone)
    const end = localTimeOf(leg.arrivalAt, timezone)
    sections.push(sectionShell({
      id: `leg:${leg.legId}`,
      kind: 'leg',
      // 2026-09-18 新增可选字段：方案页要按交通方式给出「火车票 / 航班 / 接驳」标题。
      // 它是 display 自己给出的受控枚举（与 plan-schema 的 LEG_MODES 同源），页面不解析 facts 反推。
      mode: typeof leg.mode === 'string' && leg.mode ? leg.mode : 'unknown',
      dayKey: date,
      title: `${(leg.from && leg.from.name) || '起点待确认'} → ${(leg.to && leg.to.name) || '终点待确认'}`,
      subtitle: `${leg.serviceNo || LEG_MODE_TEXT[leg.mode] || '接驳'} · ${start || '待确认'}–${end || '待确认'}`,
      dataStatus: legDataStatus(leg),
      collapsed: true,
      facts: [
        { label: '车次', value: leg.serviceNo || LEG_MODE_TEXT[leg.mode] || '待确认' },
        { label: '时间', value: start && end ? `${start}–${end}` : '待确认' },
        { label: '来源', value: legSourceText(leg) },
        ...seatFacts(plan, leg)
      ]
    }))
  }
  return sections
}

// 2026-09-18 Owner 决定：真实方案的交通卡要显示聚合 API 返回的席别与参考票价。
// 只在该段有已选报价（quoteRef → plan.quotes → transportDetail.selectedSeat）时输出，
// 且金额一律标注成「参考 / 测试环境 + 未核验」，绝不写成可购买或已核验。
// 无席别或无金额时整项省略，不补 0、不猜。
function seatFacts(plan, leg) {
  const quotes = Array.isArray(plan && plan.quotes) ? plan.quotes : []
  const quoteRef = leg && typeof leg.quoteRef === 'string' ? leg.quoteRef : ''
  const quote = quoteRef ? quotes.find(row => row && row.quoteId === quoteRef) : null
  const detail = (quote && quote.transportDetail) || null
  const seat = detail && detail.selectedSeat
  if (!seat) return []
  const facts = []
  const name = typeof seat.name === 'string' ? seat.name.trim() : ''
  if (name) facts.push({ label: '席别', value: name })
  if (Number.isInteger(seat.amountMinor) && seat.amountMinor >= 0) {
    const environment = (quote.provenance && quote.provenance.environment) || quote.environment || 'unknown'
    const suffix = environment === 'production' ? '参考价，未核验' : '测试环境价，未核验'
    facts.push({ label: '参考票价', value: `¥${(seat.amountMinor / 100).toFixed(2)} / 人 · ${suffix}` })
  }
  return facts
}

const LODGING_SUBTITLE = Object.freeze({
  not_required_by_user: '用户选择不安排住宿',
  night_train_rest_pending_confirmation: '夜车覆盖休息时段，请确认是否仍需住宿',
  needs_review: '住宿地点、房型与价格待查询'
})

// B4-2：住宿检索结果 → 受控副标题。区分「确实检索过」与「尚未检索」，
// 但两者都不表达房态、房价或可预订。
const LODGING_SEARCH_SUBTITLE = Object.freeze({
  available: '附近住宿候选已检索（仅地点信息）',
  no_results: '附近暂未检索到住宿地点候选',
  // budget_exhausted / unavailable / anchor_missing / not_queried 共用中性文案：
  // 既不写成「已查询」，也不写成「附近没有酒店」。
  pending: '附近住宿候选待检索'
})

// 直线距离提示：只表达直线距离，不得写成步行/车程或任何未经核验的表述。
function straightLineText(anchor, coordinate) {
  const values = [anchor && anchor.lat, anchor && anchor.lng, coordinate && coordinate.lat, coordinate && coordinate.lng]
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return '直线距离待确认'
  const toRadians = value => value * Math.PI / 180
  const dLat = toRadians(coordinate.lat - anchor.lat)
  const dLng = toRadians(coordinate.lng - anchor.lng)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(anchor.lat)) * Math.cos(toRadians(coordinate.lat)) * Math.sin(dLng / 2) ** 2
  const meters = 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)))
  if (!Number.isFinite(meters)) return '直线距离待确认'
  return meters < 1000 ? `直线约 ${Math.round(meters)} m` : `直线约 ${(meters / 1000).toFixed(1)} km`
}

// §4.3 冻结形状：只输出 id / name / address / distanceText / dataStatus。
// 地图候选只证明地点存在，因此这里不出现任何报价、库存、房型或可预订字段。
function lodgingOptionViews(entry) {
  const anchor = (entry && entry.anchor && entry.anchor.location) || null
  const options = Array.isArray(entry && entry.options) ? entry.options : []
  return options
    .map(option => ({
      id: option.providerPlaceId || option.placeId || null,
      name: option.name || '未命名住宿地点',
      address: option.address || '',
      distanceText: straightLineText(anchor, option.coordinate),
      dataStatus: 'live'
    }))
    // 没有稳定身份就不输出：display 选项必须能被 UI 稳定寻址，不能用下标冒充身份。
    .filter(option => typeof option.id === 'string' && option.id)
}

function lodgingSectionView(need, entry) {
  // 没有机器态 entry（例如只做展示投影）时保持既有中性语义。
  if (!entry) return { subtitle: LODGING_SUBTITLE[need.status] || '住宿信息待确认', dataStatus: 'unknown', options: [] }
  if (need.status === 'not_required_by_user' || need.status === 'night_train_rest_pending_confirmation'
    || entry.status === 'not_required' || entry.status === 'pending_confirmation') {
    return { subtitle: LODGING_SUBTITLE[need.status] || '住宿信息待确认', dataStatus: 'unknown', options: [] }
  }
  if (entry.status === 'available') {
    // dataStatus=live 只描述「地点信息来自实时检索」，因此 facts 必须继续声明价格与库存未查询。
    return { subtitle: LODGING_SEARCH_SUBTITLE.available, dataStatus: 'live', options: lodgingOptionViews(entry) }
  }
  if (entry.status === 'no_results') {
    return { subtitle: LODGING_SEARCH_SUBTITLE.no_results, dataStatus: 'live', options: [] }
  }
  return { subtitle: LODGING_SEARCH_SUBTITLE.pending, dataStatus: 'unknown', options: [] }
}

function buildLodgingSections(journey, timezone, lodgingOptions) {
  const needs = journey && Array.isArray(journey.lodgingNeeds) ? journey.lodgingNeeds : []
  const byNeedId = new Map((Array.isArray(lodgingOptions) ? lodgingOptions : [])
    .filter(entry => entry && typeof entry.lodgingNeedId === 'string')
    .map(entry => [entry.lodgingNeedId, entry]))
  return needs.map(need => {
    const view = lodgingSectionView(need, byNeedId.get(need.id) || null)
    return sectionShell({
      id: `lodging:${need.id}`,
      kind: 'lodging',
      dayKey: need.checkInDate || null,
      title: `${shortDate(need.checkInDate)} 住宿`,
      subtitle: view.subtitle,
      severity: 'info',
      dataStatus: view.dataStatus,
      collapsed: true,
      options: view.options,
      facts: [
        { label: '房间', value: `${need.rooms || 1} 间` },
        { label: '价格与库存', value: '未查询' }
      ]
    })
  })
}

function buildUnresolvedSections(cityExpansions, menuNames) {
  const sections = []
  for (const expansion of cityExpansions || []) {
    const targetId = (expansion.sourceMenuItemIds || [])[0]
    if (!targetId) continue
    const hasCandidates = Array.isArray(expansion.candidates) && expansion.candidates.length > 0
    sections.push(sectionShell({
      id: `unresolved:CITY_EXPANSION_PENDING:${targetId}`,
      kind: 'unresolved',
      dayKey: null,
      title: hasCandidates ? '城市内景点尚未排入行程' : '城市内景点未确认',
      subtitle: hasCandidates ? '候选尚未完成校验，未排入行程' : '当前没有可核验的具体景点',
      severity: 'action_required',
      dataStatus: 'unknown',
      collapsed: false,
      facts: [
        { label: '城市', value: menuNames.get(targetId) || '待确认' },
        { label: '状态', value: '待确认' }
      ],
      actions: [{ code: 'CITY_EXPANSION_PENDING', label: CODE_TEXT.CITY_EXPANSION_PENDING.action }]
    }))
  }
  return sections
}

function projectCost(plan) {
  const summary = (plan && plan.costSummary) || {}
  const budget = (plan && plan.inputSnapshot && plan.inputSnapshot.budget) || {}
  const currency = typeof budget.currency === 'string' && budget.currency ? budget.currency : 'CNY'
  const unknownCategories = Array.isArray(summary.unknownCategories) ? [...summary.unknownCategories] : []
  const knownTotal = Number.isInteger(summary.knownTotal) ? summary.knownTotal : null
  const knownSubtotal = Number.isInteger(summary.knownSubtotalMinor) ? summary.knownSubtotalMinor : null
  let status
  if (knownTotal !== null && unknownCategories.length === 0) status = 'known'
  else if (knownTotal !== null || knownSubtotal !== null) status = 'partial'
  else status = unknownCategories.length ? 'unknown' : 'not_in_scope'
  const estimatedRange = summary.estimatedRange && Number.isInteger(summary.estimatedRange.minMinor) && Number.isInteger(summary.estimatedRange.maxMinor)
    ? { minMinor: summary.estimatedRange.minMinor, maxMinor: summary.estimatedRange.maxMinor }
    : null
  const basis = budget.basis === 'person' ? 'person' : budget.basis === 'party' ? 'party' : 'unknown'
  const dataMode = (plan && plan.dataMode) || 'manual'
  const dataStatus = dataMode === 'demo' ? 'mock'
    : dataMode === 'live' ? 'live'
      : dataMode === 'manual' ? 'manual_verified' : 'mixed'
  return {
    status,
    currency,
    basis,
    // 2026-09-18：方案页「预算 / 预计花费」行需要用户自己填的预算额度。
    // 这里原样给出用户输入的额度（不乘人数、不改口径），口径由 basis 表达。
    plannedMinor: Number.isInteger(budget.amountMinor) ? budget.amountMinor : null,
    // 未知金额保持 null，绝不用 0 冒充已知总额。
    knownMinor: knownTotal !== null ? knownTotal : knownSubtotal,
    estimatedRange,
    unknownCategories,
    dataStatus
  }
}

function projectBadges(notes, feasibility, dataMode) {
  const badges = []
  const blockedCount = notes.filter(note => note.severity === 'blocked').length
  const actionCount = notes.filter(note => note.severity === 'action_required').length
  if (blockedCount) badges.push({ code: 'GENERAL_BLOCKED', text: CODE_TEXT.GENERAL_BLOCKED.title, severity: 'blocked' })
  else if (actionCount) badges.push({ code: 'GENERAL_REVIEW_REQUIRED', text: `待确认 ${actionCount} 项`, severity: 'action_required' })
  if (notes.some(note => note.code === 'TEST_ENVIRONMENT')) {
    badges.push({ code: 'TEST_ENVIRONMENT', text: CODE_TEXT.TEST_ENVIRONMENT.title, severity: 'action_required' })
  }
  if (dataMode === 'demo') badges.push({ code: 'MOCK_DATA', text: CODE_TEXT.MOCK_DATA.title, severity: 'action_required' })
  if (!badges.length && feasibility === 'valid') {
    badges.push({ code: 'PLAN_VALID', text: CODE_TEXT.PLAN_VALID.title, severity: 'info' })
  }
  return badges
}

function sortNotes(notes) {
  return notes.slice().sort((a, b) =>
    severityRank(b.severity) - severityRank(a.severity) ||
    a.code.localeCompare(b.code) ||
    a.id.localeCompare(b.id))
}

function sortSections(sections) {
  return sections.slice().sort((a, b) =>
    String(a.dayKey || '9999-99-99').localeCompare(String(b.dayKey || '9999-99-99')) ||
    a.id.localeCompare(b.id))
}

// §6.2：只有「一个 demand 唯一对应一个 leg section」时才建立 demandId → section 映射，
// 这样只带 demandId 的受控 warning/gap 也能定位到对应 leg section；
// 同一 demand 映射到多条 leg 时不猜，也不建立映射。
function demandSectionIndex(plan, routeAudit, sections) {
  const legById = new Map()
  for (const leg of [...((plan && plan.legs) || []), ...((routeAudit && routeAudit.legs) || [])]) {
    if (leg && typeof leg.legId === 'string' && !legById.has(leg.legId)) legById.set(leg.legId, leg)
  }
  const sectionsByDemand = new Map()
  for (const section of sections) {
    if (section.kind !== 'leg') continue
    const leg = legById.get(section.id.slice('leg:'.length))
    const demandId = leg && typeof leg.demandId === 'string' && leg.demandId ? leg.demandId : null
    if (!demandId) continue
    if (!sectionsByDemand.has(demandId)) sectionsByDemand.set(demandId, [])
    sectionsByDemand.get(demandId).push(section.id)
  }
  const index = new Map()
  for (const [demandId, ids] of sectionsByDemand) if (ids.length === 1) index.set(demandId, ids[0])
  return index
}

// 主投影入口。
function projectDisplay({ plan, cityExpansions = [], routeAudit = null, journey = null, lodgingOptions = [] } = {}) {
  const timezone = (plan && plan.inputSnapshot && plan.inputSnapshot.timezone) || 'Asia/Shanghai'
  const cityAnchors = new Set((cityExpansions || []).flatMap(expansion => expansion.sourceMenuItemIds || []))
  const menuNames = new Map(((plan && plan.inputSnapshot && plan.inputSnapshot.menuItems) || [])
    .filter(entry => entry && entry.menuItemId)
    .map(entry => [entry.menuItemId, (entry.placeRef && entry.placeRef.name) || null]))

  const sections = sortSections([
    ...buildPlaceSections(plan, timezone, cityAnchors),
    ...buildLegSections(plan, routeAudit, timezone),
    ...buildLodgingSections(journey, timezone, lodgingOptions),
    ...buildUnresolvedSections(cityExpansions, menuNames)
  ])

  // 实体标识 → sectionId，供 notes 定位。没有唯一目标时为 null。
  const targetIndex = new Map()
  for (const item of plan.items || []) {
    if (!item || !item.itemId) continue
    targetIndex.set(item.itemId, `place:${item.itemId}`)
  }
  for (const section of sections) {
    if (section.kind === 'leg') targetIndex.set(section.id.slice('leg:'.length), section.id)
    if (section.kind === 'lodging') targetIndex.set(section.id.slice('lodging:'.length), section.id)
    if (section.kind === 'unresolved') targetIndex.set(section.id.slice('unresolved:CITY_EXPANSION_PENDING:'.length), section.id)
  }
  for (const need of (journey && journey.lodgingNeeds) || []) {
    if (need && need.id) targetIndex.set(need.id, `lodging:${need.id}`)
  }
  // demandId 只在有唯一 selected carrier leg 时定位到该 leg section。
  for (const [demandId, sectionId] of demandSectionIndex(plan, routeAudit, sections)) {
    if (!targetIndex.has(demandId)) targetIndex.set(demandId, sectionId)
  }

  // 诊断 → 受控 note。未知 code 落到稳定兜底（GENERAL_BLOCKED / GENERAL_REVIEW_REQUIRED），
  // 绝不透传原 message；同一输出 code + target 只保留一条，取更高严重度。
  const grouped = new Map()
  const collect = (row, level, forcedTarget) => {
    const targetId = forcedTarget || targetOf(row) || null
    const known = Object.hasOwn(CODE_TEXT, row.code)
    const outCode = known ? row.code : (level === 'error' ? 'GENERAL_BLOCKED' : 'GENERAL_REVIEW_REQUIRED')
    const escalated = level === 'error' ? 'blocked' : severityOf(row.code)
    const key = `${outCode}::${targetId || ''}`
    const existing = grouped.get(key)
    if (existing) existing.severity = worse(existing.severity, escalated)
    else grouped.set(key, { code: outCode, targetId, severity: escalated })
  }
  for (const { row, level } of diagnosticRows(plan, routeAudit, journey)) collect(row, level, null)
  for (const expansion of cityExpansions || []) {
    const targetId = (expansion.sourceMenuItemIds || [])[0] || null
    for (const gap of expansion.gaps || []) {
      if (typeof gap === 'string' && PUBLIC_CODE.test(gap)) collect({ code: gap }, 'gap', targetId)
    }
  }

  const notes = sortNotes([...grouped.values()].map(item => {
    const text = CODE_TEXT[item.code]
    return {
      id: `note:${item.code}:${item.targetId || 'plan'}`,
      code: item.code,
      severity: item.severity,
      title: text.title,
      action: text.action,
      sectionId: item.targetId ? (targetIndex.get(item.targetId) || null) : null
    }
  }))

  // 依据 notes 升级 section 严重度并补充动作提示，保持事实与提示同源。
  const sectionById = new Map(sections.map(section => [section.id, section]))
  for (const note of notes) {
    const section = note.sectionId ? sectionById.get(note.sectionId) : null
    if (!section) continue
    section.severity = worse(section.severity, note.severity)
    if (severityRank(note.severity) >= SEVERITY_ORDER.action_required) {
      if (!section.actions.some(action => action.code === note.code)) section.actions.push({ code: note.code, label: note.action })
    }
  }

  const feasibility = (() => {
    let rank = 0
    for (const note of notes) rank = Math.max(rank, severityRank(note.severity))
    const derived = rank >= SEVERITY_ORDER.blocked ? 'blocked' : rank >= SEVERITY_ORDER.action_required ? 'needs_review' : 'valid'
    const declared = plan && ['valid', 'needs_review', 'blocked'].includes(plan.feasibility) ? plan.feasibility : 'valid'
    // 与投影后的最高严重度不一致时采用更保守的结果。
    return severityRank(derived) >= severityRank(declared) ? derived : declared
  })()

  const input = (plan && plan.inputSnapshot) || {}
  const days = Array.isArray(plan && plan.days) ? plan.days.length : 0
  const nights = Math.max(0, days - 1)
  const startDate = localDateOf(input.startAt, timezone)
  const endDate = localDateOf(input.endBy, timezone)
  const startTime = localTimeOf(input.startAt, timezone)
  const endTime = localTimeOf(input.endBy, timezone)
  const destination = (input.endDestination && input.endDestination.name) || '旅行方案'
  const title = days > 1 ? `${destination} · ${days} 天${nights > 0 ? ` ${nights} 晚` : ''}` : `${destination} · ${days || 1} 天`

  return {
    schemaVersion: DISPLAY_SCHEMA,
    header: {
      title,
      // 2026-09-18：方案页条件行需要「出发日期 · 天数 · 人数」三个可直接渲染的值。
      // departureDate 用与 range 相同的短日期口径；dayCount 是计划天数（不含晚数）。
      departureDate: startDate ? shortDate(startDate) : null,
      dayCount: days || null,
      range: startDate && endDate ? `${shortDate(startDate)} ${startTime || ''} → ${shortDate(endDate)} ${endTime || ''}`.replace(/\s+$/, '') : '时间范围待确认',
      party: partyText(input.travelers),
      feasibility,
      coverage: feasibility === 'valid' ? 'complete' : 'partial',
      dataMode: (plan && plan.dataMode) || 'manual',
      badges: projectBadges(notes, feasibility, (plan && plan.dataMode) || 'manual'),
      cost: projectCost(plan)
    },
    sections,
    notes
  }
}

module.exports = {
  CODE_TEXT,
  DISPLAY_SCHEMA,
  SEVERITY_ORDER,
  computeFeasibility,
  projectDisplay,
  severityOf
}
