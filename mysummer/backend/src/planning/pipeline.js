const { createHash } = require('node:crypto')
const { normalizePlanRequest } = require('./normalizer')
const { buildRulePlan, applyTransportEvidence, zonedDateTime } = require('./rule-planner')
const { adaptMapEvidence } = require('./map-evidence')
const { routeDemands, auditRoutes, isCarrierLeg } = require('./route-audit')
const { validatePlan } = require('./plan-schema')
const { applyRouteArrivals } = require('./route-schedule')
const { cityStayWindows, optimizeCityCandidates } = require('./city-schedule')
const { buildJourneyDays } = require('./journey-days')
const { computeFeasibility, projectDisplay } = require('./display-projection')
const { bindTransportDemands } = require('./transport-demands')

// ---------------------------------------------------------------- B3-2 多段交通证据

// server 归一后的逐段状态词表：机器状态，不是 provider 原文，也不是用户文案。
const TRANSPORT_EVIDENCE_STATUSES = Object.freeze(['queried', 'no_quotes', 'out_of_window', 'disabled', 'not_configured',
  'budget_exhausted', 'unavailable', 'unbound', 'ambiguous', 'cancelled', 'not_queried'])
// provider 可直接透传的受控状态；“查到票 / 没查到票”不属于这一类，必须经归一。
const PROVIDER_PASSTHROUGH_STATUSES = Object.freeze(['out_of_window', 'disabled', 'not_configured', 'budget_exhausted', 'unavailable'])
// 聚合旧单值字段时的保守严重度顺序：只有全部段都是 queried 才允许对外表达“已查询到”。
const TRANSPORT_EVIDENCE_PRIORITY = Object.freeze(['cancelled', 'unavailable', 'budget_exhausted', 'not_configured', 'disabled',
  'out_of_window', 'no_quotes', 'unbound', 'ambiguous', 'not_queried'])
// 旧单值 transportStatus 的受控兼容映射：取值必须落在前端已有受控表内，
// 既不能新增前端未知取值，也不能透传 provider 原始状态或错误文本。
const TRANSPORT_STATUS_COMPAT = Object.freeze({
  queried: 'available',
  no_quotes: 'unknown',
  out_of_window: 'out_of_window',
  disabled: 'disabled',
  not_configured: 'not_configured',
  budget_exhausted: 'budget_exhausted',
  unavailable: 'unavailable',
  unbound: 'not_queried',
  ambiguous: 'not_queried',
  cancelled: 'not_queried',
  not_queried: 'not_queried'
})
const MACHINE_TOKEN = /^[a-z][a-z0-9_]{0,39}$/
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{2,40}$/

function machineToken(value) {
  return typeof value === 'string' && MACHINE_TOKEN.test(value) ? value : null
}

function machineCode(value) {
  return typeof value === 'string' && MACHINE_CODE.test(value) ? value : null
}

// provider 返回结果 → 归一状态。“查不到票”必须与额度、配置、窗口、停用分开。
function transportEvidenceStatusFromResult(result) {
  if (!result || typeof result.status !== 'string') return 'unavailable'
  const hasQuotes = Array.isArray(result.quotes) && result.quotes.length > 0
  if (result.status === 'available' || result.status === 'unknown') return hasQuotes ? 'queried' : 'no_quotes'
  if (PROVIDER_PASSTHROUGH_STATUSES.includes(result.status)) return result.status
  return hasQuotes ? 'queried' : 'unavailable'
}

// provider 抛错 → 归一状态；本轮查询额度用尽不得被解释成“无票”或“供应商不可用”。
function transportEvidenceStatusFromError(error) {
  return error && error.code === 'PROVIDER_SESSION_LIMIT' ? 'budget_exhausted' : 'unavailable'
}

function transportEvidenceEntry({ demand, binding, status, providerStatus = null, diagnostic = null, quotes = [] }) {
  const demandId = binding && typeof binding.demandId === 'string' ? binding.demandId : null
  return {
    demandId,
    targetMenuItemId: binding && binding.targetMenuItemId !== undefined ? binding.targetMenuItemId
      : (typeof demand?.targetMenuItemId === 'string' ? demand.targetMenuItemId : null),
    targetStopId: binding && binding.targetStopId !== undefined ? binding.targetStopId : null,
    mode: typeof demand?.mode === 'string' ? demand.mode : null,
    serviceDate: typeof demand?.serviceDate === 'string' ? demand.serviceDate : null,
    status,
    providerStatus: machineToken(providerStatus),
    diagnostic: machineCode(diagnostic) ? { code: diagnostic } : null,
    // 每段报价必须带自己的 demandId，禁止多段报价混成一个无归属候选池。
    quotes: (Array.isArray(quotes) ? quotes : []).filter(quote => quote && typeof quote === 'object')
      .map(quote => Object.assign(structuredClone(quote), { demandId }))
  }
}

// 逐段查询：只有 binding === bound 的显式需求才进入 provider 候选；
// unbound / ambiguous 保留独立状态且不查询，不按站名或顺序猜 demandId。
async function collectTransportEvidence({ transportDemands, demands, evidenceForTransport, signal }) {
  const requested = Array.isArray(transportDemands) ? transportDemands : []
  if (!requested.length) return []
  const bindings = bindTransportDemands(requested, demands)
  const evidence = []
  let budgetSpent = false
  let cancelled = false
  for (const [index, binding] of bindings.entries()) {
    const demand = requested[index]
    const base = { demand, binding }
    if (binding.binding !== 'bound') { evidence.push(transportEvidenceEntry({ ...base, status: binding.binding })); continue }
    if (cancelled || (signal && signal.aborted)) {
      cancelled = true
      evidence.push(transportEvidenceEntry({ ...base, status: 'cancelled' }))
      continue
    }
    // 航班供应商仍未授权启用：返回明确 disabled，绝不调用 fetch。
    if (demand?.mode === 'flight') { evidence.push(transportEvidenceEntry({ ...base, status: 'disabled' })); continue }
    // 额度用尽后剩余段不再尝试，但仍逐段保留明确状态（不静默跳过）。
    if (budgetSpent) { evidence.push(transportEvidenceEntry({ ...base, status: 'budget_exhausted' })); continue }
    if (!evidenceForTransport) { evidence.push(transportEvidenceEntry({ ...base, status: 'not_queried' })); continue }
    try {
      const result = await evidenceForTransport({ demand: structuredClone(demand), signal })
      const status = transportEvidenceStatusFromResult(result)
      if (status === 'budget_exhausted') budgetSpent = true
      evidence.push(transportEvidenceEntry({ ...base, status, providerStatus: result && result.status, quotes: result && result.quotes }))
    } catch (error) {
      if (signal && signal.aborted) {
        cancelled = true
        evidence.push(transportEvidenceEntry({ ...base, status: 'cancelled' }))
        continue
      }
      const status = transportEvidenceStatusFromError(error)
      if (status === 'budget_exhausted') budgetSpent = true
      evidence.push(transportEvidenceEntry({ ...base, status, diagnostic: error && error.code }))
    }
  }
  return evidence
}

// 多段结果聚合为旧单值兼容字段：只有全部段 queried 才是 available，否则取最高严重度的非 queried 状态。
function transportEvidenceStatus(evidence) {
  const statuses = (Array.isArray(evidence) ? evidence : []).map(entry => entry && entry.status)
    .filter(status => TRANSPORT_EVIDENCE_STATUSES.includes(status))
  if (!statuses.length) return 'not_queried'
  if (statuses.every(status => status === 'queried')) return 'queried'
  for (const status of TRANSPORT_EVIDENCE_PRIORITY) if (statuses.includes(status)) return status
  return 'not_queried'
}

function compatTransportStatus(status) {
  return TRANSPORT_STATUS_COMPAT[status] || 'not_queried'
}

// ---------------------------------------------------------------- B4-2 附近住宿地点证据
//
// 只做“附近住宿地点信息”的证据接入：查询结果只证明地图上存在住宿地点，
// 不证明有房、有价、可预订。因此本段的任何失败都不允许进入 plan.validation.errors，
// 也不允许单独把 feasibility 降级；额度问题必须与“没查到”分开表达。

// lodgingOptions[].status 机器词表（与 journey.lodgingNeeds.status 不是同一层语义）。
const LODGING_EVIDENCE_STATUSES = Object.freeze(['available', 'no_results', 'budget_exhausted', 'unavailable',
  'anchor_missing', 'not_queried', 'not_required', 'pending_confirmation'])
// 同一时刻只允许一个明确关键词：provider 侧默认“酒店”，本批不自动二次搜索“住宿”。
const LODGING_QUERYABLE_NEED_STATUS = 'needs_review'
// 当晚检索参考截止时间（当地时间）。
const LODGING_ANCHOR_REFERENCE_TIME = '22:00'
// 同一时间点的候选优先级：活动结束位置优于交通到达位置优于请求起点。
const LODGING_ANCHOR_SOURCE_RANK = Object.freeze({ activity: 0, transport_arrival: 1, origin: 2 })
// 只有这些状态才允许产生 info 级 LODGING_NOT_SEARCHED；
// not_required / pending_confirmation 是用户侧语义，不额外制造噪音。
const LODGING_NOT_SEARCHED_STATUSES = Object.freeze(['no_results', 'budget_exhausted', 'unavailable', 'anchor_missing', 'not_queried'])

// 住宿需求 → 是否跳过检索。返回 null 表示这是一个需要检索的 needs_review 需求。
function lodgingNeedSkipStatus(need) {
  if (!need || typeof need.id !== 'string' || !need.id) return null
  if (need.status === 'not_required_by_user') return 'not_required'
  if (need.status === 'night_train_rest_pending_confirmation') return 'pending_confirmation'
  if (need.status !== LODGING_QUERYABLE_NEED_STATUS) return 'not_queried'
  return null
}

// 可用坐标判定：必须是有限数、不得用 0/0 伪装缺失；坐标系只接受已知 GCJ-02 规范，
// 腾讯地图来源按既有规范放行，其它坐标系一律不猜、不换算。
function anchorLocation(placeRef) {
  const coordinate = placeRef && placeRef.coordinate
  if (!coordinate || typeof coordinate.lat !== 'number' || typeof coordinate.lng !== 'number') return null
  if (!Number.isFinite(coordinate.lat) || !Number.isFinite(coordinate.lng)) return null
  if (Math.abs(coordinate.lat) > 90 || Math.abs(coordinate.lng) > 180) return null
  if (coordinate.lat === 0 && coordinate.lng === 0) return null
  const system = typeof placeRef.coordinateSystem === 'string' ? placeRef.coordinateSystem.trim().toUpperCase() : ''
  if (!/^GCJ-?02$/.test(system) && placeRef.provider !== 'tencent-map') return null
  return { lat: coordinate.lat, lng: coordinate.lng }
}

// 候选事件：活动结束位置、路段到达位置、请求起点。只收集“已知真实位置”，
// 不按城市猜、不对站名做地理编码、不使用 endDestination 作无时间依据的兜底。
function lodgingAnchorCandidates(journey, plan, routeAudit = null) {
  const rows = []
  for (const day of (journey && Array.isArray(journey.days) ? journey.days : [])) {
    if (!day) continue
    for (const activity of (Array.isArray(day.activities) ? day.activities : [])) {
      const at = Date.parse(activity && activity.endAt)
      const location = anchorLocation(activity && activity.placeRef)
      if (Number.isFinite(at) && location) rows.push({ sourceKind: 'activity', sourceId: activity.id || null, at, location })
    }
  }
  const seenLegIds = new Set()
  const legs = [...((plan && plan.legs) || []), ...((routeAudit && routeAudit.legs) || [])]
  for (const leg of legs) {
    if (!leg || typeof leg.legId !== 'string' || !leg.legId || seenLegIds.has(leg.legId)) continue
    seenLegIds.add(leg.legId)
    const at = Date.parse(leg.arrivalAt)
    // carrier leg 的 to 是站名点（coordinate 为 null），因此不会被当成合法锚点。
    const location = anchorLocation(leg.to)
    if (Number.isFinite(at) && location) rows.push({ sourceKind: 'transport_arrival', sourceId: leg.legId, at, location })
  }
  const input = (plan && plan.inputSnapshot) || {}
  const originAt = Date.parse(input.startAt)
  const origin = anchorLocation(input.origin)
  if (Number.isFinite(originAt) && origin) {
    rows.push({ sourceKind: 'origin', sourceId: (input.origin && input.origin.providerPlaceId) || null, at: originAt, location: origin })
  }
  return rows
}

// 每晚锚点 = 该晚 22:00 之前最后一个已知真实位置。时间过滤天然排除次日活动，
// 因此绝不会用 next-day activity 反推上一晚的住宿位置。
function lodgingSearchAnchor({ need, journey, plan, routeAudit, timezone }) {
  const deadline = zonedDateTime(need.checkInDate, LODGING_ANCHOR_REFERENCE_TIME, timezone)
  const rows = lodgingAnchorCandidates(journey, plan, routeAudit).filter(row => row.at <= deadline)
  if (!rows.length) return null
  rows.sort((a, b) => b.at - a.at
    || LODGING_ANCHOR_SOURCE_RANK[a.sourceKind] - LODGING_ANCHOR_SOURCE_RANK[b.sourceKind]
    || String(a.sourceId || '').localeCompare(String(b.sourceId || '')))
  const best = rows[0]
  // 只保留受控的调试身份与时间：不复制整份 PlaceRef，也不泄漏 provider 诊断。
  return {
    lodgingNeedId: need.id,
    location: best.location,
    sourceKind: best.sourceKind,
    sourceId: best.sourceId,
    at: new Date(best.at).toISOString()
  }
}

// provider 返回 → 机器状态。“查到地点”与“没查到”“查不了”必须是三种不同结论。
function lodgingStatusFromResult(result) {
  if (!result || typeof result.status !== 'string') return 'unavailable'
  const options = Array.isArray(result.options) ? result.options : []
  if (result.status === 'available') return options.length ? 'available' : 'no_results'
  if (LODGING_EVIDENCE_STATUSES.includes(result.status)) return result.status
  return options.length ? 'available' : 'unavailable'
}

// provider 抛错 → 机器状态。本轮地图额度用尽不能被解释成“没查到住宿”。
function lodgingStatusFromError(error) {
  return error && error.code === 'PROVIDER_SESSION_LIMIT' ? 'budget_exhausted' : 'unavailable'
}

function lodgingEntry({ lodgingNeedId, status, anchor = null, options = [] }) {
  return {
    lodgingNeedId,
    status: LODGING_EVIDENCE_STATUSES.includes(status) ? status : 'unavailable',
    // structuredClone：机器态不得与 provider 输入互为别名。
    options: (Array.isArray(options) ? options : [])
      .filter(option => option && typeof option === 'object')
      .map(option => structuredClone(option)),
    anchor
  }
}

// 逐晚检索：只有 needs_review 才查询；资格/锚点/额度问题都逐晚留痕，不静默消失。
async function collectLodgingEvidence({ journey, plan, routeAudit = null, evidenceForLodging, signal }) {
  const needs = journey && Array.isArray(journey.lodgingNeeds) ? journey.lodgingNeeds : []
  const timezone = (plan && plan.inputSnapshot && plan.inputSnapshot.timezone) || 'Asia/Shanghai'
  const results = []
  let budgetSpent = false
  let cancelled = false
  for (const need of needs) {
    const skipped = lodgingNeedSkipStatus(need)
    if (skipped) { results.push(lodgingEntry({ lodgingNeedId: need.id, status: skipped })); continue }
    const anchor = lodgingSearchAnchor({ need, journey, plan, routeAudit, timezone })
    if (!anchor) { results.push(lodgingEntry({ lodgingNeedId: need.id, status: 'anchor_missing' })); continue }
    const entryAnchor = { sourceKind: anchor.sourceKind, sourceId: anchor.sourceId, at: anchor.at, location: anchor.location }
    if (cancelled || (signal && signal.aborted)) {
      cancelled = true
      results.push(lodgingEntry({ lodgingNeedId: need.id, status: 'not_queried', anchor: entryAnchor }))
      continue
    }
    // 额度一旦用尽，后续晚次不再尝试，但仍逐晚保留 budget_exhausted。
    if (budgetSpent) { results.push(lodgingEntry({ lodgingNeedId: need.id, status: 'budget_exhausted', anchor: entryAnchor })); continue }
    if (!evidenceForLodging) { results.push(lodgingEntry({ lodgingNeedId: need.id, status: 'not_queried', anchor: entryAnchor })); continue }
    try {
      const result = await evidenceForLodging({ location: structuredClone(entryAnchor.location), signal })
      const status = lodgingStatusFromResult(result)
      if (status === 'budget_exhausted') budgetSpent = true
      results.push(lodgingEntry({ lodgingNeedId: need.id, status, anchor: entryAnchor, options: result && result.options }))
    } catch (error) {
      if (signal && signal.aborted) {
        cancelled = true
        results.push(lodgingEntry({ lodgingNeedId: need.id, status: 'not_queried', anchor: entryAnchor }))
        continue
      }
      const status = lodgingStatusFromError(error)
      if (status === 'budget_exhausted') budgetSpent = true
      results.push(lodgingEntry({ lodgingNeedId: need.id, status, anchor: entryAnchor }))
    }
  }
  return results
}

// 检索失败只允许产出 info 级 LODGING_NOT_SEARCHED，并且必须逐晚定位到自己的 section。
function lodgingDiagnostics(lodgingOptions) {
  return (Array.isArray(lodgingOptions) ? lodgingOptions : [])
    .filter(entry => entry && LODGING_NOT_SEARCHED_STATUSES.includes(entry.status))
    .map(entry => ({ code: 'LODGING_NOT_SEARCHED', targetId: entry.lodgingNeedId, message: '附近住宿地点候选尚未完成检索' }))
}

// evidenceForCity is a server-owned local evidence reader, never request input.
// Live querying is intentionally not wired until query-budget policy is approved.
function createPlanningExecutor({ evidenceForCity, evidenceForRoutes, evidenceForTransport, evidenceForPoiSchedules, evidenceForLodging, now = Date.now } = {}) {
  return async ({ request, job, signal }) => {
    const { normalizedRequest: input } = normalizePlanRequest(request)
    const cityExpansions = []
    for (const city of input.menuItems.filter(item => item.placeRef.type === 'city' || item.stayRequirement === 'city_anchor')) {
      signal.throwIfAborted()
      const expansion = { sourceMenuItemIds: [city.menuItemId], sourceOccurrenceId: city.occurrenceId,
        status: 'needs_review', scheduled: false, candidates: [], gaps: [] }
      if (!evidenceForCity) expansion.gaps.push('MAP_EVIDENCE_MISSING')
      else {
        try {
          const evidence = await evidenceForCity({ placeRef: structuredClone(city.placeRef), signal })
          signal.throwIfAborted()
          if (!evidence) expansion.gaps.push('MAP_EVIDENCE_MISSING')
          else {
            const adapted = adaptMapEvidence(evidence)
            for (const candidate of adapted.candidates) {
              if (candidate.kind !== 'poi') continue
              // No fuzzy city-name or distance-only membership inference.
              const cityCode = city.placeRef.adcode
              const poiCode = candidate.placeRef.adcode
              if (!/^\d{6}$/.test(cityCode || '') || !/^\d{6}$/.test(poiCode || '') || cityCode.slice(0, 4) !== poiCode.slice(0, 4)) {
                expansion.gaps.push('CANDIDATE_CITY_MEMBERSHIP_UNCONFIRMED')
                continue
              }
              const id = createHash('sha256').update(JSON.stringify([city.occurrenceId, candidate.candidateId])).digest('hex').slice(0, 24)
              expansion.candidates.push({ ...candidate, expansionItemId: `expanded-${id}`,
                sourceMenuItemIds: [city.menuItemId], sourceOccurrenceId: city.occurrenceId })
            }
            expansion.candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId))
            expansion.gaps.push(...adapted.gaps)
            if (!expansion.candidates.length) expansion.gaps.push('NO_ELIGIBLE_POI')
          }
        } catch (error) {
          signal.throwIfAborted()
          expansion.gaps.push('MAP_EVIDENCE_UNAVAILABLE')
        }
      }
      expansion.gaps = [...new Set(expansion.gaps)]
      cityExpansions.push(expansion)
    }
    signal.throwIfAborted()
    // 旧单数 transportDemand 保持既有查询时机（plan 之前）与既有报价语义，仅额外记录受控状态。
    let transportQuotes = []
    let transportRead = { status: 'not_queried', providerStatus: null, diagnostic: null }
    if (input.transportDemand && evidenceForTransport) {
      try {
        const result = await evidenceForTransport({ demand: structuredClone(input.transportDemand), signal })
        transportQuotes = Array.isArray(result && result.quotes) ? result.quotes : []
        transportRead = { status: transportEvidenceStatusFromResult(result), providerStatus: result && result.status, diagnostic: null }
      } catch (error) {
        signal.throwIfAborted()
        transportQuotes = []
        transportRead = { status: transportEvidenceStatusFromError(error), providerStatus: null, diagnostic: error && error.code }
      }
    }
    signal.throwIfAborted()
    const basePlan = buildRulePlan({ request, transportQuotes, now, planId: `plan-${job.id}` })
    // 多段查询必须先绑定 server route demand，才能进入 provider 候选。
    let demands = []
    let routeReadFailed = false
    try {
      demands = routeDemands(basePlan)
    } catch {
      routeReadFailed = true
    }
    const transportEvidence = []
    let plan = basePlan
    if (input.transportDemand) {
      transportEvidence.push(transportEvidenceEntry({
        demand: input.transportDemand,
        binding: bindTransportDemands([input.transportDemand], demands)[0],
        status: transportRead.status,
        providerStatus: transportRead.providerStatus,
        diagnostic: transportRead.diagnostic,
        quotes: transportQuotes
      }))
    } else if (input.transportDemands.length) {
      transportEvidence.push(...await collectTransportEvidence({ transportDemands: input.transportDemands, demands, evidenceForTransport, signal }))
      // B3-4：多段 evidence 真正接回主链——selected quotes / carrier legs / arrival / costs 进入 plan。
      // 纯函数：不改 basePlan，也不重跑 orderPlan；同一个 transport demand 永不重复查询。
      if (transportEvidence.length) {
        plan = applyTransportEvidence({ plan: basePlan, request: basePlan.inputSnapshot, transportEvidence, now })
        // carrier 到达可能顺延活动时间，因此 demandId/顺序不变、readyAt/arriveBy 可能变化，必须重算。
        if (!routeReadFailed) {
          try {
            demands = routeDemands(plan)
          } catch {
            routeReadFailed = true
          }
        }
      }
    }
    signal.throwIfAborted()
    // carrier demand 已由 B3 selector 选票，不再查询「整段原地点→目标地点」的 walk/car：
    // 那不是站前/站后接驳证据，既浪费 map 额度又可能把公路替代路线冒充成接驳证明。
    const carrierDemandIds = new Set()
    for (const leg of Array.isArray(plan.legs) ? plan.legs : []) {
      if (!leg || typeof leg.demandId !== 'string' || !leg.demandId) continue
      if (isCarrierLeg(leg)) carrierDemandIds.add(leg.demandId)
    }
    const routeQueryDemands = demands.filter(demand => !carrierDemandIds.has(demand.demandId))
    let routeEvidence = []
    if (evidenceForRoutes && !routeReadFailed) {
      try {
        routeEvidence = await evidenceForRoutes({ demands: structuredClone(routeQueryDemands),
          transportPreferences: structuredClone(input.transportPreferences), timezone: input.timezone, signal })
      } catch {
        signal.throwIfAborted()
        routeReadFailed = true
      }
    }
    signal.throwIfAborted()
    const reflow = applyRouteArrivals(plan, routeEvidence)
    const routeAudit = auditRoutes(plan, routeEvidence)
    routeAudit.reflow = reflow
    routeAudit.errors.push(...reflow.errors)
    if (routeAudit.errors.length) routeAudit.status = 'blocked'
    if (routeReadFailed) routeAudit.gaps.push({ code: 'ROUTE_EVIDENCE_UNAVAILABLE' })
    plan.validation.errors.push(...routeAudit.errors)
    plan.validation.warnings.push(...routeAudit.gaps.map(gap => ({ ...gap, message: '接驳证据未完整验证，不能按零耗时处理' })))
    plan.validation.independentChecks.push({ check: 'route_continuity', status: routeAudit.status === 'checked' ? 'passed' : 'failed', details: '逐段检查起终点、时间衔接、实际时长和证据来源；不代表票价或库存验证' })
    if (routeAudit.errors.length) plan.feasibility = 'blocked'
    const cityStays = cityStayWindows(input, plan.plannedOrder, plan.items)
    for (const expansion of cityExpansions) {
      const stay = cityStays.find(value => value.sourceOccurrenceId === expansion.sourceOccurrenceId)
      let facts = []
      if (evidenceForPoiSchedules && expansion.candidates.length) {
        try {
          facts = await evidenceForPoiSchedules({ stay: structuredClone(stay), candidates: structuredClone(expansion.candidates), signal })
        } catch {
          signal.throwIfAborted()
          expansion.gaps.push('POI_SCHEDULE_EVIDENCE_UNAVAILABLE')
        }
      }
      signal.throwIfAborted()
      expansion.activityPreview = optimizeCityCandidates({ input, stay, candidates: expansion.candidates, facts,
        occupied: plan.items.filter(item => !expansion.sourceMenuItemIds.includes(item.itemId)) })
      expansion.stay = stay
      if (stay.status === 'blocked') {
        plan.validation.errors.push({ code: 'CITY_STAY_EXCEEDS_TRIP', itemId: stay.sourceMenuItemId, message: '城市要求的停留天数超过本次旅行日期范围' })
        plan.feasibility = 'blocked'
      }
    }
    if (cityExpansions.length) {
      // 每个城市锚点单独生成一条待确认警告，并带上目标菜单项，供 display 精确定位 section。
      for (const expansion of cityExpansions) {
        plan.validation.warnings.push({ code: 'CITY_EXPANSION_PENDING', targetId: expansion.sourceMenuItemIds[0],
          message: '城市候选尚未完成营业时间、游玩时长与接驳校验，未排入行程' })
      }
    }
    const journey = buildJourneyDays({ plan, cityExpansions, routeAudit })
    if (journey.conflicts.length) {
      plan.validation.errors.push(...journey.conflicts)
      plan.feasibility = 'blocked'
    }
    // B4-2：住宿附近检索是可选信息，不是硬约束。查询放在 journey 定稿之后、
    // 最终可行性/校验/投影之前；失败只产出 info 级 LODGING_NOT_SEARCHED。
    const lodgingOptions = await collectLodgingEvidence({ journey, plan, routeAudit, evidenceForLodging, signal })
    plan.validation.warnings.push(...lodgingDiagnostics(lodgingOptions))
    // 追加 routeAudit / 城市展开 / journey 之后统一按 severity 重算可执行性，
    // 避免纯 info 缺口污染任务状态；硬错误仍然保持 blocked。
    plan.feasibility = computeFeasibility(plan.validation.errors, plan.validation.warnings)
    validatePlan(plan)
    const display = projectDisplay({ plan, cityExpansions, routeAudit, journey, lodgingOptions })
    return { schemaVersion: 'planning-result.v1', partial: plan.feasibility !== 'valid' || cityExpansions.length > 0,
      plan, cityExpansions, routeAudit, journey, display,
      // transportEvidence 是 B3-3 选择报价的输入；transportStatus 只是旧单值受控兼容字段。
      transportEvidence, transportStatus: compatTransportStatus(transportEvidenceStatus(transportEvidence)),
      // B4 附近住宿地点证据：只含地点候选与逐晚机器状态，不含报价/库存/可预订结论。
      lodgingOptions,
      executionMode: evidenceForTransport || evidenceForCity || evidenceForLodging ? 'server_evidence' : 'local_evidence_only' }
  }
}

module.exports = {
  collectLodgingEvidence,
  collectTransportEvidence,
  compatTransportStatus,
  createPlanningExecutor,
  lodgingDiagnostics,
  lodgingNeedSkipStatus,
  lodgingSearchAnchor,
  lodgingStatusFromError,
  lodgingStatusFromResult,
  LODGING_EVIDENCE_STATUSES,
  LODGING_NOT_SEARCHED_STATUSES,
  transportEvidenceStatus,
  transportEvidenceStatusFromError,
  transportEvidenceStatusFromResult,
  TRANSPORT_EVIDENCE_STATUSES,
  TRANSPORT_STATUS_COMPAT
}
