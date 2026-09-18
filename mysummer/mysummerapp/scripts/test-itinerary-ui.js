/* Run: node mysummerapp/scripts/test-itinerary-ui.js
   G5 行程页页面级守卫。

   静态部分：左日期轴 + 右内容列的两栏结构、记录卡字段、G0 令牌取值、尺寸与触控、
             「实心绿只给主操作与选中行程」、脱离 mvp.wxss、以及**页面不得虚构投递状态**。
   功能部分：用内存 wx 桩装载真实页面 JS，验证日轴分组、记录卡投影、
              记录合并、照片上限与写回。
   不访问网络，不写真实 storage。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const wxml = read('pages/itinerary/itinerary.wxml')
const wxss = read('pages/itinerary/itinerary.wxss')
const js = read('pages/itinerary/itinerary.js')
const json = JSON.parse(read('pages/itinerary/itinerary.json'))

/* ==========================================================================
   1. WXSS 解析：先剥注释，再用**花括号配平**的字符级扫描取规则
   ========================================================================== */
const code = wxss.replace(/\/\*[\s\S]*?\*\//g, '')
const RULES = []
{
  let depth = 0, selStart = 0, bodyStart = -1
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (ch === '{') {
      if (depth === 0) bodyStart = i
      depth++
    } else if (ch === '}') {
      if (depth === 1) {
        const selector = code.slice(selStart, bodyStart).trim()
        if (selector) RULES.push({ selector, body: code.slice(bodyStart + 1, i) })
      }
      depth = Math.max(0, depth - 1)
      if (depth === 0) selStart = i + 1
    }
  }
}
assert.ok(RULES.length >= 40, 'WXSS rule scan is broken, only ' + RULES.length + ' rules found')

function exact(selector) {
  const hit = RULES.find(r => r.selector.split(',').map(s => s.trim()).includes(selector))
  assert.ok(hit, 'itinerary.wxss has no rule for ' + selector)
  return hit.body
}
function rule(selector) {
  const has = wanted => RULES.find(r => r.selector.split(',').map(s => s.trim()).includes(wanted))
  const hit = has(selector) || has('.itn-page ' + selector)
  assert.ok(hit, 'itinerary.wxss has no rule for ' + selector)
  return hit.body
}
function decl(body, property) {
  const m = body.match(new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)'))
  return m ? m[1].trim() : null
}
function must(selector, property) {
  const v = decl(rule(selector), property)
  assert.ok(v !== null, selector + ' must declare ' + property)
  return v
}
function rpx(value) {
  const m = String(value).match(/^(-?[\d.]+)rpx$/)
  assert.ok(m, 'expected an rpx length, got "' + value + '"')
  return Number(m[1])
}
const flexBasis = v => rpx(String(v).trim().split(/\s+/).pop())
function splitShorthand(value) {
  const out = []
  let buf = '', depth = 0
  for (const ch of String(value)) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (buf) out.push(buf)
      buf = ''
    } else buf += ch
  }
  if (buf) out.push(buf)
  return out
}
const at = token => {
  const i = wxml.indexOf(token)
  assert.ok(i >= 0, 'itinerary.wxml is missing ' + token)
  return i
}

/* ==========================================================================
   2. 两栏结构：**左日期轴** + 右内容列（行程切换 → 当天记录卡 → 收尾）
   ========================================================================== */
const bodyAt = at('class="itn-body"')
const axAt = at('class="itn-ax"')
const tlAt = at('class="itn-tl"')
assert.ok(bodyAt < axAt && axAt < tlAt, '日期轴必须渲染在内容列**之前**（轴在左侧）')
assert.ok(at('class="itn-ax-rail"') > axAt, '轴线必须属于轴列')
assert.ok(wxml.includes('wx:for="{{days}}"'), '轴必须渲染按天派生出来的日期列表')
assert.ok(wxml.includes('wx:for="{{dayItems}}"'), '内容列必须渲染当天记录卡')
assert.ok(wxml.includes("{{item.key === dayKey ? 'on' : ''}}"), '轴上的选中日必须由 dayKey 驱动')
assert.ok(wxml.includes('wx:if="{{item.isToday}}"') && wxml.includes('>今天<'), '今天必须有独立胶囊')
assert.ok(at('class="itn-trips"') > tlAt, '行程切换必须属于内容列（不能把轴整体推下去）')
assert.ok(at('class="itn-trips"') < at('wx:for="{{dayItems}}"'), '行程切换排在当天记录卡之前')
assert.ok(at('wx:for="{{dayItems}}"') < at('class="itn-end"'), '记录卡排在「结束旅程」之前')
assert.ok(at('class="itn-end"') < at('class="itn-rec"'), '记录页是页面内全屏态，排在最后')
assert.equal(decl(exact('.itn-rec'), 'position'), 'fixed', '行程记录必须是页面内全屏态')
// 空态在结构之前
assert.ok(at('class="itn-empty"') < bodyAt, '空态必须排在两栏结构之前')

/* ==========================================================================
   3. 记录卡：Day n · 时间 + 状态标签 + 类型 · 标题 + 备注 + 照片 + 动作
   ========================================================================== */
assert.ok(wxml.includes('Day {{dayNo}} · {{item.time}}'), '记录卡头部必须是「Day n · 时间」')
assert.ok(wxml.includes('{{item.typeName}} · {{item.title}}'), '记录卡标题必须是「类型 · 标题」')
assert.ok(wxml.includes("{{item.done ? 'outline' : 'tint'}}"),
  '记录卡动作必须按已记录/待进行切换描边与浅绿面')
assert.ok(wxml.includes('{{item.done ? \'编辑记录\' : \'记录这一刻\'}}'), '已记录=编辑记录，待进行=记录这一刻')
assert.ok(wxml.includes('class="itn-item-photos"') && wxml.includes('wx:for="{{item.photos}}"'),
  '记录卡必须渲染记录照片')
assert.ok(wxml.includes('class="itn-item-note"'), '记录卡必须渲染备注')
assert.ok(wxml.includes('class="itn-acts itn-acts-item"'), '记录卡动作行有独立间距钩子')
// 卡片本体：白面、圆角 --r-card、无描边、无投影
{
  const card = exact('.itn-card')
  assert.equal(decl(card, 'background'), '#ffffff', '卡片必须用 --surface')
  assert.equal(decl(card, 'border-radius'), '38rpx', '卡片圆角必须是 --r-card 38rpx')
  assert.equal(decl(card, 'border'), null, '卡片不得加描边')
  assert.equal(decl(card, 'box-shadow'), null, '普通卡片不得加投影')
}
assert.ok(!/gradient/i.test(code), '不得使用渐变')
assert.ok(!/box-shadow/.test(code), '本页所有卡片都不得加投影')
assert.ok(!/backdrop-filter/.test(code), '不得使用玻璃拟态')
assert.ok(!/transform\s*:\s*scale/.test(code), '不得用 transform:scale 凑尺寸')

/* ==========================================================================
   4. G0 令牌与「实心绿只给主操作 + 选中行程」
   ========================================================================== */
assert.equal(decl(exact('.itn-page'), 'background'), '#f1f2ed', '页面底必须用 --canvas')
assert.equal(decl(exact('.itn-page'), 'color'), '#141414', '主文字必须用 --ink')
{
  const greenBlocks = RULES
    .filter(r => /background\s*:\s*#00754a/.test(r.body) && !/dot/.test(r.selector))
    .map(r => r.selector)
    .sort()
  assert.deepEqual(greenBlocks, ['.itn-chip.on', '.itn-page .itn-cta', '.itn-page .itn-save'].sort(),
    '实心绿只允许出现在「选中的行程」与两个主操作上')
  assert.equal(decl(exact('.itn-chip.on'), 'background'), '#00754a', '选中的行程是实心绿（画布真值）')
  assert.equal(decl(exact('.itn-page .itn-act.outline'), 'background'), '#ffffff', '卡片内动作是白底描边')
  assert.equal(decl(exact('.itn-page .itn-act.tint'), 'background'), '#e8f2ec', '待进行动作是浅绿面')
}
assert.equal(decl(exact('.itn-tag.ok'), 'background'), '#e8f2ec', '已记录/已开启标签用浅绿面')
assert.equal(decl(exact('.itn-tag.ok'), 'color'), '#00754a', '已记录/已开启标签文字用品牌绿')
assert.equal(decl(exact('.itn-tag.grey'), 'background'), '#e5e5e5', '待进行/已隐藏标签用 --hairline 底')
assert.equal(decl(exact('.itn-tag.grey'), 'color'), '#767676', '待进行/已隐藏标签文字用 --muted')
assert.equal(decl(exact('.itn-ax-rail'), 'background'), '#e5e5e5', '轴线用 --hairline')
assert.equal(rpx(must('.itn-ax-rail', 'width')), 2, '轴线宽 2rpx')
assert.equal(rpx(must('.itn-ax-dot', 'width')), 16, '非选中日轴点 16rpx')
assert.equal(rpx(must('.itn-ax-day.on .itn-ax-dot', 'width')), 24, '选中日轴点 24rpx')
assert.equal(rpx(must('.itn-ax-mark', 'height')), 24, '轴点外框定高，选中态变大也不会推走日期')

/* ==========================================================================
   5. 尺寸：全部来自 G0 阶梯（画布 390 → 750rpx，×1.923，取偶）
   ========================================================================== */
{
  const pagePad = splitShorthand(must('.itn-page', 'padding'))
  assert.equal(pagePad.length, 4, '.itn-page padding 必须写四值简写，否则解不出左右内距')
  assert.equal(rpx(pagePad[3]), 31, '左内距 = --sp-page 31rpx')
  assert.equal(rpx(pagePad[1]), 31, '右内距 = --sp-page 31rpx')
}
{
  const railCenter = 59 // 页面 31 + 轴列中心 28
  const axWidth = flexBasis(must('.itn-ax', 'flex'))
  assert.equal(axWidth, 56, '轴列宽 56rpx')
  assert.equal(rpx(must('.itn-ax-rail', 'left')) + rpx(must('.itn-ax-rail', 'width')) / 2,
    railCenter - 31, '轴线中心必须落在轴列中心')
  assert.equal(31 + axWidth + rpx(must('.itn-tl', 'margin-left')), 127, '内容列左边界 127rpx')
}
assert.equal(rpx(must('.itn-cta', 'height')), 92, '主按钮高 48px → 92rpx')
assert.equal(rpx(must('.itn-save', 'height')), 92, '保存记录与主按钮同高（成对出现必须等高）')
assert.equal(rpx(must('.itn-cancel', 'height')), 92, '取消与保存成对，必须等高')
assert.equal(rpx(must('.itn-act', 'height')), 66, '卡片内动作钮高 34px → 65rpx 取偶 66rpx')
assert.equal(rpx(must('.itn-end', 'height')), 86, '结束旅程高 44px → 85rpx 取偶 86rpx')
assert.equal(rpx(must('.itn-chip', 'height')), 70, 'chip 高 36px → 69rpx 取偶 70rpx')
assert.equal(rpx(must('.itn-tag', 'height')), 50, '状态标签高 26px → 50rpx')
assert.equal(rpx(must('.itn-ax-today', 'height')), 30, '今天胶囊高 30rpx')
assert.equal(rpx(must('.itn-item-photos image', 'width')), 138, '记录卡照片边长')
assert.equal(rpx(must('.itn-item-photos image', 'height')), 138, '记录卡照片必须正方形')
assert.equal(rpx(must('.itn-rec-area', 'height')), 160, '记录文本域高度')
assert.equal(rpx(must('.itn-rec-photo', 'width')), 160, '记录照片边长')
assert.equal(rpx(must('.itn-rec-add', 'height')), rpx(must('.itn-rec-photo', 'height')), '照片与加号块必须等尺寸')
assert.equal(rpx(must('.itn-hd-title', 'font-size')), 28, '卡片标题是 ct 级')
assert.equal(rpx(must('.itn-item-title', 'font-size')), 28, '记录卡标题与卡片标题同级')
assert.equal(rpx(must('.itn-item-note', 'font-size')), 24, '记录备注是 tm 级')
assert.equal(rpx(must('.itn-item-meta', 'font-size')), 24, 'Day n · 时间是 tm 级')
assert.equal(rpx(must('.itn-body-text', 'font-size')), 24, '卡片说明文字是 tm 级')
assert.equal(rpx(must('.itn-ax-date', 'font-size')), 24, '轴上日期是 tm 级')
assert.equal(rpx(must('.itn-ax-today', 'font-size')), 20, '今天胶囊是标签级字号')
assert.equal(rpx(must('.itn-rec-title', 'font-size')), 34, '记录页标题是 h3 级')

/* ==========================================================================
   6. button 前缀 / aria-disabled / 偶数律
   ========================================================================== */
const reset = rule('.itn-page button')
assert.equal(decl(reset, 'min-height'), '0', '复位必须显式清 min-height：宿主默认值会撑高矮按钮')
assert.equal(decl(reset, 'display'), 'flex', '复位必须显式 display:flex，否则文字贴顶')
assert.ok(decl(reset, 'line-height'), '复位必须给整数行高')
assert.ok(/\.itn-page button::after/.test(code), '必须显式清掉微信原生 button::after 描边')

const buttonClasses = new Set()
for (const m of wxml.matchAll(/<button\b[^>]*>/g)) {
  const cls = m[0].match(/class="([^"]*)"/)
  if (!cls) continue
  const raw = cls[1]
  raw.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean).forEach(t => buttonClasses.add(t))
  ;(raw.match(/'[a-z][a-z0-9-]*'/g) || []).forEach(s => buttonClasses.add(s.slice(1, -1)))
}
assert.ok(buttonClasses.size >= 4, 'expected the itinerary page to render several button classes')
buttonClasses.forEach(cls => {
  const token = new RegExp('\\.' + cls + '(?![\\w-])')
  const refs = []
  RULES.forEach(r => r.selector.split(',').map(s => s.trim()).forEach(s => {
    const subject = s.split(/[\s>+~]+/).pop()
    if (token.test(subject)) refs.push(s)
  }))
  assert.ok(refs.length > 0, 'button 类 .' + cls + ' 在 WXSS 里没有任何规则（死类或漏样式）')
  refs.forEach(s => assert.ok(s.startsWith('.itn-page '),
    'button 类 .' + cls + ' 必须以 .itn-page 前缀声明，否则会被页面复位静默吞掉: ' + s))
})
assert.ok(!/<button[^>]*\sdisabled=/.test(wxml), '自定义 button 不得使用 disabled（特异度会覆盖品牌色）')
assert.ok(wxml.includes('aria-disabled="{{busy}}"'), '忙碌态改用 aria-disabled + JS 早退')

RULES.forEach(r => {
  const f = decl(r.body, 'font-size')
  if (f && /rpx$/.test(f)) assert.equal(rpx(f) % 2, 0, r.selector + ' 字号必须是偶数 rpx')
  const h = decl(r.body, 'height'), lh = decl(r.body, 'line-height')
  if (lh && /rpx$/.test(lh)) {
    assert.equal(rpx(lh) % 2, 0, r.selector + ' 行高必须是偶数 rpx')
    if (f && /rpx$/.test(f)) assert.equal((rpx(lh) - rpx(f)) % 2, 0, r.selector + ' 行高−字号必须是偶数 rpx')
  }
  if (!h || !lh || !/rpx$/.test(h) || !/rpx$/.test(lh)) return
  const H = rpx(h), L = rpx(lh)
  assert.equal(H % 2, 0, r.selector + ' 高度必须是偶数 rpx')
  assert.equal((H - L) % 2, 0, r.selector + ' 高度−行高必须是偶数 rpx')
  assert.ok(L <= H, r.selector + ' 行高不得大于高度')
})

/* ==========================================================================
   7. 样式迁移：本页已脱离 styles/mvp.wxss（G1B LEGACY ONLY）
   ========================================================================== */
assert.ok(!/@import\s+["'][^"']*mvp\.wxss/.test(wxss), '行程页不得再 import styles/mvp.wxss')
assert.ok(wxss.includes('mvp.wxss'), '文件头必须写明本页已脱离 mvp.wxss，避免后人加回 import')
{
  const routes = JSON.parse(read('app.json')).pages
  const stillImporting = routes.filter(route => {
    const file = path.join(root, route + '.wxss')
    return fs.existsSync(file) && /@import\s+["'][^"']*mvp\.wxss/.test(fs.readFileSync(file, 'utf8'))
  })
  assert.ok(!stillImporting.includes('pages/itinerary/itinerary'), 'pages/itinerary 必须从 mvp 依赖清单里消失')
}
assert.ok(!/\.itn-/.test(read('styles/mvp.wxss')), 'mvp.wxss 不得新增本页类名')
assert.ok(!/\.itn-/.test(read('app.wxss')), 'app.wxss 不得新增本页类名')
{
  // WXML 里出现的每个类都必须在本页 WXSS 里有规则，否则会静默依赖已被隔离的 mvp 基线
  const STATE_CLASSES = ['on', 'ok', 'grey', 'outline', 'tint']
  const used = new Set()
  for (const m of wxml.matchAll(/class="([^"]*)"/g)) {
    const raw = m[1]
    // {{a ? 'x' : 'y'}} 会留下半截 token（以 - 结尾），过滤掉
    raw.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean)
      .filter(c => !c.endsWith('-')).forEach(c => used.add(c))
  }
  STATE_CLASSES.forEach(c => used.add(c))
  const missing = Array.from(used).filter(c => !new RegExp('\\.' + c + '(?![\\w-])').test(code))
  assert.deepEqual(missing, [], '页面用到的类必须都在本页 WXSS 里有规则')
  // 反向：WXSS 里也不许留死规则（改了 DOM 忘了改样式是同一类事故的镜像）
  const wxssClasses = new Set()
  RULES.forEach(r => (r.selector.match(/\.[a-z][\w-]*/g) || []).forEach(c => wxssClasses.add(c.slice(1))))
  const dead = Array.from(wxssClasses).filter(c => !used.has(c))
  assert.deepEqual(dead, [], 'WXSS 不得留下页面已不再使用的选择器')
}

/* ==========================================================================
   8. 站内提醒卡片已下线（Owner 决定项目不做该功能）
   护栏：不得虚构投递状态，也不得留下点不到的入口或死样式。
   ========================================================================== */
const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
assert.ok(!/已同步/.test(jsCode), '不得再使用「已同步」这类把站内保存说成微信送达的措辞')
assert.ok(!/已同步/.test(wxml), '页面文案里不得出现「已同步」')
assert.ok(!/messageState/.test(wxml), '页面不得直接渲染 messageState 原文')
assert.ok(!wxml.includes('站内提醒'), '行程页不再渲染站内提醒卡片')
assert.ok(!wxml.includes('bindtap="sync"') && !wxml.includes('bindtap="plan"'),
  '提醒卡下线后不得留下点不到的按钮')
assert.ok(!/remindView|REMIND_RULES/.test(js), '提醒状态映射必须随卡片一并删除')
assert.ok(!/\.itn-remind-/.test(code), 'WXSS 不得残留提醒状态行的死样式')

/* ==========================================================================
   9. WXML 卫生与必须保留的能力
   ========================================================================== */
const HANDLERS = ['start', 'choose', 'pickDay', 'record', 'note', 'photo', 'removePhoto',
  'saveRecord', 'cancel', 'complete', 'visibility']
HANDLERS.forEach(h => assert.ok(wxml.includes('bindtap="' + h + '"') || wxml.includes('bindinput="' + h + '"'),
  '行程页丢失了 ' + h + ' 入口'))
assert.ok(/photos\.length < 6/.test(wxml), '照片添加入口必须保留 6 张上限')
assert.ok(/slice\(0,\s*6\)/.test(js), '照片写入必须仍然截断到 6 张')
assert.ok(js.includes('records[this.data.recordId]={note:'), 'saveRecord 必须仍写回当前 trip 的 records')
assert.ok(js.includes("t.status='completed'"), '结束旅程必须仍写回 status')
assert.ok(js.includes("t.visibility=t.visibility==='public'?'private':'public'"), '公开/隐藏必须仍可切换')
// 提醒卡（含其中的「查看方案」按钮）随功能下线一并移除，行程页当前没有直达方案详情的入口。
// 断言写成反向是为了让它显式可见：若产品决定保留这个入口，必须另选落点并改本条。
assert.ok(!js.includes("u.open('plan-detail'"),
  '方案入口随提醒卡移除；若要保留必须另选落点')
assert.ok(js.includes('travelSync.syncNow()'), 'onShow 的云端同步不得被删掉')
{
  const recordWrite = js.match(/records\[this\.data\.recordId\]\s*=\s*\{([^}]*)\}/)
  assert.ok(recordWrite, 'records 写入语句无法解析')
  ;['note', 'photos', 'done', 'at'].forEach(k =>
    assert.ok(recordWrite[1].includes(k), 'records 条目缺少既有字段 ' + k))
}
assert.ok(!/setStorageSync|removeStorageSync/.test(js), '页面不得触碰 storage API')
assert.ok(!/plan\.validation|\.errors\[|warnings\[/.test(jsCode), '页面不得读取 plan.validation')
assert.ok(!/<b>|<\/b>/.test(wxml), 'raw <b> tags are not valid in WXML')
assert.ok(!wxml.includes('&amp;&amp;'), 'WXML expressions must use && rather than the escaped entity')
assert.equal((wxml.match(/\{\{/g) || []).length, (wxml.match(/\}\}/g) || []).length,
  'unbalanced {{ }} expression in itinerary.wxml')
for (const m of wxml.matchAll(/<image\b[^>]*>/g)) {
  assert.ok(m[0].endsWith('/>') || wxml.includes('</image>'), 'image must be closed: ' + m[0])
}
assert.ok(!wxml.includes('timeText'), 'timeText 是旧结构字段，记录卡改用 start')
assert.ok(wxml.includes('maxlength="-1"'), 'textarea 不得沿用 140 字默认上限')
assert.equal(json.navigationStyle, 'default', 'navigationStyle 必须保持 default（不自绘导航栏）')
assert.equal(json.navigationBarTitleText, '我的行程', '页面标题必须保持权威表取值')
assert.ok(!json.tabBar, '页面 json 不得自绘 tabBar')
assert.ok(!/custom-tab-bar|cover-view/.test(wxml), '不得自绘 tabBar')

/* ==========================================================================
   10. 功能：内存 wx 桩装载真实页面
   ========================================================================== */
const memory = new Map()
global.wx = {
  getStorageSync: k => memory.has(k) ? JSON.parse(JSON.stringify(memory.get(k))) : '',
  setStorageSync: (k, v) => memory.set(k, JSON.parse(JSON.stringify(v))),
  showToast: () => {}, showModal: o => o.success({ confirm: true }),
  navigateTo: () => {}, switchTab: () => {}, navigateBack: () => {}, redirectTo: () => {},
  setNavigationBarTitle: () => {},
  request: () => { throw new Error('tests must not use network') },
  createSelectorQuery: () => ({ in() { return this }, selectAll() { return this }, boundingClientRect(fn) { fn([]); return this }, exec() {} })
}
const store = require('../utils/travel-store')
const engine = require('../utils/travel-engine')
const services = require('../utils/travel-services')

function page(name) {
  let def
  global.Page = d => { def = d }
  const file = require.resolve('../pages/' + name + '/' + name)
  delete require.cache[file]
  require(file)
  const p = Object.assign({}, def, {
    data: JSON.parse(JSON.stringify(def.data || {})),
    setData(values) {
      for (const [k, v] of Object.entries(values)) {
        const bits = k.split('.')
        let o = this.data
        for (let n = 0; n < bits.length - 1; n++) o = o[bits[n]] || (o[bits[n]] = {})
        o[bits[bits.length - 1]] = v
      }
    }
  })
  if (p.onShow) p.onShow()
  return p
}
const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } })
let passed = 0
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name) }

async function main(){
services.demoLogin()

await test('empty state offers the 去规划 route and renders no timeline', () => {
  const p = page('itinerary')
  assert.equal(p.data.trips.length, 0, 'demo account starts with no trips')
  assert.equal(p.data.days.length, 0)
  assert.equal(p.data.dayItems.length, 0)
  assert.ok(wxml.includes('还没有进行中的行程') && wxml.includes('去规划'),
    'the empty state must keep the design copy and the 去规划 CTA')
})

const today = engine.today()
const past = engine.day(today, -1)
const req = Object.assign(engine.defaults(), { startDate: past, days: 3 })
const plan = engine.generate(req, engine.seedPlaces.slice(0, 2))
store.putPlan(plan)
store.startTrip(plan, '站内提醒可用；微信发送未接入', 60)

await test('left date rail is derived from the plan range and today is highlighted', () => {
  const p = page('itinerary')
  assert.equal(p.data.days.length, 3, 'the rail must span the plan range')
  assert.deepEqual(p.data.days.map(d => d.dayNo), [1, 2, 3])
  assert.deepEqual(p.data.days.map(d => d.isToday), [false, true, false], 'the rail must mark today')
  p.data.days.forEach(d => assert.match(d.label, /^\d{1,2}\/\d{1,2}$/, 'rail labels are M/D'))
  assert.equal(p.data.dayKey, engine.day(today, 0), 'today must be selected by default when in range')
  assert.equal(p.data.dayNo, 2, 'the record card header must use the trip-relative day index')
})

await test('rail selection switches the day and the cards follow', () => {
  const p = page('itinerary')
  const expected = p.data.items.filter(i => i.date === p.data.dayKey)
  assert.deepEqual(p.data.dayItems.map(i => i.id), expected.map(i => i.id),
    'the cards must be filtered to the selected day')
  const other = p.data.days[0].key
  p.pickDay(event({ key: other }))
  assert.equal(p.data.dayKey, other)
  assert.equal(p.data.dayNo, 1, 'the card header Day index follows the rail')
  assert.ok(p.data.dayItems.every(i => i.date === other), 'picked day items must all belong to it')
  const empty = p.data.days.find(d => d.items.length === 0)
  if (empty) {
    p.pickDay(event({ key: empty.key }))
    assert.equal(p.data.dayItems.length, 0, 'a day without items renders the empty hint')
    assert.ok(wxml.includes('当天暂无安排'), 'the empty-day hint must exist')
  }
})

await test('record cards carry 类型 · 标题 / Day n · 时间 / 状态 / 备注 / 照片', () => {
  const p = page('itinerary')
  const kinds = p.data.dayItems.map(i => i.kind)
  assert.ok(kinds.includes('transport'), '当天必须有交通卡才能验证类型标签')
  assert.ok(kinds.includes('place') && kinds.includes('lodging'), '当天必须有活动卡与住宿卡')
  const labels = new Map(p.data.dayItems.map(i => [i.kind, i.typeName]))
  assert.equal(labels.get('transport'), '交通')
  assert.equal(labels.get('place'), '活动')
  assert.equal(labels.get('lodging'), '住宿')
  p.data.dayItems.forEach(i => {
    assert.ok(i.time, '每张卡都必须有时间（未定则写「时间未定」）')
    assert.ok(['已记录', '待进行'].includes(i.flag), '每张卡必须有受控状态标签')
    assert.ok(i.title && i.title.length > 0, '每张卡必须有标题')
  })
  const transport = p.data.dayItems.find(i => i.kind === 'transport')
  assert.equal(transport.time, transport.start, '交通卡的时间列就是出发时间')
  assert.match(transport.meta, /到达 /, '交通卡必须给出到达时间')
  const lodging = p.data.dayItems.find(i => i.kind === 'lodging')
  assert.match(lodging.stay, /^\d{4}-\d{2}-\d{2} 入住 · \d{4}-\d{2}-\d{2} 退房$/, '住宿卡用入住/退房日期')
  assert.match(lodging.meta, /待预订/, '住宿卡必须写出预订状态')
})

await test('records are merged into the cards as done / note / photos', () => {
  const p = page('itinerary')
  const item = p.data.dayItems.find(i => !i.done)
  assert.ok(item, 'an untouched card starts as 待进行')
  assert.equal(item.flag, '待进行')
  p.record(event({ id: item.id }))
  assert.equal(p.data.recordId, item.id, 'record() must open the matching item')
  assert.equal(p.data.editItem.id, item.id)
  assert.equal(p.data.recordTitle, item.title, '记录页必须带上当前项标题（与卡片同一套文案）')
  assert.match(p.data.recordMeta, /^Day \d · /, '记录页 meta 与记录卡同构')
  p.setData({ note: '在中央大街走了一下午' })
  p.setData({ photos: ['a.jpg', 'b.jpg'] })
  p.saveRecord()
  assert.equal(p.data.recordId, '', 'saving must close the record editor')
  const t = store.read().trips[0]
  assert.equal(t.records[item.id].note, '在中央大街走了一下午')
  assert.deepEqual(t.records[item.id].photos, ['a.jpg', 'b.jpg'])
  assert.equal(t.records[item.id].done, true)
  const card = p.data.dayItems.find(i => i.id === item.id)
  assert.equal(card.done, true, 'the card must re-derive 已记录')
  assert.equal(card.flag, '已记录')
  assert.equal(card.note, '在中央大街走了一下午')
  assert.match(js, /records\[this\.data\.recordId\]=\{note:this\.data\.note,photos:this\.data\.photos,done:true,at:/,
    'records 写入的字段顺序与形状保持不变')
})

await test('photo cap is 6 and removal works', () => {
  const p = page('itinerary')
  const item = p.data.dayItems.find(i => !i.done) || p.data.dayItems[0]
  p.record(event({ id: item.id }))
  p.setData({ photos: ['1', '2', '3', '4', '5', '6', '7'] })
  p.removePhoto(event({ index: 2 }))
  assert.deepEqual(p.data.photos, ['1', '2', '4', '5', '6', '7'], 'removing the 3rd photo')
  p.setData({ photos: ['1', '2', '3', '4', '5', '6', '7'] })
  p.saveRecord()
  assert.equal(store.read().trips[0].records[item.id].photos.length, 7,
    'saveRecord 原样写回页面已选照片（上限由选择入口与回读共同保证）')
  const back = page('itinerary')
  const card = back.data.dayItems.find(i => i.id === item.id)
  assert.equal(card.photos.length, 6, '回读时必须截断到 6 张')
  assert.ok(/photos\.length < 6/.test(wxml), '达到 6 张后不再渲染添加入口')
})

await test('multiple trips can be switched and completed trips still render', () => {
  const second = engine.generate(Object.assign({}, req, { startDate: engine.day(today, 10), days: 2 }),
    engine.seedPlaces.slice(1, 3))
  store.putPlan(second)
  store.startTrip(second, 'local', 60)
  const secondTrip = store.read().trips.find(t => t.planId === second.id)
  assert.ok(secondTrip, 'the second trip must exist in the store')
  const p = page('itinerary')
  assert.equal(p.data.trips.length, 2, 'both trips must be listed')
  assert.equal(p.data.chips.length, 2, 'the chip row must render one chip per trip')
  assert.deepEqual(p.data.chips.map(c => c.id), p.data.trips.map(t => t.id), 'chips must carry trip ids')
  assert.ok(p.data.chips.every(c => /^\d{2}-\d{2} · (进行中|已结束)$/.test(c.label)), 'chip 文案 = MM-DD · 状态')
  p.choose(event({ id: secondTrip.id }))
  assert.equal(p.data.trip.id, secondTrip.id, 'choose() must switch the active trip')
  assert.ok(p.data.days.length > 0, 'the rail must follow the switched trip')
})

await test('ending a trip flips status and keeps the records', async () => {
  const p = page('itinerary')
  const withRecords = p.data.trips.find(t => Object.keys(t.records || {}).length > 0)
  assert.ok(withRecords, 'the first trip must still carry its records')
  p.choose(event({ id: withRecords.id }))
  assert.equal(p.data.trip.id, withRecords.id)
  await p.complete()
  const t = store.read().trips.find(x => x.id === withRecords.id)
  assert.equal(t.status, 'completed', 'complete() must write status=completed')
  assert.ok(t.finishedAt, 'finishedAt must be stamped')
  assert.ok(Object.keys(t.records).length > 0, 'records must be preserved')
  const after = page('itinerary')
  after.choose(event({ id: withRecords.id }))
  assert.equal(after.data.trip.status, 'completed', 'a completed trip must still render')
  assert.ok(after.data.dayItems.length > 0, 'a completed trip must still show its cards')
  assert.ok(wxml.includes('行程公开') && wxml.includes('bindtap="visibility"'),
    'the visibility switch must remain reachable for completed trips')
  assert.ok(wxml.includes('结束旅程'), '结束旅程 must remain for active trips')
})

await test('rail falls back to the first day when today is outside the range', () => {
  const p = page('itinerary')
  p.choose(event({ id: p.data.trips[1].id }))
  const days = p.data.days
  assert.ok(days.length > 0, 'the rail must not be empty for a future trip')
  assert.equal(days.some(d => d.isToday), false, 'a future trip has no 今天')
  assert.equal(p.data.dayKey, days[0].key, 'the first day must be selected by default')
})

await test('shared files are untouched by this batch', () => {
  const shared = ['app.wxss', 'styles/tokens.wxss', 'styles/mvp.wxss', 'app.json']
  shared.forEach(f => assert.ok(fs.existsSync(path.join(root, f)), f + ' must still exist'))
  const app = JSON.parse(read('app.json'))
  assert.equal(app.pages.length, 13, 'the 13-page freeze must hold')
  assert.ok(!fs.existsSync(path.join(root, 'styles/components.wxss')),
    '本批不得新增全局 styles/components.wxss')
})

console.log('\n' + passed + ' itinerary UI tests passed. No network calls or real storage writes.')
}

main().catch(e=>{console.error(e);process.exitCode=1})
