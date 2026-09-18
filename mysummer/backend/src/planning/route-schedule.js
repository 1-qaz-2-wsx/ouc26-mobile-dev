const { scheduleItems, dateOnly } = require('./rule-planner')
const { checkHardConstraints } = require('./hard-constraints')
const { auditRoutes, routeDemands } = require('./route-audit')

// Reflow activities, never invent a new carrier departure or silently move a lock.
function applyRouteArrivals(plan, evidence) {
  if (!Array.isArray(evidence) || !evidence.length) return { changed: false, errors: [] }
  const input = plan.inputSnapshot
  const constraints = require('./transport-arrival').arrivalConstrainedRequest(input, plan.legs)
  const sources = new Map(constraints.menuItems.map(item => [item.menuItemId, item]))
  const work = structuredClone(plan)
  const updatedEvidence = structuredClone(evidence)
  const originalDemands = routeDemands(plan)
  for (let index = 0; index <= plan.plannedOrder.length; index++) {
    const demand = routeDemands(work)[index]
    const rows = updatedEvidence.filter(row => row && row.demandId === demand.demandId)
    if (rows.length !== 1 || !Array.isArray(rows[0].legs) || !rows[0].legs.length) continue
    // Navigation legs have no fixed departure. Propagate the preceding activity
    // finish, keeping supplied durations and waiting gaps, explicitly estimated.
    // Never move a bus/train/flight or arbitrary manually supplied timestamp.
    if (rows[0].legs.every(leg => ['car', 'walk'].includes(leg.mode) && !leg.quoteRef && leg.provenance?.provider === 'tencent-map'
      && leg.provenance.sourceType === 'estimate' && leg.assumptions?.includes('DEPARTURE_AT_READY_TIME'))) {
      let oldCursor = Date.parse(originalDemands[index].readyAt)
      let cursor = Date.parse(demand.readyAt)
      const shifted = structuredClone(rows[0].legs)
      let valid = true
      for (const leg of shifted) {
        const waiting = Date.parse(leg.departureAt) - oldCursor
        const actual = Date.parse(leg.arrivalAt) - Date.parse(leg.departureAt)
        if (!Number.isFinite(waiting) || waiting < 0 || !Number.isInteger(leg.durationMinutes) || leg.durationMinutes < 1 || actual !== leg.durationMinutes * 60000) { valid = false; break }
        oldCursor = Date.parse(leg.arrivalAt)
        cursor += waiting
        leg.departureAt = new Date(cursor).toISOString()
        leg.serviceDate = dateOnly(cursor, input.timezone)
        cursor += actual
        leg.arrivalAt = new Date(cursor).toISOString()
      }
      if (valid) rows[0].legs = shifted
    }
    if (index === plan.plannedOrder.length) continue
    // Validate structure/provenance and ready time independently of the provisional
    // activity start; endBy remains an absolute limit.
    const relaxed = structuredClone(work)
    const target = relaxed.items.find(item => item.itemId === plan.plannedOrder[index])
    target.startAt = input.endBy
    // B3-4：这里只审计「本段的 local route 链」是否结构/时序合法，结构上等价于 B3 之前的单段审计。
    // carrier leg 的绑定结论是整份 plan 的属性，已由 pipeline 的主 auditRoutes 统一判定，
    // 局部 relaxed 审计不再重复计算，避免 carrier 结论反过来阻断 local reflow。
    const audit = auditRoutes(relaxed, rows, { carrierAudit: false })
    if (audit.errors.length || !audit.legs.length || audit.gaps.some(gap => gap.demandId === demand.demandId && gap.code !== 'ROUTE_TIME_NEEDS_REVIEW')) continue
    const arrival = rows[0].legs[rows[0].legs.length - 1].arrivalAt
    const source = sources.get(plan.plannedOrder[index])
    if (Date.parse(arrival) > Date.parse(source.preferredWindow.startAt)) {
      source.preferredWindow.startAt = arrival
      const schedule = scheduleItems(constraints, plan.plannedOrder.map(id => sources.get(id)), input.locks)
      const hard = checkHardConstraints({ request: input, orderedItems: plan.plannedOrder.map(id => sources.get(id)), schedule })
      if (hard.errors.length) return { changed: false, errors: hard.errors }
      work.items = schedule.itemPlans
      work.days = schedule.dayPlans
    }
  }
  const changed = JSON.stringify(plan.items) !== JSON.stringify(work.items)
  evidence.splice(0, evidence.length, ...updatedEvidence)
  if (changed) {
    plan.items = work.items
    plan.days = work.days
    plan.validation.assumptions.push({ code: 'ROUTE_ARRIVAL_REFLOW', source: 'route_evidence', message: '活动已按所提供接驳的到达时间顺延，未更改交通班次或用户锁' })
  }
  return { changed, errors: [] }
}
module.exports = { applyRouteArrivals }
