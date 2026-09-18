const store = require('../../utils/travel-store')
const cache = require('../../utils/planning-cache')
const real = require('../../utils/real-planning')
const ui = require('../../utils/travel-ui')

// 补充信息（2026-09-18 Owner 定稿版）
//
// 这是「我的出行信息记录」，不是收银台、不是 OTA 下单页：
//   · 用户把自己已经买到/确认的车票、航班、住宿记回小程序，用于行程展示；
//   · 没有库存核验、没有第三方跳转、没有「从已有信息自动填入」（后端没有这两条通道）；
//   · 保存后只标记「已补充」，绝不写成「已订 / 已核验」；
//   · 身份 = 方案实例（planId）+ 卡片（sectionId），重新生成方案不会自动继承。
const KIND_TEXT = { train: '车票信息', flight: '航班信息', hotel: '住宿信息' }
const ROWS = {
  train: [
    { key: 'serviceNo', label: '车次', type: 'text', placeholder: '如 G1024' },
    { key: 'from', label: '出发站', type: 'text', placeholder: '如 青岛' },
    { key: 'to', label: '到达站', type: 'text', placeholder: '如 哈尔滨' },
    { key: 'date', label: '乘车日期', type: 'date', placeholder: '请选择' },
    { key: 'departTime', label: '发车时间', type: 'time', placeholder: '请选择' },
    { key: 'arriveTime', label: '到达时间', type: 'time', placeholder: '请选择' },
    { key: 'seatClass', label: '席别', type: 'text', placeholder: '如 二等座' },
    { key: 'unitPrice', label: '单价（元）', type: 'digit', placeholder: '如 612' },
    { key: 'quantity', label: '张数', type: 'number', placeholder: '如 2' }
  ],
  flight: [
    { key: 'flightNo', label: '航班号', type: 'text', placeholder: '如 CA1234' },
    { key: 'from', label: '出发机场', type: 'text', placeholder: '如 青岛胶东' },
    { key: 'to', label: '到达机场', type: 'text', placeholder: '如 哈尔滨太平' },
    { key: 'date', label: '乘机日期', type: 'date', placeholder: '请选择' },
    { key: 'departTime', label: '起飞时间', type: 'time', placeholder: '请选择' },
    { key: 'arriveTime', label: '到达时间', type: 'time', placeholder: '请选择' },
    { key: 'cabin', label: '舱位', type: 'text', placeholder: '如 经济舱' },
    { key: 'unitPrice', label: '单价（元）', type: 'digit', placeholder: '如 880' },
    { key: 'quantity', label: '人数', type: 'number', placeholder: '如 2' }
  ],
  hotel: [
    { key: 'name', label: '酒店名称', type: 'text', placeholder: '如 伊春小旅馆' },
    { key: 'checkInDate', label: '入住日期', type: 'date', placeholder: '请选择' },
    { key: 'checkOutDate', label: '退房日期', type: 'date', placeholder: '请选择' },
    { key: 'checkInTime', label: '入住时间', type: 'time', placeholder: '如 14:00' },
    { key: 'checkOutTime', label: '退房时间', type: 'time', placeholder: '如 11:00' },
    { key: 'roomType', label: '房型', type: 'text', placeholder: '如 经济双床房' },
    { key: 'rooms', label: '房间数', type: 'number', placeholder: '如 1' },
    { key: 'nights', label: '晚数', type: 'number', placeholder: '如 1' },
    { key: 'unitPrice', label: '每晚价格（元）', type: 'digit', placeholder: '如 78' },
    { key: 'totalPrice', label: '合计（元）', type: 'digit', placeholder: '留空按 每晚×晚数 计算' }
  ]
}

function blankFields(kind) {
  const fields = {}
  ;(ROWS[kind] || []).forEach(row => { fields[row.key] = '' })
  return fields
}

Page({
  data: {
    error: '', kind: '', kindText: '', rows: [],
    fields: {}, refRows: [], existing: false, planId: '', sectionId: ''
  },

  onLoad(q) {
    const options = q || {}
    this.planId = String(options.planId || '')
    this.sectionId = String(options.sectionId || '')
    this.jobId = String(options.jobId || '')
    ui.run(this, () => this.load())
  },

  load() {
    const identity = store.sessionIdentity()
    this.identity = identity
    const entry = cache.readEntry(identity)
    const result = entry && entry.result
    if (!result) throw new Error('当前账号还没有方案，请先回菜单生成')
    const planId = this.planId || String((result.plan && result.plan.id) || '')
    if (!planId || !this.sectionId) throw new Error('缺少卡片标识，请从方案页的卡片重新进入')
    this.planId = planId
    const prefill = real.bookingPrefill(result, this.sectionId)
    const existing = store.getBooking(planId, this.sectionId)
    const kind = String((existing && existing.kind) || (prefill && prefill.kind) || '')
    if (!KIND_TEXT[kind]) throw new Error('这张卡片不支持补充信息')
    const base = Object.assign(blankFields(kind), prefill && prefill.fields, existing && existing.fields)
    this.setData({
      error: '', kind, kindText: KIND_TEXT[kind], rows: ROWS[kind],
      fields: base, existing: Boolean(existing),
      refRows: ROWS[kind].map(row => ({ label: row.label, value: String((prefill && prefill.fields && prefill.fields[row.key]) || '') }))
        .filter(row => row.value),
      planId, sectionId: this.sectionId
    })
  },

  field(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ ['fields.' + key]: e.detail.value, error: '' })
    // 住宿合计留空时给出「每晚 × 晚数」的参考值；用户自己填过就不覆盖。
    if (this.data.kind === 'hotel' && (key === 'unitPrice' || key === 'nights')) {
      const price = Number(this.data.fields.unitPrice)
      const nights = Number(this.data.fields.nights)
      if (!String(this.data.fields.totalPrice || '').trim() && Number.isFinite(price) && Number.isFinite(nights) && price > 0 && nights > 0) {
        this.setData({ 'fields.totalPrice': String(Math.round(price * nights)) })
      }
    }
  },

  save() {
    ui.run(this, () => {
      store.saveBooking({ planId: this.planId, sectionId: this.sectionId, kind: this.data.kind, fields: this.data.fields })
      wx.showToast({ title: '已补充', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 400)
    })
  },

  async remove() {
    if (!await ui.confirm('删除这条补充信息？', '删除后这张卡片会回到「＋补充信息」，方案本身不受影响。')) return
    ui.run(this, () => {
      store.deleteBooking(this.planId, this.sectionId)
      wx.showToast({ title: '已删除', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 400)
    })
  }
})
