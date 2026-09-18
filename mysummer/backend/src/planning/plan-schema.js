const { BOOKING_STATUSES, DATA_MODES, FEASIBILITY, PLAN_SCHEMA, TASK_STATUSES, plainObject, planningError } = require('./schema')
const { checkFinalPlanHardConstraints } = require('./hard-constraints')

const SOURCE_TYPES = ['live', 'manual_verified', 'estimate', 'mock']
const LEG_MODES = ['train', 'flight', 'lodging_transfer', 'walk', 'car', 'bus', 'unknown']

function fail(message, fieldErrors = []) {
  throw planningError('INVALID_PLAN', message, 500, { fieldErrors })
}

function required(value, path, errors) {
  if (value === undefined || value === null || value === '') errors.push({ path, message: '不能为空' })
}

function stringValue(value, path, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push({ path, message: '必须是非空字符串' })
}

function nullableString(value, path, errors) {
  if (value !== null && value !== undefined && (typeof value !== 'string' || !value.trim())) errors.push({ path, message: '必须是字符串或 null' })
}

function integerValue(value, path, errors, min = 0) {
  if (!Number.isInteger(value) || value < min) errors.push({ path, message: `必须是大于等于 ${min} 的整数` })
}

function isoValue(value, path, errors, nullable = false) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || !/[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:[Zz]|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    errors.push({ path, message: '必须是带时区偏移的 ISO 时间' })
  }
}

function sourceType(value, path, errors) {
  if (!SOURCE_TYPES.includes(value)) errors.push({ path, message: `必须是 ${SOURCE_TYPES.join('、')} 之一` })
}

function localDate(epoch, timezone) {
  if (!Number.isFinite(epoch) || typeof timezone !== 'string') return null
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(epoch))
    const values = Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type, item.value]))
    return `${values.year}-${values.month}-${values.day}`
  } catch {
    return null
  }
}

function validateQuote(quote, path = 'quote') {
  const errors = []
  if (!plainObject(quote)) fail(`${path} 必须是对象`, [{ path, message: '必须是对象' }])
  for (const key of ['provider', 'productId', 'quoteId', 'currency', 'priceBasis', 'availability', 'fetchedAt', 'environment']) required(quote[key], `${path}.${key}`, errors)
  stringValue(quote.provider, `${path}.provider`, errors)
  stringValue(quote.productId, `${path}.productId`, errors)
  stringValue(quote.quoteId, `${path}.quoteId`, errors)
  // B3-3：server-owned 交通段标识。可选；一旦出现就必须是非空字符串。
  // 它由服务端按 route demand 注入，绝不允许来自客户端输入。
  if (quote.demandId !== undefined) stringValue(quote.demandId, `${path}.demandId`, errors)
  if (quote.amountMinor !== null && !Number.isInteger(quote.amountMinor)) errors.push({ path: `${path}.amountMinor`, message: '必须是整数分或 null' })
  if (quote.amountMinor !== null && quote.amountMinor < 0) errors.push({ path: `${path}.amountMinor`, message: '不能为负数' })
  stringValue(quote.currency, `${path}.currency`, errors)
  stringValue(quote.priceBasis, `${path}.priceBasis`, errors)
  if (!['available', 'sold_out', 'waitlist', 'unknown', 'expired', 'out_of_window', 'not_required'].includes(quote.availability)) errors.push({ path: `${path}.availability`, message: 'availability 无效' })
  isoValue(quote.fetchedAt, `${path}.fetchedAt`, errors)
  isoValue(quote.supplierExpiresAt, `${path}.supplierExpiresAt`, errors, true)
  isoValue(quote.refreshAfter, `${path}.refreshAfter`, errors, true)
  if (quote.taxIncluded !== null && typeof quote.taxIncluded !== 'boolean') errors.push({ path: `${path}.taxIncluded`, message: '必须是布尔值或 null' })
  if (!plainObject(quote.bookingTarget)) errors.push({ path: `${path}.bookingTarget`, message: '必须是对象' })
  if (!plainObject(quote.provenance)) errors.push({ path: `${path}.provenance`, message: '必须是对象' })
  else {
    sourceType(quote.provenance.sourceType, `${path}.provenance.sourceType`, errors)
    stringValue(quote.provenance.provider, `${path}.provenance.provider`, errors)
    isoValue(quote.provenance.fetchedAt, `${path}.provenance.fetchedAt`, errors)
  }
  if (quote.transportDetail !== null && quote.transportDetail !== undefined) {
    if (!plainObject(quote.transportDetail)) errors.push({ path: `${path}.transportDetail`, message: '必须是对象或 null' })
    else {
      if (!['train', 'flight'].includes(quote.transportDetail.mode)) errors.push({ path: `${path}.transportDetail.mode`, message: '交通 mode 无效' })
      for (const key of ['departureDate', 'arrivalDate']) {
        if (quote.transportDetail[key] !== null && quote.transportDetail[key] !== undefined && (typeof quote.transportDetail[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(quote.transportDetail[key]))) {
          errors.push({ path: `${path}.transportDetail.${key}`, message: '必须是 YYYY-MM-DD 或 null' })
        }
      }
      for (const key of ['departureTime', 'arrivalTime']) {
        if (quote.transportDetail[key] !== null && quote.transportDetail[key] !== undefined && (typeof quote.transportDetail[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quote.transportDetail[key]))) {
          errors.push({ path: `${path}.transportDetail.${key}`, message: '必须是 HH:mm 或 null' })
        }
      }
      if (quote.transportDetail.durationMinutes !== null && quote.transportDetail.durationMinutes !== undefined) integerValue(quote.transportDetail.durationMinutes, `${path}.transportDetail.durationMinutes`, errors, 1)
      if (quote.transportDetail.serviceCanBook !== null && quote.transportDetail.serviceCanBook !== undefined && typeof quote.transportDetail.serviceCanBook !== 'boolean') errors.push({ path: `${path}.transportDetail.serviceCanBook`, message: '必须是布尔值或 null' })
      if (!Array.isArray(quote.transportDetail.seatOptions)) errors.push({ path: `${path}.transportDetail.seatOptions`, message: '必须是数组' })
    }
  }
  if (errors.length) fail(`${path} 不符合 Quote 契约`, errors)
  return quote
}

function validateItem(item, index) {
  const path = `items[${index}]`
  const errors = []
  if (!plainObject(item)) fail(`${path} 必须是对象`, [{ path, message: '必须是对象' }])
  for (const key of ['itemId', 'kind', 'startAt', 'endAt', 'reason', 'sourceMenuItemIds', 'lockRefs', 'evidenceRefs', 'bookingStatus']) required(item[key], `${path}.${key}`, errors)
  stringValue(item.itemId, `${path}.itemId`, errors)
  stringValue(item.kind, `${path}.kind`, errors)
  isoValue(item.startAt, `${path}.startAt`, errors)
  isoValue(item.endAt, `${path}.endAt`, errors)
  if (Date.parse(item.startAt) >= Date.parse(item.endAt)) errors.push({ path: `${path}.endAt`, message: '必须晚于 startAt' })
  integerValue(item.durationMinutes, `${path}.durationMinutes`, errors)
  if (Number.isFinite(Date.parse(item.startAt)) && Number.isFinite(Date.parse(item.endAt)) && Number.isInteger(item.durationMinutes)) {
    const actualMinutes = (Date.parse(item.endAt) - Date.parse(item.startAt)) / (60 * 1000)
    if (!Number.isInteger(actualMinutes) || actualMinutes !== item.durationMinutes) errors.push({ path: `${path}.durationMinutes`, message: '必须等于 startAt 与 endAt 的实际分钟差' })
  }
  if (item.requestedDurationMinutes !== undefined) integerValue(item.requestedDurationMinutes, `${path}.requestedDurationMinutes`, errors, 1)
  stringValue(item.reason, `${path}.reason`, errors)
  if (!Array.isArray(item.sourceMenuItemIds) || item.sourceMenuItemIds.length < 1 || item.sourceMenuItemIds.some(value => typeof value !== 'string' || !value.trim())) errors.push({ path: `${path}.sourceMenuItemIds`, message: '必须是非空字符串数组' })
  if (!Array.isArray(item.lockRefs) || item.lockRefs.some(value => typeof value !== 'string' || !value.trim())) errors.push({ path: `${path}.lockRefs`, message: '必须是字符串数组' })
  nullableString(item.quoteRef, `${path}.quoteRef`, errors)
  if (!Array.isArray(item.evidenceRefs)) errors.push({ path: `${path}.evidenceRefs`, message: '必须是数组' })
  if (!BOOKING_STATUSES.includes(item.bookingStatus)) errors.push({ path: `${path}.bookingStatus`, message: 'bookingStatus 无效' })
  if (errors.length) fail(`${path} 不符合 Item 契约`, errors)
  return item
}

function validateLeg(leg, index) {
  const path = `legs[${index}]`
  const errors = []
  if (!plainObject(leg)) fail(`${path} 必须是对象`, [{ path, message: '必须是对象' }])
  for (const key of ['legId', 'from', 'to', 'mode', 'serviceDate', 'departureAt', 'arrivalAt', 'routeGeometry', 'status']) required(leg[key], `${path}.${key}`, errors)
  stringValue(leg.legId, `${path}.legId`, errors)
  // B3-3：carrier leg 必须与它所属的 server route demand 同源；字段出现时必须非空字符串且不得来自客户端。
  if (leg.demandId !== undefined) stringValue(leg.demandId, `${path}.demandId`, errors)
  if (!plainObject(leg.from)) errors.push({ path: `${path}.from`, message: '必须是实际起点引用对象' })
  if (!plainObject(leg.to)) errors.push({ path: `${path}.to`, message: '必须是实际终点引用对象' })
  if (!LEG_MODES.includes(leg.mode)) errors.push({ path: `${path}.mode`, message: 'mode 无效' })
  if (typeof leg.serviceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(leg.serviceDate)) errors.push({ path: `${path}.serviceDate`, message: '必须是 YYYY-MM-DD' })
  isoValue(leg.departureAt, `${path}.departureAt`, errors)
  isoValue(leg.arrivalAt, `${path}.arrivalAt`, errors)
  if (Date.parse(leg.departureAt) >= Date.parse(leg.arrivalAt)) errors.push({ path: `${path}.arrivalAt`, message: '必须晚于 departureAt' })
  nullableString(leg.serviceNo, `${path}.serviceNo`, errors)
  nullableString(leg.quoteRef, `${path}.quoteRef`, errors)
  if (!plainObject(leg.routeGeometry)) errors.push({ path: `${path}.routeGeometry`, message: '必须是对象并明确 geometry 来源' })
  if (!['available', 'unknown', 'blocked'].includes(leg.status)) errors.push({ path: `${path}.status`, message: 'status 无效' })
  if (errors.length) fail(`${path} 不符合 Leg 契约`, errors)
  return leg
}

function validatePlan(plan) {
  const errors = []
  if (!plainObject(plan)) fail('Plan 必须是对象', [{ path: '', message: '必须是对象' }])
  for (const key of ['id', 'schemaVersion', 'version', 'inputSnapshot', 'originalOrder', 'plannedOrder', 'orderChanges', 'days', 'items', 'legs', 'locks', 'costSummary', 'validation', 'dataCoverage', 'provenance', 'taskStatus', 'feasibility', 'dataMode', 'createdAt', 'updatedAt']) required(plan[key], key, errors)
  stringValue(plan.id, 'id', errors)
  if (plan.schemaVersion !== PLAN_SCHEMA) errors.push({ path: 'schemaVersion', message: `必须是 ${PLAN_SCHEMA}` })
  integerValue(plan.version, 'version', errors, 1)
  if (!plainObject(plan.inputSnapshot)) errors.push({ path: 'inputSnapshot', message: '必须是请求快照对象' })
  if (!Array.isArray(plan.originalOrder) || !Array.isArray(plan.plannedOrder)) errors.push({ path: 'plannedOrder', message: '顺序字段必须是数组' })
  if (!Array.isArray(plan.orderChanges)) errors.push({ path: 'orderChanges', message: '必须是数组' })
  if (!Array.isArray(plan.days)) errors.push({ path: 'days', message: '必须是数组' })
  if (!Array.isArray(plan.items)) errors.push({ path: 'items', message: '必须是数组' })
  else plan.items.forEach(validateItem)
  if (!Array.isArray(plan.legs)) errors.push({ path: 'legs', message: '必须是数组' })
  else plan.legs.forEach(validateLeg)
  if (plan.quotes !== undefined) {
    if (!Array.isArray(plan.quotes)) errors.push({ path: 'quotes', message: '必须是数组' })
    else plan.quotes.forEach((quote, index) => validateQuote(quote, `quotes[${index}]`))
  }
  if (!Array.isArray(plan.locks)) errors.push({ path: 'locks', message: '必须是数组' })
  if (!plainObject(plan.costSummary)) errors.push({ path: 'costSummary', message: '必须是对象' })
  if (!plainObject(plan.validation)) errors.push({ path: 'validation', message: '必须是对象' })
  if (!plainObject(plan.dataCoverage)) errors.push({ path: 'dataCoverage', message: '必须是对象' })
  if (!Array.isArray(plan.provenance)) errors.push({ path: 'provenance', message: '必须是数组' })
  if (!TASK_STATUSES.includes(plan.taskStatus)) errors.push({ path: 'taskStatus', message: 'taskStatus 无效' })
  if (!FEASIBILITY.includes(plan.feasibility)) errors.push({ path: 'feasibility', message: 'feasibility 无效' })
  if (!DATA_MODES.includes(plan.dataMode)) errors.push({ path: 'dataMode', message: 'dataMode 无效' })
  isoValue(plan.createdAt, 'createdAt', errors)
  isoValue(plan.updatedAt, 'updatedAt', errors)

  const unique = (values, path) => {
    if (!Array.isArray(values)) return
    const seen = new Set()
    values.forEach((value, index) => {
      if (typeof value !== 'string' || !value.trim()) errors.push({ path: `${path}[${index}]`, message: '必须是非空字符串' })
      else if (seen.has(value)) errors.push({ path: `${path}[${index}]`, message: '不能重复' })
      else seen.add(value)
    })
    return seen
  }
  const itemIds = unique(Array.isArray(plan.items) ? plan.items.map(item => item.itemId) : null, 'items.itemId') || new Set()
  const quoteIds = unique(Array.isArray(plan.quotes) ? plan.quotes.map(quote => quote.quoteId) : [], 'quotes.quoteId') || new Set()
  // B3-3-R1：leg 与 plan quote 的段级身份交叉校验需要按 quoteId 反查报价本体。
  const quoteById = new Map()
  if (Array.isArray(plan.quotes)) plan.quotes.forEach(quote => {
    if (plainObject(quote) && typeof quote.quoteId === 'string') quoteById.set(quote.quoteId, quote)
  })
  unique(Array.isArray(plan.legs) ? plan.legs.map(leg => leg.legId) : null, 'legs.legId')
  const originalIds = unique(plan.originalOrder, 'originalOrder') || new Set()
  const plannedIds = unique(plan.plannedOrder, 'plannedOrder') || new Set()
  if (itemIds.size && (originalIds.size !== itemIds.size || [...itemIds].some(id => !originalIds.has(id)))) errors.push({ path: 'originalOrder', message: '必须保留且只保留所有计划项目' })
  if (itemIds.size && (plannedIds.size !== itemIds.size || [...itemIds].some(id => !plannedIds.has(id)))) errors.push({ path: 'plannedOrder', message: '必须保留且只保留所有计划项目' })

  const lockIds = unique(Array.isArray(plan.locks) ? plan.locks.map(lock => lock && lock.lockId) : null, 'locks.lockId') || new Set()
  const itemMap = new Map((Array.isArray(plan.items) ? plan.items : []).map(item => [item.itemId, item]))
  if (Array.isArray(plan.locks)) plan.locks.forEach((lock, index) => {
    if (!plainObject(lock)) { errors.push({ path: `locks[${index}]`, message: '必须是对象' }); return }
    if (typeof lock.targetId !== 'string' || !itemIds.has(lock.targetId)) errors.push({ path: `locks[${index}].targetId`, message: '必须引用计划中的项目' })
  })
  const menuItems = plan.inputSnapshot && Array.isArray(plan.inputSnapshot.menuItems) ? plan.inputSnapshot.menuItems : []
  const menuItemIds = new Set(menuItems.map(item => item && item.menuItemId).filter(Boolean))
  if (plan.inputSnapshot && Array.isArray(plan.inputSnapshot.menuItems)) plan.items.forEach((item, index) => {
    if (Array.isArray(item.sourceMenuItemIds)) item.sourceMenuItemIds.forEach(sourceId => {
      if (!menuItemIds.has(sourceId)) errors.push({ path: `items[${index}].sourceMenuItemIds`, message: `引用了不存在的菜单来源 ${sourceId}` })
    })
  })
  const requiredMenuIds = menuItems.filter(item => item && item.required).map(item => item.menuItemId)
  for (const menuItemId of requiredMenuIds) {
    if (![...(itemMap.values())].some(item => Array.isArray(item.sourceMenuItemIds) && item.sourceMenuItemIds.includes(menuItemId))) errors.push({ path: 'items', message: `必选菜单项目 ${menuItemId} 未保留` })
  }
  if (Array.isArray(plan.items)) {
    plan.items.forEach((item, index) => {
      if (Array.isArray(item.lockRefs)) item.lockRefs.forEach(lockId => { if (!lockIds.has(lockId)) errors.push({ path: `items[${index}].lockRefs`, message: `引用了不存在的锁 ${lockId}` }) })
      if (item.quoteRef !== null && item.quoteRef !== undefined && !quoteIds.has(item.quoteRef)) errors.push({ path: `items[${index}].quoteRef`, message: `引用了不存在的报价 ${item.quoteRef}` })
    })
  }
  if (Array.isArray(plan.legs)) plan.legs.forEach((leg, index) => {
    if (leg.quoteRef !== null && leg.quoteRef !== undefined && !quoteIds.has(leg.quoteRef)) errors.push({ path: `legs[${index}].quoteRef`, message: `引用了不存在的报价 ${leg.quoteRef}` })
    if (leg.fromItemId !== null && leg.fromItemId !== undefined && !itemIds.has(leg.fromItemId)) errors.push({ path: `legs[${index}].fromItemId`, message: '引用了不存在的项目' })
    if (leg.toItemId !== null && leg.toItemId !== undefined && !itemIds.has(leg.toItemId)) errors.push({ path: `legs[${index}].toItemId`, message: '引用了不存在的项目' })
    // B3-3-R1：carrier leg 一旦同时声明 quoteRef 与 demandId，就必须指向本段自己的 plan quote。
    // 只约束同时具备两者的 leg；非交通报价与 legacy 无 demandId 的对象不受影响。
    if (typeof leg.quoteRef === 'string' && typeof leg.demandId === 'string') {
      const referenced = quoteById.get(leg.quoteRef)
      // quoteRef 解析不到时上面已报 dangling，这里不重复报错。
      if (referenced) {
        if (typeof referenced.demandId !== 'string' || !referenced.demandId) {
          errors.push({ path: `legs[${index}].quoteRef`, message: `引用的报价 ${leg.quoteRef} 缺少 server-owned demandId，无法确认段级身份` })
        } else if (referenced.demandId !== leg.demandId) {
          errors.push({ path: `legs[${index}].demandId`, message: `leg.demandId 与被引用报价 ${leg.quoteRef} 的 demandId 不一致` })
        }
      }
    }
  })

  const dayIds = new Set()
  const dayItemIds = new Set()
  if (Array.isArray(plan.days)) plan.days.forEach((day, index) => {
    if (!plainObject(day)) { errors.push({ path: `days[${index}]`, message: '必须是对象' }); return }
    if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) errors.push({ path: `days[${index}].date`, message: '必须是 YYYY-MM-DD' })
    else if (dayIds.has(day.date)) errors.push({ path: `days[${index}].date`, message: '日期不能重复' })
    else dayIds.add(day.date)
    if (!Array.isArray(day.itemIds)) errors.push({ path: `days[${index}].itemIds`, message: '必须是数组' })
    else day.itemIds.forEach(itemId => {
      if (!itemIds.has(itemId)) errors.push({ path: `days[${index}].itemIds`, message: `引用了不存在的项目 ${itemId}` })
      else if (dayItemIds.has(itemId)) errors.push({ path: `days[${index}].itemIds`, message: `项目 ${itemId} 被多个日期重复引用` })
      else {
        dayItemIds.add(itemId)
        const item = itemMap.get(itemId)
        const itemDate = item ? localDate(Date.parse(item.startAt), plan.inputSnapshot && plan.inputSnapshot.timezone) : null
        if (itemDate && typeof day.date === 'string' && itemDate !== day.date) errors.push({ path: `days[${index}].itemIds`, message: `项目 ${itemId} 的本地开始日期 ${itemDate} 不属于 ${day.date}` })
      }
    })
  })
  if (itemIds.size && [...itemIds].some(itemId => !dayItemIds.has(itemId))) errors.push({ path: 'days', message: '每个计划项目必须归属一个日期' })

  if (plainObject(plan.validation)) {
    for (const key of ['errors', 'warnings', 'assumptions']) if (!Array.isArray(plan.validation[key])) errors.push({ path: `validation.${key}`, message: '必须是数组' })
    if (!Array.isArray(plan.validation.independentChecks)) errors.push({ path: 'validation.independentChecks', message: '必须是实际检查记录数组' })
    else plan.validation.independentChecks.forEach((check, index) => {
      if (!plainObject(check) || typeof check.check !== 'string' || !['passed', 'failed'].includes(check.status) || typeof check.details !== 'string') errors.push({ path: `validation.independentChecks[${index}]`, message: '必须包含 check、status、details，并记录真实检查结果' })
    })
    if (Array.isArray(plan.validation.independentChecks) && !plan.validation.independentChecks.some(check => check && check.check === 'hard_constraints')) errors.push({ path: 'validation.independentChecks', message: '必须包含共用硬约束检查记录' })
  }
  if (plainObject(plan.costSummary)) {
    if (plan.costSummary.knownTotal !== null && !Number.isInteger(plan.costSummary.knownTotal)) errors.push({ path: 'costSummary.knownTotal', message: '必须是整数分或 null' })
    if (plan.costSummary.estimatedRange !== null && (!plainObject(plan.costSummary.estimatedRange) || !Number.isInteger(plan.costSummary.estimatedRange.minMinor) || !Number.isInteger(plan.costSummary.estimatedRange.maxMinor) || plan.costSummary.estimatedRange.minMinor > plan.costSummary.estimatedRange.maxMinor)) errors.push({ path: 'costSummary.estimatedRange', message: '估算区间必须包含有效的 minMinor/maxMinor' })
    if (!plainObject(plan.costSummary.budgetComparison)) errors.push({ path: 'costSummary.budgetComparison', message: '必须是对象' })
  }
  const validationErrors = plainObject(plan.validation) && Array.isArray(plan.validation.errors) ? plan.validation.errors : []
  const errorCodes = new Set(validationErrors.map(error => error && error.code).filter(Boolean))
  const finalHardConstraints = checkFinalPlanHardConstraints(plan)
  for (const hardError of finalHardConstraints.errors) {
    const target = hardError.targetId || hardError.itemId || hardError.menuItemId
    const recorded = validationErrors.some(error => error && error.code === hardError.code && (!target || error.targetId === target || error.itemId === target || error.menuItemId === target))
    if (!recorded) errors.push({ path: 'validation.errors', message: `缺少共用硬约束检查结果 ${hardError.code}` })
  }
  if (plan.feasibility === 'valid' && validationErrors.length) errors.push({ path: 'feasibility', message: 'feasibility=valid 时不能存在 validation.errors' })
  if (plan.feasibility === 'blocked' && !validationErrors.length) errors.push({ path: 'feasibility', message: 'feasibility=blocked 时必须存在 validation.errors' })
  if (plan.feasibility === 'needs_review' && validationErrors.length) errors.push({ path: 'feasibility', message: 'feasibility=needs_review 时不能存在硬错误' })
  if (Array.isArray(plan.plannedOrder) && itemMap.size) {
    let previousEnd = null
    for (const itemId of plan.plannedOrder) {
      const item = itemMap.get(itemId)
      if (!item) continue
      const start = Date.parse(item.startAt)
      const end = Date.parse(item.endAt)
      if (previousEnd !== null && start < previousEnd && !['TIME_ORDER_CONFLICT', 'LOCKED_TIME_CONFLICT'].some(code => errorCodes.has(code))) errors.push({ path: 'plannedOrder', message: '实际计划时间必须单调且不能重叠' })
      if (Number.isFinite(end)) previousEnd = Math.max(previousEnd || end, end)
    }
  }
  if (errors.length) fail('Plan 不符合 real-travel-plan.v1 契约', errors)
  return plan
}

function quoteFromProvider(value, occupancy = null) {
  const quote = {
    provider: value.provider,
    productId: value.productId,
    quoteId: value.quoteId,
    // B3-3：evidence 在查票时已把 server-owned demandId 注入每段报价，这里原样保留。
    ...(typeof value.demandId === 'string' && value.demandId ? { demandId: value.demandId } : {}),
    amountMinor: value.amountMinor === undefined ? null : value.amountMinor,
    currency: value.currency || 'CNY',
    priceBasis: value.priceBasis || 'unknown',
    taxIncluded: value.taxIncluded === undefined ? null : value.taxIncluded,
    occupancy,
    availability: value.availability || 'unknown',
    fetchedAt: value.fetchedAt,
    supplierExpiresAt: value.supplierExpiresAt === undefined ? null : value.supplierExpiresAt,
    refreshAfter: value.refreshAfter === undefined ? null : value.refreshAfter,
    bookingTarget: value.bookingTarget || { kind: 'manual', label: '请人工复核' },
    environment: value.environment || value.provenance?.environment || 'unknown',
    provenance: value.provenance,
    availabilityReason: value.availabilityReason || null,
    transportDetail: value.mode === 'train' || value.mode === 'flight' ? {
      mode: value.mode,
      serviceNo: value.serviceNo || null,
      from: value.from || null,
      to: value.to || null,
      fromCode: value.fromCode || null,
      toCode: value.toCode || null,
      departureDate: value.departureDate || null,
      departureTime: value.departureTime || null,
      arrivalDate: value.arrivalDate === undefined ? value.departureDate || null : value.arrivalDate,
      arrivalTime: value.arrivalTime || null,
      duration: value.duration || null,
      durationMinutes: value.durationMinutes === undefined ? null : value.durationMinutes,
      arrivalDateSource: value.arrivalDateSource || null,
      serviceCanBook: value.serviceCanBook === undefined ? null : value.serviceCanBook,
      selectedSeat: value.selectedSeat || null,
      seatOptions: Array.isArray(value.seatOptions) ? value.seatOptions : []
    } : null
  }
  return validateQuote(quote)
}

module.exports = { LEG_MODES, SOURCE_TYPES, quoteFromProvider, validateLeg, validatePlan, validateQuote }
