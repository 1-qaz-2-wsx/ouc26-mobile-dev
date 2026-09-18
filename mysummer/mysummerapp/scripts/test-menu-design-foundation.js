/* Run: node mysummerapp/scripts/test-menu-design-foundation.js
   Static checks for pages/menu: validation anchors, design tokens, class-name hygiene,
   drag-selector coupling and the audited bug guards. No wx runtime is involved.

   背景（specs/frontend-refactor/g3-menu-audit.md）：
   - R1  #field-* / #menu-list 被删或挂错层级时 wx.pageScrollTo({selector}) 会**静默 no-op**，
        没有任何报错。原先 pageScrollTo 被 mock 成空函数，锚点零覆盖。
   - R8  switch 的 color 必须是字面量色值：组件属性不解析 CSS 变量，低版本 webview 直接失效。
   - R9  dragStart 用 selectAll('.destination-card') 取矩形，改类名即静默失效。
   - R11 本页与 styles/mvp.wxss 的同名类（.note/.row/.title/.panel/.tag/.muted/.error）会串味。
   - 契约 §6.3：关键样式用字面量，不全部依赖 var()（低版本安卓 webview 兼容）。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const engine = require('../utils/travel-engine')

const root = path.join(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const wxml = read('pages/menu/menu.wxml')
const wxss = read('pages/menu/menu.wxss')
const js = read('pages/menu/menu.js')
const json = JSON.parse(read('pages/menu/menu.json'))

// 2026-09-18 Owner 决定：生成收敛成两步（地点 / 要求），第 3 步「生成前确认」删除。
const STEP_REGIONS = [1, 2].map(step => {
  const open = '<block wx:if="{{step === ' + step + '}}">'
  const start = wxml.indexOf(open)
  assert.ok(start >= 0, 'menu.wxml is missing the step ' + step + ' block')
  const end = wxml.indexOf('</block>', start)
  assert.ok(end > start, 'menu.wxml step ' + step + ' block is not closed')
  return wxml.slice(start, end)
})

// 所有 class 属性里的类名 token（用于冲突类名检查，避免把 .mnote 误判成 .note）
const classTokens = new Set()
wxml.replace(/class="([^"]*)"/g, (whole, value) => {
  value.split(/\s+/).forEach(token => { if (token && !token.includes('{')) classTokens.add(token) })
  return whole
})

function mbarOf(region) {
  const open = '<view class="mbar">'
  const start = region.indexOf(open)
  assert.ok(start >= 0, 'each step must have a bottom action bar')
  return region.slice(start, region.indexOf('</view>', start))
}

function primaryCount(slice) {
  return (slice.match(/<button\b[^>]*>/g) || []).filter(tag => {
    const match = tag.match(/class="([^"]*)"/)
    if (!match) return false
    const tokens = match[1].split(/\s+/)
    if (!tokens.includes('mbtn') || tokens.includes('mbtn-sec')) return false
    // 「生成方案 / 去登录」是 wx:if / wx:else 的互斥标签：同一时刻只有一个主操作。
    return !/\swx:else/.test(tag)
  }).length
}

// 解析前先剥掉 /* */ 注释：注释里出现的 { } 会把选择器块截断
// （例如按钮复位上方的注释里写了「mvp.wxss:12 的 button{min-height:84rpx}」）。
const wxssCode = wxss.replace(/\/\*[\s\S]*?\*\//g, '')

// 取 WXSS 里某个选择器的声明块（要求 `{` 紧跟选择器，所以 .mcard 不会命中 .mcard-hd）
function block(selector) {
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxssCode.match(new RegExp(pattern + '\\s*\\{([^}]*)\\}'))
  assert.ok(match, 'menu.wxss has no rule for ' + selector)
  return match[1]
}

function decl(selector, property) {
  const match = block(selector).match(new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)'))
  assert.ok(match, selector + ' does not declare ' + property)
  return match[1].trim()
}

function rpx(value) {
  const match = String(value).match(/^(-?[\d.]+)rpx$/)
  assert.ok(match, 'expected an rpx length, got "' + value + '"')
  return Number(match[1])
}

// 步骤条区域（用于断言「不给步骤条按钮加 disabled」）
const STEP_BAR = (() => {
  const start = wxml.indexOf('<view class="msteps"')
  assert.ok(start >= 0, 'menu.wxml is missing the progress bar')
  return wxml.slice(start, wxml.indexOf('</view>', start))
})()

// ---------------------------------------------------------------- 锚点（R1）
const anchors = new Set()
wxml.replace(/id="(field-[A-Za-z]+)"/g, (whole, id) => { anchors.add(id); return whole })

// Owner 2026-09-18：更多条件（preference/pace/allowNight/specialNeeds/reference/constraints）
// 与高级规划设置已从本页删除，对应 6 个锚点随之退役。
const REQUIRED_ANCHORS = ['startDate', 'days', 'origin', 'people', 'budget', 'modes', 'needHotel', 'hotelLevel']
  .map(key => 'field-' + key)

REQUIRED_ANCHORS.forEach(id => assert.ok(anchors.has(id), 'validation anchor #' + id + ' was dropped'))
assert.equal(anchors.size, REQUIRED_ANCHORS.length, 'menu.wxml has unexpected or duplicated #field-* anchors')
assert.ok(wxml.includes('id="menu-list"'), 'the #menu-list anchor is required by focusError for stop errors')

// focusError 按「错误键 → #field-<key>」拼 id，所以每个 engine.validate 能产出的键都必须有同名锚点。
// 例外：`stops` 走 #menu-list / 顶部滚动；`preference` 的输入控件已删除，
// 存量非法值由 normalizeStoredRequirements 在读入时归一，属不可达错误键。
// 若将来重新引入该字段，必须同时恢复 #field-preference 与这条例外之外的处理。
const probe = engine.validate({ startDate: '', days: 0, people: 0, budget: 0, modes: [], preference: '' }, [])
assert.deepEqual(Object.keys(probe).sort(),
  ['budget', 'days', 'modes', 'people', 'preference', 'startDate', 'stops'],
  'engine.validate error keys changed: focusError anchors must be re-checked')
const ANCHORLESS_ERROR_KEYS = new Set(['stops', 'preference'])
Object.keys(probe).forEach(key => {
  if (ANCHORLESS_ERROR_KEYS.has(key)) return
  assert.ok(anchors.has('field-' + key), 'engine.validate can emit "' + key + '" but #field-' + key + ' does not exist')
})

// 锚点不能重复（重复 id 在 WXSS/WXML 里是静默错误）
const anchorOccurrences = (wxml.match(/id="field-/g) || []).length
assert.equal(anchorOccurrences, REQUIRED_ANCHORS.length, 'duplicated #field-* id found')

// ------------------------------------------------- 拖拽选择器耦合（R9）
const selectAll = js.match(/selectAll\(\s*'([^']+)'\s*\)/)
assert.ok(selectAll, 'menu.js no longer calls selectAll() for the drag rectangles')
const dragClass = selectAll[1].replace(/^\./, '')
assert.ok(classTokens.has(dragClass),
  'menu.js selectAll("' + selectAll[1] + '") does not match any class rendered by menu.wxml')
assert.ok(wxss.includes('.' + dragClass), 'menu.wxss no longer styles .' + dragClass)

// ------------------------------------------------- switch 字面量色值（R8）
const switches = wxml.match(/<switch\b[^>]*>/g) || []
// 「接受过夜交通」「优化游玩顺序」「火车用于到达首个菜单地点」已随两个折叠区删除，
// 本页只剩「需要酒店」一个开关；若新增开关，这条计数必须同步更新。
assert.equal(switches.length, 1, 'expected the single remaining switch control on the menu page')
switches.forEach(tag => {
  assert.match(tag, /color="#00754A"/, 'switch must use the literal brand colour, never a CSS variable: ' + tag)
  assert.ok(!tag.includes('var('), 'switch colour must not be a CSS variable: ' + tag)
})

// ------------------------------------------------- 类名冲突（R11）
const CONFLICTING = ['note', 'row', 'title', 'panel', 'tag', 'muted', 'error']
CONFLICTING.forEach(name => {
  assert.ok(!classTokens.has(name), 'menu.wxml still uses the mvp class .' + name + ', which leaks across pages')
  const redefinition = new RegExp('(^|\\})\\s*\\.' + name + '\\s*[,{]', 'm')
  assert.ok(!redefinition.test(wxss), 'menu.wxss must not redefine the mvp class .' + name)
})

// ------------------------------------------------- 设计令牌与画布底
assert.ok(!wxss.includes('@import "../../styles/mvp.wxss"'), 'menu.wxss must no longer import the legacy mvp baseline (G1B)')
assert.match(wxss, /page\s*\{[^}]*background:\s*#f1f2ed/, 'menu.wxss must override the mvp page background with the canvas colour')
assert.match(wxss, /\.menu-page\s*\{[^}]*background:\s*#f1f2ed/, 'the menu shell must paint the canvas colour')
assert.ok(wxss.includes('#00754a'), 'the brand colour must appear in menu.wxss')

// 旧灰阶体系不得残留（audit §3.1 V1/V2/V5/V6）
const LEGACY = ['#f4f5f7', '#20242a', '#c8cdd3', '#fafbfc']
LEGACY.forEach(value => assert.ok(!wxss.includes(value), 'legacy grey token ' + value + ' is still present in menu.wxss'))

// 普通卡片不加投影；一屏只允许一个实心绿主操作（不得出现 sticky 顶栏遮挡锚点落点）
assert.match(wxss, /\.mcard\s*\{[^}]*box-shadow:\s*none/, 'ordinary cards must not carry a shadow')
assert.match(wxss, /\.menu-page\s+\.destination-card\s*\{[^}]*box-shadow:\s*none/, 'destination cards must not carry a shadow')
assert.ok(!/position:\s*sticky/.test(wxss), 'a sticky top bar would swallow wx.pageScrollTo({selector}) landing points')
assert.match(wxss, /\.mbar\s*\{[^}]*bottom:\s*0/, 'the action bar must stay pinned to the bottom')

// ------------------------------------------------- 每步一个主操作
STEP_REGIONS.forEach((region, index) => {
  const step = index + 1
  const bar = mbarOf(region)
  const buttons = (bar.match(/<button\b/g) || []).length
  // 两步都是「次操作 + 主操作」；要求页的主操作是「生成方案」（未登录时换成「去登录」）。
  assert.equal(buttons, step === 2 ? 3 : 2, 'step ' + step + ' action bar has an unexpected number of buttons')
  assert.equal((bar.match(/mbtn mbtn-sec/g) || []).length, 1,
    'step ' + step + ' must keep exactly one secondary action')
  assert.equal((bar.match(/mbtn-block/g) || []).length, 0,
    '两步都不再有「通栏唯一主操作」的确认页底栏')
  assert.equal(primaryCount(bar), 1, 'step ' + step + ' must expose exactly one solid brand-green primary action')
})

// ------------------------------------------------- 步骤条形态与状态（V3 / G3-R1）
assert.match(wxml, /class="mstep \{\{item\.done \|\| item\.current \? 'mstep-on' : ''\}\}/,
  'the progress bar must fill both the completed and the current segment')
assert.ok(wxml.includes('{{item.step}} {{item.label}}'), 'each segment must print its own step number and label')

// G3-R1 回归守卫：步骤条按钮一旦带 disabled，微信内置的
// button[disabled]:not([type])（特异度 0,2,1）就会盖掉品牌绿底色，
// 当前步被渲染成灰色 → 进度条看起来「落后一个阶段」。
// 注意：不能用 \bdisabled= —— `-` 是非单词字符，\b 会命中 `aria-disabled=` 里的子串。
// 必须显式排除连字符前缀，只拦真正的原生 disabled 属性。
assert.ok(!/(?<![-\w])disabled\s*=/.test(STEP_BAR),
  'the progress bar segments must not use disabled: the framework disabled style overrides the brand fill')
assert.ok(STEP_BAR.includes('aria-disabled='),
  'non-tappable segments must still expose aria-disabled for assistive tech')

// 当前步 / 已完成步的品牌绿必须用 button. 前缀声明：
// 去掉 disabled 后框架规则不再匹配（那才是根治），button. 前缀用于压过
// mvp.wxss 的 button[disabled]（0,1,1），并让 .menu-page button.mbtn[disabled]（0,3,1）
// 稳定高于框架的 button[disabled]:not([type])（0,2,1）。
assert.match(wxss, /\.menu-page\s+button\.mstep-on\s*\{[^}]*background:\s*#00754a/,
  'the brand fill must be declared on button.mstep-on so it outranks framework button styles')
assert.match(wxss, /\.menu-page\s+button\.mstep-on\s*\{[^}]*color:\s*#ffffff/,
  'the current segment label must be white on the brand fill')
assert.match(wxss, /\.menu-page\s+button\.mbtn\[disabled\]/,
  'disabled button states must also use the button. prefix to outrank framework styles')

// ------------------------------------------------- PDF 尺寸规格（G3-R1 实测）
// rpx = pdf_px × 1.3838（PDF 542px 画板 = 750rpx；卡片圆角实测 27px ↔ 契约 20px×1.923=38rpx）
const SIZE_SPEC = [
  ['.msteps', 'height', 68, 'PDF 49px 外框（p06 y227-275 / p07+p08 y170-218 三页一致）'],
  ['.menu-page .mvpill', 'height', 62, 'PDF 45px'],
  ['.menu-page .mvpill', 'padding', '0 24rpx', 'PDF 17px'],
  ['.mcard', 'padding', 33, 'PDF 24px'],
  ['.mcard', 'border-radius', 38, 'PDF 27px'],
  ['.menu-page .mchip', 'height', 71, 'PDF 51px'],
  ['.mbtn', 'height', 86, 'PDF 62px（p06 y554-615 / p08 y1062-1123）'],
  ['.mbtn-sm', 'height', 61, 'PDF 45px'],
  ['.menu-page .mstepper', 'height', 61, 'PDF 45px'],
  ['.menu-page .mstepper', 'width', 231, 'PDF 168px'],
  ['.menu-page .minp', 'min-height', 48, '紧凑次级输入'],
  ['.mkv', 'min-height', 87, 'PDF 63px 行距'],
  ['.menu-page .mnote', 'min-height', 65, 'PDF 47px'],
]
SIZE_SPEC.forEach(([selector, property, expected, note]) => {
  const actual = decl(selector, property)
  if (typeof expected === 'number') {
    assert.equal(rpx(actual), expected, selector + ' ' + property + ' should be ' + expected + 'rpx (' + note + ')')
  } else {
    assert.equal(actual, expected, selector + ' ' + property + ' should be "' + expected + '" (' + note + ')')
  }
})

// 「铺满式长框」守卫（G3-R1 反馈：各种框普遍过长）。
// Owner 2026-09-18 删除「更多条件」后，步骤 2 不应再有任何铺满式填充输入框：
// 日期 / 天数 / 人数 / 预算走值胶囊，交通方式走 chip，出发地与结束地是行式入口。
const STEP2_CARD1 = (() => {
  const start = STEP_REGIONS[1].indexOf('<view class="mcard">')
  return STEP_REGIONS[1].slice(start, STEP_REGIONS[1].indexOf('</view>', start))
})()
assert.ok(!STEP2_CARD1.includes('class="minp"'), 'the primary requirement card must not contain a full-width filled input')
assert.ok(!STEP2_CARD1.includes('<textarea'), 'the primary requirement card must not contain a textarea')
assert.ok(!STEP_REGIONS[1].includes('class="minp"'), '步骤 2 不应再有铺满式填充输入框')
assert.ok(!STEP_REGIONS[1].includes('<textarea'), '步骤 2 不应再有 textarea')
// 值胶囊是 PDF 里唯一带描边的行内控件，不应被拉满整行
assert.ok(!/class="mvpill"[^>]*style="[^"]*width/.test(wxml), 'value pills must stay content-sized')
assert.match(wxss, /\.mbar\s*\{[^}]*justify-content:\s*space-between/,
  'the action bar must space the secondary action and the primary CTA apart (PDF p06/p07)')
assert.equal(rpx(decl('.mbar .mbtn', 'flex').split(/\s+/).pop()), 368, 'PDF 主 CTA 宽 266px（p06 258 / p07 274 取中）')
assert.equal(rpx(decl('.mbar button.mbtn-sec', 'flex').split(/\s+/).pop()), 185, 'PDF 次按钮宽 134px')
// G3-R4：368 + 185 = 553rpx 必须留在底栏内容宽 690rpx（750 − 30×2）内。
// 一旦两按钮合计超过内容宽，`justify-content: space-between` 就失效：
// 两按钮之间没有间隙、主 CTA 右缘溢出到画板边缘（Owner 反馈的实际表现）。
assert.ok(368 + 185 < 750 - 30 * 2, 'the two action-bar buttons must leave room for the space-between gap')
// 修饰类必须**严格高于**基类。同特异度时会按源序互相覆盖：`.mbar .mbtn`（0,2,0）
// 只要声明在 `.mbar .mbtn-sec`（0,2,0）之后，就会把次按钮也撑成 368rpx。
assert.deepEqual(specificity('.mbar button.mbtn-sec'), [0, 2, 1],
  'the secondary action must outrank the base .mbar .mbtn rule (0,2,0) by specificity, not by source order')
assert.deepEqual(specificity('.mbar .mbtn'), [0, 2, 0],
  'the base action-bar button rule must stay at (0,2,0) so both modifiers can outrank it')
// 底栏按钮宽度由 flex-basis 固定 ⇒ 横向内边距**只**决定文字可用宽度。
// 185rpx 的次按钮若沿用基类的 0 46rpx，只剩 93rpx，装不下「继续选点」→ 折成两行。
{
  const secPad = decl('.mbar button.mbtn-sec', 'padding').split(/\s+/)
  const padX = rpx(secPad[secPad.length >= 2 ? 1 : 0])
  const label = (wxml.match(/class="mbtn mbtn-sec"[^>]*>([^<]+)</) || [])[1] || ''
  const labelRpx = Array.from(label.trim()).length * rpx(decl('.menu-page .mbtn', 'font-size'))
  assert.ok(labelRpx > 0, 'the secondary action label could not be read from menu.wxml')
  assert.ok(185 - 2 * padX >= labelRpx,
    'the 185rpx secondary action must fit "' + label.trim() + '" (' + labelRpx +
    'rpx) inside its horizontal padding, otherwise the label wraps to two lines')
}
// G3-R3：底栏**没有白色面板、也没有顶部分隔线**。
// p06 x=30 竖直切片：卡片底 y537 → 按钮顶 y554 之间全是页底色 #F1F2ED；
// y638 那条灰线是**底部 tabBar 的顶边**，不是本栏的。
// 旧实现写成白底 + border-top 会在页面底部多出一条明显不属于设计的白带。
{
  const barBody = block('.mbar')
  assert.ok(!/border-top\s*:\s*[^;]*#[0-9a-f]{3,6}/i.test(barBody),
    'the action bar must not draw a top hairline: the PDF shows the buttons sitting directly on #F1F2ED')
  assert.match(barBody, /background:\s*#f1f2ed/i,
    'the action bar must share the page canvas colour (#F1F2ED), not a white panel')
  // padding 是 `24rpx 30rpx calc(32rpx + env(safe-area-inset-bottom))` 这种带 calc 的简写，
  // 直接 split 取不到纯 rpx，要把 calc() 里的数字抠出来。
  const padBottom = decl('.mbar', 'padding').split(/\s+/)[2]
  const padBottomRpx = Number((padBottom.match(/([\d.]+)rpx/) || [])[1])
  assert.equal(padBottomRpx, 32,
    'the button bottom must sit 23px above the tab bar (PDF y638-y615) → 32rpx, got ' + padBottom)
}
// G3-R3：拖动提示行只在地点数 > 1 时渲染。
// PDF p06 的单地点态在「想去哪里」和卡片之间**没有任何一行**；提示行会占 25rpx 行高 + 15rpx 间距
// ≈ 38px，把整张卡片连同后续内容整体下推，是「1 地点页面没调好」的主要纵向偏差。
// 而「长按拖动排序」在只有 1 个地点时本来就没有意义。
assert.match(wxml, /wx:if="\{\{menu\.length > 1\}\}"[^>]*class="msub/,
  'the drag hint row must be gated on menu.length > 1, otherwise the single-stop state drifts ~38px below PDF p06')

// ------------------------------------------------- mvp 兼容层污染守卫（G3-R2）
// mvp.wxss:12 的 `button{min-height:84rpx}`（0,0,1）只在页面复位未声明 min-height 时生效，
// 会把所有比 84rpx 矮的自定义按钮（步骤条 68 / chip 71 / mbtn-sm 61 / mtype 48 /
// mstepper-b 55rpx）全部撑高到 84rpx。这是「各种框普遍过高」的总根因，必须显式清零。
assert.match(block('.menu-page button'), /min-height:\s*0\s*;/,
  'the page-level button reset must zero min-height, otherwise mvp button{min-height:84rpx} inflates every short button')
// mvp.wxss:16 的 `input{width:100%}` 与 menu.wxss 自身的 `.menu-page input{width:auto}`（0,2,0）
// 都会压过裸 `.mvpill-inp`（0,1,0）→ 胶囊内的 input 退回默认宽度，把胶囊拉满一行。
assert.ok(!/(^|\})\s*\.mvpill-inp\s*\{/.test(wxssCode),
  'the value-pill input must not be declared with a bare .mvpill-inp selector: .menu-page input outranks it')
assert.match(wxss, /\.menu-page\s+\.mvpill-inp\s*\{[^}]*width:\s*\d+rpx/,
  'the value-pill input needs an explicit compact width under the .menu-page prefix')

// 行内控件一律 flex:none，绝不参与拉伸（否则变成 Owner 明确拒绝的「铺满式长框」）
;['.menu-page .mvpill', '.menu-page .mchip', '.menu-page .mtype'].forEach(selector => {
  assert.match(block(selector), /flex:\s*none\s*;/,
    selector + ' must be flex:none so it can never stretch to fill the row')
})

// 卡片头行的「删除」必须把 flex / margin / width / padding 全部写死（G3-R4）：
// 宽度若由「删除」两字 + padding 决定，长地名行里会被挤；默认的 flex-shrink:1
// 还能把它压到内容宽以下，让两字溢出按钮盒、视觉上压住左侧地名；
// 而微信内置 button 的 `margin-left/right: auto` 若没被压住，按钮会「浮」在行中间，
// 名称列同时被挤到只剩几十 rpx（Owner 实机截图就是这个形态）。
assert.match(block('.menu-page .mcard-hd-row .mbtn-sm'), /flex:\s*none\s*;/,
  'the in-card 删除 button must be flex:none so a long stop name can never squeeze or overlap it')
assert.equal(rpx(decl('.menu-page .mcard-hd-row .mbtn-sm', 'width')), 108,
  'PDF p06 删除按钮宽 78px → 108rpx（不再由内容宽度决定）')
assert.match(decl('.menu-page .mcard-hd-row .mbtn-sm', 'margin'), /0\s+0\s+0\s+auto/,
  'the 删除 button must be pinned to the row right edge with margin-left:auto, ' +
  'which also overrides the framework button margin-left/right:auto')
assert.match(block('.menu-page .mcard-hd-row .mbtn-sm'), /padding:\s*0\s*;/,
  'the fixed-width 删除 button must not add padding on top of its 108rpx width')
assert.match(block('.mcopy'), /flex:\s*1/,
  'the name column must keep flex:1 so the 删除 button never has to shrink')
assert.match(block('.mcopy'), /min-width:\s*0/,
  'the name column needs min-width:0 for the ellipsis to kick in instead of pushing the row wide')

// PDF 是「标签左 / 值右」：.mkv 行里的值侧必须有 margin-left:auto 才能贴到卡片右内边距，
// 否则胶囊会紧贴标签左侧（这正是 Owner 截图里 出发日期/返回日期 的实际表现）。
assert.match(wxssCode, /\.menu-page\s+\.mkv\s*>\s*\.mvpill[\s\S]{0,200}?\{[^}]*margin-left:\s*auto/,
  'the value pill in a .mkv row must be pushed to the right edge (PDF: label left / value right)')
assert.match(wxssCode, /\.menu-page\s+\.mkv\s*>\s*picker/,
  'picker-wrapped values (出发日期 / 返回日期) must also be pushed right')

// ------------------------------------------------- 特异度：页面复位不得压过组件类（G3-R2）
// `.menu-page button` / `.menu-page input` / `.menu-page textarea` 是页面级复位，
// 特异度 **(0,1,1)**（1 个类 + 1 个元素），声明了
// display / min-height / margin / padding / border / border-radius / background /
// color / font-size / line-height / text-align。
// 任何 (0,1,0) 的裸类（或 (0,1,1) 的 `button.hv-*`）只要也声明了这些属性，就会被**静默压回**
// transparent / 0 / inherit —— 这是「按钮只剩文字、没有边框和底色」的根因，静态读值查不出来。
// 组件类必须 ≥ (0,2,0) 才能不依赖声明顺序稳赢。
const RESET_SELECTORS = new Set([
  '.menu-page button', '.menu-page button::after', '.menu-page input', '.menu-page textarea', '.menu-page picker',
])
// 复位属性清单**从复位块自身推导**（parseRules 是函数声明，会被提升），不硬编码：
// 以后给 `.menu-page button` 加任何新属性，守卫会自动把它纳入检查，不会悄悄失效。
const RESET_PROPS = new Set(
  parseRules(wxssCode)
    .filter(([sel]) => sel.split(',').some(s => RESET_SELECTORS.has(s.trim().replace(/\s+/g, ' '))))
    .flatMap(([, body]) => (body.match(/[a-z-]+\s*:/g) || []).map(p => p.replace(/\s*:$/, '')))
)
assert.ok(RESET_PROPS.has('border') && RESET_PROPS.has('background') && RESET_PROPS.has('min-height'),
  'the reset-property list must be derived from the .menu-page button/input reset blocks')
const classTokensFrom = (attr) => {
  const found = new Set()
  const re = new RegExp(attr + '="([^"]*)"', 'g')
  let match
  while ((match = re.exec(wxml))) {
    match[1].split(/\s+/).forEach(token => { if (token && !token.includes('{')) found.add(token) })
  }
  return found
}
const buttonClasses = classTokensFrom('class')
// class= 里的普通类 + hover-class= 里的反馈类，都要算作「挂在 button 上」
const buttonAttrClasses = new Set()
{
  const re = /<button\b[^>]*>/g
  let tag
  while ((tag = re.exec(wxml))) {
    ;['class', 'hover-class'].forEach(attr => {
      const m = tag[0].match(new RegExp(attr + '="([^"]*)"'))
      if (m) m[1].split(/\s+/).forEach(t => { if (t && !t.includes('{')) buttonAttrClasses.add(t) })
    })
  }
}
const inputAttrClasses = new Set()
{
  const re = /<(input|textarea)\b[^>]*>/g
  let tag
  while ((tag = re.exec(wxml))) {
    const m = tag[0].match(/class="([^"]*)"/)
    if (m) m[1].split(/\s+/).forEach(t => { if (t && !t.includes('{')) inputAttrClasses.add(t) })
  }
}
function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length
  const cls = (selector.match(/\.[\w-]+/g) || []).length
    + (selector.match(/\[[^\]]+\]/g) || []).length
    + (selector.match(/:(?!:)[\w-]+/g) || []).length
  const els = (selector.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length
  return [ids, cls, els]
}
const lessThan = (a, b) => {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i] }
  return false
}
const offenders = []
const visited = new Set()
// 用花括号配平的字符级扫描取出 {选择器, 声明体}。
// ⚠️ 不能用 `}\s*选择器\s*{` 这类正则：连续规则共享分隔符，会**隔一条漏一条**，
//    守卫会假绿（本批第一次实现就踩了这个坑，只抓到一半规则）。
function parseRules(css) {
  const rules = []
  let depth = 0
  let start = 0
  let bodyStart = -1
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0) bodyStart = i + 1
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        const selector = css.slice(start, bodyStart - 1).trim()
        const body = css.slice(bodyStart, i)
        // @media 等 at-rule 的整块跳过（里面的规则本身就是 .menu-page 前缀）
        if (selector && !selector.startsWith('@')) rules.push([selector, body])
        start = i + 1
      }
    }
  }
  return rules
}
parseRules(wxssCode).forEach(([rawSel, body]) => {
  rawSel.split(',').forEach(raw => {
    const selector = raw.trim().replace(/\s+/g, ' ')
    if (!selector || visited.has(selector)) return
    visited.add(selector)
    const tokens = (selector.match(/\.[\w-]+/g) || []).map(t => t.slice(1))
    const isButton = /(^|[\s>+~])button(?![\w-])/.test(selector) || tokens.some(t => buttonAttrClasses.has(t))
    const isInput = /(^|[\s>+~])(input|textarea)(?![\w-])/.test(selector) || tokens.some(t => inputAttrClasses.has(t))
    if (!isButton && !isInput) return
    const props = (body.match(/[a-z-]+\s*:/g) || []).map(p => p.replace(/\s*:$/, ''))
    if (!props.some(p => RESET_PROPS.has(p))) return
    // 复位规则本身就是被复位的对象，跳过。
    if (RESET_SELECTORS.has(selector)) return
    // 必须严格强于复位规则 (0,1,1)：即至少要 (0,2,0)（两个类）。
    if (lessThan(specificity(selector), [0, 2, 0])) offenders.push(selector)
  })
})
assert.deepEqual(offenders, [],
  'these selectors target a button/input but lose to the .menu-page button/input reset (0,1,1),'
  + ' so their background/border/padding are silently discarded'
  + ' — prefix them with `.menu-page ` to reach (0,2,0):\n  ' + offenders.join('\n  '))
assert.ok(buttonClasses.size > 0, 'the WXML scan should have found button classes to check')

// ------------------------------------------------- 交通方式图标（G3-R2）
// PDF p07 四个 chip 都带线性图标；图标键来自 menu.js 的 MODE_ICONS。
const modeIconMap = (() => {
  const match = js.match(/const MODE_ICONS = \{([^}]*)\}/)
  assert.ok(match, 'menu.js must declare MODE_ICONS for the transport chips')
  const map = {}
  match[1].split(',').forEach(pair => {
    const kv = pair.match(/([^\s:]+)\s*:\s*'([^']+)'/)
    if (kv) map[kv[1]] = kv[2]
  })
  return map
})()
engine.MODES.forEach(name => {
  assert.ok(modeIconMap[name], 'every engine.MODES entry needs an icon key: ' + name)
})
const iconKeys = new Set(Object.keys(modeIconMap).map(name => modeIconMap[name]))
assert.equal(iconKeys.size, engine.MODES.length,
  'two transport modes must not share one icon key')
iconKeys.forEach(key => {
  assert.match(wxss, new RegExp('\\.mchip-ico-' + key + '\\s*\\{[^}]*background-image:\\s*url\\("data:image/svg\\+xml,'),
    'icon ' + key + ' needs an unselected (grey) data-URI background-image')
  assert.match(wxss, new RegExp('\\.mchip-on\\s+\\.mchip-ico-' + key + '\\s*\\{[^}]*stroke=\'%2300754A\''),
    'icon ' + key + ' needs a selected (brand green) variant, because a data URI cannot inherit currentColor')
})
// WXML 必须真的把图标节点渲染出来，且 chip 不再是纯文字
assert.match(wxml, /class="mchip-ico mchip-ico-\{\{item\.icon\}\}"/,
  'the transport chip must render its icon node')
assert.ok(block('.mchip-ico').includes('width: 32rpx'),
  'the chip icon box is 32rpx (PDF glyph 15px wide inside a 24 viewBox)')
// PDF 未选中 chip 的图标比文字浅：图标 #767676 / 文字 #4A4A4A
assert.match(block('.menu-page .mchip'), /color:\s*#4a4a4a/,
  'unselected chip label colour must stay #4A4A4A (PDF pixel sample)')

// ------------------------------------------------- 原生导航栏（不得自绘）
assert.equal(json.navigationBarTitleText, '菜单', 'menu.json must keep the p06/p07 native title')
assert.notEqual(json.navigationStyle, 'custom', 'the native navigation bar must be kept')
assert.deepEqual(json.usingComponents, {}, 'the menu page must not register custom components')
assert.ok(js.includes('setNavigationBarTitle'), 'the native title must still be set through wx.setNavigationBarTitle')
assert.ok(js.includes("typeof wx.setNavigationBarTitle === 'function'"),
  'the dynamic title must be feature-detected so old runtimes do not throw')

// ------------------------------------------------- 已发现问题的修复必须留在源码里（§7）
assert.ok(js.includes('STEP2_FIELDS'), 'focusError must scope its anchor search to the fields step 2 actually renders')
assert.match(js, /field === 'stayDays'[\s\S]{0,120}Math\.min\(30, Math\.max\(1, days\)\)/,
  'typed stay days must be clamped to 1–30 before it reaches local storage')
assert.match(js, /cancelReal\(\)\s*\{\s*if \(!this\.data\.busy \|\| !this\.data\.jobId\) return/,
  'cancelReal must not cancel a job that already finished')

// --------------------------------- Owner 2026-09-18 决议：以下区块「这里不做」，已删除
// 原 §2.4「画布未画但不得删除」条款随之作废，改为反向断言，防止死代码/无入口 UI 回流。
assert.ok(!wxml.includes('bindtap="toggleAdvanced"'), '更多条件 must stay deleted')
assert.ok(!wxml.includes('bindtap="togglePlanning"'), '高级规划设置 must stay deleted')
assert.ok(!wxml.includes('data-field="trainToFirstPlace"'), '火车站点与绑定开关 must stay deleted')
assert.ok(!js.includes('ADVANCED_KEYS') && !js.includes('previewReal') && !js.includes('restoreRealDraft')
  && !js.includes('runRealRevision') && !js.includes('freeTextCount'),
  'no handler or constant may survive for a deleted section')
assert.ok(js.includes('normalizeStoredRequirements'),
  'legacy storage values for the deleted fields must be normalized on load')
// 2026-09-18 Owner 决定：本地演示方案链路彻底下线，菜单里不得再有 demo 生成分支。
assert.ok(!js.includes('generateDemo'), 'the demo generation path must stay deleted')
assert.ok(!js.includes('generateAsync'), 'the menu must never call the local demo engine again')
assert.ok(wxml.includes('bindtap="clear"'), '清空全部地点 must remain')

// ------------------------------------------------- WXML 卫生
assert.ok(!/<b>|<\/b>/.test(wxml), 'raw <b> tags are not valid in WXML')
assert.ok(!wxml.includes('&amp;&amp;'), 'WXML expressions must use && rather than the escaped entity')
assert.equal((wxml.match(/\{\{/g) || []).length, (wxml.match(/\}\}/g) || []).length,
  'unbalanced {{ }} expression in menu.wxml')
assert.equal((wxml.match(/id="menu-list"/g) || []).length, 1, 'the #menu-list id must appear exactly once')

console.log('PASS menu design foundation: 8 anchors + #menu-list, token/literal colours, class hygiene,')
console.log('     drag-selector coupling, one primary per step and the audited bug guards')
