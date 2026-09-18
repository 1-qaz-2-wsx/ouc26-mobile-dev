const DEFAULT_QUERY_URL = 'https://apis.juhe.cn/fapigw/train/query'
const MAX_QUERY_DAYS = 15

function providerError(code, message, status = 502, details = {}) {
  return Object.assign(new Error(message), { code, status, provider: 'juhe-train-817', details })
}

function nowValue(clock) {
  return typeof clock === 'function' ? Number(clock()) : Number.isFinite(clock) ? clock : Date.now()
}

function chinaDate(clock) {
  const value = new Date(nowValue(clock) + 8 * 60 * 60 * 1000)
  return value.toISOString().slice(0, 10)
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null
  return date
}

function addDays(value, days) {
  const date = parseDate(value)
  if (!date) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetween(start, end) {
  const a = parseDate(start)
  const b = parseDate(end)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function text(value, field, max = 80) {
  const result = String(value === undefined || value === null ? '' : value).trim()
  if (!result || result.length > max) throw providerError('INVALID_PROVIDER_QUERY', `${field}格式不正确`, 422)
  return result
}

function time(value) {
  const result = String(value || '').trim()
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(result) ? result : null
}

function normalizeInput(input, clock) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw providerError('INVALID_PROVIDER_QUERY', '火车查询参数必须是对象', 422)
  const departureStation = text(input.departureStation || input.departure_station, '出发站')
  const arrivalStation = text(input.arrivalStation || input.arrival_station, '到达站')
  const date = text(input.date, '出发日期', 10)
  if (!parseDate(date)) throw providerError('INVALID_PROVIDER_QUERY', '出发日期必须是有效的 YYYY-MM-DD', 422)
  const offset = daysBetween(chinaDate(clock), date)
  if (offset === null || offset < 0 || offset > MAX_QUERY_DAYS) {
    return { departureStation, arrivalStation, date, outOfWindow: true, offset }
  }
  return {
    departureStation,
    arrivalStation,
    date,
    searchType: input.searchType === '2' ? '2' : '1',
    filter: String(input.filter || '').trim().slice(0, 16),
    enableBooking: input.enableBooking === '1' ? '1' : '2',
    departureTimeRange: String(input.departureTimeRange || '').trim().slice(0, 16),
    seatTypeCode: input.seatTypeCode ? String(input.seatTypeCode).trim().slice(0, 12) : '',
    outOfWindow: false,
    offset
  }
}

function formBody(values) {
  const body = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') body.set(key, String(value))
  })
  return body.toString()
}

function priceMinor(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null
}

function durationMinutes(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim()
  if (!raw) return null
  const match = raw.match(/^(?:(\d+)\s*(?:天|d)\s*)?(\d+):([0-5]\d)$/i)
  if (!match) return null
  const days = Number(match[1] || 0)
  const hours = Number(match[2])
  const minutes = Number(match[3])
  const total = days * 1440 + hours * 60 + minutes
  return Number.isSafeInteger(total) && total > 0 ? total : null
}

function seatAvailability(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim()
  if (!raw) return 'unknown'
  if (raw === '无' || raw === '0') return 'sold_out'
  if (/^\d+$/.test(raw) || /有|充足|充裕/.test(raw)) return 'available'
  if (/候补/.test(raw)) return 'waitlist'
  return 'unknown'
}

function normalizeSeats(prices) {
  if (!Array.isArray(prices)) return []
  return prices.map((item) => {
    const price = priceMinor(item && item.price)
    return {
      name: String(item && item.seat_name || '').trim() || '未提供席别',
      typeCode: String(item && item.seat_type_code || '').trim() || null,
      amountMinor: price,
      currency: 'CNY',
      priceBasis: 'per_person',
      availability: seatAvailability(item && item.num),
      rawAvailability: item && item.num !== undefined && item.num !== null ? String(item.num) : null,
      discount: item && item.discount !== undefined ? item.discount : null
    }
  }).filter((item) => item.amountMinor !== null || item.availability !== 'unknown')
}

function selectSeat(seats, preferredTypeCode) {
  if (preferredTypeCode) {
    const preferred = seats.find((seat) => seat.typeCode === preferredTypeCode)
    if (preferred) return preferred
  }
  return seats.find((seat) => seat.availability === 'available') || seats[0] || null
}

function arrivalDateInfo(row, input, departureTime, arrivalTime) {
  const departureMinutes = Number(departureTime.slice(0, 2)) * 60 + Number(departureTime.slice(3))
  const arrivalMinutes = Number(arrivalTime.slice(0, 2)) * 60 + Number(arrivalTime.slice(3))
  const rawDuration = row.duration
  const parsedDuration = durationMinutes(rawDuration)
  const hasDuration = rawDuration !== undefined && rawDuration !== null && String(rawDuration).trim() !== ''
  const explicitValue = row.arrival_date || row.arrivalDate || row.arrival_date_time || row.arrivalDateTime
  const explicitDate = typeof explicitValue === 'string'
    ? String(explicitValue).match(/\d{4}-\d{2}-\d{2}/)?.[0] || null
    : null

  if (hasDuration && parsedDuration === null) {
    return { arrivalDate: null, arrivalDateSource: 'conflict', durationMinutes: null, conflict: 'INVALID_DURATION' }
  }

  const expectedTotal = parsedDuration === null ? null : departureMinutes + parsedDuration
  const expectedDate = expectedTotal === null ? null : addDays(input.date, Math.floor(expectedTotal / 1440))
  const expectedTime = expectedTotal === null ? null : `${String(Math.floor((expectedTotal % 1440) / 60)).padStart(2, '0')}:${String(expectedTotal % 60).padStart(2, '0')}`

  if (explicitValue !== undefined && (!explicitDate || !parseDate(explicitDate))) {
    return { arrivalDate: null, arrivalDateSource: 'conflict', durationMinutes: parsedDuration, conflict: 'INVALID_ARRIVAL_DATE' }
  }
  if (explicitDate) {
    const explicitDelta = daysBetween(input.date, explicitDate)
    if (explicitDelta === null || explicitDelta < 0 || (explicitDelta === 0 && arrivalMinutes < departureMinutes) || (expectedDate && (explicitDate !== expectedDate || arrivalTime !== expectedTime))) {
      return { arrivalDate: null, arrivalDateSource: 'conflict', durationMinutes: parsedDuration, conflict: 'ARRIVAL_DATE_DURATION_CONFLICT' }
    }
    if (parsedDuration !== null && arrivalTime !== expectedTime) {
      return { arrivalDate: null, arrivalDateSource: 'conflict', durationMinutes: parsedDuration, conflict: 'ARRIVAL_TIME_DURATION_CONFLICT' }
    }
    return { arrivalDate: explicitDate, arrivalDateSource: 'provider_explicit', durationMinutes: parsedDuration, conflict: null }
  }
  if (expectedDate) {
    if (arrivalTime !== expectedTime) {
      return { arrivalDate: null, arrivalDateSource: 'conflict', durationMinutes: parsedDuration, conflict: 'ARRIVAL_TIME_DURATION_CONFLICT' }
    }
    return { arrivalDate: expectedDate, arrivalDateSource: 'derived_from_duration', durationMinutes: parsedDuration, conflict: null }
  }
  const crossesMidnight = arrivalMinutes < departureMinutes
  return {
    arrivalDate: crossesMidnight ? addDays(input.date, 1) : input.date,
    arrivalDateSource: crossesMidnight ? 'derived_from_time_order' : 'provider_service_date',
    durationMinutes: null,
    conflict: null
  }
}

function normalizeRow(row, input, fetchedAt, environment) {
  if (!row || typeof row !== 'object') return null
  const serviceNo = String(row.train_no || '').trim()
  const departureTime = time(row.departure_time)
  const arrivalTime = time(row.arrival_time)
  if (!serviceNo || !departureTime || !arrivalTime) return null
  const arrivalInfo = arrivalDateInfo(row, input, departureTime, arrivalTime)
  const seats = normalizeSeats(row.prices)
  const selectedSeat = selectSeat(seats, input.seatTypeCode)
  const bookingFlag = row.enable_booking === undefined || row.enable_booking === null || String(row.enable_booking).trim() === ''
    ? null
    : String(row.enable_booking).trim().toUpperCase()
  const serviceCanBook = bookingFlag === null ? null : bookingFlag === 'Y'
  const rawAvailability = selectedSeat ? selectedSeat.availability : 'unknown'
  const availability = serviceCanBook === false || arrivalInfo.conflict ? 'unknown' : rawAvailability
  const arrivalDate = arrivalInfo.arrivalDate
  return {
    provider: 'juhe',
    providerId: '817',
    providerName: '聚合数据·火车订票查询',
    environment,
    category: 'transport',
    mode: 'train',
    status: availability === 'available' ? 'available' : availability,
    availability,
    quoteId: `juhe-train-817:${input.date}:${serviceNo}`,
    productId: serviceNo,
    serviceNo,
    from: String(row.departure_station || input.departureStation).trim(),
    to: String(row.arrival_station || input.arrivalStation).trim(),
    fromCode: String(row.departure_station_code || '').trim() || null,
    toCode: String(row.arrival_station_code || '').trim() || null,
    departureDate: input.date,
    departureTime,
    arrivalDate,
    arrivalTime,
    arrivalDateSource: arrivalInfo.arrivalDateSource,
    duration: String(row.duration || '').trim() || null,
    durationMinutes: arrivalInfo.durationMinutes,
    serviceCanBook,
    availabilityReason: serviceCanBook === false ? 'service_not_bookable' : arrivalInfo.conflict || null,
    seatOptions: seats,
    selectedSeat: selectedSeat ? {
      name: selectedSeat.name,
      typeCode: selectedSeat.typeCode,
      amountMinor: selectedSeat.amountMinor,
      availability: selectedSeat.availability,
      rawAvailability: selectedSeat.rawAvailability
    } : null,
    amountMinor: selectedSeat ? selectedSeat.amountMinor : null,
    currency: 'CNY',
    priceBasis: 'per_person',
    taxIncluded: null,
    trainFlags: Array.isArray(row.train_flags) ? row.train_flags.map((item) => String(item)).slice(0, 20) : [],
    fetchedAt,
    supplierExpiresAt: null,
    bookingTarget: { kind: 'manual', label: '请在官方平台复核后预订' },
    provenance: {
      sourceType: 'live',
      provider: 'juhe',
      sourceRef: '817',
      fetchedAt,
      validForDate: input.date,
      fieldScope: ['schedule', 'seat_options', 'reference_price', 'availability', 'arrival_date_source'],
      environment
    },
    dataCoverage: {
      schedule: true,
      seatOptions: seats.length > 0,
      referencePrice: seats.some((seat) => seat.amountMinor !== null),
      availability: seats.some((seat) => seat.availability !== 'unknown'),
      arrivalDate: Boolean(arrivalDate),
      arrivalDateDerived: arrivalInfo.arrivalDateSource !== 'provider_explicit' && Boolean(arrivalDate),
      arrivalDateConflict: Boolean(arrivalInfo.conflict),
      serviceCanBook
    }
  }
}

function createDailyBudget(limit, clock = Date.now) {
  let bucket = chinaDate(clock)
  let used = 0
  function refresh() {
    const current = chinaDate(clock)
    if (current !== bucket) { bucket = current; used = 0 }
  }
  return {
    reserve() {
      refresh()
      if (used >= limit) return false
      used += 1
      return true
    },
    snapshot() {
      refresh()
      return { date: bucket, used, limit, remaining: Math.max(0, limit - used), persistence: 'process_day' }
    }
  }
}

function safeEndpoint(value) {
  const endpoint = String(value || DEFAULT_QUERY_URL)
  let parsed
  try { parsed = new URL(endpoint) } catch { throw providerError('PROVIDER_CONFIG_INVALID', '火车供应商地址无效', 500) }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'apis.juhe.cn') throw providerError('PROVIDER_CONFIG_INVALID', '火车供应商地址必须是官方 HTTPS 地址', 500)
  return parsed.toString()
}

function createJuheTrainProvider({ config = {}, fetchImpl = globalThis.fetch, clock = Date.now, budget } = {}) {
  const dailyLimit = Number.isInteger(config.juheTrainDailyLimit) ? config.juheTrainDailyLimit : 10
  const usage = budget || createDailyBudget(dailyLimit, clock)
  const endpoint = safeEndpoint(config.juheTrainQueryUrl)
  const environment = String(config.juheTrainEnvironment || 'test')
  return {
    id: 'juhe-train-817',
    name: '聚合数据·火车订票查询 817',
    capabilities() {
      return {
        id: 'juhe-train-817',
        kind: 'transport',
        productId: '817',
        provider: 'juhe',
        configured: Boolean(config.juheTrainKey),
        enabled: Boolean(config.juheTrainEnabled && config.juheTrainKey),
        environment,
        queryWindowDays: MAX_QUERY_DAYS,
        dailyLimit,
        usage: usage.snapshot(),
        status: !config.juheTrainKey ? 'not_configured' : !config.juheTrainEnabled ? 'disabled' : 'ready',
        supportedFields: ['schedule', 'seat_options', 'reference_price', 'availability'],
        limitations: ['仅支持查询日期窗口内日期', '未提供供应商有效期，价格/余票仍需购买前复核', '调用预算为当前进程日计数，正式部署前需替换为持久化账本']
      }
    },
    async search(input) {
      const normalized = normalizeInput(input, clock)
      if (normalized.outOfWindow) return { status: 'out_of_window', quotes: [], query: normalized, capabilities: this.capabilities() }
      if (!config.juheTrainEnabled) return { status: 'disabled', quotes: [], query: normalized, capabilities: this.capabilities() }
      if (!config.juheTrainKey) return { status: 'not_configured', quotes: [], query: normalized, capabilities: this.capabilities() }
      if (typeof fetchImpl !== 'function') throw providerError('PROVIDER_RUNTIME_INVALID', '火车供应商缺少 HTTPS 请求实现', 500)
      if (!usage.reserve()) return { status: 'budget_exhausted', quotes: [], query: normalized, capabilities: this.capabilities() }
      const fetchedAt = new Date(nowValue(clock)).toISOString()
      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: formBody({
            key: config.juheTrainKey,
            search_type: normalized.searchType,
            departure_station: normalized.departureStation,
            arrival_station: normalized.arrivalStation,
            date: normalized.date,
            filter: normalized.filter,
            enable_booking: normalized.enableBooking,
            departure_time_range: normalized.departureTimeRange
          })
        })
      } catch {
        throw providerError('PROVIDER_NETWORK_ERROR', '火车供应商网络请求失败', 502)
      }
      if (!response || !response.ok) throw providerError('PROVIDER_HTTP_ERROR', '火车供应商返回 HTTP 错误', 502, { status: response && response.status })
      let payload
      try { payload = await response.json() } catch { throw providerError('PROVIDER_BAD_RESPONSE', '火车供应商返回不是有效 JSON', 502) }
      if (!payload || Number(payload.error_code) !== 0) {
        throw providerError('PROVIDER_REJECTED', '火车供应商拒绝了查询', 502, { upstreamCode: payload && payload.error_code, reason: payload && payload.reason })
      }
      const rows = Array.isArray(payload.result) ? payload.result : []
      const quotes = rows.map((row) => normalizeRow(row, normalized, fetchedAt, environment)).filter(Boolean)
      return { status: quotes.length ? 'available' : 'unknown', quotes, query: normalized, fetchedAt, capabilities: this.capabilities() }
    }
  }
}

module.exports = { MAX_QUERY_DAYS, addDays, createDailyBudget, createJuheTrainProvider, durationMinutes, normalizeInput, normalizeRow, seatAvailability }
