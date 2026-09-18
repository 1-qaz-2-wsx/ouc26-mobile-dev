function create(api) {
  function isAdministrative(place) {
    return !!place && place.objectType !== 'poi' && place.providerKind !== 'poi' && (place.objectType === 'administrative' || place.providerKind === 'district' || place.isAdministrative === true || place.isProvince === true || place.isCity === true)
  }

  function coordinate(place, key) {
    const nestedKey = key === 'latitude' ? 'lat' : 'lng'
    const value = place && place[key] !== undefined ? place[key] : place && place.location && place.location[nestedKey]
    return Number(value)
  }

  function distanceMeters(a, b) {
    const latitudeA = coordinate(a, 'latitude')
    const longitudeA = coordinate(a, 'longitude')
    const latitudeB = coordinate(b, 'latitude')
    const longitudeB = coordinate(b, 'longitude')
    if (![latitudeA, longitudeA, latitudeB, longitudeB].every(Number.isFinite)) return Infinity
    const radians = Math.PI / 180
    const dLat = (latitudeB - latitudeA) * radians
    const dLng = (longitudeB - longitudeA) * radians
    const lat1 = latitudeA * radians
    const lat2 = latitudeB * radians
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  }

  function administrativeName(name) {
    return String(name || '').trim().replace(/(?:省|市|自治区|自治州|特别行政区|地区|盟|县|区|旗)$/, '')
  }

  function sameAdministrativeName(left, right) {
    const a = administrativeName(left)
    const b = administrativeName(right)
    return Boolean(a && b && a === b)
  }

  function isProvince(place) {
    return place && place.isProvince === true || /(?:省|自治区|特别行政区)$/.test(String(place && (place.name || place.fullname) || '').trim())
  }

  function normalizeAdministrative(place) {
    const province = isProvince(place)
    const name = String(place && (place.name || place.fullname) || '').trim()
    return Object.assign({}, place, {
      id: place && (place.id || place.providerId || place.fullname || name),
      providerId: place && (place.providerId || place.id || ''),
      providerKind: 'district',
      objectType: 'administrative',
      latitude: place && place.latitude !== undefined ? Number(place.latitude) : coordinate(place, 'latitude'),
      longitude: place && place.longitude !== undefined ? Number(place.longitude) : coordinate(place, 'longitude'),
      recognitionStatus: 'confirmed',
      detailStatus: place && place.detailStatus || 'available',
      planningRole: province ? 'choose_city' : 'destination_area',
      canAdd: province ? false : place && place.canAdd !== false,
      isAdministrative: true,
      isProvince: province,
      isCity: !province,
      category: province ? '省/自治区' : '城市',
      address: place && place.address || name,
      summary: place && place.summary || (province ? '请继续选择省内城市' : '城市目的地；加入后将作为旅行目的地安排市内游玩'),
      source: place && place.source || '腾讯位置服务·行政区搜索'
    })
  }

  function administrativeFallback(place, original) {
    return api('/maps/search', { keyword: place.name, city: place.city || '' }).then(result => {
      const places = Array.isArray(result && result.places) ? result.places : []
      const match = places.find(candidate => {
        if (!isAdministrative(candidate) || !sameAdministrativeName(candidate.name || candidate.fullname, place.name)) return false
        const distance = distanceMeters(place, candidate)
        return distance !== Infinity && distance <= 100000
      })
      if (!match) return original
      const resolved = normalizeAdministrative(match)
      return { place: resolved, recognitionStatus: 'confirmed', detailStatus: resolved.detailStatus, candidates: [] }
    })
  }

  function resolvePlace(place) {
    if (isAdministrative(place)) {
      const resolved = place.objectType === 'administrative' ? place : normalizeAdministrative(place)
      return Promise.resolve({ place: resolved, recognitionStatus: resolved.recognitionStatus || 'confirmed', detailStatus: resolved.detailStatus || 'available', candidates: [] })
    }
    if (place && place.providerId) return api('/maps/detail', { id: place.providerId })
    if (!place || !place.name) return Promise.resolve({ place: null, recognitionStatus: 'unidentified', detailStatus: 'missing', candidates: [] })
    return api('/maps/poi', { name: place.name, latitude: place.latitude, longitude: place.longitude }).then(result => {
      if (result && result.place) {
        return isAdministrative(result.place) ? Object.assign({}, result, { place: result.place.objectType === 'administrative' ? result.place : normalizeAdministrative(result.place) }) : result
      }
      if (result && Array.isArray(result.candidates) && result.candidates.length) return result
      // Older cloud deployments may still return place:null for a bare city.
      // Recover only from an explicit administrative search with the same name;
      // never promote reverse-geocoding data or the nearest POI implicitly.
      return administrativeFallback(place, result || { place: null, recognitionStatus: 'unidentified', detailStatus: 'missing', candidates: [] })
    })
  }
  return {
    searchPlaces: (keyword, city) => api('/maps/search', { keyword, city }).then(r => (Array.isArray(r && r.places) ? r.places : []).map(place => isAdministrative(place) ? normalizeAdministrative(place) : place)),
    regeo: (latitude, longitude) => api('/maps/regeo', { latitude, longitude }),
    resolvePlace,
    // Keep the old place-only contract for the separate place-detail page.
    poiDetail: p => resolvePlace(p).then(r => r && r.place)
  }
}
module.exports = { create }
