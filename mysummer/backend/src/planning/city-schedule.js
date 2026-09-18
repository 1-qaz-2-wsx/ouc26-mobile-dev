const { dateKeys, dateOnly, zonedDateTime } = require('./rule-planner')
const MINUTE = 60000
function sourced(value) {
  return value && ['mock', 'live', 'manual_verified'].includes(value.sourceType) &&
    ['test', 'production'].includes(value.environment) && typeof value.sourceRef === 'string' && value.sourceRef.trim() &&
    typeof value.fetchedAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value.fetchedAt) && Number.isFinite(Date.parse(value.fetchedAt))
}

// These are requested city day allocations, not evidence of arrival or hotel nights.
function cityStayWindows(input, plannedOrder, scheduledItems = []) {
  const days = dateKeys(Date.parse(input.startAt), Date.parse(input.endBy), input.timezone)
  const sources = new Map(input.menuItems.map(item => [item.menuItemId, item]))
  let offset = 0
  return plannedOrder.map(id => sources.get(id)).filter(item => item && (item.placeRef.type === 'city' || item.stayRequirement === 'city_anchor')).map(city => {
    const count = city.stayDays || 1
    const scheduled = scheduledItems.find(item => item.itemId === city.menuItemId)
    if (scheduled) offset = Math.max(offset, days.indexOf(dateOnly(Date.parse(scheduled.startAt), input.timezone)))
    const allocated = days.slice(offset, offset + count)
    offset += count
    return { sourceMenuItemId: city.menuItemId, sourceOccurrenceId: city.occurrenceId,
      dates: allocated, requestedDays: count, status: allocated.length === count ? 'requested' : 'blocked',
      gaps: allocated.length === count ? ['CITY_ARRIVAL_DEPARTURE_UNCONFIRMED', 'LODGING_NIGHTS_UNCONFIRMED'] : ['CITY_STAY_EXCEEDS_TRIP'],
      windows: allocated.map(date => ({ startAt: new Date(Math.max(zonedDateTime(date, '08:00', input.timezone), Date.parse(input.startAt), Date.parse(city.preferredWindow.startAt), scheduled ? Date.parse(scheduled.startAt) : -Infinity)).toISOString(),
        endAt: new Date(Math.min(zonedDateTime(date, '22:00', input.timezone), Date.parse(input.endBy), Date.parse(city.preferredWindow.endAt))).toISOString() })) }
  })
}

// facts: candidate id, sourced duration/open windows, and sourced inbound transfer
// from each possible prior candidate. No straight-line-to-driving-time inference.
function scheduleCityCandidates({ input, stay, candidates, facts = [], occupied = [] }) {
  const activities = [], pending = []
  if (!stay || stay.status === 'blocked') return { activities, pending: [{ code: 'CITY_STAY_EXCEEDS_TRIP' }], status: 'blocked' }
  const factsMap = new Map()
  const duplicates = new Set()
  for (const fact of Array.isArray(facts) ? facts : []) {
    if (!fact || typeof fact.candidateId !== 'string') continue
    if (factsMap.has(fact.candidateId)) duplicates.add(fact.candidateId)
    factsMap.set(fact.candidateId, fact)
  }
  let previousId = 'city-arrival'
  let cursor = -Infinity
  const explicitIds = new Set(input.menuItems.filter(item => item.menuItemId !== stay.sourceMenuItemId).map(item => JSON.stringify([item.placeRef.provider, item.placeRef.providerPlaceId])))
  for (const candidate of candidates) {
    const defer = code => pending.push({ candidateId: candidate.candidateId, code })
    if (explicitIds.has(JSON.stringify([candidate.placeRef.provider, candidate.placeRef.providerPlaceId]))) { defer('EXPLICIT_PLACE_ALREADY_INCLUDED'); continue }
    const fact = factsMap.get(candidate.candidateId)
    if (duplicates.has(candidate.candidateId)) { defer('POI_FACTS_AMBIGUOUS'); continue }
    if (!fact || !sourced(fact.provenance) || !Number.isInteger(fact.visitDurationMinutes) || fact.visitDurationMinutes < 1 || fact.visitDurationMinutes > 1440 ||
        !Array.isArray(fact.openWindows) || !fact.openWindows.length) { defer('POI_SCHEDULE_FACTS_MISSING'); continue }
    const transfers = Array.isArray(fact.inboundTransfers) ? fact.inboundTransfers.filter(row => row && row.fromCandidateId === previousId) : []
    const transfer = transfers.length === 1 ? transfers[0] : null
    if (!transfer || !sourced(transfer.provenance) || !Number.isInteger(transfer.durationMinutes) || transfer.durationMinutes < 0 ||
        (previousId === 'city-arrival' && (typeof transfer.readyAt !== 'string' || !Number.isFinite(Date.parse(transfer.readyAt))))) { defer('POI_TRANSFER_FACTS_MISSING'); continue }
    let chosen = null
    const windows = fact.openWindows.filter(window => sourced(window.provenance) && Number.isFinite(Date.parse(window.startAt)) && Number.isFinite(Date.parse(window.endAt)) && Date.parse(window.startAt) < Date.parse(window.endAt))
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    for (const day of stay.windows) {
      for (const opening of windows) {
        let start = Math.max(Date.parse(day.startAt), Date.parse(opening.startAt),
          (previousId === 'city-arrival' ? Date.parse(transfer.readyAt) : cursor) + transfer.durationMinutes * MINUTE)
        const bound = Math.min(Date.parse(day.endAt), Date.parse(opening.endAt))
        // Reserve required activities and locked bookings before optional additions.
        for (const reserved of [...occupied].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))) {
          if (start < Date.parse(reserved.endAt) && start + fact.visitDurationMinutes * MINUTE > Date.parse(reserved.startAt)) start = Date.parse(reserved.endAt)
        }
        if (start + fact.visitDurationMinutes * MINUTE <= bound) { chosen = { start, end: start + fact.visitDurationMinutes * MINUTE }; break }
      }
      if (chosen) break
    }
    if (!chosen) { defer('POI_CANNOT_FIT_WINDOW'); continue }
    const transferStart = chosen.start - transfer.durationMinutes * MINUTE
    if (occupied.some(reserved => transferStart < Date.parse(reserved.endAt) && chosen.start > Date.parse(reserved.startAt))) {
      defer('POI_TRANSFER_OVERLAPS_REQUIRED_ITEM'); continue
    }
    activities.push({ itemId: candidate.expansionItemId, kind: 'poi', placeRef: candidate.placeRef,
      sourceMenuItemIds: [stay.sourceMenuItemId], sourceOccurrenceId: stay.sourceOccurrenceId,
      startAt: new Date(chosen.start).toISOString(), endAt: new Date(chosen.end).toISOString(),
      date: dateOnly(chosen.start, input.timezone), durationMinutes: fact.visitDurationMinutes,
      inboundTransferMinutes: transfer.durationMinutes, provenance: fact.provenance,
      reason: '城市候选按有来源的开放窗口与接驳耗时安排', status: 'needs_review' })
    cursor = chosen.end
    previousId = candidate.candidateId
  }
  return { activities, pending, status: 'needs_review', scope: 'city_activity_preview',
    gaps: ['CITY_EXIT_TRANSFER_UNCONFIRMED', 'TICKET_PRICE_UNCONFIRMED', 'LODGING_UNCONFIRMED'] }
}
function optimizeCityCandidates(options) {
  const original = [...options.candidates]
  const score = result => {
    const selected = new Set(result.activities.map(activity => activity.itemId))
    const interests = new Set(options.input.interests || [])
    return { count: result.activities.length,
      interestMatches: original.filter(candidate => selected.has(candidate.expansionItemId) && interests.has(candidate.categoryGroup)).length,
      transferMinutes: result.activities.reduce((sum, activity) => sum + activity.inboundTransferMinutes, 0) }
  }
  const better = (a, b) => a.count > b.count || a.count === b.count &&
    (a.interestMatches > b.interestMatches || a.interestMatches === b.interestMatches && a.transferMinutes < b.transferMinutes)
  let order = original
  let result = scheduleCityCandidates(options)
  const baselineScore = score(result)
  let bestScore = baselineScore
  let evaluations = 1
  // Bounded local swaps; compares the same opening/transfer evidence snapshot.
  for (let pass = 0; pass < 3 && evaluations < 25; pass++) {
    let improved = false
    for (let index = 0; index + 1 < order.length && evaluations < 25; index++) {
      const candidateOrder = [...order]
      ;[candidateOrder[index], candidateOrder[index + 1]] = [candidateOrder[index + 1], candidateOrder[index]]
      const candidateResult = scheduleCityCandidates({ ...options, candidates: candidateOrder })
      evaluations++
      const candidateScore = score(candidateResult)
      if (better(candidateScore, bestScore)) { order = candidateOrder; result = candidateResult; bestScore = candidateScore; improved = true }
    }
    if (!improved) break
  }
  return { ...result, optimization: { method: 'bounded_local_swap', evaluations, baselineScore, selectedScore: bestScore,
    orderChanged: order.some((candidate, index) => candidate.candidateId !== original[index].candidateId),
    selectedCandidateOrder: order.map(candidate => candidate.candidateId), globallyOptimal: false } }
}
module.exports = { cityStayWindows, scheduleCityCandidates, optimizeCityCandidates }
