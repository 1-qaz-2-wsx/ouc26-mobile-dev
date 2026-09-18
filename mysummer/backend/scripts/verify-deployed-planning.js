// Bounded deployed-service acceptance probe. It never prints credentials or tokens.
const { createHmac, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { readConfig } = require('../src/config')

const service = 'travel-assistant-api'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function readLine() { return new Promise(resolve => process.stdin.once('data', chunk => resolve(String(chunk).trim()))) }
function place(id, name, lat, lng, type = 'city') {
  return { provider: 'manual', providerPlaceId: id, name, type, coordinateSystem: 'GCJ-02', coordinate: { lat, lng } }
}
function token(secret) {
  const body = Buffer.from(JSON.stringify({ id: 'deployed-closure-acceptance', exp: Date.now() + 15 * 60000 })).toString('base64url')
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url')
}
async function post(cloudbase, path, data, auth) {
  const response = await cloudbase.callContainer({ name: service, path, method: 'POST', header: { 'content-type': 'application/json', 'X-App-Authorization': `Bearer ${auth}` }, data })
  const payload = response.data || {}
  if (response.statusCode < 200 || response.statusCode >= 300 || payload.ok === false) throw Object.assign(new Error('deployed request failed'), { code: payload.code || `HTTP_${response.statusCode}`, status: response.statusCode })
  return payload
}
async function cloudLogin(cloudbase, appId) {
  const response = await cloudbase.callContainer({ name: service, path: '/auth/wechat', method: 'POST', header: {
    'content-type': 'application/json', 'X-WX-OPENID': 'closure-acceptance-openid', 'X-WX-APPID': appId
  }, data: {} })
  const payload = response.data || {}
  if (response.statusCode < 200 || response.statusCode >= 300 || !payload.token) throw Object.assign(new Error('trusted cloud login failed'), { code: payload.code || `HTTP_${response.statusCode}`, status: response.statusCode })
  return payload.token
}
async function main() {
  const [date, confirmation] = process.argv.slice(2)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || confirmation !== '--confirm-deployed-map-train') throw new Error('confirmation required')
  const config = readConfig()
  let supplied = {}
  if (process.argv.includes('--credentials-stdin')) supplied = JSON.parse(await readLine())
  const fileIndex = process.argv.indexOf('--credentials-file')
  if (fileIndex >= 0) {
    const credentialPath = path.resolve(process.argv[fileIndex + 1] || '')
    if (path.dirname(credentialPath) !== process.cwd() || !path.basename(credentialPath).startsWith('.planning-acceptance-credentials-')) throw new Error('invalid credential file')
    supplied = JSON.parse(fs.readFileSync(credentialPath, 'utf8'))
    fs.unlinkSync(credentialPath)
  }
  const accessKey = config.cloudbaseApiKey || supplied.accessKey || ''
  const sessionSecret = supplied.sessionSecret || config.sessionSecret
  const appId = supplied.appId || config.wechatAppId
  if (!accessKey || (!process.argv.includes('--cloud-login') && (!sessionSecret || sessionSecret.length < 32))) throw new Error('secure deployment credentials unavailable')
  const cloudbase = require('@cloudbase/node-sdk').init({ env: config.cloudbaseEnv, accessKey })
  const auth = process.argv.includes('--cloud-login') ? await cloudLogin(cloudbase, appId) : token(sessionSecret)
  const idempotencyKey = `closure-${date}-${randomUUID()}`
  const nextDay = new Date(Date.parse(date + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10)
  const startAt = date + 'T08:00:00+08:00', endBy = nextDay + 'T20:00:00+08:00'
  const destination = { provider: 'tencent-map', providerPlaceId: '230726', name: '南岔县', type: 'city', adcode: '230726',
    coordinateSystem: 'GCJ-02', coordinate: { lat: 47.139009, lng: 129.283584 } }
  const request = { schemaVersion: 'real-travel-plan-request.v1', clientRequestId: idempotencyKey,
    origin: place('changchun-acceptance', '长春', 43.82, 125.32), endDestination: destination,
    startAt, endBy, timezone: 'Asia/Shanghai', travelers: { adults: 1, children: [] },
    budget: { amountMinor: 100000, currency: 'CNY', basis: 'party', includedCategories: ['transport', 'local_transfer', 'ticket'], strict: false },
    transportPreferences: { modes: ['train'], allowNightTrain: true },
    transportDemand: { mode: 'train', serviceDate: date, departure: { name: '长春' }, arrival: { name: '南岔' }, seatTypeCode: '3', targetMenuItemId: 'nancha-visit' },
    lodgingPreferences: { rooms: 1, required: false }, interests: ['自然'], pace: 'balanced',
    menuItems: [{ menuItemId: 'nancha-visit', occurrenceId: 'nancha-visit', placeRef: destination, role: 'must_visit', inputOrder: 0, required: true,
      stayRequirement: 'city_anchor', stayDays: 1, visitDuration: { minutes: 120 }, preferredWindow: { startAt, endAt: endBy } }],
    optimizeOrder: true, locks: [], confirmedConstraints: [], sourceInput: { type: 'manual_menu' } }
  const created = await post(cloudbase, '/planning/jobs/create', { idempotencyKey, request }, auth)
  let job = created.job
  for (let i = 0; i < 120 && ['queued', 'running'].includes(job.taskStatus); i++) {
    await sleep(1000)
    job = (await post(cloudbase, '/planning/jobs/get', { jobId: job.id }, auth)).job
  }
  if (!['succeeded', 'partial'].includes(job.taskStatus) || !job.result?.plan) throw Object.assign(new Error('job incomplete'), { code: job.error?.code || job.taskStatus })
  const draft = (await post(cloudbase, '/planning/drafts/create', { jobId: job.id }, auth)).draft
  const reloaded = (await post(cloudbase, '/planning/drafts/get', { draftId: draft.id }, auth)).draft
  const plan = job.result.plan, leg = plan.legs.find(row => row.mode === 'train')
  const selected = Array.isArray(job.result.transportEvidence?.quotes) ? job.result.transportEvidence.quotes.length : null
  console.log(JSON.stringify({ ok: true, jobId: job.id, draftId: draft.id, taskStatus: job.taskStatus,
    jobPersistence: job.persistence, draftPersistence: reloaded.persistence, feasibility: plan.feasibility,
    hasTrainLeg: Boolean(leg), trainServiceNo: leg?.serviceNo || null, trainEnvironment: leg?.provenance?.environment || null,
    transportQuoteCount: selected, cityExpansionCount: job.result.cityExpansions?.[0]?.candidates?.length || 0,
    errors: plan.validation?.errors?.map(row => row.code) || [], warnings: plan.validation?.warnings?.map(row => row.code) || [] }, null, 2))
}
main().catch(error => { console.error(JSON.stringify({ ok: false, code: error.code || error.name || 'DEPLOYED_ACCEPTANCE_FAILED', status: error.status || error.statusCode || null, message: String(error.message || '').replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 240) })); process.exitCode = 1 })
