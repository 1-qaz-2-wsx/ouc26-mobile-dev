/**
 * G6 · pages/me 我的页（G0 绿基线重设计）—— 静态验收
 *
 * 覆盖：
 *   1. Owner 冻结规则：项目仍是 13 pages，未新增 pages/settings；设置是右上角入口打开的本页抽屉；
 *   2. 页面结构：顶行(账号状态 + 设置) → 身份 → 我的旅行 → 社区内容（含 tabs + 列表直接可见）；
 *   3. 视觉真值：只用 G0 令牌（tokens.wxss），无渐变 / 阴影 / 旧灰黑 / 旧森林绿 / 裸 px / !important；
 *   4. 角色一致性：主按钮 / 次按钮 / 小动作 / 列表行 / 资料行 / 标签 / tabs / chip / 输入框 各一套尺寸；
 *   5. 功能冻结：所有低频入口只允许折叠或收进设置抽屉，事件与数据字段必须保留；
 *   6. 小程序工程约束：.me-page 前缀、button/input 复位、整数行高、position:fixed 只给抽屉。
 *
 * 边界：只做静态结构断言，不做截图级视觉比对；真机观感仍需人工验收。
 * 参考：AGENTS.md §6 §7 §12、specs/frontend-refactor/design-system-contract.md §1 §2、
 *      specs/frontend-refactor/visual-qa-checklist.md
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const APP = path.resolve(__dirname, '..')
const ME_DIR = path.join(APP, 'pages', 'me')

/** 读文件；先剥注释，避免注释里的 `}` / `#xxxxxx` 干扰断言（G3-R2 踩过） */
function read(file) {
  return fs.readFileSync(path.join(APP, file), 'utf8')
}
function stripCss(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}
function stripJs(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
}
function stripXml(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '')
}

/** 花括号配平的字符级扫描取 CSS 规则（正则会在连续规则共享分隔符时漏条，守卫会假绿） */
function cssRules(css) {
  const rules = []
  let depth = 0
  let head = ''
  let body = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0) { body = '' } else { body += ch }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) { rules.push({ selector: head.trim(), body }); head = ''; body = '' } else { body += ch }
    } else if (depth === 0) {
      head += ch
    } else {
      body += ch
    }
    i++
  }
  return rules
}

/** WXML 里出现的类名：静态 class + class 表达式里三元分支的字符串字面量 */
function wxmlClasses(text) {
  const found = new Set()
  const re = /class\s*=\s*"([^"]*)"/g
  let match
  while ((match = re.exec(text))) {
    const value = match[1]
    // 只取 `? 'a b' : 'c'` 的两个分支；class 表达式里的比较操作数（'following' 等）不是类名
    const branch = /\?\s*'([^']*)'\s*:\s*'([^']*)'/g
    let picked
    while ((picked = branch.exec(value))) {
      picked[1].split(/\s+/).concat(picked[2].split(/\s+/)).forEach(name => {
        if (/^[a-z][\w-]*$/.test(name)) found.add(name)
      })
    }
    value.replace(/{{[\s\S]*?}}/g, ' ').split(/\s+/).forEach(name => {
      if (/^[a-z][\w-]*$/.test(name)) found.add(name)
    })
  }
  return found
}

const appJson = JSON.parse(read('app.json'))
const wxssRaw = read('pages/me/me.wxss')
const wxss = stripCss(wxssRaw)
const wxmlRaw = read('pages/me/me.wxml')
const wxml = stripXml(wxmlRaw)
const jsRaw = read('pages/me/me.js')
const js = stripJs(jsRaw)
const rules = cssRules(wxss)
const bodyOf = selector => {
  const rule = rules.find(r => r.selector.trim() === selector)
  assert.ok(rule, '找不到规则 ' + selector)
  return rule.body
}
const sliceOf = (from, to) => {
  const start = wxml.indexOf(from)
  assert.ok(start >= 0, '找不到锚点 ' + from)
  const end = to ? wxml.indexOf(to, start) : wxml.length
  assert.ok(end > start, '找不到锚点 ' + to)
  return wxml.slice(start, end)
}
const results = []
function check(name, fn) {
  try { fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' :: ' + e.message]) }
}

/* G0（tokens.wxss / 契约 §1.1）允许出现的颜色；除此之外本页不得自造颜色 */
const G0_COLORS = ['#00754a', '#005f3b', '#e8f2ec', '#1e3932', '#ffffff', '#f7f7f7', '#f1f2ed',
  '#e9ebe3', '#dfe6dc', '#e6e7eb', '#9cc3b0', '#e5e5e5', '#141414', '#4a4a4a', '#767676',
  '#9a9a9a', '#8a4c13', '#fbf4ec', '#b3261e', '#fdf0ee', '#d39e40', '#f6e4b9', '#f9f0e3']
const LEGACY_COLORS = ['#20242a', '#2f6654', '#f4f5f7', '#f5f1e8', '#24302b', '#fffdf8',
  '#223d33', '#7a7f78', '#e5eee8', '#c8c7bd', '#d2d7dd', '#315f50']

/* ==========================================================================
   1. Owner 冻结规则：13 pages、无 settings route
   ========================================================================== */
check('app.json 仍是 13 个页面', () => {
  assert.equal(appJson.pages.length, 13, 'app.json pages 数量变了：' + appJson.pages.length)
})
check('app.json 未新增 pages/settings', () => {
  const hit = appJson.pages.filter(p => /settings/i.test(p))
  assert.deepEqual(hit, [], 'app.json 出现 settings 页面：' + hit.join(','))
})
check('仓库内不存在 pages/settings 目录', () => {
  assert.equal(fs.existsSync(path.join(APP, 'pages', 'settings')), false, '出现了 pages/settings 目录')
})
check('me 页仍在页面清单内', () => {
  assert.ok(appJson.pages.includes('pages/me/me'), 'me 页从 app.json 消失')
})
check('me.wxml / me.js 内没有任何 settings 路由跳转', () => {
  const bad = ['pages/settings', '/settings', 'settings/settings'].filter(token => wxml.includes(token) || js.includes(token))
  assert.deepEqual(bad, [], 'me 页出现 settings 路由引用：' + bad.join(','))
})
check('me 目录只保留 me.js / me.json / me.wxml / me.wxss', () => {
  const files = fs.readdirSync(ME_DIR).sort()
  assert.deepEqual(files, ['me.js', 'me.json', 'me.wxml', 'me.wxss'], 'me 目录文件集合被改动：' + files.join(','))
})
check('me.json 未改变原生导航栏体系', () => {
  const json = JSON.parse(read('pages/me/me.json'))
  assert.notEqual(json.navigationStyle, 'custom', 'navigationStyle 被改成 custom')
  assert.deepEqual(json.usingComponents || {}, {}, 'me.json 引入第三方组件')
  assert.equal(json.navigationBarTitleText, '我的 · 旅行规划助手', '页面标题被改动')
})

/* ==========================================================================
   2. 设置：右上角入口 + 本页抽屉单独打开
   ========================================================================== */
check('me.js 保留 settingsOpen / toggleSettings / closeSettings', () => {
  assert.match(js, /settingsOpen\s*:\s*false/, 'settingsOpen 初始状态丢失')
  assert.match(js, /toggleSettings\s*\(/, 'toggleSettings 事件丢失')
  assert.match(js, /settingsOpen\s*:\s*!\s*this\.data\.settingsOpen/, 'toggleSettings 不再翻转 settingsOpen')
  assert.match(js, /closeSettings\s*\(/, 'closeSettings 事件丢失')
  assert.match(js, /settingsOpen\s*:\s*false\s*\}\)/, 'closeSettings 未收起设置抽屉')
  assert.equal(/reminderCustomOpen/.test(js), false, '提醒输入折叠态已随提醒功能下线')
})
check('「设置」入口位于顶行右上角，且是本页 bindtap（不是路由）', () => {
  const topbar = sliceOf('me-topbar', 'me-card me-identity')
  assert.match(topbar, /class="me-setpill"[^>]*bindtap="toggleSettings"/, '顶行缺少绑定 toggleSettings 的「设置」胶囊')
  assert.ok(topbar.includes('设置'), '「设置」文案丢失')
  assert.equal(/navigateTo|redirectTo|reLaunch|switchTab/.test(topbar), false, '设置入口变成了路由跳转')
  assert.ok(wxml.indexOf('me-setpill') < wxml.indexOf('me-card me-identity'), '设置胶囊应在身份卡之上')
})
check('设置内容在本页抽屉里单独打开（遮罩 + 抓手 + 标题 + 关闭）', () => {
  const sheet = sliceOf('me-mask', null)
  for (const part of ['me-mask', 'me-sheet__grip', 'me-sheet__head', 'me-sheet__title', 'bindtap="closeSettings"', 'scroll-view']) {
    assert.ok(sheet.includes(part), '抽屉缺少 ' + part)
  }
  assert.ok(sheet.includes('设置与数据说明'), '抽屉标题丢失')
  assert.ok(wxml.indexOf('me-mask') > wxml.indexOf('me-card me-community'), '遮罩应在页面内容之后渲染')
  assert.match(wxml, /class="me-mask"[^>]*catchtouchmove="preventMove"/, '遮罩未拦截滑动，会出现滚动穿透')
})
check('低频分区（账号与数据 / 本机历史内容）都在抽屉内，提醒与演示入口已删除', () => {
  const sheet = sliceOf('me-sheet', null)
  for (const title of ['账号与数据', '本机历史内容', '退出当前账号']) {
    assert.ok(sheet.includes(title), '抽屉内缺少：' + title)
  }
  // 2026-09-18 Owner 决定：提醒功能搁置废弃、本地演示方案链路下线，两者都不得以任何形态回流。
  for (const removed of ['行程提醒', '进入本地演示数据', '保存默认时间', 'reminderMinutes']) {
    assert.equal(sheet.includes(removed), false, '抽屉内仍残留已下线的入口：' + removed)
  }
})
check('页面上不再有「设置与数据说明」卡片（已收进抽屉）', () => {
  assert.equal(wxml.includes('me-card me-settings'), false, '仍存在设置卡片')
  assert.equal(/class="me-card me-settings"/.test(wxss), false, 'wxss 仍定义设置卡片锚点')
})
check('互动通知 / 关注粉丝仍是本页二级 state（不在抽屉里）', () => {
  const community = sliceOf('me-card me-community', 'me-mask')
  assert.ok(community.includes('互动通知'), '互动通知不在社区内容卡内')
  assert.ok(community.includes('data-relation="followers"') || wxml.indexOf('data-relation="followers"') < wxml.indexOf('me-card me-community'), '关注/粉丝入口丢失')
  assert.ok(wxml.includes('名单仅自己可见'), '缺少「名单仅自己可见」的产品说明')
})
check('position:fixed 只出现在设置抽屉的遮罩与面板上', () => {
  const offenders = rules.filter(rule => /position\s*:\s*fixed/.test(rule.body))
    .map(rule => rule.selector.trim())
    .filter(selector => !/^\.me-page \.me-(mask|sheet)$/.test(selector))
  assert.deepEqual(offenders, [], '出现抽屉之外的 position:fixed：' + offenders.join(' | '))
  assert.match(bodyOf('.me-page .me-mask'), /position\s*:\s*fixed/, '遮罩必须是 fixed')
  assert.match(bodyOf('.me-page .me-sheet'), /position\s*:\s*fixed/, '抽屉必须是 fixed')
})

/* ==========================================================================
   3. 视觉真值：只用 G0 令牌
   ========================================================================== */
check('me.wxss 不再 import 旧 mvp 基线，也没有其它 @import', () => {
  const imports = (wxss.match(/@import\s+[^;]+;/g) || [])
  assert.deepEqual(imports, [], 'me.wxss 仍存在 @import：' + imports.join(' | '))
})
check('me.wxss 不含任何旧灰黑 / 旧森林绿', () => {
  const hit = LEGACY_COLORS.filter(color => new RegExp(color, 'i').test(wxss))
  assert.deepEqual(hit, [], '仍在用旧主题色：' + hit.join(','))
})
check('me.wxss 所有色值都在 G0 令牌集内', () => {
  const used = Array.from(new Set((wxss.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map(v => v.toLowerCase())))
  const bad = used.filter(color => !G0_COLORS.includes(color))
  assert.deepEqual(bad, [], '出现 G0 之外的色值：' + bad.join(','))
  assert.equal(/rgba?\(/i.test(wxss), false, '出现 rgba()/rgb() 自造颜色')
})
check('me.wxss 覆盖关键 G0 令牌', () => {
  const required = ['#00754a', '#f1f2ed', '#ffffff', '#141414', '#4a4a4a', '#767676', '#e5e5e5']
  const missing = required.filter(token => !new RegExp(token, 'i').test(wxss))
  assert.deepEqual(missing, [], '缺少 G0 令牌：' + missing.join(','))
})
check('me.wxss 无投影（普通卡片与抽屉都不加阴影）', () => {
  assert.equal(/box-shadow/.test(wxss), false, '出现 box-shadow')
  assert.equal(/gradient/i.test(wxss), false, '出现渐变')
})
check('me.wxss 只允许 1px 细线，其余一律 rpx', () => {
  const px = Array.from(new Set(wxss.match(/[\d.]+px/g) || []))
  const bad = px.filter(value => value !== '1px')
  assert.deepEqual(bad, [], '出现 1px 之外的 px 单位：' + bad.join(','))
})
check('me.wxss 不使用 !important', () => {
  assert.equal(/!important/.test(wxss), false, '出现 !important（应用特异度解决）')
})

/* ==========================================================================
   4. 样式工程约束（微信小程序特异度 / 文字发虚陷阱）
   ========================================================================== */
check('me.wxss 的组件类一律带 .me-page 前缀', () => {
  const offenders = []
  for (const rule of rules) {
    for (const sel of rule.selector.split(',')) {
      const s = sel.trim()
      if (!s || s === 'page') continue
      if (!/^\.me-page\b/.test(s)) offenders.push(s)
    }
  }
  assert.deepEqual(offenders, [], '存在无 .me-page 前缀的选择器（会被页面复位吞掉）：' + offenders.join(' | '))
})
check('me.wxss 存在 button 复位且逐属性清零（含 min-height / display）', () => {
  const body = bodyOf('.me-page button')
  for (const prop of ['display', 'min-height', 'margin', 'padding', 'border', 'border-radius', 'background', 'color', 'font-size', 'line-height']) {
    assert.ok(new RegExp('(^|;)\\s*' + prop + '\\s*:').test(body), '复位缺少 ' + prop)
  }
  assert.equal(/overflow\s*:\s*hidden/.test(body), false, 'button 复位写了 overflow:hidden（文字会发虚）')
})
check('me.wxss 清掉原生 button::after 描边', () => {
  assert.ok(rules.some(r => /^\.me-page button::after$/.test(r.selector.trim())), '缺少 button::after 清除规则')
})
check('me.wxss 自带 input / textarea / image 复位（已脱离 mvp）', () => {
  assert.ok(rules.some(r => /^\.me-page input, \.me-page textarea$/.test(r.selector.trim())), '缺少 input/textarea 复位')
  assert.ok(rules.some(r => /^\.me-page image$/.test(r.selector.trim())), '缺少 image 复位')
})
check('控件高度 − 行高 为偶数（文字落整像素）', () => {
  const roles = [
    { selector: '.me-page .me-btn--primary', height: 92, line: 36, lineFrom: '.me-page .me-btn' },
    { selector: '.me-page .me-btn--sec', height: 86, line: 36, lineFrom: '.me-page .me-btn' },
    { selector: '.me-page .me-btn--sm', height: 66, line: 34, lineFrom: '.me-page .me-btn--sm' },
    { selector: '.me-page .me-chip', height: 70, line: 36, lineFrom: '.me-page .me-chip' },
    { selector: '.me-page .me-setpill', height: 66, line: 34, lineFrom: '.me-page .me-setpill' }
  ]
  for (const role of roles) {
    const own = bodyOf(role.selector)
    assert.match(own, new RegExp('height\\s*:\\s*' + role.height + 'rpx'), role.selector + ' 高度不是 ' + role.height + 'rpx')
    const lineBody = role.lineFrom === role.selector ? own : bodyOf(role.lineFrom)
    assert.match(lineBody, new RegExp('line-height\\s*:\\s*' + role.line + 'rpx'), role.lineFrom + ' 行高不是 ' + role.line + 'rpx')
    assert.equal((role.height - role.line) % 2, 0, role.selector + ' 高度 − 行高 不是偶数')
  }
})
check('自定义按钮不使用 disabled（框架 button[disabled]:not([type]) 会压掉品牌色）', () => {
  const bad = wxml.match(/<button[^>]*\sdisabled=/g) || []
  assert.deepEqual(bad, [], '自定义 button 出现 disabled 属性，应改用 aria-disabled + JS 早退')
})
check('WXML 全类名都能在 me.wxss 找到定义', () => {
  const defined = new Set(Array.from(wxss.matchAll(/\.([a-z][\w-]*)/g)).map(match => match[1]))
  const missing = [...wxmlClasses(wxml)].filter(name => !defined.has(name))
  assert.deepEqual(missing, [], 'WXML 用了未定义的类：' + missing.join(','))
})
check('角色类齐备：主/次/小动作、列表行+图标、资料行、标签、tabs、chip、输入框、抽屉', () => {
  for (const cls of ['me-btn--primary', 'me-btn--sec', 'me-btn--sm', 'me-lrow', 'me-lrow__ico', 'me-prow',
    'me-tag', 'me-tab--on', 'me-chip--on', 'me-inp', 'me-tip', 'me-empty', 'me-mask', 'me-sheet', 'me-block']) {
    assert.ok(new RegExp('\\.me-page \\.' + cls + '\\b').test(wxss), '缺少角色样式 .' + cls)
  }
})

/* ==========================================================================
   5. 信息层级与交互组织
   ========================================================================== */
check('一级结构顺序：身份 → 我的旅行 → 社区内容 → 设置抽屉', () => {
  const order = ['me-topbar', 'me-card me-identity', 'me-card me-travel', 'me-card me-community', 'me-sheet']
    .map(anchor => wxml.indexOf(anchor))
  order.forEach((at, index) => assert.ok(at >= 0, '缺少结构锚点：' + index))
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, '页面结构顺序不是 顶行 → 身份 → 旅行 → 社区 → 抽屉')
})
check('三张一级卡片都不带 wx:if（游客态与登录态共用同一骨架）', () => {
  for (const anchor of ['me-card me-identity', 'me-card me-travel', 'me-card me-community']) {
    const at = wxml.indexOf(anchor)
    const open = wxml.lastIndexOf('<view', at)
    const tag = wxml.slice(open, wxml.indexOf('>', at))
    assert.equal(/wx:if/.test(tag), false, anchor + ' 被条件渲染，游客态与登录态骨架会分叉')
  }
})
check('社区内容默认可见：帖子/收藏 tabs 与列表不折叠', () => {
  assert.equal(/communityOpen/.test(js), false, 'me.js 仍保留已取消的 communityOpen 折叠态')
  assert.equal(/communityOpen/.test(wxml), false, 'WXML 仍按 communityOpen 折叠社区内容')
  const community = sliceOf('me-card me-community', 'me-mask')
  assert.ok(community.includes('switchTab'), '社区 tabs 不在社区卡内直接渲染')
  assert.ok(community.includes('me-rows'), '社区列表不在社区卡内直接渲染')
  assert.ok(community.includes('toggleNotifications'), '互动通知入口丢失')
})
check('首屏不展开低频内容：折叠态默认值全为 false', () => {
  for (const field of ['notificationsOpen', 'settingsOpen', 'relationOpen']) {
    assert.match(js, new RegExp(field + '\\s*:\\s*false'), field + ' 默认不是折叠状态')
  }
})
check('统计为内联数字（无描边 / 无底色 / 无胶囊）', () => {
  const stat = bodyOf('.me-page .me-stat')
  for (const prop of ['border', 'background', 'height']) {
    assert.equal(new RegExp('(^|;)\\s*' + prop + '\\s*:').test(stat), false, '.me-stat 仍写 ' + prop + '，与截图的纯文字统计不一致')
  }
  assert.match(bodyOf('.me-page .me-stat__num'), /font-size\s*:\s*38rpx/, '统计数字字号不是 38rpx')
  for (const label of ['stats.followingCount', 'stats.followerCount', 'stats.likeReceivedCount']) {
    assert.ok(wxml.includes(label), '缺少统计项：' + label)
  }
})
check('账号状态在顶行、ID 行在身份卡（与截图一致）', () => {
  assert.ok(sliceOf('me-topbar', 'me-card me-identity').includes('account.stateLabel'), '顶行未渲染账号状态')
  assert.ok(sliceOf('me-card me-identity', 'me-card me-travel').includes('account.idLine'), '身份卡未渲染 ID 行')
  assert.ok(js.includes('ID · 微信账号已绑定'), '缺少「ID · 微信账号已绑定」文案')
})
check('同一屏只有一个实心绿主操作（登录 / 保存资料 / 生成旅行方案 三者互斥）', () => {
  const count = (wxml.match(/me-btn--primary/g) || []).length
  assert.ok(count <= 3, 'me-btn--primary 出现 ' + count + ' 次，模板里主按钮过多')
  assert.match(wxml, /wx:if="\{\{user\.kind !== 'wechat'\}\}"[^>]*me-btn--primary/, '游客登录主按钮没有按身份收敛')
  assert.match(wxml, /account\.wechat && cloud && !editing \? 'me-btn--primary' : 'me-btn--sec'/, '旅行卡主按钮没有与编辑态互斥')
})
check('我的旅行卡文案与操作：生成旅行方案 + 查看行程', () => {
  const travel = sliceOf('me-card me-travel', 'me-card me-community')
  assert.ok(travel.includes('生成旅行方案'), '缺少「生成旅行方案」')
  assert.ok(travel.includes('查看行程'), '缺少「查看行程」')
  assert.ok(travel.includes('bindtap="start"') && travel.includes('bindtap="trip"'), '主次按钮事件丢失')
  assert.ok(travel.includes('travelMeta'), '缺少方案 / 行程数量')
})
check('游客态有登录主操作，登录态有编辑资料入口', () => {
  assert.equal((wxml.match(/bindtap="login"/g) || []).length, 1, 'login 绑定必须唯一')
  assert.match(wxml, /bindtap="editProfile"[\s\S]*?>编辑资料</, '缺少编辑资料入口')
})
check('微信资料待加载时提供重新加载入口', () => {
  assert.match(wxml, /wx:elif="\{\{user\.kind === 'wechat'\}\}"[\s\S]*?bindtap="refreshAccount"[\s\S]*?重新加载/, '缺少「重新加载」入口')
})

/* ==========================================================================
   6. 功能冻结：低频入口只允许折叠，不允许删除
   ========================================================================== */
const HANDLERS = ['login', 'editProfile', 'chooseAvatar', 'nickname', 'bio', 'saveProfile', 'cancelProfile',
  'refreshAccount', 'logout', 'toggleSettings', 'closeSettings', 'toggleNotifications',
  'openRelations', 'relationAction', 'relationMore', 'openMember', 'switchTab',
  'markNotifications', 'openNotification', 'post', 'removeFavorite',
  'start', 'trip', 'community', 'compose', 'previewLegacy', 'republishLegacy']
check('me.js 保留全部既有事件（含抽屉与折叠事件）', () => {
  const missing = HANDLERS.filter(name => !new RegExp('\\b' + name + '\\s*\\(').test(js))
  assert.deepEqual(missing, [], 'me.js 丢失事件：' + missing.join(','))
  // 已下线的入口连处理器一起删除，防止「无入口 UI 的死代码」回流。
  const removedHandlers = ['demo', 'toggleDeveloper', 'togglePlans', 'toggleReminderCustom', 'saveReminder', 'quickReminder', 'openPlan', 'field']
  removedHandlers.forEach(name => assert.equal(new RegExp('\\b' + name + '\\s*\\(').test(js), false,
    'me.js 仍保留已下线入口的处理器：' + name))
})
check('me.wxml 引用的每个事件在 me.js 中都有实现', () => {
  const bound = new Set()
  const re = /(?:bind|catch)[a-z]*\s*=\s*"([A-Za-z_$][\w$]*)"/g
  let m
  while ((m = re.exec(wxml))) bound.add(m[1])
  const missing = [...bound].filter(name => !new RegExp('\\b' + name + '\\s*\\(').test(js))
  assert.deepEqual(missing, [], 'me.wxml 绑定了未实现的事件：' + missing.join(','))
  assert.ok(bound.size >= 20, '绑定的事件数量异常偏少：' + bound.size)
})
check('me.js 保留全部低频数据字段与派生状态', () => {
  const fields = ['legacyPosts', 'republishBusy', 'relationItems', 'relationCursor',
    'relationHasMore', 'notifications', 'unreadCount', 'favoriteBusy',
    'avatarDraft', 'nicknameDraft', 'bioDraft', 'profileBusy', 'syncError', 'loginSource',
    'account', 'travelMeta', 'idLine']
  const missing = fields.filter(f => !new RegExp('\\b' + f + '\\b').test(js))
  assert.deepEqual(missing, [], 'me.js 丢失字段：' + missing.join(','))
})
check('me.wxml 保留低频能力入口文案', () => {
  const entries = ['登录 / 注册', '编辑资料', '选择头像', '保存资料', '退出当前账号',
    '我的帖子', '收藏', '发布内容', '浏览社区', '本机历史内容', '重发', '互动通知', '全部标为已读',
    '生成旅行方案', '查看行程', '我的旅行', '设置与数据说明']
  const missing = entries.filter(t => !wxml.includes(t))
  assert.deepEqual(missing, [], 'me.wxml 丢失入口：' + missing.join(','))
})
check('guest / wechat 两态文案分支与云端分支都还在', () => {
  assert.ok(wxml.includes("user.kind !== 'wechat'"), '缺少游客登录主操作分支')
  assert.ok(js.includes("kind === 'guest'") || js.includes("=== 'guest'"), '缺少 guest 分支')
  assert.ok(wxml.includes('cloud ?') || js.includes('cloud ?'), '缺少 cloud 分支')
})
check('提醒功能已从本页彻底下线（无输入、无落库、无订阅调用）', () => {
  assert.equal(/reminderMinutes|requestSubscribeMessage|subscribe\(/.test(js), false,
    '本页不得再保留提醒数据与订阅调用')
  assert.equal(/0–10080|保存默认时间/.test(wxml), false, '提醒输入区必须整块删除')
})
check('关注 / 粉丝数字与「我的名单」能力保留', () => {
  assert.ok(wxml.includes('stats.followingCount'), '缺少关注数字')
  assert.ok(wxml.includes('stats.followerCount'), '缺少粉丝数字')
  assert.ok(wxml.includes('stats.likeReceivedCount'), '缺少获赞数字')
  assert.match(js, /service\.following\(/, 'following 接口调用丢失')
  assert.match(js, /service\.followers\(/, 'followers 接口调用丢失')
})

/* ==========================================================================
   7. WXML 完整性
   ========================================================================== */
check('WXML 没有把 && 写成 &amp;&amp;', () => {
  assert.equal(/&amp;&amp;/.test(wxml), false, 'WXML 表达式被错误转义为 &amp;&amp;')
})
check('WXML 标签配平（view / block / button / text / scroll-view）', () => {
  for (const tag of ['view', 'block', 'button', 'text', 'scroll-view']) {
    const open = (wxml.match(new RegExp('<' + tag + '(?=[\\s>])', 'g')) || []).length
    const close = (wxml.match(new RegExp('</' + tag + '>', 'g')) || []).length
    assert.equal(open, close, tag + ' 标签不配平：open=' + open + ' close=' + close)
  }
})
check('WXML 未使用设计稿不允许的自绘结构（navigation-bar / custom-tab-bar）', () => {
  assert.equal(/<navigation-bar|<custom-tab-bar|navigationStyle/.test(wxml), false, '出现自绘导航/标签栏结构')
})
check('WXML 内不再引用 mvp / 全局旧类', () => {
  const foreign = ['class="page', 'class="panel', 'class="error"', 'class="subtitle"', 'class="toolbar"',
    'class="section-title"', 'class="empty-card"', 'class="note"', 'class="tag"', 'class="muted"', 'class="row"']
  const hit = foreign.filter(token => wxml.includes(token))
  assert.deepEqual(hit, [], '仍在用全局/其它页类名：' + hit.join(','))
})

/* ==========================================================================
   输出
   ========================================================================== */
let failed = 0
for (const [state, name] of results) {
  if (state === 'FAIL') failed++
  console.log((state === 'PASS' ? '  ok  ' : '  FAIL') + '  ' + name)
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed' + (failed ? '  (' + failed + ' failed)' : ''))
if (failed) process.exit(1)
