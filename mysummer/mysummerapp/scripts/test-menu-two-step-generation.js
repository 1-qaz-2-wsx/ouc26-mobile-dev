/* Run: node mysummerapp/scripts/test-menu-two-step-generation.js
 *
 * 菜单两步生成（2026-09-18 Owner 决定）：
 *   · 只有「地点 / 要求」两步，第 3 步「生成前确认」整块删除；
 *   · 第 2 步底部的唯一主操作是「生成方案」，一次点击就生成并进入方案页；
 *   · 原第 3 步的数据源真实状态压成第 2 步底部一行小字；
 *   · 未登录时明确失败并给「去登录」，不再回退演示方案；
 *   · 方案页「重新生成」把菜单定位回第 2 步。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const menuWxml = read('pages/menu/menu.wxml')
const menuJs = read('pages/menu/menu.js')
const markupCode = markup => markup.replace(/<!--[\s\S]*?-->/g, '')

/* ---- 静态：两个步骤区块，没有第三步 ---- */
assert.ok(menuWxml.includes('<block wx:if="{{step === 2}}">'), '缺少第 2 步「要求」区块')
assert.ok(!menuWxml.includes('wx:if="{{step === 3}}"'), '第 3 步确认页必须删除')
assert.equal(markupCode(menuWxml).includes('生成前确认'), false, '「生成前确认」标题不得回流')
assert.equal(markupCode(menuWxml).includes('本次会生成'), false, '确认页的「本次会生成」区块必须删除')
assert.equal(menuJs.includes('STEP_LABELS = [\'地点\', \'要求\', \'生成\']'), false, '步骤标签必须只剩两项')
assert.ok(menuJs.includes("const STEP_LABELS = ['地点', '要求']"), '步骤标签应为「地点 / 要求」')
assert.ok(!/validateStep\(3\)/.test(menuJs), '不得再有第 3 步校验')
assert.ok(menuJs.includes('capabilitySummary'), '数据源真实状态要压成第 2 步的一行小字')
assert.ok(menuWxml.includes('生成方案'), '第 2 步主操作必须是「生成方案」')
assert.ok(menuWxml.includes('bindtap="login"'), '未登录时必须给出「去登录」入口')
assert.equal(menuJs.includes('generateDemo'), false, '菜单不得再有演示生成分支')

/* ---- 运行时 ---- */
const memory = new Map()
const clone = value => JSON.parse(JSON.stringify(value))
const navTitles = []
let lastNavigation = ''
global.wx = {
  getStorageSync: key => (memory.has(key) ? clone(memory.get(key)) : ''),
  setStorageSync: (key, value) => memory.set(key, clone(value)),
  showToast() {}, showModal: options => options.success({ confirm: true }),
  switchTab: options => { lastNavigation = options.url }, navigateTo: options => { lastNavigation = options.url },
  navigateBack() {}, pageScrollTo() {}, setNavigationBarTitle: options => { navTitles.push(options.title) },
  createSelectorQuery: () => ({ in() { return this }, selectAll() { return this }, boundingClientRect(cb) { cb([]); return this }, exec() {} })
}
let menuStepHint = 0
global.getApp = () => ({ globalData: { get menuStepHint() { return menuStepHint }, set menuStepHint(value) { menuStepHint = value } } })

const store = require('../utils/travel-store')
const engine = require('../utils/travel-engine')
const services = require('../utils/travel-services')

function definitionOf(pagePath) {
  let definition
  const previous = global.Page
  global.Page = value => { definition = value }
  const file = require.resolve('../pages/' + pagePath + '/' + pagePath)
  delete require.cache[file]
  require(file)
  global.Page = previous
  return definition
}
const menuDefinition = definitionOf('menu')
const pdDefinition = definitionOf('plan-detail')
function makePage(definition) {
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(values, callback) {
      Object.keys(values).forEach(key => {
        const parts = key.split('.')
        let target = this.data
        for (let index = 0; index < parts.length - 1; index++) target = target[parts[index]] || (target[parts[index]] = {})
        target[parts[parts.length - 1]] = values[key]
      })
      if (callback) callback()
    }
  })
}

async function main() {
  store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
  store.resetCache()
  store.mutate(state => {
    state.menu = []
    state.requirements = {}
    state.bookings = []
  })
  store.addPlace(engine.seedPlaces[0])
  const page = makePage(menuDefinition)
  page.onShow()
  assert.equal(page.data.steps.length, 2)
  assert.equal(page.data.step, 1)

  page.next()
  assert.equal(page.data.step, 2)
  page.next()
  assert.equal(page.data.step, 2, '第 2 步没有「下一步」，只剩生成')
  assert.equal(navTitles[navTitles.length - 1], '菜单')

  // 未登录：明确失败 + 「去登录」，且不调用任何规划接口。
  let calls = 0
  const originalApi = services.api
  services.api = async () => { calls += 1; return {} }
  await page.generate()
  assert.match(page.data.error, /微信登录/)
  assert.equal(page.data.loginHint, true)
  assert.equal(calls, 0, '未登录时不得发起规划请求')
  page.login()
  assert.equal(lastNavigation, '/pages/me/me', '「去登录」跳「我的」页')
  services.api = originalApi

  // 方案页「重新生成」→ 菜单直接定位到第 2 步。
  menuStepHint = 2
  page.setData({ step: 1 })
  page.onShow()
  assert.equal(page.data.step, 2, 'menuStepHint 必须让菜单停在第 2 步')
  assert.equal(menuStepHint, 0, '提示是一次性的，读后即清')

  // 方案页没有方案时的空态给出「去菜单生成」；有方案时才渲染时间轴。
  const pd = makePage(pdDefinition)
  pd.onLoad({})
  pd.onShow()
  assert.equal(pd.data.ready, false)
  assert.match(pd.data.error, /还没有方案/)
  console.log('PASS menu two-step generation: no confirm step, one-tap generate, capability line,')
  console.log('     login hint for guests and the plan-page「重新生成」hand-off')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
