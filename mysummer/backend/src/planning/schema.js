const { createHash } = require('node:crypto')

const PLAN_REQUEST_SCHEMA = 'real-travel-plan-request.v1'
const PLAN_SCHEMA = 'real-travel-plan.v1'
const TASK_STATUSES = Object.freeze(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'])
const FEASIBILITY = Object.freeze(['valid', 'needs_review', 'blocked'])
const DATA_MODES = Object.freeze(['live', 'mixed', 'manual', 'demo'])
const AVAILABILITY = Object.freeze(['available', 'sold_out', 'waitlist', 'unknown', 'expired', 'out_of_window', 'not_required'])
const BOOKING_STATUSES = Object.freeze(['not_booked', 'user_confirmed', 'needs_recheck'])
// 结构性上限，不等于“每单最多查询多少段 carrier”的产品预算（该预算属 Owner 决策点，见 B3 审计 §11/§22）。
const MAX_TRANSPORT_DEMANDS = 100

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function planningError(code, message, status = 422, extra = {}) {
  return Object.assign(new Error(message), { code, status, retryable: false, fieldErrors: [], ...extra })
}

function invalid(fieldErrors, path, message) {
  fieldErrors.push({ path, message })
}

function allowedKeys(value, allowed, path, fieldErrors) {
  if (!plainObject(value)) {
    invalid(fieldErrors, path, '必须是对象')
    return false
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(fieldErrors, path ? `${path}.${key}` : key, '包含不支持的字段')
  }
  return true
}

function stringField(value, path, fieldErrors, { min = 1, max = 160, optional = false } = {}) {
  if (value === undefined && optional) return
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    invalid(fieldErrors, path, `必须是 ${min} 到 ${max} 个字符的字符串`)
  }
}

function integerField(value, path, fieldErrors, { min, max, optional = false } = {}) {
  if (value === undefined && optional) return
  if (!Number.isInteger(value) || value < min || value > max) invalid(fieldErrors, path, `必须是 ${min} 到 ${max} 的整数`)
}

function finiteNumber(value, path, fieldErrors, { min, max } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(fieldErrors, path, `必须是 ${min} 到 ${max} 的有限数字`)
  }
}

function isoWithOffset(value, path, fieldErrors, optional = false) {
  if (value === undefined && optional) return
  if (typeof value !== 'string' || !/[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:[Zz]|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    invalid(fieldErrors, path, '必须是带时区偏移的 ISO 时间')
  }
}

function enumField(value, path, choices, fieldErrors, optional = false) {
  if (value === undefined && optional) return
  if (!choices.includes(value)) invalid(fieldErrors, path, `必须是 ${choices.join('、')} 之一`)
}

function validatePlaceRef(value, path, fieldErrors) {
  if (!allowedKeys(value, new Set(['provider', 'providerPlaceId', 'name', 'type', 'coordinate', 'coordinateSystem', 'adcode']), path, fieldErrors)) return
  stringField(value.provider, `${path}.provider`, fieldErrors, { max: 60 })
  stringField(value.providerPlaceId, `${path}.providerPlaceId`, fieldErrors, { max: 160 })
  stringField(value.name, `${path}.name`, fieldErrors, { max: 160 })
  stringField(value.type, `${path}.type`, fieldErrors, { max: 60 })
  if (!allowedKeys(value.coordinate, new Set(['lat', 'lng']), `${path}.coordinate`, fieldErrors)) return
  finiteNumber(value.coordinate.lat, `${path}.coordinate.lat`, fieldErrors, { min: -90, max: 90 })
  finiteNumber(value.coordinate.lng, `${path}.coordinate.lng`, fieldErrors, { min: -180, max: 180 })
  stringField(value.coordinateSystem, `${path}.coordinateSystem`, fieldErrors, { max: 32 })
  stringField(value.adcode, `${path}.adcode`, fieldErrors, { max: 32, optional: true })
}

function validateTravelers(value, path, fieldErrors) {
  if (!allowedKeys(value, new Set(['adults', 'children']), path, fieldErrors)) return
  integerField(value.adults, `${path}.adults`, fieldErrors, { min: 1, max: 20 })
  if (!Array.isArray(value.children) || value.children.length > 20) {
    invalid(fieldErrors, `${path}.children`, '必须是 0 到 20 项的数组')
    return
  }
  value.children.forEach((age, index) => integerField(age, `${path}.children[${index}]`, fieldErrors, { min: 0, max: 17 }))
}

function validateBudget(value, path, fieldErrors) {
  if (!allowedKeys(value, new Set(['amountMinor', 'currency', 'basis', 'includedCategories', 'strict']), path, fieldErrors)) return
  if (value.amountMinor !== null) integerField(value.amountMinor, `${path}.amountMinor`, fieldErrors, { min: 0, max: 1000000000 })
  stringField(value.currency, `${path}.currency`, fieldErrors, { max: 8 })
  enumField(value.basis, `${path}.basis`, ['party', 'person'], fieldErrors)
  if (!Array.isArray(value.includedCategories) || value.includedCategories.length > 20) invalid(fieldErrors, `${path}.includedCategories`, '必须是 0 到 20 项的数组')
  else value.includedCategories.forEach((item, index) => stringField(item, `${path}.includedCategories[${index}]`, fieldErrors, { max: 40 }))
  if (typeof value.strict !== 'boolean') invalid(fieldErrors, `${path}.strict`, '必须是布尔值')
}

function validatePreferences(value, path, fieldErrors, allowed, optionalFields = []) {
  if (!allowedKeys(value, allowed, path, fieldErrors)) return
  if (Object.hasOwn(value, 'modes')) {
    if (!Array.isArray(value.modes) || value.modes.length > 8) invalid(fieldErrors, `${path}.modes`, '必须是 0 到 8 项的数组')
    else value.modes.forEach((item, index) => stringField(item, `${path}.modes[${index}]`, fieldErrors, { max: 32 }))
  }
  if (Object.hasOwn(value, 'allowNightTrain') && typeof value.allowNightTrain !== 'boolean') invalid(fieldErrors, `${path}.allowNightTrain`, '必须是布尔值')
  if (Object.hasOwn(value, 'rooms')) integerField(value.rooms, `${path}.rooms`, fieldErrors, { min: 1, max: 10 })
  for (const key of optionalFields) if (Object.hasOwn(value, key)) stringField(value[key], `${path}.${key}`, fieldErrors, { max: 80 })
}

function validateMenuItem(value, index, fieldErrors) {
  const path = `menuItems[${index}]`
  if (!allowedKeys(value, new Set(['menuItemId', 'occurrenceId', 'placeRef', 'role', 'inputOrder', 'required', 'stayRequirement', 'visitDuration', 'preferredWindow', 'stayDays']), path, fieldErrors)) return
  integerField(value.stayDays, `${path}.stayDays`, fieldErrors, { min: 1, max: 30, optional: true })
  stringField(value.menuItemId, `${path}.menuItemId`, fieldErrors, { max: 80 })
  stringField(value.occurrenceId, `${path}.occurrenceId`, fieldErrors, { max: 80 })
  validatePlaceRef(value.placeRef, `${path}.placeRef`, fieldErrors)
  stringField(value.role, `${path}.role`, fieldErrors, { max: 40 })
  integerField(value.inputOrder, `${path}.inputOrder`, fieldErrors, { min: 0, max: 10000 })
  if (typeof value.required !== 'boolean') invalid(fieldErrors, `${path}.required`, '必须是布尔值')
  enumField(value.stayRequirement, `${path}.stayRequirement`, ['none', 'city_anchor', 'lodging', 'transfer', 'must_visit', 'optional'], fieldErrors)
  if (!allowedKeys(value.visitDuration, new Set(['minutes']), `${path}.visitDuration`, fieldErrors)) return
  integerField(value.visitDuration.minutes, `${path}.visitDuration.minutes`, fieldErrors, { min: 0, max: 1440 })
  if (!allowedKeys(value.preferredWindow, new Set(['startAt', 'endAt']), `${path}.preferredWindow`, fieldErrors)) return
  isoWithOffset(value.preferredWindow.startAt, `${path}.preferredWindow.startAt`, fieldErrors)
  isoWithOffset(value.preferredWindow.endAt, `${path}.preferredWindow.endAt`, fieldErrors)
  if (typeof value.preferredWindow.startAt === 'string' && typeof value.preferredWindow.endAt === 'string' && Date.parse(value.preferredWindow.startAt) >= Date.parse(value.preferredWindow.endAt)) invalid(fieldErrors, `${path}.preferredWindow.endAt`, '必须晚于 startAt')
}

function validateLock(value, index, fieldErrors) {
  const path = `locks[${index}]`
  if (!allowedKeys(value, new Set(['lockId', 'targetId', 'kind', 'value', 'source', 'createdAt']), path, fieldErrors)) return
  stringField(value.lockId, `${path}.lockId`, fieldErrors, { max: 80 })
  stringField(value.targetId, `${path}.targetId`, fieldErrors, { max: 160 })
  enumField(value.kind, `${path}.kind`, ['place', 'time', 'order', 'booking'], fieldErrors)
  if (value.value === undefined) invalid(fieldErrors, `${path}.value`, '不能为空')
  stringField(value.source, `${path}.source`, fieldErrors, { max: 80 })
  isoWithOffset(value.createdAt, `${path}.createdAt`, fieldErrors)
}

function validateTransportDemand(value, path, fieldErrors) {
  if (value === undefined || value === null) return
  if (!allowedKeys(value, new Set(['mode', 'serviceDate', 'departure', 'arrival', 'seatTypeCode', 'departureWindow', 'targetMenuItemId']), path, fieldErrors)) return
  stringField(value.targetMenuItemId, `${path}.targetMenuItemId`, fieldErrors, { max: 160, optional: true })
  enumField(value.mode, `${path}.mode`, ['train', 'flight'], fieldErrors)
  stringField(value.serviceDate, `${path}.serviceDate`, fieldErrors, { max: 10 })
  if (typeof value.serviceDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value.serviceDate)) invalid(fieldErrors, `${path}.serviceDate`, '必须是 YYYY-MM-DD')
  for (const endpoint of ['departure', 'arrival']) {
    const endpointPath = `${path}.${endpoint}`
    if (!allowedKeys(value[endpoint], new Set(['name', 'code']), endpointPath, fieldErrors)) continue
    stringField(value[endpoint].name, `${endpointPath}.name`, fieldErrors, { max: 160, optional: true })
    stringField(value[endpoint].code, `${endpointPath}.code`, fieldErrors, { max: 40, optional: true })
    if (!value[endpoint].name && !value[endpoint].code) invalid(fieldErrors, endpointPath, 'name 和 code 至少提供一个')
  }
  stringField(value.seatTypeCode, `${path}.seatTypeCode`, fieldErrors, { max: 40, optional: true })
  if (value.departureWindow !== undefined) {
    if (!allowedKeys(value.departureWindow, new Set(['startAt', 'endAt']), `${path}.departureWindow`, fieldErrors)) return
    isoWithOffset(value.departureWindow.startAt, `${path}.departureWindow.startAt`, fieldErrors)
    isoWithOffset(value.departureWindow.endAt, `${path}.departureWindow.endAt`, fieldErrors)
    if (typeof value.departureWindow.startAt === 'string' && typeof value.departureWindow.endAt === 'string' && Date.parse(value.departureWindow.startAt) >= Date.parse(value.departureWindow.endAt)) invalid(fieldErrors, `${path}.departureWindow.endAt`, '必须晚于 startAt')
  }
}

// 多段交通输入：每项复用单段字段集；targetMenuItemId 缺省在新数组语义中表示“到 endDestination”，
// 因此整个数组最多允许一项缺省。客户端不得自带 server route demandId（该 id 由 routeDemands 按最终 plannedOrder 生成）。
function validateTransportDemands(value, path, fieldErrors) {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    invalid(fieldErrors, path, '必须是数组')
    return
  }
  if (value.length > MAX_TRANSPORT_DEMANDS) {
    invalid(fieldErrors, path, `必须是 0 到 ${MAX_TRANSPORT_DEMANDS} 项的数组`)
    return
  }
  value.forEach((item, index) => {
    if (!plainObject(item)) {
      invalid(fieldErrors, `${path}[${index}]`, '必须是对象')
      return
    }
    validateTransportDemand(item, `${path}[${index}]`, fieldErrors)
  })
}

function validatePlanRequest(input) {
  const fieldErrors = []
  if (!allowedKeys(input, new Set(['schemaVersion', 'clientRequestId', 'origin', 'endDestination', 'startAt', 'endBy', 'timezone', 'travelers', 'budget', 'transportPreferences', 'transportDemand', 'transportDemands', 'lodgingPreferences', 'interests', 'pace', 'menuItems', 'optimizeOrder', 'locks', 'confirmedConstraints', 'sourceInput']), '', fieldErrors)) {
    throw planningError('INVALID_CONSTRAINTS', 'PlanRequest 必须是对象', 422, { fieldErrors })
  }
  if (input.schemaVersion !== PLAN_REQUEST_SCHEMA) invalid(fieldErrors, 'schemaVersion', `必须是 ${PLAN_REQUEST_SCHEMA}`)
  stringField(input.clientRequestId, 'clientRequestId', fieldErrors, { max: 128 })
  validatePlaceRef(input.origin, 'origin', fieldErrors)
  validatePlaceRef(input.endDestination, 'endDestination', fieldErrors)
  isoWithOffset(input.startAt, 'startAt', fieldErrors)
  isoWithOffset(input.endBy, 'endBy', fieldErrors)
  if (typeof input.startAt === 'string' && typeof input.endBy === 'string' && Date.parse(input.startAt) >= Date.parse(input.endBy)) invalid(fieldErrors, 'endBy', '必须晚于 startAt')
  stringField(input.timezone, 'timezone', fieldErrors, { max: 64 })
  try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format() } catch { invalid(fieldErrors, 'timezone', '必须是有效的 IANA 时区') }
  validateTravelers(input.travelers, 'travelers', fieldErrors)
  validateBudget(input.budget, 'budget', fieldErrors)
  validatePreferences(input.transportPreferences, 'transportPreferences', fieldErrors, new Set(['modes', 'allowNightTrain', 'maxTransfers', 'seatType', 'cabin']))
  validateTransportDemand(input.transportDemand, 'transportDemand', fieldErrors)
  validateTransportDemands(input.transportDemands, 'transportDemands', fieldErrors)
  if (input.transportDemand && Array.isArray(input.transportDemands) && input.transportDemands.length) invalid(fieldErrors, 'transportDemands', '不能与 transportDemand 同时提供')
  if (input.transportDemand?.targetMenuItemId && (!Array.isArray(input.menuItems) || !input.menuItems.some(item => item?.menuItemId === input.transportDemand.targetMenuItemId))) invalid(fieldErrors, 'transportDemand.targetMenuItemId', '绑定地点不在菜单中')
  if (Array.isArray(input.transportDemands)) {
    const targets = new Set()
    let untargetedCount = 0
    input.transportDemands.forEach((item, index) => {
      if (!plainObject(item)) return
      // 缺省 targetMenuItemId 表示“到 endDestination”，整个数组最多一项。
      if (item.targetMenuItemId === undefined) {
        untargetedCount += 1
        if (untargetedCount > 1) invalid(fieldErrors, `transportDemands[${index}]`, '最多只能有一项缺省 targetMenuItemId（缺省表示到终点）')
        return
      }
      const targetMenuItemId = item.targetMenuItemId
      if (typeof targetMenuItemId !== 'string') return
      if (!Array.isArray(input.menuItems) || !input.menuItems.some(menuItem => menuItem?.menuItemId === targetMenuItemId)) invalid(fieldErrors, `transportDemands[${index}].targetMenuItemId`, '绑定地点不在菜单中')
      if (targets.has(targetMenuItemId)) invalid(fieldErrors, `transportDemands[${index}].targetMenuItemId`, 'targetMenuItemId 不能重复')
      targets.add(targetMenuItemId)
    })
  }
  if (!allowedKeys(input.lodgingPreferences, new Set(['rooms', 'roomType', 'bedType', 'breakfast', 'required']), 'lodgingPreferences', fieldErrors)) {
    // errors already recorded
  } else {
    integerField(input.lodgingPreferences.rooms, 'lodgingPreferences.rooms', fieldErrors, { min: 1, max: 10 })
    if (input.lodgingPreferences.required !== undefined && typeof input.lodgingPreferences.required !== 'boolean') invalid(fieldErrors, 'lodgingPreferences.required', '必须是布尔值')
    stringField(input.lodgingPreferences.roomType, 'lodgingPreferences.roomType', fieldErrors, { max: 80, optional: true })
    stringField(input.lodgingPreferences.bedType, 'lodgingPreferences.bedType', fieldErrors, { max: 80, optional: true })
    if (input.lodgingPreferences.breakfast !== undefined && typeof input.lodgingPreferences.breakfast !== 'boolean') invalid(fieldErrors, 'lodgingPreferences.breakfast', '必须是布尔值')
  }
  if (!Array.isArray(input.interests) || input.interests.length > 30) invalid(fieldErrors, 'interests', '必须是 0 到 30 项的数组')
  else input.interests.forEach((item, index) => stringField(item, `interests[${index}]`, fieldErrors, { max: 80 }))
  enumField(input.pace, 'pace', ['relaxed', 'balanced', 'intense'], fieldErrors)
  if (!Array.isArray(input.menuItems) || input.menuItems.length < 1 || input.menuItems.length > 100) invalid(fieldErrors, 'menuItems', '必须是 1 到 100 项的数组')
  else input.menuItems.forEach((item, index) => validateMenuItem(item, index, fieldErrors))
  if (Array.isArray(input.menuItems)) {
    const menuItemIds = new Set()
    input.menuItems.forEach((item, index) => {
      const menuItemId = item && item.menuItemId
      if (menuItemIds.has(menuItemId)) invalid(fieldErrors, `menuItems[${index}].menuItemId`, 'menuItemId 不能重复')
      if (menuItemId !== undefined) menuItemIds.add(menuItemId)
    })
  }
  if (typeof input.optimizeOrder !== 'boolean') invalid(fieldErrors, 'optimizeOrder', '必须是布尔值')
  if (!Array.isArray(input.locks) || input.locks.length > 100) invalid(fieldErrors, 'locks', '必须是 0 到 100 项的数组')
  else input.locks.forEach((item, index) => validateLock(item, index, fieldErrors))
  if (Array.isArray(input.locks)) {
    const lockIds = new Set()
    input.locks.forEach((item, index) => {
      const lockId = item && item.lockId
      if (lockIds.has(lockId)) invalid(fieldErrors, `locks[${index}].lockId`, 'lockId 不能重复')
      if (lockId !== undefined) lockIds.add(lockId)
    })
  }
  if (!Array.isArray(input.confirmedConstraints) || input.confirmedConstraints.length > 100) invalid(fieldErrors, 'confirmedConstraints', '必须是 0 到 100 项的数组')
  else input.confirmedConstraints.forEach((item, index) => { if (!plainObject(item)) invalid(fieldErrors, `confirmedConstraints[${index}]`, '必须是对象') })
  if (!allowedKeys(input.sourceInput, new Set(['type', 'sourceUrl', 'textRef', 'extractedAt']), 'sourceInput', fieldErrors)) {
    // errors already recorded
  } else {
    enumField(input.sourceInput.type, 'sourceInput.type', ['manual_menu', 'community_reference', 'external_guide'], fieldErrors)
    stringField(input.sourceInput.sourceUrl, 'sourceInput.sourceUrl', fieldErrors, { max: 2048, optional: true })
    stringField(input.sourceInput.textRef, 'sourceInput.textRef', fieldErrors, { max: 160, optional: true })
    isoWithOffset(input.sourceInput.extractedAt, 'sourceInput.extractedAt', fieldErrors, true)
  }
  if (fieldErrors.length) throw planningError('INVALID_CONSTRAINTS', 'PlanRequest 不符合契约', 422, { fieldErrors })
  return input
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  return value
}

function inputHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

module.exports = {
  AVAILABILITY,
  BOOKING_STATUSES,
  DATA_MODES,
  FEASIBILITY,
  PLAN_REQUEST_SCHEMA,
  PLAN_SCHEMA,
  TASK_STATUSES,
  inputHash,
  plainObject,
  planningError,
  validatePlanRequest
}
