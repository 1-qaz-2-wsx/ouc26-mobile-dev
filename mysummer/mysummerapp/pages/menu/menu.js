const store = require('../../utils/travel-store')
const engine = require('../../utils/travel-engine')
const ui = require('../../utils/travel-ui')
const realPlanning = require('../../utils/real-planning')
const services = require('../../utils/travel-services')
const planningCache = require('../../utils/planning-cache')
const G = require('../../config/endpoints').planning

// 2026-09-18 Owner 决定：生成环节收敛成两步。第三步「生成前确认」删除，
// 第 2 步底部的唯一主操作就是「生成方案」，点击即生成并直接进入方案页。
const STEP_LABELS = ['地点', '要求']

// 交通方式 → chip 图标键（对应 menu.wxss 的 .mchip-ico-*）。
// 仅做「名字 → 图标」的展示映射，不改变 engine.MODES 的顺序与集合（§5.2 禁改）。
const MODE_ICONS = { 高铁: 'rail', 火车: 'loco', 飞机: 'plane', 大巴: 'bus', 自驾: 'car' }

// 校验错误键 → 所在步骤。用于把 focusError 的落点限制在当前真正渲染的步骤内。
const STEP2_FIELDS = ['startDate', 'days', 'origin', 'people', 'budget', 'modes', 'needHotel', 'hotelLevel']

function totalDays(menu) {
  return (menu || []).reduce((total, place) => {
    const days = Number(place.stayDays)
    return total + (Number.isFinite(days) ? days : 0)
  }, 0)
}

// 返回日期是 startDate + days - 1 的派生展示值，不是新的可编辑字段，
// 与 real-planning.buildRequest 的 endBy 推导（day(startDate, days - 1)）保持一致。
function returnDateOf(req) {
  const days = Number(req && req.days)
  if (!engine.validDate(req && req.startDate) || !Number.isInteger(days) || days < 1) return ''
  return engine.day(req.startDate, days - 1)
}

// 「更多条件」与「高级规划设置」已按 Owner 2026-09-18 决议从本页移除。
// 旧版本可能把自由文本或失效枚举留在本机 storage：自由文本非空会让真实规划直接抛错，
// 而页面上已无处清空，因此读入时统一归一，保证存量用户仍然能生成。
function normalizeStoredRequirements(req) {
  const normalized = Object.assign({}, req)
  normalized.specialNeeds = ''
  normalized.reference = ''
  normalized.constraints = ''
  if (!['自然', '人文', '均衡'].includes(normalized.preference)) normalized.preference = '自然'
  if (!['松弛', '均衡', '紧凑'].includes(normalized.pace)) normalized.pace = '均衡'
  normalized.allowNight = normalized.allowNight === true
  return normalized
}

function stepHasError(step, errors) {
  const keys = Object.keys(errors || {})
  if (step === 1) return keys.includes('stops')
  if (step === 2) return keys.some(key => key !== 'stops')
  return false
}

// 进度条语义：done = 已经走过的步骤，current = 当前所在步骤。
// 已完成段与当前段在视觉上同为实心品牌绿，未开始段为 sunken。
// ⚠️ WXML 里**不要**给步骤条按钮加 disabled：微信内置的
//    button[disabled]:not([type]) 特异度 (0,2,1) 会盖掉品牌绿底色，
//    让当前步显示成灰色，进度条看起来「落后一个阶段」。
//    可回退性由 goStep 的 target >= step 早退负责。
function makeSteps(current, errors) {
  return STEP_LABELS.map((label, index) => {
    const step = index + 1
    return {
      step,
      label,
      current: step === current,
      done: step < current,
      error: stepHasError(step, errors)
    }
  })
}

function relevantErrors(errors, step) {
  const result = {}
  Object.keys(errors || {}).forEach(key => {
    if (step === 1 && key === 'stops') result[key] = errors[key]
    if (step === 2 && key !== 'stops') result[key] = errors[key]
  })
  return result
}

function errorText(errors) {
  return Object.keys(errors || {}).map(key => errors[key]).filter(Boolean).join('；')
}

function touchPoint(event) {
  const touch = event && ((event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]))
  if (!touch) return null
  const y = Number(touch.clientY === undefined ? touch.pageY : touch.clientY)
  return Number.isFinite(y) ? { y } : null
}

// 方案页「重新生成」= 回到菜单第 2 步改条件。用 app 实例上的瞬时提示传递，
// 不写 storage、不进 travel-store schema；读一次即清除。
function takeMenuStepHint() {
  if (typeof getApp !== 'function') return 0
  const app = getApp()
  const step = app && app.globalData ? Number(app.globalData.menuStepHint) : 0
  if (app && app.globalData) app.globalData.menuStepHint = 0
  return Number.isInteger(step) && step >= 1 && step <= 2 ? step : 0
}

Page({
  data: {
    step: 1,
    steps: makeSteps(1, {}),
    menu: [],
    req: engine.defaults(),
    errors: {},
    error: '',
    // 未登录时的可操作提示：底栏出现「去登录」次按钮，不再回退演示方案。
    loginHint: false,
    busy: false,
    jobId: '',
    expandedNotes: {},
    draggingIndex: -1,
    dragOverIndex: -1,
    stepOneReady: false,
    totalDays: 0,
    returnDate: '',
    modeChoices: [],
    modeSummary: '',
    modeOptions: engine.MODES,
    preferences: ['自然', '人文', '均衡'],
    paces: ['松弛', '均衡', '紧凑'],
    levels: ['经济', '舒适'],
    budgetTypes: ['人均', '全团'],
    capabilityRows: [],
    capabilityNotes: [],
    capabilitySummary: '',
    capabilityState: ''
  },

  // 原生导航栏标题：两步都在「菜单」；不自绘导航栏。
  syncNavTitle(step) {
    const title = '菜单'
    if (this.navTitle === title) return
    this.navTitle = title
    if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title })
  },

  // 生成前向用户交代各数据源的真实状态（压成第 2 步底部一行小字），
  // 避免把「交通 / 景点门票」当成能力承诺。
  // 该接口不需要登录，失败也不阻塞生成，只把状态降级为「未能确认」。
  async loadCapabilities(force) {
    if (this.data.capabilityState === 'loading') return
    if (!force && this.data.capabilityState === 'ready') return
    this.setData({ capabilityState: 'loading' })
    const identity = store.sessionIdentity()
    try {
      const out = await services.api(G.capabilities, {})
      if (!store.isCurrentSession(identity)) return
      const rows = realPlanning.capabilityRows(out)
      this.setData({
        capabilityRows: rows,
        // 一行小字：真实可用/不可用的数据源概况。失败时清空，不写乐观结论。
        capabilitySummary: rows.map(row => row.name + ' ' + row.statusText).join(' · ').slice(0, 160),
        capabilityNotes: Array.isArray(out && out.notes) ? out.notes : [],
        capabilityState: 'ready'
      })
    } catch (error) {
      if (!store.isCurrentSession(identity)) return
      // 能力查询失败不代表规划不可用，只标注为未能确认。
      this.setData({ capabilityRows: [], capabilityNotes: [], capabilitySummary: '', capabilityState: 'error' })
    }
  },

  onShow() {
    if (this.realIdentity && !store.isCurrentSession(this.realIdentity)) {
      this.setData({ jobId: '', busy: false })
      this.realFingerprint = null
      this.realIdentity = null
      this.lastRealJobId = ''
      this.latestRawResult = null
    }
    const currentIdentity = store.sessionIdentity()
    const cacheEntry = planningCache.readEntry(currentIdentity)
    const cachedResult = cacheEntry && cacheEntry.result
    if (cachedResult) {
      this.realIdentity = currentIdentity
      this.latestRawResult = cachedResult
      this.lastRealJobId = cacheEntry.jobId || ''
    }
    ui.run(this, () => {
      const state = store.read()
      const req = normalizeStoredRequirements(Object.assign(engine.defaults(), state.requirements))
      const hint = takeMenuStepHint()
      const currentStep = state.menu.length ? Math.max(1, Math.min(2, hint || Number(this.data.step || 1))) : 1
      const errors = {}
      const validation = engine.validate(req, state.menu)
      const expandedNotes = Object.keys(this.data.expandedNotes || {}).reduce((result, id) => {
        if (state.menu.some(place => String(place.id) === String(id))) result[id] = true
        return result
      }, {})
      this.setData({
        step: currentStep,
        steps: makeSteps(currentStep, errors),
        menu: state.menu,
        req,
        errors,
        error: '',
        loginHint: false,
        expandedNotes,
        draggingIndex: -1,
        dragOverIndex: -1,
        stepOneReady: !validation.stops,
        totalDays: totalDays(state.menu),
        returnDate: returnDateOf(req),
        modeChoices: engine.MODES.map(name => ({ name, icon: MODE_ICONS[name] || 'car', checked: req.modes.includes(name) })),
        modeSummary: (req.modes || []).join('、')
      })
      this.syncNavTitle(currentStep)
      if (currentStep === 2) this.loadCapabilities(false)
    })
  },

  chooseEndpoint(e) {
    const field = e.currentTarget.dataset.field
    const identity = store.sessionIdentity()
    wx.chooseLocation({ success: place => {
      if (!store.isCurrentSession(identity)) return
      this.setRequest(field, place)
      if (field === 'originPlace') this.setRequest('origin', place.name)
    }, fail: () => { if (store.isCurrentSession(identity)) this.setData({ error: '未选择地点；请重试，原地点保留。' }) } })
  },

  async generateReal() {
    if (this.data.busy || !this.validateStep(2)) return
    const identity = store.sessionIdentity()
    if (identity.kind !== 'wechat') {
      // 不再生成演示方案：未登录时明确失败并给出登录入口，菜单原样保留。
      this.setData({ error: '真实规划需要先在“我的”页微信登录；菜单会保留，登录后回到本页即可生成。', loginHint: true })
      return
    }
    this.realIdentity = identity
    const submittedFingerprint = this.realEditFingerprint()
    this.setData({ busy: true, error: '', loginHint: false })
    try {
      const request = realPlanning.buildRequest(this.data.req, this.data.menu, 'menu-planning')
      const fingerprint = JSON.stringify(request)
      if (this.realFingerprint !== fingerprint) {
        this.realFingerprint = fingerprint
        this.realIdempotencyKey = store.id('planning')
      }
      // 服务端校验兜底：buildRequest 与服务端 normalizePlanRequest 是两套规则，
      // 提交前用服务端那一份确认，避免「本地放行、服务端拒绝」且两处措辞不一致。
      // 仅当该接口不存在（后端未升级）时跳过；真正的校验失败必须抛出。
      try {
        await services.api(G.validate, request)
      } catch (checkError) {
        if (checkError.code !== 'NOT_FOUND') throw checkError
      }
      if (!store.isCurrentSession(identity)) return
      const response = await services.api(G.jobsCreate, { request, idempotencyKey: this.realIdempotencyKey })
      if (!store.isCurrentSession(identity)) return
      this.setData({ jobId: response.job.id })
      let job = response.job
      for (let attempt = 0; attempt < 240 && ['queued', 'running'].includes(job.taskStatus); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500))
        if (!store.isCurrentSession(identity)) return
        job = (await services.api(G.jobsGet, { jobId: job.id })).job
      }
      if (!store.isCurrentSession(identity)) return
      if (job.result) {
        this.latestRawResult = job.result
        this.lastRealJobId = job.id
        planningCache.save(identity, job.result, { jobId: job.id })
        if (submittedFingerprint === this.realEditFingerprint()) ui.open('plan-detail', 'source=real')
        else this.setData({ error: '原条件的方案已生成，但你已修改条件。请重新生成以匹配当前条件。' })
      }
      else if (job.taskStatus === 'cancelled') { this.realFingerprint = null; this.setData({ error: '任务已取消，菜单未改变。' }) }
      else throw new Error(job.error && job.error.message || '任务尚未返回结果，可稍后重试同一请求。')
    } catch (error) {
      if (store.isCurrentSession(identity)) {
        if (error.code === 'INVALID_CONSTRAINTS') {
          const detail = realPlanning.fieldErrorText(error)
          this.setData({ error: detail ? '提交内容与服务端要求不符 — ' + detail + '。请返回对应步骤修改。' : '提交内容与服务端要求不符，请核对日期、人数、预算与地点。' })
        }
        else if (error.code === 'PLANNING_NOT_ENABLED') {
          const ready = (this.data.capabilityRows || []).filter(row => row.ready).map(row => row.name)
          this.setData({ error: ready.length
            ? '当前云端还未启用真实规划服务（已确认可用数据源：' + ready.join('、') + '）。菜单和已有方案已保留，不会回退到演示数据。'
            : '当前云端还未启用真实规划服务，需要部署新后端并启用规划开关。菜单和已有方案已保留，不会回退到演示数据。' })
        }
        else ui.fail(this, error)
      }
    }
    finally { if (store.isCurrentSession(identity)) this.setData({ busy: false }) }
  },

  realEditFingerprint() { return JSON.stringify({ req: this.data.req, menu: this.data.menu }) },


  // 只允许取消「正在生成中」的任务：任务已完成后 jobId 仍留在 data 里，
  // 若不加 busy 守卫会对已结束的 job 发取消。
  async cancelReal() {
    if (!this.data.busy || !this.data.jobId) return
    const identity = store.sessionIdentity()
    try { await services.api(G.jobsCancel, { jobId: this.data.jobId }) }
    catch (error) { if (store.isCurrentSession(identity)) ui.fail(this, error) }
  },

  setRequest(field, value) {
    const req = Object.assign({}, this.data.req, { [field]: value })
    this.setData({
      req,
      modeSummary: (req.modes || []).join('、'),
      returnDate: returnDateOf(req)
    })
    ui.run(this, () => store.mutate(state => { state.requirements = req }))
  },

  field(e) {
    this.setRequest(e.currentTarget.dataset.field, e.detail.value)
  },

  fieldBlur(e) {
    if (this.data.step !== 2) return
    this.validateFields([e.currentTarget.dataset.field])
  },

  datePick(e) {
    this.setRequest('startDate', e.detail.value)
    this.validateFields(['startDate'])
  },

  pick(e) {
    const field = e.currentTarget.dataset.field
    const list = this.data[e.currentTarget.dataset.options]
    this.setRequest(field, list[Number(e.detail.value)])
    this.validateFields([field])
  },

  toggle(e) {
    const field = e.currentTarget.dataset.field
    this.setRequest(field, e.detail.value)
    this.validateFields([field])
  },

  modes(e) {
    this.setRequest('modes', e.detail.value)
    this.validateFields(['modes'])
  },

  // 滑杆只在松手时写一次（bindchange），避免拖动过程反复写本机存储。
  budgetSlide(e) {
    this.setRequest('budget', e.detail.value)
    this.validateFields(['budget'])
  },

  // 预算口径（人均 / 全团）语义不变，只从 picker 改为次级 chip。
  budgetType(e) {
    const value = e.currentTarget.dataset.value
    if (!this.data.budgetTypes.includes(value)) return
    this.setRequest('budgetType', value)
    this.validateFields(['budget'])
  },

  validateFields(fields) {
    const all = engine.validate(this.data.req, this.data.menu)
    const errors = Object.assign({}, this.data.errors)
    fields.forEach(field => {
      if (all[field]) errors[field] = all[field]
      else delete errors[field]
    })
    this.setData({ errors, steps: makeSteps(this.data.step, errors) })
  },

  // 锚点跳转：只在「目标步骤真的渲染了该锚点」时才用 selector，
  // 否则 pageScrollTo({selector}) 会静默 no-op（无报错、无滚动）。
  focusError(errors, targetStep) {
    const keys = Object.keys(errors || {})
    const step = Number(targetStep || this.data.step)
  // #field-* 只存在于步骤 2；步骤 1 只有 #menu-list。
    const field = step === 2 ? keys.find(key => STEP2_FIELDS.includes(key)) : ''
    if (field) { setTimeout(() => wx.pageScrollTo({ selector: '#field-' + field, duration: 220 }), 60); return }
    if (errors && errors.stops) {
      // #menu-list 带 wx:if，菜单为空时节点不存在，改用滚动到顶部。
      const selector = step === 1 && this.data.menu.length ? '#menu-list' : ''
      setTimeout(() => wx.pageScrollTo(selector ? { selector, duration: 220 } : { scrollTop: 0, duration: 220 }), 60)
    }
  },

  validateStep(step) {
    const all = engine.validate(this.data.req, this.data.menu)
    const visible = relevantErrors(all, step)
    const keys = Object.keys(visible)
    const nextStep = this.data.step
    this.setData({
      errors: all,
      step: nextStep,
      steps: makeSteps(nextStep, all),
      error: errorText(visible)
    }, () => {
      if (keys.length) this.focusError(visible, nextStep)
    })
    this.syncNavTitle(nextStep)
    return keys.length === 0
  },

  next() {
    if (this.data.step !== 1) return
    if (!this.validateStep(1)) return
    this.setData({ step: 2, error: '', loginHint: false, steps: makeSteps(2, this.data.errors) }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 180 })
    })
    this.syncNavTitle(2)
    // 进入「要求」时刷新数据源能力：这就是生成前唯一能看到真实状态的位置。
    this.loadCapabilities(true)
  },

  // 未登录时底栏的「去登录」：跳到「我的」页，返回后菜单原样保留。
  login() { ui.tab('me') },

  goStep(e) {
    const target = Number(e.currentTarget.dataset.step)
    if (!Number.isInteger(target) || target >= this.data.step || target < 1) return
    this.setData({ step: target, error: '', loginHint: false, steps: makeSteps(target, this.data.errors) }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 180 })
    })
    this.syncNavTitle(target)
  },

  backToPlaces() {
    this.setData({ step: 1, error: '', loginHint: false, steps: makeSteps(1, this.data.errors) }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 180 })
    })
    this.syncNavTitle(1)
  },

  toggleNote(e) {
    const id = e.currentTarget.dataset.id
    const expandedNotes = Object.assign({}, this.data.expandedNotes)
    expandedNotes[id] = !expandedNotes[id]
    this.setData({ expandedNotes })
  },

  editStop(e) {
    const field = e.currentTarget.dataset.field
    const id = e.currentTarget.dataset.id
    let value = e.detail.value
    // 手输停留天数与 adjustStay 用同一套范围规则，避免 0/99/非数字写进本机存储。
    if (field === 'stayDays') {
      const days = Math.round(Number(value))
      value = Number.isFinite(days) ? Math.min(30, Math.max(1, days)) : 1
    }
    ui.run(this, () => {
      store.mutate(state => {
        const place = state.menu.find(item => String(item.id) === String(id))
        if (!place) throw new Error('地点已不存在，请刷新菜单')
        place[field] = value
      })
      this.onShow()
    })
  },

  adjustStay(e) {
    const id = e.currentTarget.dataset.id
    const delta = Number(e.currentTarget.dataset.delta)
    ui.run(this, () => {
      store.mutate(state => {
        const place = state.menu.find(item => String(item.id) === String(id))
        if (!place) throw new Error('地点已不存在，请刷新菜单')
        const current = Number(place.stayDays)
        place.stayDays = Math.min(30, Math.max(1, (Number.isFinite(current) ? current : 1) + delta))
      })
      this.onShow()
    })
  },

  dragStart(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0 || index >= this.data.menu.length) return
    this.dragIndex = index
    this.dragOverIndex = index
    this.dragRects = []
    this.setData({ draggingIndex: index, dragOverIndex: index })
    wx.createSelectorQuery().in(this).selectAll('.destination-card').boundingClientRect(rects => {
      this.dragRects = rects || []
    }).exec()
  },

  dragMove(e) {
    if (!Number.isInteger(this.dragIndex)) return
    const point = touchPoint(e)
    const rects = this.dragRects || []
    if (!point || !rects.length) return
    let target = rects.findIndex(rect => point.y >= rect.top && point.y <= rect.bottom)
    if (target < 0) target = point.y < rects[0].top ? 0 : rects.length - 1
    if (target !== this.dragOverIndex) {
      this.dragOverIndex = target
      this.setData({ dragOverIndex: target })
    }
  },

  dragEnd() {
    if (!Number.isInteger(this.dragIndex)) return
    const index = this.dragIndex
    const to = this.dragOverIndex
    this.dragIndex = undefined
    this.dragOverIndex = undefined
    this.dragRects = []
    this.setData({ draggingIndex: -1, dragOverIndex: -1 })
    if (!Number.isInteger(to) || index === to) return
    ui.run(this, () => {
      store.mutate(state => {
        if (index < 0 || to < 0 || index >= state.menu.length || to >= state.menu.length) return
        const place = state.menu.splice(index, 1)[0]
        state.menu.splice(to, 0, place)
      })
      this.onShow()
    })
  },

  dragCancel() {
    this.dragIndex = undefined
    this.dragOverIndex = undefined
    this.dragRects = []
    this.setData({ draggingIndex: -1, dragOverIndex: -1 })
  },

  async remove(e) {
    if (!await ui.confirm('删除这个地点？')) return
    ui.run(this, () => {
      store.mutate(state => {
        state.menu = state.menu.filter(place => String(place.id) !== String(e.currentTarget.dataset.id))
      })
      this.onShow()
    })
  },

  async clear() {
    if (!await ui.confirm('清空全部想去地点？')) return
    ui.run(this, () => {
      store.mutate(state => { state.menu = [] })
      this.setData({ step: 1, error: '', loginHint: false, errors: {}, expandedNotes: {}, steps: makeSteps(1, {}) })
      this.syncNavTitle(1)
      this.onShow()
    })
  },

  add() {
    ui.tab('index')
  },

  // 唯一的生成入口：一次点击 → 真实规划任务 → 直接进入方案页。
  // 本地演示方案链路已按 Owner 2026-09-18 决定下线，这里不再有 demo 分支。
  generate() { return this.generateReal() }
})
