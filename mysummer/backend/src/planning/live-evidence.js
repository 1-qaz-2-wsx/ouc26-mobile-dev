const { createPlatform } = require('../platform')
const { createJuheTrainProvider } = require('./providers/juhe-train')
const { createTencentLodgingProvider } = require('./providers/tencent-lodging')
const { planningError } = require('./schema')
const { createDirectionEvidenceReader } = require('./providers/tencent-route')

// One process-scoped, explicitly granted session budget. Restart does not grant
// permission to spend another session budget; deployment keeps these limits zero.
function createLiveEvidenceReaders({ config, fetchImpl = globalThis.fetch, mapLimit = 0, trainLimit = 0, budget } = {}) {
  const used = { map: 0, train: 0 }
  // 地图额度耗尽是一次性终态。platform 会把 fetch 包装内部的异常统一包装成通用
  // “第三方服务连接失败”，因此这里必须自己记住额度已耗尽，才能把
  // PROVIDER_SESSION_LIMIT 原样交回上层，而不是被误判成“供应商不可用/没查到”。
  let mapQuotaExhausted = false
  const reserve = async kind => {
    if (budget) return budget.reserve(kind)
    const limit = kind === 'map' ? mapLimit : trainLimit
    if (used[kind] >= limit) throw planningError('PROVIDER_SESSION_LIMIT', '本轮真实查询次数已用完', 429)
    used[kind]++
  }
  const platform = createPlatform(config, async (url, options) => {
    try {
      await reserve('map')
    } catch (error) {
      if (error && error.code === 'PROVIDER_SESSION_LIMIT') mapQuotaExhausted = true
      throw error
    }
    return fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) })
  })
  const train = createJuheTrainProvider({ config, fetchImpl: async (url, options) => {
    await reserve('train')
    return fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) })
  } })
  // 住宿地点检索复用同一套 platform：地图额度只在 platform 的 fetch 包装里计一次，
  // 因此 evidenceForLodging 自身绝不 reserve('map')，否则同一晚会被双计。
  const lodging = createTencentLodgingProvider({ queryNearby: request => platform.queryNearby(request) })
  return {
    usage: () => ({ ...used, mapLimit, trainLimit }),
    async evidenceForRoutes({ demands, transportPreferences, timezone, signal }) {
      // Do not turn a rail/public-transit itinerary into a road trip.
      const modes = transportPreferences?.modes?.length === 1 && transportPreferences.modes[0] === 'car' ? ['car'] : []
      const reader = createDirectionEvidenceReader({ modes, timezone, environment: 'production',
        queryDirection: ({ demand, mode }) => platform.queryDirection({ from: demand.from.coordinate, to: demand.to.coordinate, mode }) })
      return reader({ demands, signal })
    },
    async evidenceForCity({ placeRef, signal }) {
      signal.throwIfAborted()
      const result = await platform.handle('/maps/search', { keyword: placeRef.name }, { headers: {}, socket: { remoteAddress: 'planning-evidence' } })
      signal.throwIfAborted()
      return { places: result.places, fetchedAt: new Date().toISOString(), environment: 'production', sourceRef: 'tencent-map:/maps/search' }
    },
    async evidenceForTransport({ demand, signal }) {
      signal.throwIfAborted()
      // 航班供应商尚未授权启用：绝不把 flight 需求降级成火车查询，也不发生任何 fetch。
      if (demand && demand.mode === 'flight') return { status: 'disabled', quotes: [] }
      const result = await train.search({ departureStation: demand.departure.name, arrivalStation: demand.arrival.name, date: demand.serviceDate, seatTypeCode: demand.seatTypeCode })
      signal.throwIfAborted()
      return result
    },
    // 附近住宿「地点信息」：一次调用只查一个明确关键词，不自动二次搜索“住宿”。
    // 返回的是地点候选与机器状态，不含房价、库存、房型或可预订结论。
    async evidenceForLodging({ location, keyword = '酒店', radius = 3000, signal }) {
      signal.throwIfAborted()
      if (mapQuotaExhausted) throw planningError('PROVIDER_SESSION_LIMIT', '本轮真实查询次数已用完', 429)
      let result
      try {
        result = await lodging.searchNearby({ location, keyword, radius })
      } catch (error) {
        // 真正的额度耗尽发生在 fetch 包装内部，会被 platform 归一成通用 502，这里还原机器语义。
        if (mapQuotaExhausted) throw planningError('PROVIDER_SESSION_LIMIT', '本轮真实查询次数已用完', 429)
        throw error
      }
      signal.throwIfAborted()
      return { ...result, fetchedAt: new Date().toISOString(), environment: 'production', sourceRef: 'tencent-map:place/v1/search' }
    }
  }
}
module.exports = { createLiveEvidenceReaders }
