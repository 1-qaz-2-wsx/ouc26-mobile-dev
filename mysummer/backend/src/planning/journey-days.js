const { dateKeys, dateOnly, zonedDateTime } = require('./rule-planner')

function buildJourneyDays({ plan, cityExpansions = [], routeAudit }) {
  const input = plan.inputSnapshot
  const dates = dateKeys(Date.parse(input.startAt), Date.parse(input.endBy), input.timezone)
  const cityIds = new Set(cityExpansions.flatMap(expansion => expansion.sourceMenuItemIds))
  const activities = plan.items.filter(item => !cityIds.has(item.itemId)).map(item => ({
    id: item.itemId, kind: 'explicit_activity', name: item.placeRef.name, placeRef: item.placeRef,
    startAt: item.startAt, endAt: item.endAt, sourceMenuItemIds: item.sourceMenuItemIds,
    status: 'needs_review', evidenceRefs: item.evidenceRefs
  }))
  for (const expansion of cityExpansions) {
    for (const activity of expansion.activityPreview?.activities || []) {
      activities.push({ ...activity, id: activity.itemId, name: activity.placeRef.name, kind: 'city_activity_preview' })
    }
  }
  const legs = [...plan.legs, ...(routeAudit?.legs || [])]
  const days = dates.map(date => {
    const dayStart = zonedDateTime(date, '00:00', input.timezone)
    const nextDate = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
    const dayEnd = zonedDateTime(nextDate, '00:00', input.timezone)
    return { date,
      cityStays: cityExpansions.filter(expansion => expansion.stay?.dates.includes(date)).map(expansion => ({
        sourceMenuItemIds: expansion.sourceMenuItemIds, sourceOccurrenceId: expansion.sourceOccurrenceId,
        status: expansion.stay.status, arrivalDepartureConfirmed: false
      })),
      activities: activities.filter(activity => dateOnly(Date.parse(activity.startAt), input.timezone) === date)
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id)),
      transport: legs.filter(leg => Date.parse(leg.departureAt) < dayEnd && Date.parse(leg.arrivalAt) > dayStart).map(leg => ({
        id: leg.legId, mode: leg.mode, serviceNo: leg.serviceNo || null, departureAt: leg.departureAt,
        arrivalAt: leg.arrivalAt, from: leg.from, to: leg.to, quoteRef: leg.quoteRef || null,
        continuesFromPreviousDay: Date.parse(leg.departureAt) < dayStart,
        continuesIntoNextDay: Date.parse(leg.arrivalAt) > dayEnd,
        status: leg.status
      })) }
  })
  const lodgingNeeds = []
  for (const date of dates.slice(0, -1)) {
    const nextDate = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
    // A planning convention, not a promise about rest quality or hotel check-in.
    const restStart = zonedDateTime(date, '22:00', input.timezone)
    const restEnd = zonedDateTime(nextDate, '06:00', input.timezone)
    const overnight = plan.legs.find(leg => leg.mode === 'train' && Date.parse(leg.departureAt) <= restStart && Date.parse(leg.arrivalAt) >= restEnd)
    const required = input.lodgingPreferences.required !== false
    lodgingNeeds.push({ id: `lodging-${date}`, checkInDate: date, checkOutDate: nextDate,
      rooms: input.lodgingPreferences.rooms, travelers: structuredClone(input.travelers),
      status: !required ? 'not_required_by_user' : overnight ? 'night_train_rest_pending_confirmation' : 'needs_review',
      overnightLegRef: overnight?.legId || null,
      hotelId: null, roomTypeId: null, amountMinor: null, availability: 'unknown',
      gaps: !required ? [] : ['REST_LOCATION_UNCONFIRMED', 'HOTEL_RATE_INVENTORY_UNAVAILABLE'],
      assumption: '夜间休息检查按当地 22:00–次日06:00；夜车覆盖仍需用户确认是否另需住宿' })
  }
  const conflicts = []
  for (const activity of activities) {
    for (const leg of legs) {
      if (Date.parse(activity.startAt) < Date.parse(leg.arrivalAt) && Date.parse(activity.endAt) > Date.parse(leg.departureAt)) {
        conflicts.push({ code: 'ACTIVITY_TRANSPORT_OVERLAP', itemId: activity.id, legId: leg.legId, message: '游玩活动与交通行驶时间重叠，需要调整行程' })
      }
    }
  }
  return { schemaVersion: 'planning-journey-days.v1', days, lodgingNeeds, conflicts,
    requestedNights: lodgingNeeds.filter(need => need.status !== 'not_required_by_user').length,
    confirmedHotelNights: 0, complete: false }
}
module.exports = { buildJourneyDays }
