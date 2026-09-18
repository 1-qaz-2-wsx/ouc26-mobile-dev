const { validateLeg } = require('./plan-schema')
const { DESTINATION_STOP_ID, routeDemandToStopId } = require('./transport-demands')

const MENU_ITEM_STOP_PREFIX = 'item:'

function identity(place) {
  return place && typeof place.provider === 'string' && typeof place.providerPlaceId === 'string'
    && place.provider.trim() && place.providerPlaceId.trim()
    ? JSON.stringify([place.provider, place.providerPlaceId]) : null
}

// B3-4：carrier leg 判定（冻结定义）——mode 是 train/flight，或存在 quoteRef。
function isCarrierLeg(leg) {
  if (!leg || typeof leg !== 'object') return false
  if (leg.quoteRef !== null && leg.quoteRef !== undefined) return true
  return leg.mode === 'train' || leg.mode === 'flight'
}

// carrier leg 的目标必须与它声明的 route demand 的 to stop 一致：
//   item:<id> -> leg.toItemId === id ; destination -> leg.toItemId 恒为 null。
// 注意：这里比较的是「目标活动/终点」，不是 carrier 的真实车站端点（§3.2）。
function carrierTargetMatchesDemand(leg, demand) {
  const toStopId = routeDemandToStopId(demand)
  if (!toStopId) return false
  if (toStopId === DESTINATION_STOP_ID) return leg.toItemId === null || leg.toItemId === undefined
  if (!toStopId.startsWith(MENU_ITEM_STOP_PREFIX)) return false
  return leg.toItemId === toStopId.slice(MENU_ITEM_STOP_PREFIX.length)
}

function routeDemands(plan) {
  const input = plan.inputSnapshot
  const source = new Map(input.menuItems.map(item => [item.menuItemId, item]))
  const items = new Map(plan.items.map(item => [item.itemId, item]))
  const stops = [{ id: 'origin', place: input.origin, readyAt: input.startAt }]
  for (const id of plan.plannedOrder) {
    const item = items.get(id)
    const original = source.get(id)
    if (!item || !original) throw new Error('route source mapping missing')
    stops.push({ id: `item:${id}`, place: original.placeRef, arriveBy: item.startAt, readyAt: item.endAt })
  }
  stops.push({ id: 'destination', place: input.endDestination, arriveBy: input.endBy })
  return stops.slice(1).map((to, index) => ({
    demandId: JSON.stringify([stops[index].id, to.id]),
    from: stops[index].place, to: to.place,
    readyAt: stops[index].readyAt, arriveBy: to.arriveBy
  }))
}

// Each evidence entry is a complete ordered chain, not a bag of alternatives.
// It can contain multiple legs (e.g. walking -> bus -> walking).
//
// B3-4：carrier leg 的绑定校验与 local route chain 审计分开进行。
// - plan.legs 中已选中的 carrier leg：验证 leg ↔ quote ↔ route demand 三者同源与时序；
//   绑定成功只产生 station transfer gap（两侧接驳未验证），绝不判 blocked；
// - route evidence 中仍出现 carrier-like leg 且该 demand 没有绑定的 carrier：保留兼容 code
//   ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED；
// - 没有任何 carrier 绑定的 demand：继续沿用原有 local route chain 审计（行为不变）。
//
// options.carrierAudit === false 供 route-schedule 的局部 relaxed 审计使用，
// 避免同一份 plan 的 carrier 结论在每次局部审计里被重复计算。
function auditRoutes(plan, evidence = [], options = {}) {
  const auditCarriers = !options || options.carrierAudit !== false
  const demands = routeDemands(plan)
  const errors = [], gaps = [], acceptedLegs = []
  const legs = Array.isArray(plan.legs) ? plan.legs : []
  const usedIds = new Set(legs.map(leg => leg.legId))
  const demandIds = new Set(demands.map(demand => demand.demandId))
  const demandById = new Map(demands.map(demand => [demand.demandId, demand]))
  const quoteById = new Map()
  for (const quote of Array.isArray(plan.quotes) ? plan.quotes : []) {
    if (quote && typeof quote.quoteId === 'string') quoteById.set(quote.quoteId, quote)
  }
  if (!Array.isArray(evidence)) return { demands, legs: [], errors: [{ code: 'ROUTE_EVIDENCE_INVALID' }], gaps, status: 'blocked' }
  for (const row of evidence) {
    if (!row || !demandIds.has(row.demandId)) errors.push({ code: 'ROUTE_DEMAND_UNKNOWN' })
  }

  // ---- carrier binding（§3.1 / §3.2 / §3.3 / §3.4）
  const boundCarriersByDemand = new Map()
  if (auditCarriers) {
    for (const leg of legs) {
      if (!isCarrierLeg(leg)) continue
      const demandId = typeof leg.demandId === 'string' && leg.demandId ? leg.demandId : null
      const target = demandId ? { demandId, legId: leg.legId } : { legId: leg.legId }
      const fail = code => errors.push({ code, ...target })
      const demand = demandId ? demandById.get(demandId) : null
      if (!demand) { fail('ROUTE_DEMAND_UNKNOWN'); continue }
      // 绑定三要素：quoteRef 可解析，且引用报价声明的 demandId 与 leg 完全一致。
      const quote = typeof leg.quoteRef === 'string' && leg.quoteRef ? quoteById.get(leg.quoteRef) : null
      if (!quote || typeof quote.demandId !== 'string' || !quote.demandId || quote.demandId !== demandId) {
        fail('ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED'); continue
      }
      const legErrors = []
      const failLeg = code => legErrors.push({ code, ...target })
      if (!carrierTargetMatchesDemand(leg, demand)) failLeg('ROUTE_DESTINATION_MISMATCH')
      if (Date.parse(leg.departureAt) < Date.parse(demand.readyAt)) failLeg('ROUTE_TIME_CONFLICT')
      if (Date.parse(leg.arrivalAt) > Date.parse(demand.arriveBy)) failLeg('ROUTE_ARRIVES_TOO_LATE')
      if (leg.status === 'blocked') failLeg('ROUTE_LEG_BLOCKED')
      if (legErrors.length) { errors.push(...legErrors); continue }
      if (!boundCarriersByDemand.has(demandId)) boundCarriersByDemand.set(demandId, [])
      boundCarriersByDemand.get(demandId).push(leg)
    }
    // 绑定结论统一留到 demand 循环里下判：只有「唯一绑定且没有整段 local 证据」时才落到
    // station transfer gap（§3.3 / §3.5）；多条绑定或绑定 + 整段证据都必须是 ambiguous，
    // 不允许同时给出 STATION_TRANSFERS_UNCONFIRMED，否则等于把冲突当成站前站后接驳。
  }

  for (const demand of demands) {
    const rows = evidence.filter(row => row && row.demandId === demand.demandId)
    const bound = boundCarriersByDemand.get(demand.demandId)
    if (bound) {
      // 同一 demand 最多一条 selected carrier leg；多条时无法判断哪条才是唯一绑定（§3.3）。
      if (bound.length > 1) {
        errors.push({ code: 'ROUTE_CHAIN_AMBIGUOUS', demandId: demand.demandId })
        continue
      }
      // §3.5：已绑定 carrier 的 demand 不应再有整段 local route evidence。
      // 二者不能相加当成站前/站后接驳——当前 evidence schema 表达不了两条独立 transfer 子链。
      if (rows.length) {
        errors.push({ code: 'ROUTE_CHAIN_AMBIGUOUS', demandId: demand.demandId })
        continue
      }
      // 唯一绑定：票面本身已验证，但两侧接驳仍未确认——保留为 gap，不得当作 0 分钟或已解决。
      gaps.push({ code: 'STATION_TRANSFERS_UNCONFIRMED', demandId: demand.demandId, legId: bound[0].legId })
      continue
    }
    if (!rows.length) { gaps.push({ code: 'TRANSFER_EVIDENCE_MISSING', demandId: demand.demandId }); continue }
    if (rows.length !== 1 || !Array.isArray(rows[0].legs) || !rows[0].legs.length) {
      errors.push({ code: 'ROUTE_CHAIN_AMBIGUOUS', demandId: demand.demandId }); continue
    }
    const chain = rows[0].legs
    const chainErrors = []
    let previousPlace = demand.from
    let previousArrival = Date.parse(demand.readyAt)
    for (const [index, leg] of chain.entries()) {
      try { validateLeg(leg, index) } catch {
        chainErrors.push({ code: 'ROUTE_LEG_INVALID', demandId: demand.demandId }); continue
      }
      const fail = code => chainErrors.push({ code, demandId: demand.demandId, legId: leg.legId })
      if (usedIds.has(leg.legId)) fail('ROUTE_LEG_ID_DUPLICATE')
      usedIds.add(leg.legId)
      if (!identity(leg.from) || !identity(leg.to) || identity(previousPlace) !== identity(leg.from)) fail('ROUTE_ENDPOINT_DISCONNECTED')
      if (Date.parse(leg.departureAt) < previousArrival) fail('ROUTE_TIME_CONFLICT')
      if (Date.parse(leg.arrivalAt) > Date.parse(demand.arriveBy)) fail('ROUTE_ARRIVES_TOO_LATE')
      const duration = (Date.parse(leg.arrivalAt) - Date.parse(leg.departureAt)) / 60000
      if (!Number.isInteger(leg.durationMinutes) || leg.durationMinutes !== duration) fail('ROUTE_DURATION_MISMATCH')
      const provenance = leg.provenance
      if (!provenance || !['mock', 'manual_verified', 'live', 'estimate'].includes(provenance.sourceType)
          || !['test', 'production'].includes(provenance.environment)
          || typeof provenance.sourceRef !== 'string' || !provenance.sourceRef.trim()
          || typeof provenance.fetchedAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(provenance.fetchedAt)
          || !Number.isFinite(Date.parse(provenance.fetchedAt))) fail('ROUTE_PROVENANCE_MISSING')
      if (isCarrierLeg(leg)) {
        // route evidence 里的 carrier-like leg 没有经过 B3 selector 的 quote/leg 绑定，
        // 当前 route evidence schema 还无法表达票面证据，因此保持兼容的「未实现」结论。
        fail('ROUTE_CARRIER_BINDING_NOT_IMPLEMENTED')
      }
      if (leg.status === 'blocked') fail('ROUTE_LEG_BLOCKED')
      if (leg.status !== 'available' || provenance?.sourceType === 'estimate') {
        gaps.push({ code: 'ROUTE_TIME_NEEDS_REVIEW', demandId: demand.demandId, legId: leg.legId })
      }
      previousPlace = leg.to
      previousArrival = Date.parse(leg.arrivalAt)
    }
    if (identity(previousPlace) !== identity(demand.to)) chainErrors.push({ code: 'ROUTE_DESTINATION_MISMATCH', demandId: demand.demandId })
    errors.push(...chainErrors)
    if (!chainErrors.length) acceptedLegs.push(...structuredClone(chain))
  }
  return { demands, legs: acceptedLegs, errors, gaps,
    status: errors.length ? 'blocked' : gaps.length ? 'needs_review' : 'checked',
    scope: 'local_transfer_timing_only' }
}

module.exports = { auditRoutes, isCarrierLeg, routeDemands }
