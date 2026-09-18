const { createHash } = require('node:crypto')
const { validateLeg } = require('../plan-schema')

function endpointDistance(a, b) {
  if (!a || !b || !Number.isFinite(b.lat) || !Number.isFinite(b.lng) || Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) return Infinity
  const rad = value => value * Math.PI / 180
  const h = Math.sin(rad(a.lat - b.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(a.lng - b.lng) / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}

// Direction duration is minutes; distance-matrix duration is seconds. Never
// feed a matrix response to this direction-only adapter.
function decodePolyline(values) {
  if (!Array.isArray(values) || values.length < 4 || values.length % 2 || values.length > 20000) throw new Error('INVALID_ROUTE_GEOMETRY')
  const decoded = []
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || (i >= 2 && !Number.isInteger(values[i]))) throw new Error('INVALID_ROUTE_GEOMETRY')
    decoded[i] = i < 2 ? values[i] : decoded[i - 2] + values[i] / 1000000
    if (Math.abs(decoded[i]) > (i % 2 ? 180 : 90)) throw new Error('INVALID_ROUTE_GEOMETRY')
  }
  return Array.from({ length: decoded.length / 2 }, (_, i) => ({ lat: decoded[i * 2], lng: decoded[i * 2 + 1] }))
}

function normalizeDirection({ response, demand, mode, fetchedAt, environment, timezone }) {
  if (!['car', 'walk'].includes(mode)) throw new Error('UNSUPPORTED_ROUTE_MODE')
  if (![demand?.from?.coordinateSystem, demand?.to?.coordinateSystem].every(value => ['GCJ02', 'GCJ-02'].includes(value))) throw new Error('UNSUPPORTED_ROUTE_COORDINATES')
  if (!['production', 'test'].includes(environment) || !/(Z|[+-]\d{2}:\d{2})$/.test(fetchedAt || '') || !Number.isFinite(Date.parse(fetchedAt))) throw new Error('INVALID_ROUTE_SOURCE')
  if (response?.status !== 0 || !Array.isArray(response.result?.routes)) throw new Error('ROUTE_PROVIDER_UNAVAILABLE')
  const candidates = []
  for (const [index, route] of response.result.routes.entries()) {
    if (route.mode !== (mode === 'car' ? 'DRIVING' : 'WALKING') || !Number.isFinite(route.duration) || route.duration <= 0
        || !Number.isFinite(route.distance) || route.distance < 0 || (mode === 'car' && route.restriction?.status !== 0)) continue
    let points
    try { points = decodePolyline(route.polyline) } catch { continue }
    // Supplier geometry may snap to a nearby road entrance, never to another
    // city or arbitrary route. Larger offsets require explicit entrance data.
    if (endpointDistance(points[0], demand.from.coordinate) > 500 || endpointDistance(points.at(-1), demand.to.coordinate) > 500) continue
    const durationMinutes = Math.ceil(route.duration)
    const start = Date.parse(demand.readyAt)
    if (!Number.isFinite(start) || durationMinutes > 10080) continue
    const departureAt = new Date(start).toISOString()
    const arrivalAt = new Date(start + durationMinutes * 60000).toISOString()
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(start))
    const dates = Object.fromEntries(parts.map(p => [p.type, p.value]))
    const sourceRef = `tencent-map:/ws/direction/v1/${mode === 'car' ? 'driving' : 'walking'}/`
    const leg = {
      legId: `map-route:${createHash('sha256').update(JSON.stringify([demand.demandId, mode, departureAt, fetchedAt, index])).digest('hex').slice(0, 24)}`,
      from: structuredClone(demand.from), to: structuredClone(demand.to), mode,
      serviceDate: `${dates.year}-${dates.month}-${dates.day}`, departureAt, arrivalAt,
      durationMinutes, distanceMeters: route.distance, serviceNo: null, quoteRef: null,
      routeGeometry: { source: sourceRef, coordinateSystem: 'GCJ02', points },
      status: 'unknown',
      provenance: { sourceType: 'estimate', provider: 'tencent-map', environment, fetchedAt, sourceRef },
      assumptions: ['NAVIGATION_TIME_ESTIMATE', 'DEPARTURE_AT_READY_TIME', 'PRICE_AND_AVAILABILITY_UNKNOWN']
    }
    validateLeg(leg, index)
    candidates.push(leg)
  }
  candidates.sort((a, b) => a.durationMinutes - b.durationMinutes || a.distanceMeters - b.distanceMeters || a.legId.localeCompare(b.legId))
  return candidates.length ? { demandId: demand.demandId, legs: [candidates[0]] } : null
}

// Injectable and offline by default: caller owns keys, allowed modes and quota.
// This adapter does not fetch, purchase, or guess public-transit schedules.
function createDirectionEvidenceReader({ queryDirection, modes, timezone, environment = 'test', clock = Date.now }) {
  return async ({ demands, signal }) => {
    const evidence = []
    for (const demand of demands) {
      for (const mode of modes) {
        signal.throwIfAborted()
        if (!['car', 'walk'].includes(mode) || ![demand.from.coordinateSystem, demand.to.coordinateSystem].every(value => ['GCJ02', 'GCJ-02'].includes(value))) continue
        try {
          const response = await queryDirection({ demand: structuredClone(demand), mode, signal })
          signal.throwIfAborted()
          const row = normalizeDirection({ response, demand, mode, timezone, environment, fetchedAt: new Date(clock()).toISOString() })
          if (row) { evidence.push(row); break }
        } catch { signal.throwIfAborted() }
      }
    }
    return evidence
  }
}
module.exports = { decodePolyline, normalizeDirection, createDirectionEvidenceReader }
