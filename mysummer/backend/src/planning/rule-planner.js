const { normalizePlanRequest } = require('./normalizer')
const { plainObject, planningError } = require('./schema')
const { quoteFromProvider, validatePlan } = require('./plan-schema')
const { checkHardConstraints, uniqueErrors } = require('./hard-constraints')
const { computeFeasibility } = require('./display-projection')
const {
  arrivalConstrainedRequest,
  arrivalErrors,
  arrivalConstraints,
  canonicalTransportDemands,
  demandsByTargetStopId,
  resolveDemandByStopId,
  serverDemandIdFor
} = require('./transport-arrival')

const MINUTE = 60 * 1000

function partsAt(epoch, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(epoch))
  return Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type, item.value]))
}

function offsetMsAt(epoch, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(new Date(epoch))
  const raw = parts.find(item => item.type === 'timeZoneName')?.value || 'GMT'
  if (raw === 'GMT' || raw === 'UTC') return 0
  const match = raw.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  if (!match) throw planningError('TIMEZONE_UNSUPPORTED', '无法解析规划时区偏移', 422)
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0)
  return (match[1] === '+' ? 1 : -1) * minutes * MINUTE
}

function zonedDateTime(date, time, timezone) {
  const naive = Date.parse(`${date}T${time}:00.000Z`)
  if (Number.isNaN(naive)) throw planningError('INVALID_TIME', '规划时间无效', 422)
  let guess = naive
  for (let index = 0; index < 3; index += 1) guess = naive - offsetMsAt(guess, timezone)
  return guess
}

function dateOnly(epoch, timezone) {
  const parts = partsAt(epoch, timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function nextDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function dateKeys(startEpoch, endEpoch, timezone) {
  const result = []
  let current = dateOnly(startEpoch, timezone)
  const end = dateOnly(endEpoch, timezone)
  for (let guard = 0; guard < 366; guard += 1) {
    result.push(current)
    if (current === end) return result
    current = nextDate(current)
  }
  throw planningError('DATE_RANGE_TOO_LARGE', '规划日期范围不能超过 1 年', 422)
}

function coordinate(value) {
  return value && value.coordinate && Number.isFinite(value.coordinate.lat) && Number.isFinite(value.coordinate.lng)
    ? value.coordinate
    : null
}

function distance(a, b) {
  const first = coordinate(a), second = coordinate(b)
  if (!first || !second) return Number.POSITIVE_INFINITY
  const latFactor = Math.cos(((first.lat + second.lat) / 2) * Math.PI / 180)
  return Math.hypot((first.lat - second.lat) * 111, (first.lng - second.lng) * 111 * latFactor)
}

function orderScore(items, request = null) {
  const points = request ? [request.origin, ...items.map(item => item.placeRef), request.endDestination] : items.map(item => item.placeRef)
  let score = 0
  let unknownSegments = 0
  for (let index = 1; index < points.length; index += 1) {
    const value = distance(points[index - 1], points[index])
    if (!Number.isFinite(value)) unknownSegments += 1
    else score += value
  }
  return { score, unknownSegments }
}

function orderLockPosition(lock) {
  if (Number.isInteger(lock.value)) return lock.value
  if (plainObject(lock.value) && Number.isInteger(lock.value.position)) return lock.value.position
  return null
}

function orderPlan(items, request) {
  const original = [...items].sort((a, b) => a.inputOrder - b.inputOrder)
  const itemIds = new Set(original.map(item => item.menuItemId))
  const conflicts = []
  const fixed = new Map()
  for (const lock of request.locks) {
    if (!itemIds.has(lock.targetId)) conflicts.push({ code: 'LOCK_TARGET_NOT_FOUND', lockId: lock.lockId, targetId: lock.targetId })
    if (lock.kind === 'time') {
      const value = lock.value
      if (!plainObject(value) || typeof value.startAt !== 'string' || typeof value.endAt !== 'string' || Number.isNaN(Date.parse(value.startAt)) || Number.isNaN(Date.parse(value.endAt)) || Date.parse(value.startAt) >= Date.parse(value.endAt)) {
        conflicts.push({ code: 'TIME_LOCK_INVALID', lockId: lock.lockId, targetId: lock.targetId })
      }
    }
    if (lock.kind !== 'order') continue
    const position = orderLockPosition(lock)
    if (position === null) conflicts.push({ code: 'ORDER_LOCK_POSITION_REQUIRED', lockId: lock.lockId })
    else if (position < 0 || position >= original.length) conflicts.push({ code: 'ORDER_LOCK_POSITION_INVALID', lockId: lock.lockId, position })
    else if (fixed.has(position) && fixed.get(position) !== lock.targetId) conflicts.push({ code: 'ORDER_LOCK_CONFLICT', position })
    else fixed.set(position, lock.targetId)
  }
  if (conflicts.length) return { original, planned: original, changes: [], conflicts, scores: { original: orderScore(original, request), planned: orderScore(original, request) } }
  const fixedSatisfiedByOriginal = [...fixed].every(([position, itemId]) => original[position]?.menuItemId === itemId)
  if (!request.optimizeOrder) {
    const strictConflicts = fixedSatisfiedByOriginal ? [] : [{ code: 'ORDER_LOCK_CONFLICT_WITH_EXPLICIT_ORDER', message: '顺序锁与用户关闭优化后的显式顺序冲突' }]
    return { original, planned: original, changes: [], conflicts: strictConflicts, scores: { original: orderScore(original, request), planned: orderScore(original, request) } }
  }

  const byId = new Map(original.map(item => [item.menuItemId, item]))
  const planned = new Array(original.length)
  const used = new Set()
  for (const [position, itemId] of fixed) {
    if (!byId.has(itemId)) conflicts.push({ code: 'LOCK_TARGET_NOT_FOUND', targetId: itemId })
    else if (used.has(itemId)) conflicts.push({ code: 'ORDER_LOCK_DUPLICATE_TARGET', targetId: itemId })
    else { planned[position] = byId.get(itemId); used.add(itemId) }
  }
  const remaining = original.filter(item => !used.has(item.menuItemId))
  for (let position = 0; position < planned.length; position += 1) {
    if (planned[position]) continue
    const previous = [...planned.slice(0, position)].reverse().find(Boolean) || request.origin
    remaining.sort((a, b) => distance(previous.placeRef || previous, a.placeRef) - distance(previous.placeRef || previous, b.placeRef) || a.inputOrder - b.inputOrder)
    planned[position] = remaining.shift()
  }
  const originalScore = orderScore(original, request)
  const candidateScore = orderScore(planned, request)
  const useCandidate = !fixedSatisfiedByOriginal || candidateScore.unknownSegments < originalScore.unknownSegments || (candidateScore.unknownSegments === originalScore.unknownSegments && candidateScore.score < originalScore.score)
  const chosen = useCandidate ? planned : original
  const changes = chosen.map((item, index) => item.menuItemId === original[index]?.menuItemId ? null : {
    menuItemId: item.menuItemId,
    fromIndex: original.findIndex(candidate => candidate.menuItemId === item.menuItemId),
    toIndex: index,
    reason: useCandidate ? '基于地点坐标的确定性距离启发式' : '原顺序评分不劣，保留输入顺序'
  }).filter(Boolean)
  return { original, planned: chosen, changes, conflicts, scores: { original: originalScore, planned: orderScore(chosen, request) } }
}

function lockRefsFor(itemId, locks) {
  return locks.filter(lock => lock.targetId === itemId).map(lock => lock.lockId)
}

function fixedTimeLock(itemId, locks) {
  const matches = locks.filter(item => item.targetId === itemId && item.kind === 'time')
  const parsed = matches.map(lock => ({
    lockId: lock.lockId,
    start: plainObject(lock.value) && typeof lock.value.startAt === 'string' ? Date.parse(lock.value.startAt) : NaN,
    end: plainObject(lock.value) && typeof lock.value.endAt === 'string' ? Date.parse(lock.value.endAt) : NaN
  }))
  if (!parsed.length) return { value: null, conflicts: [] }
  const valid = parsed.filter(lock => Number.isFinite(lock.start) && Number.isFinite(lock.end) && lock.start < lock.end)
  const conflicts = parsed.filter(lock => !Number.isFinite(lock.start) || !Number.isFinite(lock.end) || lock.start >= lock.end)
    .map(lock => ({ code: 'TIME_LOCK_INVALID', lockId: lock.lockId, targetId: itemId }))
  const nonMinute = valid.filter(lock => (lock.end - lock.start) % MINUTE !== 0)
  nonMinute.forEach(lock => conflicts.push({ code: 'TIME_LOCK_INVALID', lockId: lock.lockId, targetId: itemId, message: '固定时间锁必须落在整分钟边界' }))
  if (nonMinute.length) return { value: null, conflicts }
  if (valid.length && valid.some(lock => lock.start !== valid[0].start || lock.end !== valid[0].end)) {
    conflicts.push({ code: 'TIME_LOCK_CONFLICT', targetId: itemId, lockIds: valid.map(lock => lock.lockId) })
    return { value: null, conflicts }
  }
  return { value: valid[0] || null, conflicts }
}

function dayWindows(request, days) {
  const startEpoch = Date.parse(request.startAt)
  const endEpoch = Date.parse(request.endBy)
  return days.map((date, index) => ({
    date,
    start: index === 0 ? startEpoch : zonedDateTime(date, '08:00', request.timezone),
    end: index === days.length - 1 ? endEpoch : zonedDateTime(date, '22:00', request.timezone)
  }))
}

function scheduleItems(request, orderedItems, locks) {
  const startEpoch = Date.parse(request.startAt)
  const endEpoch = Date.parse(request.endBy)
  const days = dateKeys(startEpoch, endEpoch, request.timezone)
  const windows = dayWindows(request, days)
  const conflicts = []
  const assumptions = [{ code: 'DEFAULT_ACTIVITY_WINDOW', value: '中间日期按当地 08:00–22:00 作为规划假设', source: 'planning_assumption' }]
  const scheduled = []
  let cursorDay = 0
  let cursor = windows[0].start
  for (const menuItem of orderedItems) {
    const requestedDurationMinutes = Math.max(1, menuItem.visitDuration.minutes)
    const preferredStart = menuItem.preferredWindow ? Date.parse(menuItem.preferredWindow.startAt) : null
    const preferredEnd = menuItem.preferredWindow ? Date.parse(menuItem.preferredWindow.endAt) : null
    const fixedInfo = fixedTimeLock(menuItem.menuItemId, locks)
    const fixed = fixedInfo.value
    conflicts.push(...fixedInfo.conflicts)
    let chosen = null
    if (fixed) {
      const fixedDuration = Math.round((fixed.end - fixed.start) / MINUTE)
      const isOutsideRequest = fixed.start < windows[0].start || fixed.end > windows[windows.length - 1].end
      const isBeforeCursor = fixed.start < cursor
      const violatesPreferred = preferredStart !== null && (fixed.start < preferredStart || fixed.end > preferredEnd)
      if (isOutsideRequest || isBeforeCursor || violatesPreferred) {
        conflicts.push({ code: 'LOCKED_TIME_CONFLICT', menuItemId: menuItem.menuItemId, message: '固定时间锁必须保持原边界，且不能与请求范围、前项或项目窗口冲突' })
      }
      if (fixedDuration !== requestedDurationMinutes) {
        conflicts.push({ code: 'TIME_LOCK_DURATION_CONFLICT', menuItemId: menuItem.menuItemId, requestedDurationMinutes, lockedDurationMinutes: fixedDuration })
      }
      chosen = { dayIndex: Math.max(0, windows.findIndex(window => fixed.start >= window.start && fixed.start <= window.end)), start: fixed.start, end: fixed.end }
      cursorDay = Math.max(cursorDay, chosen.dayIndex)
      cursor = Math.max(cursor, chosen.end)
    } else {
      // Once the cursor has advanced, only the current or a future day may be considered.
      // This prevents a later item from being silently backfilled into an earlier date.
      for (let dayIndex = cursorDay; dayIndex < windows.length; dayIndex += 1) {
        const window = windows[dayIndex]
        const earliest = Math.max(dayIndex === cursorDay ? cursor : window.start, preferredStart || window.start)
        const latestEnd = Math.min(window.end, preferredEnd || window.end)
        const finish = earliest + requestedDurationMinutes * MINUTE
        const intersectsWindow = earliest < latestEnd && finish <= latestEnd && earliest >= window.start
        if (intersectsWindow) { chosen = { dayIndex, start: earliest, end: finish }; break }
      }
      if (!chosen) {
        const preferredIsEarlier = preferredStart !== null && preferredStart < cursor
        const start = cursor
        const end = start + requestedDurationMinutes * MINUTE
        chosen = { dayIndex: Math.min(cursorDay, windows.length - 1), start, end }
        conflicts.push({ code: preferredIsEarlier ? 'TIME_ORDER_CONFLICT' : 'TIME_WINDOW_CONFLICT', menuItemId: menuItem.menuItemId, message: preferredIsEarlier ? '项目窗口早于前项结束时间，禁止回填到更早时间' : '项目无法放入当前有效时间窗口' })
      }
      cursorDay = Math.max(cursorDay, chosen.dayIndex)
      cursor = chosen.end
    }
    scheduled.push({ menuItem, requestedDurationMinutes, ...chosen })
  }
  const itemPlans = scheduled.map(({ menuItem, requestedDurationMinutes, start, end }) => ({
    itemId: menuItem.menuItemId,
    kind: menuItem.stayRequirement === 'lodging' ? 'lodging' : 'poi',
    placeRef: menuItem.placeRef,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    durationMinutes: Math.round((end - start) / MINUTE),
    requestedDurationMinutes,
    reason: menuItem.required ? '用户标记的必去项目' : '按菜单顺序和有效时间安排',
    sourceMenuItemIds: [menuItem.menuItemId],
    lockRefs: lockRefsFor(menuItem.menuItemId, locks),
    quoteRef: null,
    bookingStatus: 'not_booked',
    evidenceRefs: [{ kind: 'menu_input', sourceType: 'manual_verified', sourceRef: menuItem.menuItemId }]
  }))
  const dayPlans = windows.map(window => {
    const itemPlansForDay = itemPlans.filter(item => dateOnly(Date.parse(item.startAt), request.timezone) === window.date)
    return {
      date: window.date,
      cityRefs: [...new Set(itemPlansForDay.map(item => item.placeRef.adcode).filter(Boolean))],
      itemIds: itemPlansForDay.map(item => item.itemId),
      startAt: new Date(window.start).toISOString(),
      endAt: new Date(window.end).toISOString(),
      effectivePlayMinutes: itemPlansForDay.reduce((sum, item) => sum + item.durationMinutes, 0),
      transferMinutes: null,
      assumptions: assumptions.map(item => item.code)
    }
  })
  return { itemPlans, dayPlans, conflicts, assumptions }
}

function transportPoint(name, code, provider) {
  return { provider, providerPlaceId: code || name, name, type: 'train_station', coordinate: null, coordinateSystem: 'unknown', adcode: null }
}

function transportIso(date, time, timezone) {
  return new Date(zonedDateTime(date, time, timezone)).toISOString()
}

// 每个 selected quote 生成一个 carrier leg。
// demand 决定 toItemId（endDestination 段保持 null）；demandId 是 server-owned 段标识，
// 一旦可得就必须与 selected quote 的 demandId 一致，禁止改写成别的段。
function legFromQuote(quote, request, demand = null, demandId = null) {
  const departureAt = transportIso(quote.departureDate, quote.departureTime, request.timezone)
  const arrivalAt = transportIso(quote.arrivalDate || quote.departureDate, quote.arrivalTime, request.timezone)
  const status = quote.availability === 'available' ? 'available' : quote.availability === 'sold_out' ? 'blocked' : 'unknown'
  const resolvedDemandId = [demandId, quote.demandId].find(value => typeof value === 'string' && value) || null
  return {
    legId: `leg:${quote.quoteId}`,
    from: transportPoint(quote.from, quote.fromCode, quote.provider),
    to: transportPoint(quote.to, quote.toCode, quote.provider),
    fromItemId: null,
    toItemId: demand && typeof demand.targetMenuItemId === 'string' && demand.targetMenuItemId ? demand.targetMenuItemId : null,
    mode: quote.mode || 'train',
    serviceDate: quote.departureDate,
    departureAt,
    arrivalAt,
    serviceNo: quote.serviceNo || null,
    ...(resolvedDemandId ? { demandId: resolvedDemandId } : {}),
    quoteRef: quote.quoteId,
    routeGeometry: { type: 'none', source: 'provider_geometry_not_returned', display: '供应商未返回路线几何，不绘制连线' },
    provenance: structuredClone(quote.provenance),
    status
  }
}

function endpointMatches(demandEndpoint, quoteName, quoteCode) {
  if (!demandEndpoint) return false
  return Boolean((demandEndpoint.code && quoteCode && demandEndpoint.code === quoteCode) || (demandEndpoint.name && quoteName && demandEndpoint.name === quoteName))
}

function transportEpoch(date, time, timezone) {
  try {
    return zonedDateTime(date, time, timezone)
  } catch {
    return NaN
  }
}

// 单段校验：demand 是这一段自己的显式交通需求（不是全局单数字段）。
// 多段化不得删除任何旧校验项。
function transportQuoteReason(quote, request, demand, nowEpoch) {
  const detail = quote.transportDetail
  if (!demand) return 'transport_demand_required'
  if (!detail || detail.mode !== demand.mode) return 'mode_mismatch'
  const preferredModes = Array.isArray(request.transportPreferences.modes) ? request.transportPreferences.modes : []
  if (preferredModes.length && !preferredModes.includes(detail.mode)) return 'mode_not_in_preferences'
  if (detail.departureDate !== demand.serviceDate) return 'service_date_mismatch'
  if (!endpointMatches(demand.departure, detail.from, detail.fromCode)) return 'departure_station_mismatch'
  if (!endpointMatches(demand.arrival, detail.to, detail.toCode)) return 'arrival_station_mismatch'
  if (quote.availability !== 'available') return `availability_${quote.availability}`
  if (detail.serviceCanBook === false) return 'service_not_bookable'
  if (!detail.arrivalDate || !detail.arrivalTime || !detail.departureTime) return 'arrival_or_departure_time_unknown'
  const departureAt = transportEpoch(detail.departureDate, detail.departureTime, request.timezone)
  const arrivalAt = transportEpoch(detail.arrivalDate, detail.arrivalTime, request.timezone)
  if (!Number.isFinite(departureAt) || !Number.isFinite(arrivalAt) || arrivalAt <= departureAt) return 'transport_time_invalid'
  const demandWindow = demand.departureWindow || null
  const requestStart = Date.parse(request.startAt)
  const requestEnd = Date.parse(request.endBy)
  const allowedStart = Math.max(requestStart, demandWindow ? Date.parse(demandWindow.startAt) : Number.NEGATIVE_INFINITY)
  const allowedEnd = Math.min(requestEnd, demandWindow ? Date.parse(demandWindow.endAt) : Number.POSITIVE_INFINITY)
  if (departureAt < allowedStart) return 'departure_before_allowed_window'
  if (departureAt > allowedEnd) return 'departure_after_allowed_window'
  if (arrivalAt > requestEnd) return 'arrival_after_allowed_window'
  if (request.transportPreferences.allowNightTrain === false && dateOnly(arrivalAt, request.timezone) !== detail.departureDate) return 'overnight_not_allowed'
  if (demand.seatTypeCode) {
    const seat = detail.seatOptions.find(item => item && item.typeCode === demand.seatTypeCode)
    if (!seat) return 'seat_type_unmatched'
    if (!detail.selectedSeat || detail.selectedSeat.typeCode !== demand.seatTypeCode) return 'seat_selection_mismatch'
  }
  const selectedSeat = detail.selectedSeat
  const rawAvailability = selectedSeat && selectedSeat.rawAvailability !== undefined ? String(selectedSeat.rawAvailability).trim() : null
  if (rawAvailability && /^\d+$/.test(rawAvailability) && Number(rawAvailability) < request.travelers.adults + request.travelers.children.length) return 'passenger_count_exceeds_availability'
  if (quote.supplierExpiresAt && Date.parse(quote.supplierExpiresAt) <= nowEpoch) return 'quote_expired'
  return null
}

// 在每个 demand 自己的候选池内选票；不同 demand 的 quote 永远不互相竞争。
function selectTransportQuote(quotes, request, demand, nowEpoch) {
  const candidates = []
  const diagnostics = []
  quotes.forEach((quote, index) => {
    const reason = transportQuoteReason(quote, request, demand, nowEpoch)
    if (reason) diagnostics.push({ quoteId: quote.quoteId, reason })
    else candidates.push({ quote, index })
  })
  candidates.sort((a, b) => (a.quote.amountMinor === null ? 1 : b.quote.amountMinor === null ? -1 : a.quote.amountMinor - b.quote.amountMinor) || Date.parse(a.quote.fetchedAt) - Date.parse(b.quote.fetchedAt) || a.quote.quoteId.localeCompare(b.quote.quoteId))
  return { selected: candidates[0] || null, diagnostics }
}

function selectedQuoteList(quotes) {
  if (Array.isArray(quotes)) return quotes.filter(Boolean)
  return quotes ? [quotes] : []
}

// 单段已知下界：per_person 按成人计价，per_party 直接取整笔。
// 金额未知或计价基础未知时返回 null —— 该段未知，绝不按 0 计入。
function quoteContribution(quote, adults) {
  if (!quote || !Number.isInteger(quote.amountMinor)) return null
  if (quote.priceBasis === 'per_person') return quote.amountMinor * adults
  if (quote.priceBasis === 'per_party') return quote.amountMinor
  return null
}

// 多段费用聚合：selectedQuotes 是本次真正选中的 transport 报价数组。
// options.missingTransportDemands 表示「有显式交通需求但没有选中报价」的段数，
// 这些段一律不计 0，也不允许把整体标成 fully known。
function costSummary(request, selectedQuotes, options = {}) {
  const quotes = selectedQuoteList(selectedQuotes)
  const adults = request.travelers.adults
  const children = request.travelers.children.length
  const missingTransportDemands = Number.isInteger(options.missingTransportDemands) && options.missingTransportDemands > 0
    ? options.missingTransportDemands : 0
  const contributions = quotes.map(quote => quoteContribution(quote, adults))
  const knownContributions = contributions.filter(value => Number.isInteger(value))
  const adultSubtotal = knownContributions.length ? knownContributions.reduce((sum, value) => sum + value, 0) : null
  const anyUnknownContribution = contributions.some(value => !Number.isInteger(value))
  // 任一 per_person 报价在带儿童时儿童价未知：不能冒充精确总价，只给保守上界。
  const hasUnknownChildPrice = children > 0 && quotes.some(quote => Number.isInteger(quote.amountMinor) && quote.priceBasis === 'per_person')
  const transportFullyKnown = quotes.length > 0 && !anyUnknownContribution && missingTransportDemands === 0 && !hasUnknownChildPrice
  const knownTotal = transportFullyKnown ? adultSubtotal : null
  // 有未知金额的段时不产出区间：只按已知段求和会把缺失段当成 0。
  const estimatedRange = quotes.length && !anyUnknownContribution && hasUnknownChildPrice ? {
    minMinor: adultSubtotal,
    maxMinor: quotes.reduce((sum, quote) => sum + (quote.priceBasis === 'per_person' ? quote.amountMinor * (adults + children) : quote.amountMinor), 0),
    basis: 'children_price_unknown_upper_bound_assumes_adult_price'
  } : null
  const transportStatus = transportFullyKnown ? 'known' : knownContributions.length ? 'partial' : 'unknown'
  const transportBasis = !quotes.length ? 'quote_missing'
    : new Set(quotes.map(quote => quote.priceBasis)).size === 1 ? quotes[0].priceBasis : 'mixed'
  const categoryBreakdown = [
    { category: 'transport', amountMinor: adultSubtotal, status: transportStatus, basis: transportBasis },
    { category: 'lodging', amountMinor: request.lodgingPreferences.required === false ? 0 : null,
      status: request.lodgingPreferences.required === false ? 'known' : 'unknown', basis: request.lodgingPreferences.required === false ? 'not_required_by_user' : 'hotel_cooperation_required' },
    { category: 'local_transfer', amountMinor: null, status: 'unknown', basis: 'not_queried' }
  ]
  const budget = request.budget.amountMinor
  const includedCategories = Array.isArray(request.budget.includedCategories) ? request.budget.includedCategories : []
  for (const category of new Set(includedCategories)) {
    if (!categoryBreakdown.some(row => row.category === category)) {
      categoryBreakdown.push({ category, amountMinor: null, status: 'unknown', basis: 'not_implemented' })
    }
  }
  const included = new Set(includedCategories)
  const transportIncluded = included.has('transport')
  const unknownIncludedCategories = categoryBreakdown.filter(row => included.has(row.category) && row.amountMinor === null).map(row => row.category)
  // 币种：任一纳入比较的段与预算币种不一致，就不得冒充可比。
  const mismatchedCurrency = quotes.some(quote => quote.currency !== request.budget.currency)
  // 预算 basis 与报价 basis 的兼容性：person 预算只接受 per_person；party 预算两者皆可。
  const basisCompatible = quote => request.budget.basis === 'person'
    ? quote.priceBasis === 'per_person'
    : request.budget.basis === 'party' ? ['per_person', 'per_party'].includes(quote.priceBasis) : false
  let knownIncludedMinor = 0
  // 只有「所有纳入比较的 transport 段都可比较」时才允许给出精确比较结论；
  // 缺失段或不可比段存在时保守地不给结论，也绝不把缺失段当 0。
  let comparable = true
  if (transportIncluded) {
    if (!quotes.length || missingTransportDemands > 0 || mismatchedCurrency) comparable = false
    for (const quote of quotes) {
      const contribution = quoteContribution(quote, adults)
      if (!Number.isInteger(contribution) || !basisCompatible(quote)) { comparable = false; continue }
      knownIncludedMinor += request.budget.basis === 'person' ? quote.amountMinor : contribution
    }
  }
  let budgetComparison
  if (budget === null) budgetComparison = { status: 'unknown', budgetMinor: budget, budgetBasis: request.budget.basis, knownMinor: comparable ? knownIncludedMinor : null, includedCategories }
  else if (!includedCategories.length) budgetComparison = { status: 'not_in_scope', budgetMinor: budget, budgetBasis: request.budget.basis, knownMinor: 0, includedCategories }
  else if (transportIncluded && mismatchedCurrency) budgetComparison = { status: 'unknown_currency', budgetMinor: budget, budgetBasis: request.budget.basis, knownMinor: null, quoteCurrency: quotes.length ? quotes[0].currency : null, quoteCurrencies: [...new Set(quotes.map(quote => quote.currency))], includedCategories }
  else if (comparable && knownIncludedMinor > budget) budgetComparison = { status: 'hard_exceeded', budgetMinor: budget, budgetBasis: request.budget.basis, knownMinor: knownIncludedMinor, includedCategories }
  else if (unknownIncludedCategories.length || (hasUnknownChildPrice && transportIncluded)) budgetComparison = { status: hasUnknownChildPrice && transportIncluded && !unknownIncludedCategories.includes('lodging') && !unknownIncludedCategories.includes('local_transfer') ? 'unknown_child_price' : 'unknown_included_categories', budgetMinor: budget, budgetBasis: request.budget.basis, knownMinor: comparable ? knownIncludedMinor : null, unknownCategories: unknownIncludedCategories, includedCategories }
  else if (comparable) budgetComparison = { status: 'known_within_partial_scope', budgetMinor: budget, budgetBasis: request.budget.basis, knownMinor: knownIncludedMinor, includedCategories }
  else budgetComparison = { status: 'unknown_basis', budgetMinor: budget, budgetBasis: request.budget.basis, knownMinor: null, includedCategories }
  return {
    knownTotal,
    knownSubtotalMinor: adultSubtotal,
    estimatedRange,
    unknownCategories: categoryBreakdown.filter(row => row.status !== 'known').map(row => row.category),
    categoryBreakdown,
    budgetComparison
  }
}

function buildRulePlan({ request, transportQuotes = [], now = Date.now, planId = `plan-${Date.now()}` } = {}) {
  const normalized = normalizePlanRequest(request).normalizedRequest
  const quotes = transportQuotes.map(value => quoteFromProvider(value, { adults: normalized.travelers.adults, children: normalized.travelers.children }))
  const selection = selectTransportQuote(quotes, normalized, normalized.transportDemand, Number(now()))
  const selectedQuote = selection.selected ? selection.selected.quote : null
  const legs = selectedQuote ? [legFromQuote(transportQuotes[selection.selected.index], normalized, normalized.transportDemand)] : []
  const schedulingRequest = arrivalConstrainedRequest(normalized, legs)
  const ordered = orderPlan(schedulingRequest.menuItems, schedulingRequest)
  const baselineSchedule = scheduleItems(schedulingRequest, ordered.original, normalized.locks)
  const candidateSchedule = ordered.planned.map(item => item.menuItemId).join('|') === ordered.original.map(item => item.menuItemId).join('|')
    ? baselineSchedule
    : scheduleItems(schedulingRequest, ordered.planned, normalized.locks)
  const baselineHard = checkHardConstraints({ request: schedulingRequest, orderedItems: ordered.original, schedule: baselineSchedule })
  const candidateHard = checkHardConstraints({ request: schedulingRequest, orderedItems: ordered.planned, schedule: candidateSchedule })
  const baselineFeasible = baselineHard.errors.length === 0
  const candidateFeasible = candidateHard.errors.length === 0
  const useCandidate = ordered.planned.map(item => item.menuItemId).join('|') !== ordered.original.map(item => item.menuItemId).join('|') && !(baselineFeasible && !candidateFeasible)
  const selectedOrder = useCandidate ? ordered.planned : ordered.original
  const scheduled = useCandidate ? candidateSchedule : baselineSchedule
  // plannedOrder 定稿后才能反推出 server-owned demandId（routeDemand 由最终顺序生成）。
  // 只有能唯一对应到某个 route demand 时才写，避免伪造段标识。
  // legacy 单段保持 provider 原始 quoteId 不变，但 selected quote 必须与 carrier leg 同源：
  // 两者写同一个 demandId，leg.quoteRef 继续指向该 selected quote（B3-3-R1 §1.4）。
  if (legs.length) {
    const demandId = serverDemandIdFor(selectedOrder.map(item => item.menuItemId), normalized.transportDemand)
    if (demandId) {
      legs.forEach(leg => { leg.demandId = demandId })
      // 只同步本次构建出的 plan 报价对象，不污染入参 transportQuotes。
      for (const quote of quotes) if (selectedQuote && quote.quoteId === selectedQuote.quoteId) quote.demandId = demandId
    }
  }
  const fallbackWarning = !useCandidate && ordered.planned.map(item => item.menuItemId).join('|') !== ordered.original.map(item => item.menuItemId).join('|') && baselineFeasible && !candidateFeasible
    ? { code: 'OPTIMIZATION_FALLBACK_TO_FEASIBLE_BASELINE', message: '优化顺序不可行，已回退到原始可行顺序' }
    : null
  const warnings = []
  // 交通类诊断带上已选路段标识，让展示投影能把 note.sectionId 定位到对应 leg section（contract §9.2）。
  const selectedLegId = legs.length ? legs[0].legId : null
  if (selectedQuote) warnings.push({ code: normalized.transportDemand.targetMenuItemId ? 'STATION_TRANSFERS_UNCONFIRMED' : 'TRANSPORT_PLACEMENT_UNCONFIRMED',
    ...(selectedLegId ? { legId: selectedLegId } : {}),
    message: normalized.transportDemand.targetMenuItemId ? '已按交通到达下限顺延绑定地点；出发地到上车站、到达站到地点的接驳尚未确认' : '交通报价尚未绑定到菜单中的具体到达地点，不能视为完整联程' })
  if (!quotes.length) warnings.push({ code: 'TRANSPORT_QUOTE_MISSING', message: '未提供真实交通报价，交通安排待查询' })
  else if (!selectedQuote) {
    warnings.push({ code: normalized.transportDemand ? 'TRANSPORT_QUOTE_UNSELECTED' : 'TRANSPORT_QUOTE_UNBOUND', message: normalized.transportDemand ? '报价均未通过日期、路线、席别、库存或有效期校验' : '存在交通报价，但未提供显式 transportDemand，禁止猜测绑定' })
    selection.diagnostics.forEach(item => warnings.push({ code: 'TRANSPORT_QUOTE_REJECTED', quoteId: item.quoteId, reason: item.reason, message: '报价未被选中' }))
  }
  if (quotes.some(quote => quote.environment === 'test')) warnings.push({ code: 'TEST_ENVIRONMENT',
    // 只有被选中的路段确实来自测试环境时才绑定，避免把提示挂到生产路段上。
    ...(selectedQuote && selectedQuote.environment === 'test' && selectedLegId ? { legId: selectedLegId } : {}),
    message: '交通证据来自测试环境，不能证明生产可购买' })
  if (normalized.lodgingPreferences.required !== false) warnings.push({ code: 'HOTEL_QUOTE_MISSING', message: '酒店合作尚未完成，房型、库存和价格待查询' })
  warnings.push({ code: 'TRANSFER_QUOTE_MISSING', message: '城市内接驳未查询，时间线需要人工复核' })
  if (fallbackWarning) warnings.push(fallbackWarning)
  const costs = costSummary(normalized, selectedQuote)
  const budgetErrors = costs.budgetComparison.status === 'hard_exceeded' && normalized.budget.strict
    ? [{ code: 'BUDGET_EXCEEDED', message: '已知交通费用超过严格预算上限', budgetMinor: normalized.budget.amountMinor, knownMinor: costs.budgetComparison.knownMinor }]
    : []
  const finalHard = checkHardConstraints({ request: normalized, orderedItems: selectedOrder, schedule: scheduled })
  const planErrors = uniqueErrors([...finalHard.errors, ...budgetErrors])
  planErrors.push(...arrivalErrors({ inputSnapshot: normalized, items: scheduled.itemPlans, legs }))
  const orderCheckFailed = finalHard.checks.orderLocks.length > 0
  const timeCheckFailed = finalHard.checks.timeLocks.length > 0 || finalHard.checks.timeline.length > 0 || finalHard.checks.timeWindows.length > 0
  const transportBasisText = costs.categoryBreakdown.find(row => row.category === 'transport')?.basis || 'unknown'
  const validation = {
    errors: planErrors,
    warnings,
    assumptions: scheduled.assumptions,
    independentChecks: [
      { check: 'request_schema', status: 'passed', details: 'normalizePlanRequest 已完成字段、时区和日期校验' },
      { check: 'hard_constraints', status: finalHard.errors.length ? 'failed' : 'passed', details: finalHard.errors.length ? '原顺序、优化候选和最终输出均经过同一硬约束检查，冲突已记录' : '原顺序、优化候选和最终输出均经过同一锁、时间窗和时间轴检查' },
      { check: 'order_locks', status: orderCheckFailed ? 'failed' : 'passed', details: orderCheckFailed ? '共用硬约束检查发现顺序锁冲突，已记录到 validation.errors' : '原顺序/优化候选/最终输出均使用同一顺序锁检查' },
      { check: 'time_windows', status: timeCheckFailed ? 'failed' : 'passed', details: timeCheckFailed ? '共用硬约束检查发现固定锁、时间窗或时间轴冲突，已记录到 validation.errors' : '原顺序/优化候选/最终输出均使用同一时间硬约束检查' },
      { check: 'amount_basis', status: costs.budgetComparison.status === 'hard_exceeded' ? 'failed' : 'passed', details: `按 ${normalized.budget.basis} 预算与 ${transportBasisText} 报价基础计算，未知人群费用不冒充精确总价` },
      { check: 'transport_quote_binding', status: selectedQuote ? 'passed' : 'failed', details: selectedQuote ? '已校验显式交通需求、日期、路线、库存、席别和有效期' : '没有报价通过显式交通需求绑定校验' }
    ]
  }
  // 可执行性只被 action_required 及以上影响；HOTEL_QUOTE_MISSING / TRANSFER_QUOTE_MISSING /
  // TRANSPORT_QUOTE_MISSING 等 info 级缺口不再单独把方案降为 needs_review。
  const feasibility = computeFeasibility(validation.errors, warnings)
  const dataMode = quotes.length ? 'mixed' : 'manual'
  const timestamp = new Date(now()).toISOString()
  const plan = {
    id: planId,
    schemaVersion: 'real-travel-plan.v1',
    version: 1,
    inputSnapshot: normalized,
    originalOrder: ordered.original.map(item => item.menuItemId),
    plannedOrder: selectedOrder.map(item => item.menuItemId),
    orderChanges: useCandidate ? ordered.changes : [],
    days: scheduled.dayPlans,
    items: scheduled.itemPlans,
    legs,
    quotes,
    locks: normalized.locks,
    costSummary: costs,
    validation,
    dataCoverage: {
      schedule: true,
      transportQuote: quotes.length > 0,
      lodgingQuote: false,
      poiFacts: false,
      transferFacts: false,
      availability: Boolean(selectedQuote)
    },
    provenance: quotes.map(quote => quote.provenance),
    taskStatus: 'succeeded',
    feasibility,
    dataMode,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  return validatePlan(plan)
}

function collectPoolQuote(pool, seenQuoteIds, quote) {
  if (!quote || typeof quote.quoteId !== 'string' || seenQuoteIds.has(quote.quoteId)) return
  seenQuoteIds.add(quote.quoteId)
  pool.push(quote)
}

// ---------------------------------------------------------------- plan 内段级 quote 身份（B3-3-R1）

// demandId 是服务端生成的 JSON.stringify([fromStopId, toStopId])。
// 把它规范化成稳定、可读、可逆的短标签：
// - 只保留 [A-Za-z0-9_.:-]，其它字符（含 '%' 本身）按 %XX 转义，映射保持单射；
// - 分隔符 '>' 永远不会出现在组件内部，因此不同 demand 一定得到不同标签；
// - 不依赖数组顺序、不使用站名模糊匹配、不引入随机 UUID。
function escapeScopeToken(value) {
  return value.replace(/[^A-Za-z0-9_.:-]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

function demandScopeLabel(demandId) {
  if (typeof demandId !== 'string' || !demandId) return null
  try {
    const parsed = JSON.parse(demandId)
    if (Array.isArray(parsed) && parsed.length >= 2 && parsed.every(value => typeof value === 'string' && value)) {
      return parsed.map(escapeScopeToken).join('>')
    }
  } catch {
    // 非 JSON 形状的 demandId 走下面的兜底编码，仍然稳定且非空。
  }
  // 'raw:' 前缀让兜底标签永远不会与组件列表标签相撞（后者必含 '>'）。
  return `raw:${escapeScopeToken(demandId)}`
}

// plan 内段级 quoteId = provider 原始 quoteId + 本段 demand 作用域。
// 注意：provider 原始身份生成规则不改（juhe-train.js 不动），这里只在 planner 投影层保证
// 「同一 plan 内 quoteId 唯一」，使同一车次被两个不同 demand 查询时不会互相覆盖或去重。
// demandId 不可用时退化为原始 quoteId（legacy 单段路径即走此分支）。
function scopedTransportQuoteId(rawQuoteId, demandId) {
  if (typeof rawQuoteId !== 'string' || !rawQuoteId) return null
  const label = demandScopeLabel(demandId)
  return label ? `${rawQuoteId}@${label}` : rawQuoteId
}

// plan.quotes 中的段级报价：返回副本，不改写传入的 provider 报价对象。
function scopedPlanQuote(quote, demandId) {
  const quoteId = scopedTransportQuoteId(quote.quoteId, demandId)
  if (!quoteId) throw planningError('INVALID_PLAN', '交通报价缺少可用的 quoteId，无法生成段级身份', 500)
  return { ...quote, quoteId, demandId }
}

// legFromQuote 需要 provider 行的扁平字段（from/to/departureDate...），因此单独做作用域化副本。
function scopedQuoteRow(row, demandId) {
  const quoteId = scopedTransportQuoteId(row.quoteId, demandId)
  if (!quoteId) throw planningError('INVALID_PLAN', '交通报价缺少可用的 quoteId，无法生成段级身份', 500)
  return { ...row, quoteId, demandId }
}

// ---------------------------------------------------------------- 交通段失败状态映射（B3-4 §5）

// B3-2 的机器状态 → 受控公共 code。前端只消费 code，不读 provider status 或 message。
// 冻结映射（round-03-workbuddy-b3-4.md §5）：
//   no_quotes → TRANSPORT_NO_QUOTES            budget_exhausted → TRANSPORT_QUERY_BUDGET_EXHAUSTED
//   out_of_window → TRANSPORT_QUERY_OUT_OF_WINDOW   disabled → TRANSPORT_PROVIDER_DISABLED
//   not_configured → TRANSPORT_PROVIDER_NOT_CONFIGURED  unavailable → TRANSPORT_QUERY_UNAVAILABLE
//   not_queried / cancelled → TRANSPORT_NOT_QUERIED  unbound / ambiguous → TRANSPORT_QUOTE_UNBOUND
//   hadQuotes → TRANSPORT_QUOTE_UNSELECTED（有报价但全部被 selector 拒绝）
//   其余未映射状态保持 TRANSPORT_QUOTE_MISSING 兜底，绝不按「无票」静默处理。
const TRANSPORT_SEGMENT_STATUS_CODES = Object.freeze({
  queried: 'TRANSPORT_QUOTE_MISSING',
  no_quotes: 'TRANSPORT_NO_QUOTES',
  out_of_window: 'TRANSPORT_QUERY_OUT_OF_WINDOW',
  disabled: 'TRANSPORT_PROVIDER_DISABLED',
  not_configured: 'TRANSPORT_PROVIDER_NOT_CONFIGURED',
  budget_exhausted: 'TRANSPORT_QUERY_BUDGET_EXHAUSTED',
  unavailable: 'TRANSPORT_QUERY_UNAVAILABLE',
  unbound: 'TRANSPORT_QUOTE_UNBOUND',
  ambiguous: 'TRANSPORT_QUOTE_UNBOUND',
  cancelled: 'TRANSPORT_NOT_QUERIED',
  not_queried: 'TRANSPORT_NOT_QUERIED'
})

// 受控内部说明文案：只用于后端诊断，不进入 display（display 走 CODE_TEXT）。
const TRANSPORT_SEGMENT_WARNING_TEXT = Object.freeze({
  TRANSPORT_QUOTE_UNSELECTED: '报价均未通过日期、路线、席别、库存或有效期校验',
  TRANSPORT_QUOTE_UNBOUND: '交通需求没有唯一绑定到路段，禁止猜测绑定',
  TRANSPORT_NO_QUOTES: '该段交通未查到可用报价',
  TRANSPORT_QUERY_BUDGET_EXHAUSTED: '该段交通查询额度已用完，未完成查询',
  TRANSPORT_QUERY_OUT_OF_WINDOW: '该段日期超出当前交通查询范围',
  TRANSPORT_PROVIDER_DISABLED: '该段交通方式当前未启用查询',
  TRANSPORT_PROVIDER_NOT_CONFIGURED: '该段交通数据源尚未配置',
  TRANSPORT_QUERY_UNAVAILABLE: '该段交通查询暂不可用',
  TRANSPORT_NOT_QUERIED: '该段交通尚未查询',
  TRANSPORT_QUOTE_MISSING: '该段交通报价尚未取得，交通安排待查询'
})

function transportSegmentWarningCode(outcome) {
  if (!outcome || typeof outcome !== 'object') return 'TRANSPORT_QUOTE_MISSING'
  // 有候选但全被拒：状态可能是 queried，必须优先表达「未通过校验」。
  if (outcome.hadQuotes) return 'TRANSPORT_QUOTE_UNSELECTED'
  return TRANSPORT_SEGMENT_STATUS_CODES[outcome.status] || 'TRANSPORT_QUOTE_MISSING'
}

// B3-3：把 B3-2 产出的 transportEvidence[] 投影成 planner 侧的多段交通安排。
//
// 约束：
// - 纯函数：不修改传入的 plan / request / transportEvidence，返回新的 plan；
// - 每个 demand 各自成池，逐段独立选票，禁止跨 demand 选票或按站名/顺序猜绑定；
// - plannedOrder 完全沿用 base plan，不重跑顺序优化器，不自动换下一班车；
// - endDestination 段只生成 carrier leg，不移动任何 activity；
// - 缺失段不计 0，成功段不因其它段失败被抹掉。
//
// 本批按任务要求不接回 pipeline 最终输出，由 B3-4 负责接线与解除 route audit 阻断。
function applyTransportEvidence({ plan, request = null, transportEvidence = [], now = Date.now } = {}) {
  if (!plainObject(plan)) throw planningError('INVALID_PLAN', 'plan 必须是对象', 500)
  const snapshot = plainObject(request) ? normalizePlanRequest(request).normalizedRequest : plan.inputSnapshot
  if (!plainObject(snapshot)) throw planningError('INVALID_CONSTRAINTS', 'applyTransportEvidence 需要 request 或 plan.inputSnapshot', 500)
  const nowEpoch = typeof now === 'function' ? Number(now()) : Number(now)
  const next = structuredClone(plan)
  const plannedOrder = Array.isArray(next.plannedOrder) ? [...next.plannedOrder] : []
  const demands = canonicalTransportDemands(snapshot)
  const byTargetStopId = demandsByTargetStopId(demands)
  const occupancy = { adults: snapshot.travelers.adults, children: snapshot.travelers.children }

  const selections = []
  const outcomeById = new Map()
  const pool = []
  const seenQuoteIds = new Set()
  // 无法归属到显式交通需求的 evidence（unbound / demandId 解析不到）与跨段报价拒绝，
  // 都保留独立诊断，绝不用站名相似度或数组顺序猜出归属。
  const unboundEvidence = []
  const rejectedQuotes = []
  const selectionRejections = []
  const seenEvidenceDemandIds = new Set()

  for (const entry of Array.isArray(transportEvidence) ? transportEvidence : []) {
    if (!plainObject(entry)) continue
    const demandId = typeof entry.demandId === 'string' && entry.demandId ? entry.demandId : null
    const status = typeof entry.status === 'string' ? entry.status : 'unavailable'
    const rows = Array.isArray(entry.quotes) ? entry.quotes : []
    if (!demandId) {
      unboundEvidence.push({ reason: `evidence_${status}` })
      continue
    }
    const demand = resolveDemandByStopId(byTargetStopId, demandId)
    if (!demand) {
      unboundEvidence.push({ reason: 'transport_demand_unresolved' })
      outcomeById.set(demandId, { demandId, status: 'unbound', selected: false, hadQuotes: rows.length > 0 })
      continue
    }
    // 同一 demand 只有一个候选池；重复 evidence 视为重复输入，第一次的结论为准。
    if (seenEvidenceDemandIds.has(demandId)) continue
    seenEvidenceDemandIds.add(demandId)
    const segmentPool = []
    for (const row of rows) {
      if (!plainObject(row)) continue
      // 只接受本段自己的报价：跨 demand 的报价一律拒绝，绝不混池比价。
      if (row.demandId !== demandId) {
        rejectedQuotes.push({ quoteId: typeof row.quoteId === 'string' ? row.quoteId : null })
        continue
      }
      const quote = quoteFromProvider(row, occupancy)
      // scoped 是进入 plan 的段级身份（raw quoteId + demand 作用域）；
      // quote 保持 provider 原始身份，仅用于本段内的候选排序。
      segmentPool.push({ raw: row, quote, scoped: scopedPlanQuote(quote, demandId) })
    }
    // plan.quotes 收集所有进入本段候选池的报价。去重键是 scoped quoteId，因此
    // 不同 demand 即使 provider raw quoteId 完全相同也各自保留，不会被静默去重。
    segmentPool.forEach(entry => collectPoolQuote(pool, seenQuoteIds, entry.scoped))
    if (status !== 'queried' || !segmentPool.length) {
      outcomeById.set(demandId, { demandId, status, selected: false, hadQuotes: segmentPool.length > 0 })
      continue
    }
    // 选票仍按 provider 原始身份排序（价格 → fetchedAt → quoteId），
    // 保证 scoped identity 不改变同一段内的候选顺序。
    const selection = selectTransportQuote(segmentPool.map(entry => entry.quote), snapshot, demand, nowEpoch)
    const scopedIdByRawId = new Map(segmentPool.map(entry => [entry.quote.quoteId, entry.scoped.quoteId]))
    selection.diagnostics.forEach(item => selectionRejections.push({ demandId, quoteId: scopedIdByRawId.get(item.quoteId) || item.quoteId, reason: item.reason }))
    if (!selection.selected) {
      outcomeById.set(demandId, { demandId, status: 'queried', selected: false, hadQuotes: true })
      continue
    }
    outcomeById.set(demandId, { demandId, status: 'queried', selected: true, hadQuotes: true })
    const chosen = segmentPool[selection.selected.index]
    selections.push({ demandId, demand, raw: chosen.raw, quote: chosen.scoped })
  }

  // 显式需求是「权威清单」：每条需求都必须给出结论，没有 evidence 的段标成 not_queried。
  const segments = demands.map(demand => {
    const demandId = serverDemandIdFor(plannedOrder, demand)
    const outcome = (demandId && outcomeById.get(demandId)) || { demandId, status: 'not_queried', selected: false, hadQuotes: false }
    return { demand, demandId, outcome, selection: null }
  })
  const selectionByDemandId = new Map(selections.map(item => [item.demandId, item]))
  for (const segment of segments) if (segment.demandId) segment.selection = selectionByDemandId.get(segment.demandId) || null

  // legs：保留 base plan 中不被本次选票取代的 leg，再追加本次选中的 carrier leg。
  const selectedDemandIds = new Set(selections.map(item => item.demandId))
  const usedLegIds = new Set()
  const keptLegs = []
  for (const leg of Array.isArray(next.legs) ? next.legs : []) {
    if (!plainObject(leg) || typeof leg.legId !== 'string') continue
    // 同一 demand 的旧 leg 由本次重新选票的结果取代，避免同一段出现两条 carrier leg。
    if (typeof leg.demandId === 'string' && selectedDemandIds.has(leg.demandId)) continue
    if (usedLegIds.has(leg.legId)) continue
    usedLegIds.add(leg.legId)
    keptLegs.push(leg)
  }
  const carrierLegs = selections.map(segment => {
    // leg 身份必须与被选中的 plan quote 完全同源：legId / quoteRef 用 scoped quoteId，
    // demandId 用本段 server-owned demandId，绝不借用别的段的身份。
    const leg = legFromQuote(scopedQuoteRow(segment.raw, segment.demandId), snapshot, segment.demand, segment.demandId)
    let legId = leg.legId
    for (let suffix = 2; usedLegIds.has(legId); suffix += 1) legId = `${leg.legId}#${suffix}`
    usedLegIds.add(legId)
    leg.legId = legId
    segment.leg = leg
    return leg
  })
  const legs = [...keptLegs, ...carrierLegs]

  const keptQuoteIds = new Set(keptLegs.map(leg => leg.quoteRef).filter(value => typeof value === 'string'))
  const quotes = (Array.isArray(next.quotes) ? next.quotes : []).filter(quote => quote && keptQuoteIds.has(quote.quoteId))
  for (const quote of pool) if (!quotes.some(value => value.quoteId === quote.quoteId)) quotes.push(quote)

  // 以 base plan 的 plannedOrder 为固定顺序，只按多段 carrier arrival 重算时间安排。
  const constraints = arrivalConstraints(snapshot, legs)
  const schedulingRequest = arrivalConstrainedRequest(snapshot, legs)
  const menuById = new Map(schedulingRequest.menuItems.map(item => [item.menuItemId, item]))
  const orderedItems = plannedOrder.map(itemId => menuById.get(itemId)).filter(Boolean)
  const schedule = scheduleItems(schedulingRequest, orderedItems, schedulingRequest.locks)

  next.legs = legs
  next.quotes = quotes
  next.items = schedule.itemPlans
  next.days = schedule.dayPlans
  next.locks = snapshot.locks
  next.inputSnapshot = structuredClone(snapshot)
  next.provenance = quotes.map(quote => quote.provenance)

  const missingTransportDemands = segments.filter(segment => !segment.selection).length
  const costs = costSummary(snapshot, selections.map(segment => segment.quote), { missingTransportDemands })
  const budgetErrors = costs.budgetComparison.status === 'hard_exceeded' && snapshot.budget.strict
    ? [{ code: 'BUDGET_EXCEEDED', message: '已知交通费用超过严格预算上限', budgetMinor: snapshot.budget.amountMinor, knownMinor: costs.budgetComparison.knownMinor }]
    : []
  const finalHard = checkHardConstraints({ request: snapshot, orderedItems, schedule })
  const planErrors = uniqueErrors([...finalHard.errors, ...budgetErrors])
  planErrors.push(...arrivalErrors(next))

  const warnings = []
  // 交通类诊断带上 legId，让展示投影能把 note.sectionId 定位到对应 leg section。
  for (const segment of segments) {
    if (segment.selection) {
      const leg = segment.selection.leg
      // B3-4-R1：带 selection 的段必然持有 server-owned demandId（没有 demandId 的段根本不会建立
      // selection，见上面的 selectionByDemandId 回填），也就是说它已经完成 route-demand placement。
      // 新 transportDemands[] 里唯一不带 targetMenuItemId 的元素明确表示 endDestination，
      // 其 to stop 就是 destination，因此 `leg.toItemId === null` 是**合法的绑定结果**，
      // 不是「尚未放入完整行程」。两种目标形态真正未知的都只有车站两侧接驳，
      // 所以统一报 STATION_TRANSFERS_UNCONFIRMED，不再按 toItemId 是否为空分流。
      // （TRANSPORT_PLACEMENT_UNCONFIRMED 作为公共 code 保留给真正 placement 未确认的兼容路径。）
      const placed = Boolean(segment.demandId)
      warnings.push({
        code: placed || leg.toItemId ? 'STATION_TRANSFERS_UNCONFIRMED' : 'TRANSPORT_PLACEMENT_UNCONFIRMED',
        legId: leg.legId,
        ...(segment.demandId ? { demandId: segment.demandId } : {}),
        message: !placed
          ? '交通报价尚未绑定到菜单中的具体到达地点，不能视为完整联程'
          : leg.toItemId
            ? '已按交通到达下限顺延绑定地点；出发地到上车站、到达站到地点的接驳尚未确认'
            : '该段已绑定到旅行终点；出发地到上车站、到达站到终点的接驳尚未确认'
      })
      continue
    }
    // 缺口段默认不是 hard blocked，只把真实状态说清楚，不透传 provider message。
    // B3-4：显式交通需求的失败状态必须按机器状态映射到各自的受控 code，
    // 不能全部塌缩成一个泛化的「尚未取得报价」；提供方原文永不进入 code 或文案。
    const code = transportSegmentWarningCode(segment.outcome)
    warnings.push({
      code,
      ...(segment.demandId ? { demandId: segment.demandId } : {}),
      message: TRANSPORT_SEGMENT_WARNING_TEXT[code] || TRANSPORT_SEGMENT_WARNING_TEXT.TRANSPORT_QUOTE_MISSING
    })
  }
  const testSegments = segments.filter(segment => segment.selection && segment.selection.quote.environment === 'test')
  for (const segment of testSegments) {
    // 只有真正被选中的路段才绑定 legId，避免把提示挂到别的段上。
    warnings.push({ code: 'TEST_ENVIRONMENT', legId: segment.selection.leg.legId, ...(segment.demandId ? { demandId: segment.demandId } : {}), message: '交通证据来自测试环境，不能证明生产可购买' })
  }
  if (!testSegments.length && quotes.some(quote => quote.environment === 'test')) {
    warnings.push({ code: 'TEST_ENVIRONMENT', message: '交通证据来自测试环境，不能证明生产可购买' })
  }
  if (snapshot.lodgingPreferences.required !== false) warnings.push({ code: 'HOTEL_QUOTE_MISSING', message: '酒店合作尚未完成，房型、库存和价格待查询' })
  warnings.push({ code: 'TRANSFER_QUOTE_MISSING', message: '城市内接驳未查询，时间线需要人工复核' })
  // 本段池内落选：quoteId 使用 plan 内 scoped 身份，可直接对照 plan.quotes。
  for (const rejection of selectionRejections) {
    warnings.push({ code: 'TRANSPORT_QUOTE_REJECTED', demandId: rejection.demandId, quoteId: rejection.quoteId, reason: rejection.reason, message: '报价未被选中' })
  }
  // 跨 demand 被拒的报价不属于本 plan，无法也不应给出 scoped 身份，因此保留 provider 原始 quoteId。
  for (const rejection of rejectedQuotes) {
    warnings.push({ code: 'TRANSPORT_QUOTE_REJECTED', ...(rejection.quoteId ? { quoteId: rejection.quoteId } : {}), reason: 'quote_demand_id_mismatch', message: '报价未被选中' })
  }
  for (const orphan of unboundEvidence) {
    warnings.push({ code: 'TRANSPORT_QUOTE_UNBOUND', reason: orphan.reason, message: '存在无法绑定到显式交通需求的报价证据，禁止猜测绑定' })
  }
  for (const diagnostic of constraints.diagnostics) warnings.push(diagnostic)

  const assumptions = [...schedule.assumptions]
  if (constraints.constraints.length) {
    assumptions.push({ code: 'TRANSPORT_ARRIVAL_LOWER_BOUND', source: 'transport_evidence', message: '活动开始时间已按所选交通段的真实到达时刻设下界；未更改任何班次时刻，也未重新排序' })
  }
  const orderCheckFailed = finalHard.checks.orderLocks.length > 0
  const timeCheckFailed = finalHard.checks.timeLocks.length > 0 || finalHard.checks.timeline.length > 0 || finalHard.checks.timeWindows.length > 0
  const transportBasisText = costs.categoryBreakdown.find(row => row.category === 'transport')?.basis || 'unknown'
  const carriedChecks = (Array.isArray(next.validation && next.validation.independentChecks) ? next.validation.independentChecks : [])
    .filter(check => check && !['hard_constraints', 'order_locks', 'time_windows', 'amount_basis', 'transport_quote_binding', 'multi_segment_transport'].includes(check.check))
  next.validation = {
    errors: planErrors,
    warnings,
    assumptions,
    independentChecks: [...carriedChecks,
      { check: 'hard_constraints', status: finalHard.errors.length ? 'failed' : 'passed', details: finalHard.errors.length ? '固定顺序重排后仍经过同一硬约束检查，冲突已记录' : '固定 plannedOrder 下重新检查锁、时间窗和时间轴，未发现冲突' },
      { check: 'order_locks', status: orderCheckFailed ? 'failed' : 'passed', details: orderCheckFailed ? '共用硬约束检查发现顺序锁冲突，已记录到 validation.errors' : '沿用 base plan 的 plannedOrder，顺序锁结论不变' },
      { check: 'time_windows', status: timeCheckFailed ? 'failed' : 'passed', details: timeCheckFailed ? '共用硬约束检查发现固定锁、时间窗或时间轴冲突，已记录到 validation.errors' : '多段到达约束已在同一时间硬约束检查下复核' },
      { check: 'amount_basis', status: costs.budgetComparison.status === 'hard_exceeded' ? 'failed' : 'passed', details: `按 ${snapshot.budget.basis} 预算与 ${transportBasisText} 报价基础逐段聚合，缺失段不计 0，未知人群费用不冒充精确总价` },
      { check: 'transport_quote_binding', status: !segments.length || segments.every(segment => segment.selection) ? 'passed' : 'failed', details: !segments.length ? '没有显式交通需求，无需绑定报价' : segments.every(segment => segment.selection) ? '每个显式交通需求都在自己的候选池内选出一条报价' : '存在没有选中报价的显式交通需求，缺失段不计 0' },
      { check: 'multi_segment_transport', status: selections.length ? 'passed' : 'failed', details: selections.length ? `按 demandId 分组产生 ${selections.length} 条 carrier leg，未做跨段选票` : '没有可用的分段交通报价' }
    ]
  }
  next.costSummary = costs
  next.dataCoverage = {
    ...(plainObject(next.dataCoverage) ? next.dataCoverage : {}),
    schedule: true,
    transportQuote: quotes.length > 0,
    availability: selections.length > 0
  }
  next.dataMode = quotes.length ? 'mixed' : 'manual'
  next.taskStatus = plainObject(plan) && typeof plan.taskStatus === 'string' ? plan.taskStatus : 'succeeded'
  next.updatedAt = new Date(nowEpoch).toISOString()
  if (typeof next.createdAt !== 'string') next.createdAt = next.updatedAt
  // 可执行性与 base plan 用同一推导：info 级缺口不降级方案，硬冲突进入 blocked。
  next.feasibility = computeFeasibility(next.validation.errors, next.validation.warnings)
  return validatePlan(next)
}

module.exports = {
  applyTransportEvidence,
  buildRulePlan,
  costSummary,
  dateOnly,
  dateKeys,
  distance,
  legFromQuote,
  orderPlan,
  orderScore,
  scheduleItems,
  scopedTransportQuoteId,
  selectTransportQuote,
  serverDemandIdFor,
  transportQuoteReason,
  zonedDateTime
}
