const { inputHash, PLAN_REQUEST_SCHEMA, validatePlanRequest } = require('./schema')

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : value
}

function clone(value) {
  return structuredClone(value)
}

function normalizePlaceRef(value) {
  return {
    provider: trimmed(value.provider),
    providerPlaceId: trimmed(value.providerPlaceId),
    name: trimmed(value.name),
    type: trimmed(value.type),
    coordinate: { lat: Number(value.coordinate.lat), lng: Number(value.coordinate.lng) },
    coordinateSystem: trimmed(value.coordinateSystem),
    ...(value.adcode === undefined ? {} : { adcode: trimmed(value.adcode) })
  }
}

// 旧单数输入到 canonical 多段数组的兼容层（B3-1）。
// 非空新数组为真值；schema 已禁止它与旧单数字段同时出现。
// 只有旧单数时包装成长度 1；都没有则为空数组。
// 空的新数组不视为“清空交通需求”的声明，避免静默丢掉旧单数里的显式需求。
function canonicalTransportDemands(input) {
  if (Array.isArray(input.transportDemands) && input.transportDemands.length) return input.transportDemands.map(clone)
  if (input.transportDemand) return [clone(input.transportDemand)]
  return []
}

function normalizePlanRequest(input) {
  validatePlanRequest(input)
  const normalized = {
    schemaVersion: PLAN_REQUEST_SCHEMA,
    clientRequestId: trimmed(input.clientRequestId),
    origin: normalizePlaceRef(input.origin),
    endDestination: normalizePlaceRef(input.endDestination),
    startAt: input.startAt,
    endBy: input.endBy,
    timezone: trimmed(input.timezone),
    travelers: { adults: input.travelers.adults, children: [...input.travelers.children] },
    budget: {
      amountMinor: input.budget.amountMinor,
      currency: trimmed(input.budget.currency).toUpperCase(),
      basis: input.budget.basis,
      includedCategories: input.budget.includedCategories.map(trimmed),
      strict: input.budget.strict
    },
    transportPreferences: clone(input.transportPreferences),
    // canonical 多段交通需求；本批保留 legacy 单数字段，消费者迁移放到后续批次。
    transportDemands: canonicalTransportDemands(input),
    transportDemand: input.transportDemand ? clone(input.transportDemand) : null,
    lodgingPreferences: clone(input.lodgingPreferences),
    interests: input.interests.map(trimmed),
    pace: input.pace,
    menuItems: input.menuItems.map(item => ({
      menuItemId: trimmed(item.menuItemId),
      occurrenceId: trimmed(item.occurrenceId),
      placeRef: normalizePlaceRef(item.placeRef),
      role: trimmed(item.role),
      inputOrder: item.inputOrder,
      required: item.required,
      stayRequirement: item.stayRequirement,
      ...(item.stayDays === undefined ? {} : { stayDays: item.stayDays }),
      visitDuration: { minutes: item.visitDuration.minutes },
      preferredWindow: { startAt: item.preferredWindow.startAt, endAt: item.preferredWindow.endAt }
    })),
    optimizeOrder: input.optimizeOrder,
    locks: clone(input.locks),
    confirmedConstraints: clone(input.confirmedConstraints),
    sourceInput: clone(input.sourceInput)
  }
  return { normalizedRequest: normalized, inputHash: inputHash(normalized) }
}

module.exports = { normalizePlanRequest }
