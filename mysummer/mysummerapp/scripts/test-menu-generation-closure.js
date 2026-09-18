// Offline menu -> verified-owner API -> job -> account cache -> result page.
// Provider facts are fixtures; this does not establish real supplier executability.
const assert = require('node:assert/strict')
const memory = new Map()
global.wx = { getStorageSync: key => memory.get(key) || '', setStorageSync: (key, value) => memory.set(key, value), showToast() {} }
const store = require('../utils/travel-store')
const services = require('../utils/travel-services')
const cache = require('../utils/planning-cache')
const ui = require('../utils/travel-ui')
const { createPlanningService } = require('../../backend/src/planning/service')
const { createPlanningApi } = require('../../backend/src/planning/http-api')
let definition
global.Page = value => { definition = value }
require('../pages/menu/menu')
const menuDefinition = definition
require('../pages/plan-detail/plan-detail')
const resultDefinition = definition
const place = { id: 'visit', providerId: 'fixture-place', name: '测试地点', latitude: 43, longitude: 125, stayDays: 1 }
const req = { origin: place.name, originPlace: place, startDate: '2026-09-17', days: 2, people: 1, budget: 1000,
  budgetType: '全团', modes: ['自驾'], pace: '均衡', preference: '自然', needHotel: false }
const clone = value => JSON.parse(JSON.stringify(value))
function page(value) { return { ...value, data: clone(value.data), setData(values) { Object.assign(this.data, values) } } }
function menuPage() { const instance = page(menuDefinition); instance.data.req = clone(req); instance.data.menu = [clone(place)]; instance.validateStep = () => true; return instance }
async function main() {
  store.setSession({ kind: 'wechat', id: 'alice', token: 'fixture-token' })
  const planning = createPlanningService()
  const handle = createPlanningApi({ planning, enabled: true, verify: token => token === 'fixture-token' ? { id: 'alice' } : null })
  const calls = []
  // 与 app.js 的分发保持一致：/planning/requests/validate 与 /planning/capabilities
  // 由 planningService 直接处理，不走 createPlanningApi（后者只管 jobs / drafts）。
  const dispatch = (path, data) => {
    calls.push(path)
    if (path === '/planning/requests/validate') return planning.validateRequest(data)
    if (path === '/planning/capabilities') return planning.capabilities()
    return handle(path, data, { headers: { authorization: 'Bearer fixture-token' } })
  }
  services.api = async (path, data) => dispatch(path, data)
  const opened = []
  ui.open = (name, query) => opened.push(query ? name + '?' + query : name)
  const instance = menuPage()
  await instance.generate()
  assert.equal(instance.data.busy, false)
  // 真实草案与本地演示方案共用方案页，靠 source=real 区分。
  assert.deepEqual(opened, ['plan-detail?source=real'])
  assert.ok(calls.includes('/planning/jobs/create'))
  assert.ok(calls.includes('/planning/requests/validate'), 'submit must confirm against the server-side plan-request contract first')
  assert.ok(calls.indexOf('/planning/requests/validate') < calls.indexOf('/planning/jobs/create'), 'server validation must precede job creation')
  assert.ok(cache.read(store.sessionIdentity()).plan)
  const result = page(resultDefinition)
  result.onLoad({ source: 'real' })
  result.onShow()
  // 2026-09-18 版面：条件行只有「出发与规模 / 预算·预计花费」，正文是按天时间轴。
  assert.equal(result.data.ready, true)
  assert.match(result.data.scale, /09-17/)
  assert.match(result.data.scale, /2 天/)
  assert.ok(result.data.days.length > 0, '方案页必须给出按天时间轴')
  assert.ok(result.data.days.some(day => day.rows.length > 0), '至少一天要有安排')
  assert.ok(!JSON.stringify(result.data).includes('DEMO-'))
  await assert.rejects(handle('/planning/jobs/get', { jobId: instance.data.jobId }, { headers: { authorization: 'Bearer other-user' } }), { code: 'UNAUTHENTICATED' })

  const changed = menuPage()
  opened.length = 0
  services.api = async (path, data) => {
    const response = await dispatch(path, data)
    if (path.endsWith('/create')) changed.data.req.budget = 2000
    return response
  }
  await changed.generate()
  assert.deepEqual(opened, [], 'old-conditions result never auto-opens after requirements changed')
  assert.match(changed.data.error, /已修改条件/)
  assert.equal(changed.latestRawResult.plan.inputSnapshot.budget.amountMinor, 100000)

  const disabled = menuPage()
  services.api = async () => { throw Object.assign(new Error('disabled'), { code: 'PLANNING_NOT_ENABLED', status: 503 }) }
  await disabled.generate()
  assert.match(disabled.data.error, /未启用真实规划/)
  assert.equal(disabled.latestRawResult, undefined, 'disabled backend never creates a demo fallback')
  assert.equal(disabled.data.busy, false)
  console.log('PASS offline default menu generation -> owned job -> cached real result; changed-input and disabled-backend guards')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
