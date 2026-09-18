const { plainObject } = require('./schema')

const MINUTE = 60 * 1000

function errorKey(error) {
  return [error.code, error.lockId, error.targetId || error.itemId || error.menuItemId, error.position, error.message].join('|')
}

function uniqueErrors(errors) {
  const seen = new Set()
  return errors.filter(error => {
    if (!error || !error.code) return false
    const key = errorKey(error)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function orderLockPosition(lock) {
  if (Number.isInteger(lock.value)) return lock.value
  if (plainObject(lock.value) && Number.isInteger(lock.value.position)) return lock.value.position
  return null
}

function checkOrderLocks(locks, orderedItems, itemIds = orderedItems.map(item => item.menuItemId || item.itemId)) {
  const orderedIds = orderedItems.map(item => item.menuItemId || item.itemId)
  const knownIds = new Set(itemIds)
  const errors = []
  const positions = new Map()
  const targets = new Map()
  for (const lock of Array.isArray(locks) ? locks.filter(item => item && item.kind === 'order') : []) {
    if (!knownIds.has(lock.targetId)) {
      errors.push({ code: 'LOCK_TARGET_NOT_FOUND', lockId: lock.lockId, targetId: lock.targetId })
      continue
    }
    const position = orderLockPosition(lock)
    if (position === null) {
      errors.push({ code: 'ORDER_LOCK_POSITION_REQUIRED', lockId: lock.lockId, targetId: lock.targetId })
      continue
    }
    if (position < 0 || position >= orderedIds.length) {
      errors.push({ code: 'ORDER_LOCK_POSITION_INVALID', lockId: lock.lockId, targetId: lock.targetId, position })
      continue
    }
    if (positions.has(position) && positions.get(position) !== lock.targetId) errors.push({ code: 'ORDER_LOCK_CONFLICT', lockId: lock.lockId, targetId: lock.targetId, position })
    else positions.set(position, lock.targetId)
    if (targets.has(lock.targetId) && targets.get(lock.targetId) !== position) errors.push({ code: 'ORDER_LOCK_DUPLICATE_TARGET', lockId: lock.lockId, targetId: lock.targetId, position })
    else targets.set(lock.targetId, position)
    if (orderedIds[position] !== lock.targetId) errors.push({ code: 'ORDER_LOCK_VIOLATION', lockId: lock.lockId, targetId: lock.targetId, position, actual: orderedIds[position] || null })
  }
  return uniqueErrors(errors)
}

function parseTimeLock(lock) {
  const value = lock && plainObject(lock.value) ? lock.value : null
  const start = value && typeof value.startAt === 'string' ? Date.parse(value.startAt) : NaN
  const end = value && typeof value.endAt === 'string' ? Date.parse(value.endAt) : NaN
  return { lockId: lock && lock.lockId, targetId: lock && lock.targetId, start, end }
}

function checkTimeLocks(locks, items, scheduledItems) {
  const itemMap = new Map((Array.isArray(items) ? items : []).map(item => [item.menuItemId || item.itemId, item]))
  const scheduledMap = new Map((Array.isArray(scheduledItems) ? scheduledItems : []).map(item => [item.itemId || item.menuItemId, item]))
  const groups = new Map()
  const errors = []
  for (const lock of Array.isArray(locks) ? locks.filter(item => item && item.kind === 'time') : []) {
    if (!itemMap.has(lock.targetId)) errors.push({ code: 'LOCK_TARGET_NOT_FOUND', lockId: lock.lockId, targetId: lock.targetId })
    const parsed = parseTimeLock(lock)
    if (!Number.isFinite(parsed.start) || !Number.isFinite(parsed.end) || parsed.start >= parsed.end || (parsed.end - parsed.start) % MINUTE !== 0) {
      errors.push({ code: 'TIME_LOCK_INVALID', lockId: lock.lockId, targetId: lock.targetId })
      continue
    }
    if (!groups.has(lock.targetId)) groups.set(lock.targetId, [])
    groups.get(lock.targetId).push(parsed)
  }
  for (const [targetId, values] of groups) {
    const first = values[0]
    if (values.some(value => value.start !== first.start || value.end !== first.end)) {
      errors.push({ code: 'TIME_LOCK_CONFLICT', targetId, lockIds: values.map(value => value.lockId) })
      continue
    }
    const item = itemMap.get(targetId)
    const requestedDuration = item && item.visitDuration && item.visitDuration.minutes
    const lockedDuration = (first.end - first.start) / MINUTE
    if (Number.isInteger(requestedDuration) && requestedDuration !== lockedDuration) errors.push({ code: 'TIME_LOCK_DURATION_CONFLICT', targetId, requestedDurationMinutes: requestedDuration, lockedDurationMinutes: lockedDuration })
    const scheduled = scheduledMap.get(targetId)
    if (!scheduled) continue
    const actualStart = Date.parse(scheduled.startAt)
    const actualEnd = Date.parse(scheduled.endAt)
    if (actualStart !== first.start || actualEnd !== first.end) errors.push({ code: 'TIME_LOCK_VIOLATION', targetId, lockStartAt: new Date(first.start).toISOString(), lockEndAt: new Date(first.end).toISOString(), actualStartAt: scheduled.startAt, actualEndAt: scheduled.endAt })
  }
  return uniqueErrors(errors)
}

function checkTimeline(itemPlans, request) {
  const errors = []
  const requestStart = request && typeof request.startAt === 'string' ? Date.parse(request.startAt) : NaN
  const requestEnd = request && typeof request.endBy === 'string' ? Date.parse(request.endBy) : NaN
  let previousEnd = null
  for (const item of Array.isArray(itemPlans) ? itemPlans : []) {
    const start = Date.parse(item.startAt)
    const end = Date.parse(item.endAt)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    if (Number.isFinite(requestStart) && start < requestStart || Number.isFinite(requestEnd) && end > requestEnd) errors.push({ code: 'ITEM_OUTSIDE_REQUEST_WINDOW', itemId: item.itemId, startAt: item.startAt, endAt: item.endAt })
    if (previousEnd !== null && start < previousEnd) errors.push({ code: 'TIME_ORDER_CONFLICT', itemId: item.itemId, message: 'plannedOrder 中的实际时间倒退或重叠' })
    previousEnd = Math.max(previousEnd === null ? end : previousEnd, end)
  }
  return uniqueErrors(errors)
}

function checkPreferredWindows(items, itemPlans, timezone) {
  const itemMap = new Map((Array.isArray(items) ? items : []).map(item => [item.menuItemId || item.itemId, item]))
  const errors = []
  for (const planItem of Array.isArray(itemPlans) ? itemPlans : []) {
    const source = itemMap.get(planItem.itemId)
    if (!source) {
      errors.push({ code: 'SOURCE_CONSTRAINT_MISSING', itemId: planItem.itemId })
      continue
    }
    if (!source.preferredWindow) continue
    const start = Date.parse(planItem.startAt)
    const end = Date.parse(planItem.endAt)
    const preferredStart = Date.parse(source.preferredWindow.startAt)
    const preferredEnd = Date.parse(source.preferredWindow.endAt)
    if (Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(preferredStart) && Number.isFinite(preferredEnd) && (start < preferredStart || end > preferredEnd)) {
      errors.push({ code: 'TIME_WINDOW_CONFLICT', itemId: planItem.itemId, message: `项目实际时间不在 preferredWindow 内（${timezone || 'request timezone'}）` })
    }
  }
  return uniqueErrors(errors)
}

function checkHardConstraints({ request, orderedItems, schedule }) {
  const constraintItems = Array.isArray(request && request.menuItems) ? request.menuItems : []
  const itemIds = (Array.isArray(orderedItems) ? orderedItems : []).map(item => item.menuItemId || item.itemId)
  const itemPlans = schedule && Array.isArray(schedule.itemPlans) ? schedule.itemPlans : []
  return {
    errors: uniqueErrors([
      ...(schedule && Array.isArray(schedule.conflicts) ? schedule.conflicts : []),
      ...checkOrderLocks(request && request.locks, orderedItems || [], itemIds),
      ...checkTimeLocks(request && request.locks, constraintItems, itemPlans),
      ...checkTimeline(itemPlans, request),
      ...checkPreferredWindows(constraintItems, itemPlans, request && request.timezone)
    ]),
    checks: {
      orderLocks: checkOrderLocks(request && request.locks, orderedItems || [], itemIds),
      timeLocks: checkTimeLocks(request && request.locks, constraintItems, itemPlans),
      timeline: checkTimeline(itemPlans, request),
      timeWindows: checkPreferredWindows(constraintItems, itemPlans, request && request.timezone)
    }
  }
}

function checkFinalPlanHardConstraints(plan) {
  const request = plan && plainObject(plan.inputSnapshot) ? plan.inputSnapshot : {}
  const itemMap = new Map((Array.isArray(plan && plan.items) ? plan.items : []).map(item => [item.itemId, item]))
  const orderedItems = (Array.isArray(plan && plan.plannedOrder) ? plan.plannedOrder : []).map(itemId => itemMap.get(itemId)).filter(Boolean)
  const result = checkHardConstraints({ request, orderedItems, schedule: { itemPlans: orderedItems, conflicts: [] } })
  result.errors.push(...require('./transport-arrival').arrivalErrors(plan))
  return result
}

module.exports = { checkFinalPlanHardConstraints, checkHardConstraints, checkOrderLocks, checkTimeLocks, uniqueErrors }
