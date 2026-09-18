// Explicitly bounded acceptance probe, not a daemon or production configuration.
const { readConfig } = require('../src/config')
const { createLiveEvidenceReaders } = require('../src/planning/live-evidence')
const { adaptMapEvidence } = require('../src/planning/map-evidence')
const { createPlanningService } = require('../src/planning/service')
async function main() {
  const [date, confirmation] = process.argv.slice(2)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || confirmation !== '--confirm-map-2-train-1') throw new Error('需要日期和 --confirm-map-2-train-1 明确确认；最多地图2次、火车1次')
  const readers = createLiveEvidenceReaders({ config: readConfig(), mapLimit: 2, trainLimit: 1 })
  try {
    const signal = new AbortController().signal
    const evidence = await readers.evidenceForCity({ placeRef: { name: '南岔' }, signal })
    const city = adaptMapEvidence(evidence).candidates.find(candidate => candidate.kind === 'destination_area')
    if (!city) throw new Error('没有可确认的真实城市锚点，停止，不补演示坐标')
    const endDate = new Date(Date.parse(date + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10)
    const startAt = date + 'T08:00:00+08:00', endBy = endDate + 'T20:00:00+08:00'
    const request = { schemaVersion: 'real-travel-plan-request.v1', clientRequestId: 'real-provider-acceptance',
      // Explicit test scenario coordinate, NOT a verified boarding-station POI.
      origin: { provider: 'manual', providerPlaceId: 'acceptance-origin', name: '长春城市锚点（上车站坐标未验证）', type: 'city', coordinateSystem: 'GCJ-02', coordinate: { lat: 43.82, lng: 125.32 } },
      endDestination: city.placeRef, startAt, endBy, timezone: 'Asia/Shanghai', travelers: { adults: 1, children: [] },
      budget: { amountMinor: 100000, currency: 'CNY', basis: 'party', includedCategories: ['transport', 'local_transfer', 'ticket'], strict: false },
      transportPreferences: { modes: ['train'], allowNightTrain: true },
      transportDemand: { mode: 'train', serviceDate: date, departure: { name: '长春' }, arrival: { name: '南岔' }, seatTypeCode: '3', targetMenuItemId: 'nancha-visit' },
      lodgingPreferences: { rooms: 1, required: false }, interests: ['自然'], pace: 'balanced',
      menuItems: [{ menuItemId: 'nancha-visit', occurrenceId: 'nancha-visit', placeRef: city.placeRef, role: 'must_visit', inputOrder: 0,
        required: true, stayRequirement: 'city_anchor', stayDays: 1, visitDuration: { minutes: 120 }, preferredWindow: { startAt, endAt: endBy } }],
      optimizeOrder: true, locks: [], confirmedConstraints: [], sourceInput: { type: 'manual_menu' } }
    const service = createPlanningService({ evidenceForCity: async () => evidence, evidenceForTransport: readers.evidenceForTransport })
    const created = service.jobs.create({ ownerId: 'local-acceptance-only', idempotencyKey: 'real-provider-acceptance', request })
    const job = await service.jobs.run({ ownerId: 'local-acceptance-only', jobId: created.job.id })
    if (!job.result) throw new Error('任务未返回可验证结果')
    const result = job.result, plan = result.plan
    const boundActivity = plan.items.find(item => item.itemId === 'nancha-visit')
    const carrier = plan.legs[0]
    console.log(JSON.stringify({ ok: Boolean(carrier) && Date.parse(boundActivity.startAt) >= Date.parse(carrier.arrivalAt),
      scope: 'live-provider-to-memory-job-not-full-executable-trip', usage: readers.usage(), taskStatus: job.taskStatus, feasibility: plan.feasibility,
      city: city.placeRef, candidateCount: result.cityExpansions[0].candidates.length,
      cityStayDates: result.cityExpansions[0].stay.dates, activityStartAt: boundActivity.startAt,
      carrier: carrier ? { serviceNo: carrier.serviceNo, departureAt: carrier.departureAt, arrivalAt: carrier.arrivalAt, provenance: carrier.provenance } : null,
      unknownCategories: plan.costSummary.unknownCategories, errors: plan.validation.errors,
      gaps: plan.validation.warnings.map(row => row.code) }, null, 2))
  } catch {
    console.log(JSON.stringify({ ok: false, code: 'LIVE_ACCEPTANCE_INCOMPLETE', usage: readers.usage(), message: '真实取证或任务未完整成功；未回退演示数据，未回显敏感配置' }))
    process.exitCode = 1
  }
}
main().catch(() => { console.error('参数错误，未查询供应商'); process.exitCode = 2 })
