// B3-1：多段交通数据契约的 carrier 判定层。
//
// 本模块只做两件事：
// 1. 按冻结规则判断某个 server route demand 是否需要 carrier（火车/航班）票据；
// 2. 把显式 transportDemands[] 按 targetMenuItemId 关联回 server route demand。
//
// 约束（见 specs/agent-tasks/round-03-workbuddy-b3-1.md §3）：
// - 纯函数：不访问 provider、不做 IO、不修改传入的 route demand；
// - 不产生任何用户文案，只输出机器可读的 code；
// - 证据不足时返回 unknown，绝不用“缺坐标 = 0km”“缺 adcode = 同城”来猜。
//
// 本批不查询供应商、不生成 carrier leg、不改 route audit 绑定、不改 display。

const EARTH_RADIUS_KM = 6371.0088
const CARRIER_DISTANCE_THRESHOLD_KM = 150
const CARRIER_VERDICTS = Object.freeze(['required', 'not_required', 'unknown'])
const CARRIER_REQUIRED_REASONS = Object.freeze(['DISTANCE_OVER_THRESHOLD', 'ADCODE_PREFIX_DIFFERS'])
const CARRIER_LOCAL_REASONS = Object.freeze(['DISTANCE_WITHIN_THRESHOLD', 'ADCODE_PREFIX_SAME'])
const MISSING_EVIDENCE_KINDS = Object.freeze(['distance', 'adcode'])
const BINDING_STATUSES = Object.freeze(['bound', 'ambiguous', 'unbound'])
// route-audit.routeDemands 用 JSON.stringify([fromStopId, toStopId]) 作为 demandId，
// 菜单项目的 stop id 形如 `item:<menuItemId>`，最后一段的终点 stop id 恒为 `destination`。
const MENU_ITEM_STOP_PREFIX = 'item:'
const DESTINATION_STOP_ID = 'destination'
const ADCODE_PATTERN = /^\d{6}$/

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function validCoordinate(place) {
  const coordinate = place && typeof place === 'object' ? place.coordinate : null
  if (!coordinate || typeof coordinate !== 'object') return null
  const { lat, lng } = coordinate
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

// 缺坐标或坐标非法一律返回 null；调用方不得把它当成 0km。
function haversineKm(from, to) {
  const start = validCoordinate(from)
  const end = validCoordinate(to)
  if (!start || !end) return null
  const toRadians = degrees => (degrees * Math.PI) / 180
  const deltaLat = toRadians(end.lat - start.lat)
  const deltaLng = toRadians(end.lng - start.lng)
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(start.lat)) * Math.cos(toRadians(end.lat)) * Math.sin(deltaLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

// 只有合法 6 位 adcode 才能推出前 4 位；缺失或非法一律返回 null，不得当作同城。
function adcodePrefix(place) {
  const adcode = place && typeof place === 'object' && typeof place.adcode === 'string' ? place.adcode.trim() : null
  return adcode && ADCODE_PATTERN.test(adcode) ? adcode.slice(0, 4) : null
}

// 核心判定：只依赖可核验证据，任一项已足够命中 required 即直接 required。
function evaluateCarrierNeed({ distanceKm = null, fromAdcodePrefix = null, toAdcodePrefix = null } = {}) {
  const distanceKnown = isFiniteNumber(distanceKm) && distanceKm >= 0
  const adcodeKnown = typeof fromAdcodePrefix === 'string' && typeof toAdcodePrefix === 'string'
  const missingEvidence = []
  if (!distanceKnown) missingEvidence.push('distance')
  if (!adcodeKnown) missingEvidence.push('adcode')
  const reasons = []
  // 恰好 150km 不因距离规则触发 required，只有严格大于阈值才命中。
  if (distanceKnown && distanceKm > CARRIER_DISTANCE_THRESHOLD_KM) reasons.push('DISTANCE_OVER_THRESHOLD')
  if (adcodeKnown && fromAdcodePrefix !== toAdcodePrefix) reasons.push('ADCODE_PREFIX_DIFFERS')
  if (reasons.length) return { carrier: 'required', reasons, missingEvidence }
  if (missingEvidence.length) return { carrier: 'unknown', reasons: [], missingEvidence }
  return { carrier: 'not_required', reasons: [...CARRIER_LOCAL_REASONS], missingEvidence: [] }
}

function carrierDemandFor(routeDemand) {
  const demandId = routeDemand && typeof routeDemand.demandId === 'string' ? routeDemand.demandId : null
  const fromAdcodePrefix = adcodePrefix(routeDemand && routeDemand.from)
  const toAdcodePrefix = adcodePrefix(routeDemand && routeDemand.to)
  const distanceKm = routeDemand ? haversineKm(routeDemand.from, routeDemand.to) : null
  return { demandId, ...evaluateCarrierNeed({ distanceKm, fromAdcodePrefix, toAdcodePrefix }), distanceKm, fromAdcodePrefix, toAdcodePrefix }
}

// 输出与输入等长、同序的逐段判定，未命中的段保留 unknown，不丢弃。
function carrierDemands(routeDemands) {
  return (Array.isArray(routeDemands) ? routeDemands : []).map(carrierDemandFor)
}

function requiredCarrierDemands(routeDemands) {
  return carrierDemands(routeDemands).filter(entry => entry.carrier === 'required')
}

function stopIdsFromDemandId(demandId) {
  if (typeof demandId !== 'string') return null
  try {
    const parsed = JSON.parse(demandId)
    return Array.isArray(parsed) && parsed.length === 2 && parsed.every(stopId => typeof stopId === 'string') ? parsed : null
  } catch {
    return null
  }
}

// server route demand 的 to stop；无法解析时返回 null。
function routeDemandToStopId(routeDemand) {
  const stopIds = stopIdsFromDemandId(routeDemand && routeDemand.demandId)
  return stopIds ? stopIds[1] : null
}

// 是否是最后一段 `last item -> destination`。
function isDestinationRouteDemand(routeDemand) {
  return routeDemandToStopId(routeDemand) === DESTINATION_STOP_ID
}

// server route demand 的目标菜单项：只有 to stop 是 `item:<menuItemId>` 才有显式绑定目标。
function routeDemandTargetMenuItemId(routeDemand) {
  const toStopId = routeDemandToStopId(routeDemand)
  return toStopId && toStopId.startsWith(MENU_ITEM_STOP_PREFIX) ? toStopId.slice(MENU_ITEM_STOP_PREFIX.length) : null
}

// 显式 transportDemands[] 的绑定目标：
// - 有 targetMenuItemId -> `item:<menuItemId>`；
// - 缺省 targetMenuItemId -> `destination`（新数组缺省即表示到终点）；
// - targetMenuItemId 存在但不是非空字符串 -> 无法判定，返回 null（不猜）。
function transportDemandTargetStopId(transportDemand) {
  const targetMenuItemId = transportDemand ? transportDemand.targetMenuItemId : undefined
  if (targetMenuItemId === undefined || targetMenuItemId === null) return DESTINATION_STOP_ID
  return typeof targetMenuItemId === 'string' && targetMenuItemId.length ? `${MENU_ITEM_STOP_PREFIX}${targetMenuItemId}` : null
}

// 显式 transportDemands[] 只按 stop id 精确关联 server route demand。
// 站名相似度、数组顺序、推断出的“最后一段”都不允许用来猜绑定；
// 匹配不到保留 unbound，匹配到多条保留 ambiguous。
function bindTransportDemands(transportDemands, routeDemands) {
  const demands = Array.isArray(transportDemands) ? transportDemands : []
  const routes = Array.isArray(routeDemands) ? routeDemands : []
  const demandIdsByStopId = new Map()
  for (const route of routes) {
    if (!route || typeof route.demandId !== 'string') continue
    const toStopId = routeDemandToStopId(route)
    if (!toStopId) continue
    if (!demandIdsByStopId.has(toStopId)) demandIdsByStopId.set(toStopId, [])
    demandIdsByStopId.get(toStopId).push(route.demandId)
  }
  return demands.map((demand, index) => {
    const targetMenuItemId = demand && typeof demand.targetMenuItemId === 'string' && demand.targetMenuItemId.length ? demand.targetMenuItemId : null
    const targetStopId = transportDemandTargetStopId(demand)
    const matches = targetStopId ? demandIdsByStopId.get(targetStopId) || [] : []
    const binding = matches.length === 1 ? 'bound' : matches.length ? 'ambiguous' : 'unbound'
    return { index, targetMenuItemId, targetStopId, demandId: binding === 'bound' ? matches[0] : null, binding }
  })
}

module.exports = {
  BINDING_STATUSES,
  CARRIER_DISTANCE_THRESHOLD_KM,
  CARRIER_LOCAL_REASONS,
  CARRIER_REQUIRED_REASONS,
  CARRIER_VERDICTS,
  DESTINATION_STOP_ID,
  MISSING_EVIDENCE_KINDS,
  adcodePrefix,
  bindTransportDemands,
  carrierDemandFor,
  carrierDemands,
  evaluateCarrierNeed,
  haversineKm,
  isDestinationRouteDemand,
  requiredCarrierDemands,
  routeDemandTargetMenuItemId,
  routeDemandToStopId,
  transportDemandTargetStopId
}
