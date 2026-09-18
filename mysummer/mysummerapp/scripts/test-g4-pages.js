/* Run: node mysummerapp/scripts/test-g4-pages.js
 * 方案页（pages/plan-detail）+ 补充信息页（pages/booking）的静态与运行时验收。
 *
 * 2026-09-18 Owner 定稿版：
 *   1) 方案页只认真实规划结果，版面 = 方案条件（出发与规模 / 预算·预计花费）+ 路线地图 + 按天时间轴 + 底部两键；
 *   2) 可执行性行、待确认清单、费用与数据说明、状态角标全部删除；
 *   3) 方案不可编辑、不支持选择部分重新规划；
 *   4) 补充信息页是纯记录页：无库存核验、无第三方跳转、无「从已有信息自动填入」。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const markupCode = markup => markup.replace(/<!--[\s\S]*?-->/g, '')

/* ------------------------------------------------------------ 1) 标签闭合 */
function assertBalanced(file, markup) {
  const stack = []
  for (const match of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, selfClose] = match
    if (['image', 'input', 'map', 'textarea', 'checkbox', 'switch', 'slider'].includes(tag) && !close) continue
    if (selfClose === '/' ) continue
    if (close === '/') {
      const open = stack.pop()
      assert.equal(open, tag, file + ' 标签未闭合：<' + tag + '> 与 <' + open + '> 不匹配')
    } else stack.push(tag)
  }
  assert.deepEqual(stack, [], file + ' 存在未闭合标签 ' + stack.join(','))
}

/* ------------------------------------------------------------ 2) 类名必须有样式 */
function assertClassesStyled(file, markup, css, prefix) {
  const missing = new Set()
  const check = token => {
    if (!token || token.endsWith('-')) return
    if (!css.includes('.' + token)) missing.add(token)
  }
  for (const match of markup.matchAll(/class="([^"]+)"/g)) {
    const raw = match[1]
    raw.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).forEach(token => check(token.trim()))
    for (const literal of raw.matchAll(/'([^']*)'/g)) {
      const token = literal[1]
      if (token.startsWith(prefix)) check(token)
    }
  }
  assert.deepEqual([...missing], [], file + ' 使用了没有样式规则的类名 ' + [...missing].join(','))
}

;[['pages/plan-detail/plan-detail', 'pd-'], ['pages/booking/booking', 'bk-']].forEach(([base, prefix]) => {
  const markup = read(base + '.wxml')
  assertBalanced(base + '.wxml', markup)
  assertClassesStyled(base + '.wxml', markup, read(base + '.wxss'), prefix)
})

/* ------------------------------------------------------------ 3) 方案页只消费 display */
const pdJs = read('pages/plan-detail/plan-detail.js')
const pdWxml = read('pages/plan-detail/plan-detail.wxml')
const pdCode = pdJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
assert.ok(pdCode.includes('real.displayOf(result)'), '真实方案的用户语义必须来自 result.display')
;['plan.validation', 'costSummary', 'routeAudit', 'cityExpansions', '.journey', 'errors[', 'warnings['].forEach(banned => {
  assert.ok(!pdCode.includes(banned), 'plan-detail.js 不得读取 ' + banned)
})
assert.ok(!/validation|costSummary|routeAudit|cityExpansions|\.message/.test(markupCode(pdWxml)),
  'plan-detail.wxml 不得渲染内部工程字段')
assert.ok(pdWxml.includes('{{row.facts'), '事实行必须来自 display facts')
assert.ok(pdWxml.includes('{{row.options'), '住宿候选必须来自 display options')

/* 2026-09-18：三块旧信息不再上页面（反向断言，防止回流） */
;['可执行性', '待确认事项', '费用与数据说明', '数据说明', 'pd-tag'].forEach(removed => {
  assert.equal(markupCode(pdWxml).includes(removed), false, '方案页不得再渲染：' + removed)
})
const pdHandlers = ['toggle', 'marker', 'supplement', 'regenerate', 'start', 'mapError']
pdHandlers.forEach(name => assert.ok(pdWxml.includes('bindtap="' + name + '"') || pdWxml.includes('bindmarkertap="marker"'),
  'plan-detail 缺少入口 ' + name))
;['bindtap="edit"', 'bindtap="replan"', 'bindtap="buy"', 'bindtap="preview"', 'bindtap="accept"', 'bindtap="select"'].forEach(removed => {
  assert.equal(pdWxml.includes(removed), false, '方案页不得再出现已下线入口：' + removed)
})
;['edit()', 'replan()', 'preview()', 'accept()', 'rebuild(', 'changeItem('].forEach(removed => {
  assert.equal(pdCode.includes(removed), false, 'plan-detail.js 不得保留已下线的编辑/重规划方法：' + removed)
})
assert.ok(pdWxml.includes('出发与规模'), '方案条件必须有「出发与规模」行')
assert.ok(pdWxml.includes('预算 / 预计花费'), '方案条件必须有「预算 / 预计花费」行')
assert.ok(pdWxml.includes('本页不收款、不出票、不代订'), '方案页必须写明购买边界')
assert.ok(pdWxml.includes('房价、库存与可订性未查询'), '住宿候选必须显式表达房价与库存未查询')
assert.ok(pdWxml.includes('只是地图检索到的地点候选'), '住宿候选必须写明只代表地点信息')
assert.ok(pdWxml.includes('＋ 补充信息') || pdWxml.includes('补充信息'), '卡片右下角必须保留补充信息入口')
assert.ok(pdWxml.includes('重新生成') && pdWxml.includes('开启旅程'), '底栏必须是「重新生成 / 开启旅程」')

/* ------------------------------------------------------------ 4) 补充信息页不是收银台 */
const bkWxml = read('pages/booking/booking.wxml')
const bkJs = read('pages/booking/booking.js')
;['￥', '可订', 'bookingUrl', 'purchaseUrl', '立即预订', '库存充足', '房态', '有房', '满房', '去支付', '立即支付', '收银台', 'deeplink'].forEach(word => {
  assert.ok(!markupCode(bkWxml).includes(word), 'booking.wxml 不得出现「' + word + '」')
})
assert.ok(bkWxml.includes('不代订、不出票、不收款'), 'booking 必须写明产品边界')
assert.ok(bkWxml.includes('补充信息'), 'booking 主流程应是补充实际信息')
;['bindtap="check"', 'bindtap="buy"', 'bindtap="copy"', 'bindtap="importOrder"', '从已有信息自动填入'].forEach(removed => {
  assert.equal(bkWxml.includes(removed), false, '补充信息页不得再有：' + removed)
})
;['revalidateQuote', 'openProvider', 'shareText', 'quoteCheck'].forEach(removed => {
  assert.equal(bkJs.includes(removed), false, 'booking.js 不得再引用演示报价/第三方跳转：' + removed)
})
;['车次', '航班号', '酒店名称', '席别', '舱位', '房型', '入住日期', '退房日期'].forEach(label => {
  assert.ok(bkJs.includes(label), '补充信息页缺少字段：' + label)
})

/* ------------------------------------------------------------ 5) 事件名可解析 */
function handlersOf(file) {
  const found = new Set()
  for (const match of read(file).matchAll(/(?:bind|catch)(?:\w+|:\w+)="([a-zA-Z]\w*)"/g)) found.add(match[1])
  return [...found]
}
function definitionOf(pagePath) {
  let definition
  const previous = global.Page
  global.Page = value => { definition = value }
  const file = path.join(ROOT, pagePath)
  delete require.cache[require.resolve(file)]
  require(file)
  global.Page = previous
  return definition
}

const memory = new Map()
const clone = value => JSON.parse(JSON.stringify(value))
let lastNavigation = ''
global.wx = {
  getStorageSync: key => (memory.has(key) ? clone(memory.get(key)) : ''),
  setStorageSync: (key, value) => memory.set(key, clone(value)),
  showToast() {}, showModal: options => options.success({ confirm: true }), pageScrollTo() {},
  switchTab: options => { lastNavigation = options.url }, navigateTo: options => { lastNavigation = options.url }, navigateBack() {}
}
let menuStepHint = 0
global.getApp = () => ({ globalData: { get menuStepHint() { return menuStepHint }, set menuStepHint(value) { menuStepHint = value } } })

const store = require('../utils/travel-store')
const cache = require('../utils/planning-cache')
const pdDefinition = definitionOf('pages/plan-detail/plan-detail')
const bkDefinition = definitionOf('pages/booking/booking')
;[[pdDefinition, 'pages/plan-detail/plan-detail.wxml'], [bkDefinition, 'pages/booking/booking.wxml']].forEach(([definition, file]) => {
  handlersOf(file).forEach(name => {
    assert.equal(typeof definition[name], 'function', file + ' 缺少事件方法 ' + name)
  })
})

/* ------------------------------------------------------------ 6) 方案页运行时投影 */
const display = {
  schemaVersion: 'planning-display.v1',
  header: {
    title: '南岔 · 3 天 2 晚', departureDate: '10-01', dayCount: 3,
    range: '10-01 07:00 → 10-03 20:00', party: '2 位成人 · 1 位儿童',
    feasibility: 'needs_review', coverage: 'partial', dataMode: 'mixed',
    badges: [{ code: 'GENERAL_REVIEW_REQUIRED', text: '待确认 2 项', severity: 'action_required' }],
    cost: {
      status: 'partial', currency: 'CNY', basis: 'party', plannedMinor: 500000,
      knownMinor: 26800, estimatedRange: null, unknownCategories: ['lodging'], dataStatus: 'mixed'
    }
  },
  sections: [
    { id: 'leg:leg-train-1', kind: 'leg', mode: 'train', dayKey: '2026-10-01', title: '长春 → 南岔', subtitle: 'G1234 · 08:00–11:20',
      severity: 'info', dataStatus: 'unknown', collapsed: true,
      facts: [
        { label: '车次', value: 'G1234' }, { label: '时间', value: '08:00–11:20' },
        { label: '来源', value: '测试环境，不能证明生产可购买' },
        { label: '席别', value: '二等座' }, { label: '参考票价', value: '¥612.00 / 人 · 测试环境价，未核验' }
      ],
      options: [], actions: [] },
    { id: 'lodging:night-2026-10-01', kind: 'lodging', dayKey: '2026-10-01', title: '10-01 住宿', subtitle: '附近住宿候选已检索（仅地点信息）',
      severity: 'info', dataStatus: 'live', collapsed: true,
      facts: [{ label: '房间', value: '1 间' }, { label: '价格与库存', value: '未查询' }],
      options: [{ id: 'place-1', name: '南岔某宾馆', address: '南岔区某路', distanceText: '直线约 800 m', dataStatus: 'live' }], actions: [] },
    { id: 'place:item-park', kind: 'place', dayKey: '2026-10-02', title: '南岔森林公园', subtitle: '10-02 · 09:30–13:00',
      severity: 'info', dataStatus: 'live', collapsed: true,
      facts: [{ label: '时间', value: '09:30–13:00' }, { label: '安排', value: '用户指定' }], options: [], actions: [] },
    { id: 'unresolved:MAP_EVIDENCE_UNAVAILABLE:city-harbin', kind: 'unresolved', dayKey: null, title: '城市内景点未确认',
      subtitle: '当前没有可核验的具体景点', severity: 'action_required', dataStatus: 'unknown', collapsed: false,
      facts: [{ label: '地点', value: '哈尔滨' }], options: [], actions: [{ code: 'MAP_EVIDENCE_UNAVAILABLE', label: '稍后重试地点查询' }] }
  ],
  notes: [
    { id: 'note:TEST_ENVIRONMENT:leg-train-1', code: 'TEST_ENVIRONMENT', severity: 'action_required',
      title: '当前交通数据来自测试环境', action: '核对正式班次、库存和价格', sectionId: 'leg:leg-train-1' },
    { id: 'note:TIME_ORDER_CONFLICT:plan', code: 'TIME_ORDER_CONFLICT', severity: 'blocked',
      title: '行程顺序发生时间冲突', action: '调整地点顺序或时间', sectionId: null }
  ]
}
const result = {
  display,
  plan: {
    id: 'plan-g4',
    items: [{ itemId: 'item-park', placeRef: { name: '南岔森林公园', type: 'place', coordinate: { lat: 47.1, lng: 129.2 } } }],
    legs: [],
    inputSnapshot: { origin: { coordinate: { lat: 43.9, lng: 125.3 } } }
  },
  routeAudit: { legs: [] },
  journey: { days: [], lodgingNeeds: [] }
}
store.setSession({ kind: 'wechat', id: 'g4', token: 'g4' })
cache.save(store.sessionIdentity(), result, { jobId: 'job-g4' })
const page = Object.assign({}, pdDefinition, {
  data: clone(pdDefinition.data),
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
page.onLoad({})
page.onShow()

assert.equal(page.data.ready, true)
assert.equal(page.data.scale, '10-01 · 3 天 · 2 位成人 · 1 位儿童', '条件行只由 header 的出发日 / 天数 / 人数拼成')
assert.equal(page.data.cost, '¥5,000 · 已知部分 ¥268', '预算行显示用户预算与已知部分，未知不写成 0')
assert.equal(page.data.pageBlocked, '行程顺序发生时间冲突：调整地点顺序或时间', '只有 blocked 才在页面提示')
const rows = page.data.days.reduce((list, day) => list.concat(day.rows), [])
assert.equal(page.data.days.length, 3, '两个有日期的 dayKey + 一个「日期未定」分组')
assert.equal(page.data.days[2].key, '日期未定', 'dayKey 为 null 的未解决项排到最后')
assert.deepEqual(page.data.counts, { place: 1, leg: 1, lodging: 1 })

const legRow = rows.find(row => row.kind === 'leg')
assert.equal(legRow.title, '火车票 · 长春 → 南岔', '交通卡标题按 display.mode 给出类型')
assert.equal(legRow.line2, '08:00–11:20 · 二等座 · ¥612.00 / 人 · 测试环境价，未核验', '交通卡默认显示 API 的席别与参考票价')
assert.equal(legRow.supplementable, true)
assert.equal(legRow.supplemented, false)
assert.equal(legRow.blockedText, '', 'needs_review 的 note 不再挂到卡片上')
assert.equal(legRow.facts.some(fact => fact.label === '来源'), true, '缺口事实仍保留在展开详情里')

const lodgingRow = rows.find(row => row.kind === 'lodging')
assert.equal(lodgingRow.title, '住宿 · 10-01 住宿')
assert.equal(lodgingRow.options[0].meta, '直线约 800 m · 南岔区某路')
assert.equal(lodgingRow.facts.find(fact => fact.label === '价格与库存').value, '未查询')

const placeRow = rows.find(row => row.kind === 'place')
assert.equal(placeRow.title, '南岔森林公园')
assert.equal(placeRow.line2, '09:30–13:00 · 用户指定')
assert.equal(placeRow.supplementable, false, '地点卡没有可补充的票务信息')

/* 展开 / 收起只改 UI 状态 */
page.toggle({ currentTarget: { dataset: { id: legRow.id } } })
assert.equal(page.data.expanded[legRow.id], true)
page.toggle({ currentTarget: { dataset: { id: legRow.id } } })
assert.equal(page.data.expanded[legRow.id], false)

/* 已补充后卡片换用用户自己记录的信息（不自动继承，只按 planId + sectionId 命中） */
store.saveBooking({ planId: 'plan-g4', sectionId: 'lodging:night-2026-10-01', kind: 'hotel',
  fields: { name: '伊春小旅馆', checkInDate: '10-01', checkOutDate: '10-02', checkInTime: '14:00', checkOutTime: '11:00', roomType: '经济双床房', rooms: '1', nights: '1', unitPrice: '78', totalPrice: '78' } })
page.onShow()
const supplemented = page.data.days.reduce((list, day) => list.concat(day.rows), []).find(row => row.kind === 'lodging')
assert.equal(supplemented.supplemented, true)
assert.equal(supplemented.title, '住宿 · 伊春小旅馆')
assert.equal(supplemented.line2, '10-01 14:00 入住 – 10-02 11:00 退房 · 经济双床房 × 1 间')
assert.equal(supplemented.line3, '¥78 / 晚 · 共 1 晚 ¥78')

/* 补充信息入口带着 planId + sectionId 打开记录页 */
lastNavigation = ''
page.supplement({ currentTarget: { dataset: { section: 'lodging:night-2026-10-01' } } })
assert.match(lastNavigation, /^\/pages\/booking\/booking\?sectionId=lodging%3Anight-2026-10-01/)
assert.match(lastNavigation, /planId=plan-g4/)

/* 重新生成 = 回菜单第 2 步改条件 */
lastNavigation = ''
page.regenerate()
assert.equal(menuStepHint, 2, '重新生成必须把菜单定位到「要求」步')
assert.equal(lastNavigation, '/pages/menu/menu')

console.log('PASS G4 pages: display-only plan page (two condition rows, timeline, supplement entry),')
console.log('     blocked-only warning, booking record page without checkout, and no edit/replan entry')
