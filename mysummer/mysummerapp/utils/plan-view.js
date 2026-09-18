// 统一的「方案视图模型」。
//
// 2026-09-18 状态：本地方案链路已下线，页面只保留 mapFor（纯几何通道）给方案页使用；
// fromLocal / fromReal / SOURCE_TEXT 属 LEGACY（仅 test-plan-view.js 仍在校验形状），
// 后续清理演示方案时一并删除。
//
// 项目里同时存在两种方案：
//   local —— 本地演示库存方案（travel-engine + supplier-adapters），商品可展开、可编辑、可预订；
//   real  —— 后端真实数据草案（planning 服务），只读，改条件要回菜单。
// 两者字段形状完全不同，但「打开一份方案看结果」需要的东西是同一套：条件摘要、整体状态、
// 待补齐的缺口、按天的行程、以及地图。本模块把两种形状归一化成同一份页面数据，方案页因此
// 只写一套头部、缺口清单与地图，差异只剩「结果行是否可展开编辑」和可用操作。
const engine = require('./travel-engine')
const real = require('./real-planning')
const realMap = require('./real-plan-map')

const SOURCE_TEXT = {
  local: '本地演示库存：班次、房源与价格为演示数据，不代表可购买',
  real: '真实数据草案：待核实，不能直接预订或开始执行'
}

function text(value, fallback) {
  const out = value === undefined || value === null ? '' : String(value)
  return out.trim() || (fallback === undefined ? '' : fallback)
}

function row(label, value, fallback) {
  return { label, value: text(value, fallback || '—') }
}

function amount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? '¥' + number.toFixed(2) : '未知'
}

function toneOf(status) {
  if (status === 'blocked') return 'risk'
  if (status === 'ready') return 'ok'
  return 'warn'
}

// display → marker 文案。只做「section id → 文案」关联（契约 §4.1 允许用 section id 做地图聚焦），
// 不反向解析 facts 的内容：place section 用 title，城市锚点用 unresolved section 的「城市」fact。
function markerLabels(display) {
  const labels = new Map()
  for (const section of display.sections || []) {
    if (!section || !section.id) continue
    const id = String(section.id)
    if (section.kind === 'place') labels.set(id.slice(id.indexOf(':') + 1), text(section.title))
    else if (section.kind === 'unresolved') {
      const facts = Array.isArray(section.facts) ? section.facts : []
      const city = facts.find(fact => fact && fact.label === '城市')
      if (city) labels.set(id.slice(id.lastIndexOf(':') + 1), text(city.value))
    }
  }
  return labels
}

// 地图的两套语义集中在这里，避免 fromXxx 与页面换选中项时各写一遍。
// 真实草案没有 stops 顺序线，显式给空 includePoints，让两源共用同一个 <map> 属性集。
//
// 几何（坐标 / polyline / includePoints / marker id）是唯一允许继续读原始 result 的通道。
// 但 marker 的 callout 是用户可见地点名称，有 display 时必须来自 display：无法由 display
// 表达时留空，不回退读原始 placeRef.name。历史缓存没有 display 时才保持原有取值。
function realMapOf(result, selected) {
  const map = Object.assign({ includePoints: [] }, realMap.mapData(result, selected))
  const display = real.displayOf(result)
  if (!display) return map
  const labels = markerLabels(display)
  map.markers = map.markers.map(marker => Object.assign({}, marker, {
    callout: Object.assign({}, marker.callout, { content: labels.get(marker.itemId) || '' })
  }))
  return map
}

// 选中项变化时页面只需要换地图，不必重建整份视图 —— setData 会把传入的对象整份重发，
// 而 view.days 在选中时并不改变（本地 8 地点 / 24 天的方案约 48KB，白传一次就够心疼了）。
function mapFor(source, payload, selected) {
  if (!payload) return null
  return source === 'real' ? realMapOf(payload, selected) : engine.mapData(payload, selected)
}

// 本地方案的「按天」视图。归类键取 item.date（酒店的 date 即入住日），
// 组内按「日期 + 开始时间」排序，和用户阅读行程的顺序一致。
function localDays(plan) {
  const groups = []
  const index = Object.create(null)
  engine.viewItems(plan).slice()
    .sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start)))
    .forEach(item => {
      const key = text(item.date, '日期未定')
      if (!index[key]) {
        index[key] = { key, title: key, noActivities: false, rows: [] }
        groups.push(index[key])
      }
      index[key].rows.push({
        id: item.id,
        kind: item.type,
        label: text(item.typeName, '推荐') + ' · ' + text(item.title, '未命名'),
        value: text(item.timeText, '时间未定'),
        note: text(item.reason, ''),
        item
      })
    })
  return groups.sort((a, b) => a.key.localeCompare(b.key))
}

// 真实草案的全部用户可见语义由 utils/real-planning.js 的 viewResult 决定：
// 有 display 时只来自 display 投影，没有 display 时才走受限 legacy 适配。
// 本函数只负责形状归一化 + 地图（地图是唯一允许读原始几何的通道）。
function fromReal(result, selected) {
  const view = real.viewResult(result)
  return {
    source: 'real',
    sourceText: SOURCE_TEXT.real,
    heading: view.label,
    tone: view.tone,
    editable: false,
    conditionRows: view.conditionRows,
    statusRows: view.statusRows,
    gaps: (view.checklist || []).map(item => ({ code: item.code, title: item.title, action: item.action })),
    warnings: view.warnings || [],
    days: view.days || [],
    legs: view.legs || [],
    lodging: view.lodging || [],
    candidates: view.candidates || [],
    mapNote: '城市标记仅为行政锚点，不代表上车站或景点。点击交通查看有来源的路线；无路线几何时不画连线。',
    map: realMapOf(result, selected)
  }
}

function fromLocal(plan, selected) {
  if (!plan || !plan.request || !Array.isArray(plan.items)) throw new Error('本地方案数据不完整，无法展示')
  const request = plan.request
  const execution = plan.execution || {}
  return {
    source: 'local',
    sourceText: SOURCE_TEXT.local,
    heading: text(execution.label, '已生成'),
    tone: toneOf(execution.status),
    // 可展开编辑/预订的行只在本地方案出现；真实草案由 view.days 只读呈现。
    editable: true,
    conditionRows: [
      row('出发日期', request.startDate),
      row('总天数', request.days === undefined || request.days === null ? '' : request.days + ' 天'),
      row('出发地', request.origin),
      row('出行人数', request.people === undefined || request.people === null ? '' : request.people + ' 人'),
      row('预算', request.budget === undefined || request.budget === null ? '' : '¥' + request.budget + ' · ' + text(request.budgetType, '人均')),
      row('交通方式', (request.modes || []).join('、'), '未选择'),
      row('住宿', request.needHotel ? text(request.hotelLevel, '') + '酒店' : '不需要酒店'),
      row('节奏与偏好', [request.pace, request.preference].filter(Boolean).join(' · '))
    ],
    statusRows: [
      { label: '可执行性', value: text(execution.label, '未知'), tone: toneOf(execution.status) },
      { label: '已知费用', value: amount(plan.estimate) },
      { label: '总预算', value: amount(plan.budgetLimit) },
      { label: '库存校验', value: execution.inventoryMode === 'mock' ? '演示库存，不代表真实可购买' : '真实库存校验' },
      { label: '校验时间', value: text(execution.checkedAt, '未记录') }
    ],
    gaps: (execution.blockers || []).map((message, index) => ({ code: 'BLOCKER_' + index, title: text(message, '存在未解决项'), action: '' })),
    warnings: (plan.warnings || []).concat(execution.warnings || []).map(item => text(item, '')).filter(Boolean),
    days: localDays(plan),
    legs: [],
    lodging: [],
    candidates: [],
    mapNote: '虚线为地点顺序示意，不是道路导航；演示酒店使用目的地中心坐标。',
    map: engine.mapData(plan, selected)
  }
}

module.exports = { SOURCE_TEXT, fromLocal, fromReal, mapFor, toneOf }
