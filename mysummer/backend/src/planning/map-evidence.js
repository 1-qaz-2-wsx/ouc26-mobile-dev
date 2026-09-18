const { planningError } = require('./schema')

// Consumes the existing /maps/search normalized result. Never performs a query.
// Evidence metadata must be supplied by the server-side caller, not inferred.
function adaptMapEvidence({ places, fetchedAt, environment, sourceRef } = {}) {
  if (!Array.isArray(places) || !['test', 'production'].includes(environment) ||
      typeof fetchedAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(fetchedAt) ||
      !Number.isFinite(Date.parse(fetchedAt)) || typeof sourceRef !== 'string' || !sourceRef.trim()) {
    throw planningError('MAP_EVIDENCE_INVALID', '地图证据必须包含结果数组、来源、带时区时间和环境')
  }
  const candidates = [], rejected = [], seen = new Set()
  places.forEach((place, index) => {
    const valid = place && typeof place.providerId === 'string' && place.providerId.trim() &&
      typeof place.name === 'string' && place.name.trim() &&
      Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
      Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180 &&
      ['poi', 'administrative'].includes(place.objectType)
    if (!valid) { rejected.push({ index, reason: 'identity_or_coordinate_missing' }); return }
    if (place.isProvince || place.canAdd === false || place.planningRole === 'choose_city') {
      rejected.push({ index, reason: 'requires_place_confirmation' }); return
    }
    const candidateId = `tencent-map:${place.objectType}:${place.providerId}`
    if (seen.has(candidateId)) { rejected.push({ index, reason: 'duplicate_provider_identity' }); return }
    seen.add(candidateId)
    const category = String(place.category || '')
    const kind = place.objectType === 'administrative' ? 'destination_area'
      : /火车站/.test(category) ? 'rail_station' : /机场/.test(category) ? 'airport' : 'poi'
    candidates.push({
      candidateId, kind, category,
      categoryGroup: place.categoryGroup || '',
      placeRef: { provider: 'tencent-map', providerPlaceId: place.providerId, name: place.name,
        type: place.objectType === 'administrative' ? 'city' : 'poi',
        coordinate: { lat: place.latitude, lng: place.longitude }, coordinateSystem: 'GCJ-02',
        ...(place.adcode ? { adcode: String(place.adcode) } : {}) },
      transportStationCode: null,
      openingHours: null, visitDurationMinutes: null, ticketQuote: null,
      status: 'needs_review',
      provenance: { provider: 'tencent-map', sourceRef, fetchedAt, environment,
        fieldScope: ['identity', 'coordinate', 'category'] }
    })
  })
  return { schemaVersion: 'planning-map-evidence.v1', candidates, rejected,
    complete: false, gaps: ['opening_hours', 'visit_duration', 'ticket_price', 'station_code_mapping', 'route_time'] }
}

module.exports = { adaptMapEvidence }
