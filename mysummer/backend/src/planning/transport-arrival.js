// 交通到达约束层。
//
// 职责：把 carrier leg 的真实到达时刻转成「目标活动的开始下限」，并在计划落定后逐段复核。
//
// B3-3 从单段泛化为多段：
// - 不再只读 request.transportDemand，而是逐段处理 canonical transportDemands[]；
// - 每个 carrier leg 用自己的 server-owned demandId 找到对应需求段（只按 stop id 匹配，
//   不允许用站名相似度或数组顺序猜绑定）；
// - 同一目标地点出现多个到达约束时取最晚真实到达，只顺延一次并记录诊断；
// - endDestination 段没有目标活动，不强行移动任何 item；
// - 任何班次时刻一律不自动更改（不自动换后一班车），
//   时间上不可能成立时保留硬冲突交给校验层。
//
// 约束：纯函数；不访问 provider；不产生用户文案，只输出机器可读 code。

const { DESTINATION_STOP_ID, transportDemandTargetStopId } = require('./transport-demands')

const MENU_ITEM_STOP_PREFIX = 'item:'
const ORIGIN_STOP_ID = 'origin'

function stopIdsFromDemandId(demandId) {
  if (typeof demandId !== 'string') return null
  try {
    const parsed = JSON.parse(demandId)
    return Array.isArray(parsed) && parsed.length === 2 && parsed.every(stopId => typeof stopId === 'string') ? parsed : null
  } catch {
    return null
  }
}

// canonical transportDemands[]；只有旧单数字段时包装成长度 1。
function canonicalTransportDemands(request) {
  if (!request || typeof request !== 'object') return []
  if (Array.isArray(request.transportDemands) && request.transportDemands.length) return request.transportDemands
  return request.transportDemand ? [request.transportDemand] : []
}

// canonical transportDemands[] 不带 server demandId，只能按 to stop id 索引；
// 与 B3-1 的绑定同源，禁止按站名或顺序猜。
function demandsByTargetStopId(demands) {
  const map = new Map()
  for (const demand of Array.isArray(demands) ? demands : []) {
    const stopId = transportDemandTargetStopId(demand)
    if (!stopId) continue
    if (!map.has(stopId)) map.set(stopId, [])
    map.get(stopId).push(demand)
  }
  return map
}

// server demandId 由 route-audit.routeDemands 按最终 plannedOrder 生成；
// 这里用同一规则反推，保证 legacy 单段 leg 也能带上属于自己的 server-owned demandId。
function serverDemandIdFor(plannedOrder, demand) {
  if (!Array.isArray(plannedOrder) || !plannedOrder.length) return null
  const targetStopId = transportDemandTargetStopId(demand)
  if (!targetStopId) return null
  if (targetStopId === DESTINATION_STOP_ID) {
    return JSON.stringify([`${MENU_ITEM_STOP_PREFIX}${plannedOrder[plannedOrder.length - 1]}`, DESTINATION_STOP_ID])
  }
  const itemId = targetStopId.slice(MENU_ITEM_STOP_PREFIX.length)
  const index = plannedOrder.indexOf(itemId)
  if (index < 0) return null
  const fromStopId = index === 0 ? ORIGIN_STOP_ID : `${MENU_ITEM_STOP_PREFIX}${plannedOrder[index - 1]}`
  return JSON.stringify([fromStopId, targetStopId])
}

// 按 server demandId 反查 canonical transport demand：只按 to stop id 精确匹配，
// 匹配不到或匹配到多条都返回 null（不猜绑定）。
function resolveDemandByStopId(byTargetStopId, demandId) {
  const stopIds = stopIdsFromDemandId(demandId)
  if (!stopIds) return null
  const matches = byTargetStopId.get(stopIds[1]) || []
  return matches.length === 1 ? matches[0] : null
}

// 单个 leg 的到达约束解析结果。
// kind: constraint（落到具体 activity）/ destination（到终点，无 activity）/ unbound / ambiguous / invalid
function arrivalConstraintFor(leg, byTargetStopId) {
  const demandId = leg && typeof leg.demandId === 'string' && leg.demandId ? leg.demandId : null
  const arrivalAt = leg ? Date.parse(leg.arrivalAt) : NaN
  const base = { legId: leg && typeof leg.legId === 'string' ? leg.legId : null, demandId }
  if (!demandId) return { ...base, kind: 'unbound', arrivalAt: NaN }
  if (!Number.isFinite(arrivalAt)) return { ...base, kind: 'invalid', arrivalAt: NaN }
  const stopIds = stopIdsFromDemandId(demandId)
  if (!stopIds) return { ...base, kind: 'invalid', arrivalAt: NaN }
  const toStopId = stopIds[1]
  const matches = byTargetStopId.get(toStopId) || []
  if (matches.length !== 1) return { ...base, kind: matches.length ? 'ambiguous' : 'unbound', arrivalAt: NaN }
  if (toStopId === DESTINATION_STOP_ID) return { ...base, kind: 'destination', arrivalAt }
  if (!toStopId.startsWith(MENU_ITEM_STOP_PREFIX)) return { ...base, kind: 'unbound', arrivalAt: NaN }
  return { ...base, kind: 'constraint', itemId: toStopId.slice(MENU_ITEM_STOP_PREFIX.length), arrivalAt }
}

function legacyTargetItemIdFor(demand) {
  const targetStopId = transportDemandTargetStopId(demand)
  return targetStopId && targetStopId.startsWith(MENU_ITEM_STOP_PREFIX) ? targetStopId.slice(MENU_ITEM_STOP_PREFIX.length) : null
}

// 逐段解析到达约束。legacy 单段（leg 上没有 demandId）按 request.transportDemand 的
// mode + target 兜底，保持 B3-3 之前的单段行为不变。
function arrivalConstraints(request, legs) {
  const byTargetStopId = demandsByTargetStopId(canonicalTransportDemands(request))
  const legacyDemand = request && request.transportDemand ? request.transportDemand : null
  const legacyTargetItemId = legacyDemand ? legacyTargetItemIdFor(legacyDemand) : null
  const legacyMode = legacyDemand && typeof legacyDemand.mode === 'string' ? legacyDemand.mode : null
  const resolved = new Map()
  const diagnostics = []
  const unresolved = []
  let legacyConsumed = false
  for (const leg of Array.isArray(legs) ? legs : []) {
    const parsed = arrivalConstraintFor(leg, byTargetStopId)
    // legacy 兜底只消费第一条 mode 匹配的 leg，与旧实现 legs.find(leg => leg.mode === demand.mode) 一致。
    const legacyFallback = parsed.kind === 'unbound' && !legacyConsumed && legacyTargetItemId && legacyMode && leg && leg.mode === legacyMode
    if (legacyFallback) legacyConsumed = true
    if (!legacyFallback && parsed.kind !== 'constraint') { unresolved.push(parsed); continue }
    const itemId = legacyFallback ? legacyTargetItemId : parsed.itemId
    const arrivalAt = legacyFallback ? Date.parse(leg.arrivalAt) : parsed.arrivalAt
    if (!Number.isFinite(arrivalAt)) { unresolved.push(parsed); continue }
    const existing = resolved.get(itemId)
    if (!existing) {
      resolved.set(itemId, {
        itemId,
        arrivalAt,
        legIds: parsed.legId ? [parsed.legId] : [],
        demandIds: parsed.demandId ? [parsed.demandId] : []
      })
      continue
    }
    // 同一目标出现重复到达约束：取最晚真实到达，只顺延一次，并记录诊断。
    if (parsed.legId) existing.legIds.push(parsed.legId)
    if (parsed.demandId) existing.demandIds.push(parsed.demandId)
    if (arrivalAt > existing.arrivalAt) existing.arrivalAt = arrivalAt
    diagnostics.push({ code: 'TRANSPORT_ARRIVAL_TARGET_DUPLICATED', itemId, legIds: [...existing.legIds], message: '同一目标地点存在多个到达约束，只按最晚真实到达顺延一次' })
  }
  return { constraints: [...resolved.values()], diagnostics, unresolved }
}

// 前一段 carrier 的到达不得晚于后一段 carrier 的发车。
// 只做检测：不修改任何班次，也不自动换下一班车。
function carrierSequenceErrors(plan) {
  const plannedOrder = Array.isArray(plan && plan.plannedOrder) ? plan.plannedOrder : []
  const carriers = (Array.isArray(plan && plan.legs) ? plan.legs : [])
    .filter(leg => leg && typeof leg.demandId === 'string' && Number.isFinite(Date.parse(leg.departureAt)) && Number.isFinite(Date.parse(leg.arrivalAt)))
  if (carriers.length < 2) return []
  const chainIndex = stopId => {
    if (stopId === ORIGIN_STOP_ID) return -1
    if (stopId === DESTINATION_STOP_ID) return plannedOrder.length
    return plannedOrder.indexOf(stopId.slice(MENU_ITEM_STOP_PREFIX.length))
  }
  const ordered = [...carriers].sort((a, b) => {
    const first = stopIdsFromDemandId(a.demandId)
    const second = stopIdsFromDemandId(b.demandId)
    const firstIndex = first ? chainIndex(first[0]) : Number.MAX_SAFE_INTEGER
    const secondIndex = second ? chainIndex(second[0]) : Number.MAX_SAFE_INTEGER
    return firstIndex - secondIndex || String(a.legId).localeCompare(String(b.legId))
  })
  const errors = []
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const next = ordered[index]
    if (Date.parse(next.departureAt) < Date.parse(previous.arrivalAt)) {
      errors.push({
        code: 'TRANSPORT_LEG_SEQUENCE_CONFLICT',
        legId: next.legId,
        previousLegId: previous.legId,
        message: '后一段交通的发车时间早于前一段的到达时间'
      })
    }
  }
  return errors
}

// 返回 request 的副本：把每个 carrier 的真实到达写进对应目标活动的开始下限。
// 原 request 不被修改；没有目标活动的段（endDestination）不移动任何 item。
function arrivalConstrainedRequest(request, legs) {
  const result = structuredClone(request)
  const { constraints } = arrivalConstraints(request, legs)
  for (const constraint of constraints) {
    const target = result.menuItems.find(item => item.menuItemId === constraint.itemId)
    if (!target || !target.preferredWindow) continue
    const start = Date.parse(target.preferredWindow.startAt)
    if (Number.isFinite(start) && constraint.arrivalAt > start) target.preferredWindow.startAt = new Date(constraint.arrivalAt).toISOString()
  }
  return result
}

// 逐段复核：目标活动不得早于对应 carrier 到达，且前后 carrier 时刻必须可能成立。
function arrivalErrors(plan) {
  const request = plan && plan.inputSnapshot ? plan.inputSnapshot : {}
  const legs = Array.isArray(plan && plan.legs) ? plan.legs : []
  const items = Array.isArray(plan && plan.items) ? plan.items : []
  const { constraints } = arrivalConstraints(request, legs)
  const errors = []
  for (const constraint of constraints) {
    const item = items.find(candidate => candidate.itemId === constraint.itemId)
    if (!item) continue
    if (Date.parse(item.startAt) < constraint.arrivalAt) {
      errors.push({
        code: 'TRANSPORT_ARRIVAL_TARGET_CONFLICT',
        itemId: constraint.itemId,
        ...(constraint.legIds.length ? { legId: constraint.legIds[0] } : {}),
        message: '绑定地点被安排在交通到达之前'
      })
    }
  }
  errors.push(...carrierSequenceErrors(plan))
  return errors
}

module.exports = {
  arrivalConstrainedRequest,
  arrivalConstraints,
  arrivalErrors,
  canonicalTransportDemands,
  carrierSequenceErrors,
  demandsByTargetStopId,
  resolveDemandByStopId,
  serverDemandIdFor,
  stopIdsFromDemandId
}
