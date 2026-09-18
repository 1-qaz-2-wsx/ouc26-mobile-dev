/* Run: node mysummerapp/scripts/test-menu-interactions.js
   Pure Node interaction tests; all wx APIs are mocked. */
const assert = require('node:assert/strict')

const memory = new Map()
let lastNavigation = ''
// 锚点跳转与动态导航栏标题必须可断言：pageScrollTo 静默 no-op 是 B1/B2 的失效方式，
// 把 mock 成空函数等于放弃对它的覆盖。
const scrollCalls = []
const navTitles = []

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const clearScroll = () => { scrollCalls.length = 0 }

global.wx = {
  getStorageSync: key => memory.has(key) ? clone(memory.get(key)) : '',
  setStorageSync: (key, value) => memory.set(key, clone(value)),
  showToast: () => {},
  showModal: options => options.success({ confirm: true }),
  navigateTo: options => { lastNavigation = options.url },
  switchTab: options => { lastNavigation = options.url },
  navigateBack: () => {},
  pageScrollTo: options => { scrollCalls.push(options || {}) },
  setNavigationBarTitle: options => { navTitles.push(options && options.title) },
  createSelectorQuery: () => ({
    in() { return this },
    selectAll() { return this },
    boundingClientRect(callback) {
      callback([{ top: 0, bottom: 100 }, { top: 101, bottom: 200 }])
      return this
    },
    exec() {}
  })
}

const store = require('../utils/travel-store')
const engine = require('../utils/travel-engine')
const services = require('../utils/travel-services')

function page(name) {
  let definition
  global.Page = value => { definition = value }
  const file = require.resolve('../pages/' + name + '/' + name)
  delete require.cache[file]
  require(file)
  const instance = Object.assign({}, definition, {
    data: clone(definition.data || {}),
    // setData 必须执行回调：focusError 是在 setData 回调里发起的，
    // 不执行回调会让锚点跳转在测试中永远不被覆盖。
    setData(values, callback) {
      Object.keys(values).forEach(key => {
        const parts = key.split('.')
        let target = this.data
        parts.slice(0, -1).forEach(part => { target = target[part] || (target[part] = {}) })
        target[parts[parts.length - 1]] = values[key]
      })
      if (typeof callback === 'function') callback()
    }
  })
  if (instance.onShow) instance.onShow()
  return instance
}

function event(dataset, value) {
  return { currentTarget: { dataset }, detail: { value } }
}

async function main() {
  memory.set(store.PREFIX + ':session', { kind: 'guest', id: 'guest', nickname: '游客' })
  store.resetCache()
  store.mutate(state => {
    state.menu = []
    state.requirements = {}
    state.plans = []
  })

  const firstPlace = engine.seedPlaces[0]
  const secondPlace = engine.seedPlaces[1]
  const menuPage = page('menu')

  assert.equal(menuPage.data.step, 1)
  assert.equal(menuPage.data.stepOneReady, false)
  assert.deepEqual(navTitles, ['菜单'], 'step 1 keeps the native title 菜单')
  // 2026-09-18 Owner 决定：生成收敛成两步（地点 / 要求），第 3 步「生成前确认」删除。
  assert.equal(menuPage.data.steps.length, 2, 'the progress bar now renders two segments')
  assert.equal(menuPage.data.steps.filter(item => item.done || item.current).length, 1,
    'only one segment is highlighted on the first step')
  assert.equal(menuPage.data.steps[0].current, true)

  clearScroll()
  menuPage.next()
  assert.equal(menuPage.data.step, 1, 'empty menu cannot advance')
  assert.match(menuPage.data.error, /地图上选择地点/)
  await wait(120)
  // B1：菜单为空时 #menu-list 因 wx:if 不存在，selector 会静默 no-op，必须退回顶部。
  assert.deepEqual(scrollCalls, [{ scrollTop: 0, duration: 220 }],
    'empty menu has no rendered #menu-list, so the stop error scrolls to the top instead')

  menuPage.add()
  assert.equal(lastNavigation, '/pages/index/index', 'empty state opens the map')
  store.addPlace(firstPlace)
  store.addPlace(secondPlace)
  menuPage.onShow()
  assert.equal(menuPage.data.stepOneReady, true)
  assert.equal(menuPage.data.totalDays, 2)

  clearScroll()
  menuPage.focusError({ stops: '同一地点不能重复添加' }, 1)
  await wait(120)
  assert.deepEqual(scrollCalls, [{ selector: '#menu-list', duration: 220 }],
    'step 1 with a rendered list uses the #menu-list anchor')

  menuPage.toggleNote(event({ id: firstPlace.id }))
  assert.equal(menuPage.data.expandedNotes[firstPlace.id], true)
  menuPage.editStop(event({ id: firstPlace.id, field: 'note' }, '想看日出'))
  menuPage.adjustStay(event({ id: firstPlace.id, delta: '1' }))
  assert.equal(store.read().menu.find(place => place.id === firstPlace.id).stayDays, 2)
  assert.equal(store.read().menu.find(place => place.id === firstPlace.id).note, '想看日出')

  // B4：手输停留天数必须与 adjustStay 用同一套范围规则，脏值不得写进本机存储。
  menuPage.editStop(event({ id: firstPlace.id, field: 'stayDays' }, '0'))
  assert.equal(store.read().menu.find(place => place.id === firstPlace.id).stayDays, 1, 'typed 0 is clamped up to 1')
  menuPage.editStop(event({ id: firstPlace.id, field: 'stayDays' }, '99'))
  assert.equal(store.read().menu.find(place => place.id === firstPlace.id).stayDays, 30, 'typed 99 is clamped down to 30')
  menuPage.editStop(event({ id: firstPlace.id, field: 'stayDays' }, 'abc'))
  assert.equal(store.read().menu.find(place => place.id === firstPlace.id).stayDays, 1, 'a non numeric entry falls back to 1')
  menuPage.editStop(event({ id: firstPlace.id, field: 'stayDays' }, '2'))
  assert.equal(store.read().menu.find(place => place.id === firstPlace.id).stayDays, 2, 'a valid entry is stored as typed')

  menuPage.dragStart({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(menuPage.data.draggingIndex, 0, 'long press starts destination dragging')
  menuPage.dragMove({ touches: [{ clientY: 150 }] })
  assert.equal(menuPage.data.dragOverIndex, 1, 'drag target follows the touch position')
  menuPage.dragEnd()
  assert.equal(menuPage.data.menu[0].id, secondPlace.id, 'destination order is persisted')
  menuPage.next()
  assert.equal(menuPage.data.step, 2)

  menuPage.field(event({ field: 'days' }, '1'))
  menuPage.fieldBlur(event({ field: 'days' }))
  assert.match(menuPage.data.errors.days, /超过旅行天数/)
  clearScroll()
  // 第 2 步没有「下一步」：校验由「生成方案」触发，失败时停在原页并跳到对应锚点。
  await menuPage.generate()
  assert.equal(menuPage.data.step, 2, 'invalid duration cannot submit generation')
  await wait(120)
  assert.deepEqual(scrollCalls, [{ selector: '#field-days', duration: 220 }],
    'step 2 validation scrolls to the rendered #field-days anchor')

  menuPage.field(event({ field: 'days' }, '4'))
  menuPage.fieldBlur(event({ field: 'days' }))
  menuPage.modes(event({}, []))
  clearScroll()
  await menuPage.generate()
  assert.match(menuPage.data.errors.modes, /至少接受一种交通方式/)
  assert.equal(menuPage.data.step, 2, 'empty transport modes cannot submit generation')
  await wait(120)
  assert.deepEqual(scrollCalls, [{ selector: '#field-modes', duration: 220 }],
    'the transport-mode error scrolls to its own anchor')

  menuPage.modes(event({}, ['飞机']))
  menuPage.toggle(event({ field: 'needHotel' }, false))
  menuPage.next()
  assert.equal(menuPage.data.step, 2, '要求页就是最后一步，next() 不再推进到确认页')
  assert.equal(menuPage.data.steps.filter(item => item.done || item.current).length, 2,
    'two segments are filled on the requirements step')
  assert.equal(navTitles[navTitles.length - 1], '菜单', '两步都使用原生标题「菜单」')

  // B2：focusError 必须只落在当前步骤真的渲染出来的锚点上。
  clearScroll()
  menuPage.focusError({ stops: '同一地点不能重复添加', preference: '请选择自然/人文偏好' }, 2)
  await wait(120)
  assert.deepEqual(scrollCalls, [{ scrollTop: 0, duration: 220 }],
    '要求页没有 #menu-list，stops 错误必须退回顶部而不是静默 no-op')

  menuPage.goStep(event({ step: '2' }))
  assert.equal(menuPage.data.step, 2, 'the progress bar cannot jump to the step already shown')
  menuPage.goStep(event({ step: '3' }))
  assert.equal(menuPage.data.step, 2, 'the progress bar cannot jump forward beyond the last step')
  menuPage.goStep(event({ step: '1' }))
  assert.equal(menuPage.data.step, 1, 'the progress bar can go back')
  menuPage.next()
  assert.equal(menuPage.data.step, 2, 'going back then forward returns to 要求')

  // Owner 2026-09-18 决议：「更多条件」「高级规划设置」已从本页删除。
  // 存量 storage 可能残留失效枚举与自由文本：读入时必须归一，否则用户会被一个
  // 页面上已无处修改的错误卡住，而 #field-preference 锚点也已不存在。
  store.mutate(state => {
    state.requirements = Object.assign({}, state.requirements, {
      preference: '不是有效偏好',
      pace: '不存在的节奏',
      specialNeeds: '残留文本'
    })
  })
  clearScroll()
  menuPage.onShow()
  assert.equal(menuPage.data.req.preference, '自然', 'invalid stored preference is normalized on load')
  assert.equal(menuPage.data.req.pace, '均衡', 'invalid stored pace is normalized on load')
  assert.equal(menuPage.data.req.specialNeeds, '', 'free-text leftovers are cleared so real planning is not rejected')
  assert.equal(menuPage.data.errors.preference, undefined, 'no unfixable field error survives the normalization')
  menuPage.next()
  assert.equal(menuPage.data.step, 2, 'normalized requirements stay on the last step')

  // B5：只允许取消「正在生成中」的任务；已完成任务的 jobId 仍留在 data 里。
  const originalApi = services.api
  const apiPaths = []
  services.api = async path => { apiPaths.push(path); return {} }
  menuPage.setData({ busy: false, jobId: 'job-finished' })
  await menuPage.cancelReal()
  assert.deepEqual(apiPaths, [], 'a finished job is never cancelled')
  menuPage.setData({ busy: true, jobId: 'job-running' })
  await menuPage.cancelReal()
  assert.deepEqual(apiPaths, ['/planning/jobs/cancel'], 'only a running job can be cancelled')
  services.api = originalApi
  menuPage.setData({ busy: false, jobId: '' })

  // 2026-09-18：未登录不再回退演示方案，而是明确失败并给出「去登录」。
  await menuPage.generate()
  assert.match(menuPage.data.error, /微信登录/)
  assert.equal(menuPage.data.loginHint, true, '未登录时底栏换成「去登录」')
  menuPage.setData({ error: '', loginHint: false })

  // 真实生成：一次点击只提交一次，成功后直接进入方案页（没有第 3 步确认页）。
  store.setSession({ kind: 'wechat', id: 'menu-real', token: 'menu-real-token' })
  // 旅行数据按账号隔离：切到微信账号后这份 storage 是空的，需要重新选点。
  store.addPlace(firstPlace)
  store.addPlace(secondPlace)
  // 真实规划要求出发地来自地图确认（originPlace 带坐标），这里补一份最小可用值。
  store.mutate(state => {
    state.requirements = Object.assign({}, state.requirements, {
      origin: '长春站',
      originPlace: { name: '长春站', latitude: 43.8171, longitude: 125.3235, providerId: 'origin-1' }
    })
  })
  menuPage.onShow()
  const paths = []
  let createCount = 0
  let release
  const fakeResult = {
    schemaVersion: 'planning-result.v1',
    plan: { id: 'plan-menu-real', inputSnapshot: { startAt: '2026-09-17T08:00:00+08:00', endBy: '2026-09-20T20:00:00+08:00' } },
    display: { schemaVersion: 'planning-display.v1', header: {}, sections: [], notes: [] }
  }
  services.api = (path, data) => {
    paths.push(path)
    if (path === '/planning/requests/validate') return Promise.resolve({ ok: true })
    if (path === '/planning/jobs/create') {
      createCount += 1
      return new Promise(resolve => { release = () => resolve({ ok: true, job: { id: 'job-menu-real', taskStatus: 'succeeded', result: fakeResult } }) })
    }
    return Promise.resolve({ ok: true, job: { id: 'job-menu-real', taskStatus: 'succeeded', result: fakeResult } })
  }
  const firstGenerate = menuPage.generate()
  const duplicateGenerate = menuPage.generate()
  assert.equal(menuPage.data.busy, true)
  // 服务端契约校验是 await：让出若干个微任务，等第一份请求真正走到 jobs/create。
  for (let tick = 0; tick < 20 && !createCount; tick++) await Promise.resolve()
  assert.equal(createCount, 1, 'generation is not submitted twice')
  release()
  await Promise.all([firstGenerate, duplicateGenerate])
  services.api = originalApi
  assert.equal(menuPage.data.busy, false)
  assert.deepEqual(paths.slice(0, 2), ['/planning/requests/validate', '/planning/jobs/create'],
    '提交前必须先用服务端契约校验，再创建任务')
  assert.equal(lastNavigation, '/pages/plan-detail/plan-detail?source=real',
    '生成成功后直接进入方案页，不需要第二次点击')
  assert.equal(store.read().plans.length, 0, '真实方案不再写入本机演示方案列表')

  await menuPage.remove(event({ id: firstPlace.id }))
  assert.equal(store.read().menu.length, 1, 'delete uses the destination button and persists the removal')

  await menuPage.clear()
  assert.equal(menuPage.data.step, 1)
  assert.equal(store.read().menu.length, 0)
  assert.equal(navTitles[navTitles.length - 1], '菜单', 'clearing the menu returns to the 菜单 title')
  console.log('PASS menu wizard, validation, draft persistence, hotel toggle, duplicate-submit guard,')
  console.log('     anchor focus safety (B1/B2), typed stay-day clamping (B4), cancel guard (B5)')
  console.log('     and the 2026-09-18 two-step generation flow (no demo fallback)')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
