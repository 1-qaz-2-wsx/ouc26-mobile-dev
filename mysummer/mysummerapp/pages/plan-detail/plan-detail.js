const store = require('../../utils/travel-store')
const cache = require('../../utils/planning-cache')
const ui = require('../../utils/travel-ui')
const real = require('../../utils/real-planning')
const planView = require('../../utils/plan-view')

// 旅行方案页（2026-09-18 Owner 定稿版）
//
// 版面真值：方案条件（出发与规模 / 预算·预计花费）→ 路线地图 → 按天时间轴 → 底部「重新生成 / 开启旅程」。
// 页面只承载真实规划结果：
//   · 用户可见语义只来自 result.display（planning-display.v1）；
//   · 不展示可执行性、待确认清单、费用口径与任何状态角标；
//   · 缺口不消失——「未查询 / 测试环境」等字样仍留在卡片展开详情里的 facts 内，
//     未知金额一律不显示金额行，绝不写成 ¥0；
//   · 方案不再可编辑、不再支持选择部分重新规划（Owner 2026-09-18 决定）。
const KIND_OF = { place: 'place', leg: 'leg', lodging: 'lodging', unresolved: 'unresolved' }
const LEG_TEXT = { train: '火车票', flight: '航班' }

function text(value, fallback) {
  const out = value === undefined || value === null ? '' : String(value)
  return out.trim() || (fallback === undefined ? '' : fallback)
}

function money(minor) {
  if (!Number.isInteger(minor)) return ''
  const yuan = minor / 100
  const text = Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2)
  // 千分位与设计稿一致（¥8,000 / ¥7,428）；小数只在真的有时才出现。
  return '¥' + text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function targetOf(id) {
  const value = text(id)
  const index = value.indexOf(':')
  return index >= 0 ? value.slice(index + 1) : value
}

// 锚点 id 只允许字母/数字/下划线/连字符：section id 可能含 ':'，直接进 selector 会失败。
function domOf(id) {
  return 'pd-' + text(id).replace(/[^a-zA-Z0-9_-]/g, '_')
}

function factOf(section, label) {
  const facts = Array.isArray(section && section.facts) ? section.facts : []
  const hit = facts.find(fact => fact && fact.label === label)
  return hit ? text(hit.value) : ''
}

function factsOf(section) {
  const facts = Array.isArray(section && section.facts) ? section.facts : []
  return facts.filter(fact => fact && (text(fact.label) || text(fact.value)))
    .map(fact => ({ label: text(fact.label), value: text(fact.value, '待确认') }))
}

function optionsOf(section) {
  const options = Array.isArray(section && section.options) ? section.options : []
  return options.filter(option => option && text(option.name)).map(option => ({
    id: text(option.id, text(option.name)),
    name: text(option.name),
    meta: [text(option.distanceText), text(option.address)].filter(Boolean).join(' · ')
  }))
}

function actionsOf(section) {
  const actions = Array.isArray(section && section.actions) ? section.actions : []
  return actions.map(action => text(action && action.label)).filter(Boolean)
}

// 条件行：出发与规模（MM-DD · N 天 · M 人）。
function scaleText(header) {
  const parts = []
  if (text(header.departureDate)) parts.push(text(header.departureDate))
  if (Number.isInteger(header.dayCount) && header.dayCount > 0) parts.push(header.dayCount + ' 天')
  if (text(header.party)) parts.push(text(header.party))
  return parts.join(' · ')
}

// 条件行：预算 / 预计花费。预计金额只在后端给出可解释金额时显示；未知时写「待查询」，不显示 0。
function costText(cost) {
  if (!cost) return ''
  const parts = []
  if (Number.isInteger(cost.plannedMinor)) {
    const planned = money(cost.plannedMinor)
    parts.push(cost.basis === 'person' ? planned + ' / 人' : planned)
  }
  const known = money(cost.knownMinor)
  if (known && cost.status === 'known') parts.push('预计 ' + known)
  else if (known) parts.push('已知部分 ' + known)
  else if (cost.estimatedRange && Number.isInteger(cost.estimatedRange.minMinor) && Number.isInteger(cost.estimatedRange.maxMinor)) {
    parts.push('预计 ' + money(cost.estimatedRange.minMinor) + '–' + money(cost.estimatedRange.maxMinor))
  } else if (parts.length) parts.push('预计花费待查询')
  return parts.join(' · ')
}

// 卡片 = display section + 用户已补充信息。文案只来自 display / 用户输入，页面不另写业务映射。
function cardOf(section, context) {
  const sectionId = text(section.id)
  const kind = KIND_OF[section.kind] || 'unresolved'
  const id = targetOf(sectionId) || sectionId
  const booking = context.bookings[sectionId] || null
  const fields = (booking && booking.fields) || {}
  const supplemented = Boolean(booking)
  const card = {
    id, domId: domOf(id), sectionId, kind,
    dayKey: text(section.dayKey),
    title: '', line2: text(section.subtitle), line3: '',
    facts: factsOf(section), options: [], actions: actionsOf(section),
    // 接驳段没有票可补，只保留车票 / 航班 / 住宿三类入口。
    supplementable: kind === 'lodging' || (kind === 'leg' && text(section.mode) !== 'unknown' && ['train', 'flight'].includes(text(section.mode))),
    supplemented,
    blockedText: text(context.blockedBySection[sectionId])
  }
  if (kind === 'lodging') {
    card.title = supplemented ? '住宿 · ' + text(fields.name, '已记录住宿') : '住宿 · ' + text(section.title, '住宿')
    if (supplemented) {
      const checkIn = [text(fields.checkInDate), text(fields.checkInTime)].filter(Boolean).join(' ')
      const checkOut = [text(fields.checkOutDate), text(fields.checkOutTime)].filter(Boolean).join(' ')
      const stay = [checkIn ? checkIn + ' 入住' : '', checkOut ? checkOut + ' 退房' : ''].filter(Boolean).join(' – ')
      const room = [text(fields.roomType), text(fields.rooms) ? text(fields.rooms) + ' 间' : ''].filter(Boolean).join(' × ')
      card.line2 = [stay, room].filter(Boolean).join(' · ') || card.line2
      card.line3 = [
        text(fields.unitPrice) ? '¥' + text(fields.unitPrice) + ' / 晚' : '',
        text(fields.totalPrice) ? '共 ' + (text(fields.nights) ? text(fields.nights) + ' 晚 ' : '') + '¥' + text(fields.totalPrice) : ''
      ].filter(Boolean).join(' · ')
    }
    card.options = optionsOf(section)
  } else if (kind === 'leg') {
    card.title = (LEG_TEXT[text(section.mode)] || '接驳') + ' · ' + text(section.title, '交通段')
    card.line2 = [factOf(section, '时间'), factOf(section, '席别'), factOf(section, '参考票价')]
      .filter(Boolean).join(' · ') || card.line2
    if (supplemented) {
      const recorded = [
        text(fields.serviceNo) || text(fields.flightNo),
        text(fields.seatClass) || text(fields.cabin),
        text(fields.unitPrice) ? '¥' + text(fields.unitPrice) + (text(fields.quantity) ? ' × ' + text(fields.quantity) : '') : ''
      ].filter(Boolean)
      card.line3 = recorded.length ? '你已记录：' + recorded.join(' · ') : ''
    }
  } else if (kind === 'place') {
    card.title = text(section.title, '地点')
    card.line2 = [factOf(section, '时间'), factOf(section, '安排')].filter(Boolean).join(' · ') || card.line2
  } else {
    card.title = text(section.title, '待确认项')
    card.line2 = text(section.subtitle)
  }
  card.hasDetail = Boolean(card.facts.length || card.options.length || card.actions.length)
  return card
}

function groupDays(cards) {
  const groups = []
  const index = Object.create(null)
  let dayNumber = 0
  cards.forEach(card => {
    const key = text(card.dayKey) || '日期未定'
    if (!index[key]) {
      const dated = key !== '日期未定'
      if (dated) dayNumber++
      index[key] = { key, label: dated ? '第 ' + dayNumber + ' 天' : '日期未定', date: dated ? key : '', rows: [], noActivities: true }
      groups.push(index[key])
    }
    const group = index[key]
    group.rows.push(card)
    if (card.kind === 'place') group.noActivities = false
  })
  return groups.sort((a, b) => a.key.localeCompare(b.key))
}

Page({
  data: {
    error: '', busy: false, ready: false, mapFailed: false,
    planId: '', sectionCount: 0,
    scale: '', cost: '', pageBlocked: '',
    days: [], counts: { place: 0, leg: 0, lodging: 0 }, entryCount: 0,
    map: null, expanded: {}, selected: ''
  },

  onLoad() {
    // 方案页只有一种来源：真实规划结果。本地方案链路已下线（Owner 2026-09-18）。
    this.setData({ ready: false })
  },

  onShow() { this.load() },

  load() {
    const identity = store.sessionIdentity()
    this.identity = identity
    const entry = cache.readEntry(identity)
    const result = entry && entry.result
    this.raw = result
    this.jobId = (entry && entry.jobId) || ''
    if (!result) {
      this.setData({ ready: false, error: '当前账号还没有方案，请先在菜单里生成。', map: null })
      return
    }
    ui.run(this, () => this.render(result))
  },

  render(result) {
    const display = real.displayOf(result)
    const header = (display && display.header) || {}
    const sections = (display && Array.isArray(display.sections)) ? display.sections : []
    const notes = (display && Array.isArray(display.notes)) ? display.notes : []
    const planId = text(result.plan && result.plan.id)
    const bookings = {}
    store.listBookings(planId).forEach(row => { bookings[row.sectionId] = row })
    // 只有 blocked 才在页面上提示（Owner 决定：不拦开启）；needs_review / info 不再上页面。
    const blockedBySection = {}
    let pageBlocked = ''
    notes.filter(note => note && note.severity === 'blocked').forEach(note => {
      const line = [text(note.title), text(note.action)].filter(Boolean).join('：')
      if (note.sectionId) {
        if (!blockedBySection[note.sectionId]) blockedBySection[note.sectionId] = line
      } else if (!pageBlocked) pageBlocked = line
    })
    const cards = sections.map(section => cardOf(section, { bookings, blockedBySection }))
    const days = groupDays(cards)
    // 地图折线 / 标记仍是唯一的纯几何通道（utils/plan-view.js → real-plan-map.js）。
    const map = planView.mapFor('real', result, this.data.selected)
    const counts = { place: 0, leg: 0, lodging: 0 }
    cards.forEach(card => { if (counts[card.kind] !== undefined) counts[card.kind]++ })
    this.setData({
      ready: true, error: '', mapFailed: false, planId,
      sectionCount: cards.length,
      scale: scaleText(header),
      cost: costText(header.cost),
      pageBlocked,
      days, counts,
      entryCount: counts.place + counts.leg + counts.lodging,
      map,
      expanded: {},
      selected: ''
    })
  },

  // 展开详情只改本机 UI 状态，不回写任何数据。
  toggle(e) {
    const id = e.currentTarget.dataset.id
    const expanded = Object.assign({}, this.data.expanded)
    expanded[id] = !expanded[id]
    this.setData({ expanded })
  },

  marker(e) {
    const markers = (this.data.map && this.data.map.markers) || []
    const marker = markers.find(m => m.id === Number(e.detail.markerId))
    if (!marker) return
    const rows = this.data.days.reduce((list, day) => list.concat(day.rows), [])
    const card = rows.find(row => row.id === marker.itemId) || rows.find(row => row.id === marker.stopId)
    if (!card) return
    this.setData({ expanded: Object.assign({}, this.data.expanded, { [card.id]: true }), selected: card.id })
    setTimeout(() => { try { wx.pageScrollTo({ selector: '#' + card.domId, duration: 250 }) } catch (error) { /* 目标不在当前渲染中时忽略 */ } }, 60)
  },

  mapError() { this.setData({ mapFailed: true }) },

  // 补充信息（可选）：车票 / 航班 / 住宿三类共用 pages/booking。
  supplement(e) {
    const sectionId = e.currentTarget.dataset.section
    if (!sectionId) return
    ui.open('booking', 'sectionId=' + encodeURIComponent(sectionId) + '&planId=' + encodeURIComponent(this.data.planId) + '&jobId=' + encodeURIComponent(this.jobId || ''))
  },

  // 重新生成 = 回菜单第 2 步改条件（Owner 决定：方案页不提供就地编辑或部分重规划）。
  regenerate() {
    if (typeof getApp === 'function') {
      const app = getApp()
      if (app && app.globalData) app.globalData.menuStepHint = 2
    }
    ui.tab('menu')
  },

  async start() {
    if (this.data.busy) return
    const result = this.raw
    if (!result) { ui.fail(this, new Error('当前账号还没有方案，请先在菜单里生成')) ; return }
    this.setData({ busy: true, error: '' })
    try {
      // 开启行程不需要登录：游客也能先在本机开启与记录，登录后随既有同步上云。
      store.startTripFromReal(result, { jobId: this.jobId })
      // 开启行程后菜单归零：地点清空、要求回默认值；下一次是全新一趟。
      store.mutate(state => { state.menu = []; state.requirements = {} })
      await new Promise(resolve => wx.showModal({
        title: '行程已开启',
        content: '菜单已清空，可以开始规划下一趟旅行。行程页里可以逐项记录见闻与照片。',
        showCancel: false,
        confirmText: '查看行程',
        success: resolve,
        fail: resolve
      }))
      ui.tab('itinerary')
    } catch (error) {
      ui.fail(this, error)
    } finally {
      this.setData({ busy: false })
    }
  }
})
