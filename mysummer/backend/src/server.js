const { readConfig } = require('./config')
const { createApp } = require('./app')
const { createCommunityRepository, createIdentityService } = require('./community-repository')
const { createCommunityStorage } = require('./community-storage')
const { createPlanningRepository } = require('./planning/cloud-repository')
const { createProviderBudget } = require('./planning/provider-budget')

const config = readConfig()
const dependencies = {}
if (config.cloudbaseApiKey) {
  const tcb = require('@cloudbase/node-sdk')
  const cloudbase = tcb.init({ env: config.cloudbaseEnv, accessKey: config.cloudbaseApiKey })
  const database = cloudbase.database()
  dependencies.communityRepository = createCommunityRepository(database)
  dependencies.planningRepository = createPlanningRepository(database)
  dependencies.identityService = createIdentityService(dependencies.communityRepository)
  dependencies.communityStorage = createCommunityStorage(cloudbase)
}
if (config.planningDraftEnabled && (config.planningMapSessionLimit || config.planningTrainSessionLimit)) {
  if (!dependencies.planningRepository) throw new Error('live planning requires CloudBase persistence')
  const budget = createProviderBudget({ repository: dependencies.planningRepository,
    limits: { map: config.planningMapSessionLimit, train: config.planningTrainSessionLimit }, scope: config.planningBudgetScope })
  const readers = require('./planning/live-evidence').createLiveEvidenceReaders({ config,
    mapLimit: config.planningMapSessionLimit, trainLimit: config.planningTrainSessionLimit, budget })
  if (config.planningMapSessionLimit) {
    dependencies.evidenceForCity = readers.evidenceForCity
    dependencies.evidenceForRoutes = readers.evidenceForRoutes
  }
  if (config.planningTrainSessionLimit) dependencies.evidenceForTransport = readers.evidenceForTransport
}
const { server } = createApp(config, dependencies)

server.listen(config.port, config.host, () => {
  // Deliberately log no request bodies, authorization headers, or key material.
  console.log(`Travel assist backend listening on http://${config.host}:${config.port}`)
  console.log(`AI configured: ${config.apiKey ? 'yes' : 'no'}; model: ${config.model}`)
})

server.on('error', (error) => {
  console.error(`Server failed: ${error.message}`)
  process.exitCode = 1
})
