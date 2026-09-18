const { createPlanningProviders } = require('./provider-registry')
const { normalizePlanRequest } = require('./normalizer')
const { buildRulePlan } = require('./rule-planner')
const { adaptMapEvidence } = require('./map-evidence')
const { createPlanningExecutor } = require('./pipeline')
const { createPlanningJobService } = require('./job-service')
const { createDraftRevisionService } = require('./draft-revisions')
const { createPersistentPlanningJobService } = require('./persistent-jobs')
const { createPersistentDraftRevisionService } = require('./persistent-drafts')
const { randomUUID } = require('node:crypto')

function createPlanningService({ config = {}, fetchImpl, clock, evidenceForCity, evidenceForRoutes, evidenceForTransport, evidenceForPoiSchedules, repository } = {}) {
  const providers = createPlanningProviders({ config, fetchImpl, clock })
  const executor = createPlanningExecutor({ evidenceForCity, evidenceForRoutes, evidenceForTransport, evidenceForPoiSchedules, now: clock })
  const jobs = repository
    ? createPersistentPlanningJobService({ repository, clock, executor })
    : createPlanningJobService({ clock, maxExternalCalls: 0, executor })
  const localPreviewExecutor = createPlanningExecutor({ now: clock })
  const draftOptions = { evaluate: ({ request, signal }) => localPreviewExecutor({ request, signal, job: { id: randomUUID() } }) }
  const draftRevisions = repository
    ? createPersistentDraftRevisionService({ repository, ...draftOptions })
    : createDraftRevisionService(draftOptions)
  return {
    providers,
    adaptMapEvidence,
    draftRevisions,
    jobs: {
      create(input) {
        normalizePlanRequest(input.request)
        return jobs.create({ ...input, request: structuredClone(input.request) })
      },
      get: jobs.get,
      run: jobs.run,
      cancel: jobs.cancel,
      persistence: jobs.persistence
    },
    validateRequest(input) {
      const result = normalizePlanRequest(input)
      return { ok: true, schemaVersion: result.normalizedRequest.schemaVersion, normalizedRequest: result.normalizedRequest, inputHash: result.inputHash, dataMode: 'manual' }
    },
    buildRulePlan({ request, transportQuotes = [], now, planId } = {}) {
      return buildRulePlan({ request, transportQuotes, now, planId })
    },
    async capabilities() {
      return {
        ok: true,
        schemaVersion: 'planning-capabilities.v1',
        dataMode: 'mixed',
        providers: providers.all().map((provider) => provider.capabilities()),
        notes: [
          '能力就绪不等于真实路线已查询成功',
          '航班当前禁用，不会因能力查询消耗调用次数',
          '酒店等待合作资格，未配置房价库存适配器'
        ]
      }
    }
  }
}

module.exports = { createPlanningService }
