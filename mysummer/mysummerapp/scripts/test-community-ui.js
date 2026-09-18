/**
 * G7 · Community UI 静态验收（community / member / post-detail / post-edit）
 *
 * 覆盖本轮硬约束：
 *   1. 四页彻底脱离 styles/mvp.wxss（legacy 基线），类名全部带 com-/mem-/pd-/pe- 前缀；
 *   2. 四页共用同一套 Community UI 视觉语言（色板 / 圆角 / 头像 / 卡片 / 次级动作 / 主 CTA）；
 *   3. 一屏最多一个实心绿主 CTA；
 *   4. 无渐变、无第三方组件/字体、普通卡片无投影、原生导航与 tabBar；
 *   5. 不新造后端能力：页面只调用既有 service 函数，不出现裸端点字符串；
 *   6. member 真正接入 C1 分页（cursor/hasMore/loadingMore/去重/竞态守卫），private 内容不进成员页；
 *   7. post-detail 保留两级评论语义、只允许删自己的评论、举报保持低频二级动作。
 *
 * 边界：只做静态结构断言，不做截图级视觉比对；真机观感仍需微信开发者工具人工验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const APP = path.resolve(__dirname, '..')

/* 页面 JS 只为「事件绑定是否真实存在」而加载；不给它任何真实网络/存储能力。 */
const storage = new Map()
global.wx = global.wx || {
  getStorageSync(key) { return storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : '' },
  setStorageSync(key, value) { storage.set(key, JSON.parse(JSON.stringify(value))) },
  removeStorageSync(key) { storage.delete(key) }
}

const read = file => fs.readFileSync(path.join(APP, file), 'utf8')
const stripCss = text => text.replace(/\/\*[\s\S]*?\*\//g, '')
const stripXml = text => text.replace(/<!--[\s\S]*?-->/g, '')
const stripJs = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')

const PAGES = [
  { name: 'community', prefix: 'com-', root: 'com-page', title: '社区' },
  { name: 'member', prefix: 'mem-', root: 'mem-page', title: '成员主页' },
  { name: 'post-detail', prefix: 'pd-', root: 'pd-page', title: '社区内容' },
  { name: 'post-edit', prefix: 'pe-', root: 'pe-page', title: '发布内容' }
]

const LEGACY_CLASSES = [
  'page', 'title', 'subtitle', 'note', 'panel', 'row', 'tag', 'error', 'muted',
  'photos', 'toolbar', 'item-head', 'card', 'selected', 'floating', 'empty-card', 'section-title'
]
const LEGACY_COLORS = ['#20242a', '#707780', '#f4f5f7', 'rgba(32,36,42', '#256d58', '#4f565e', '#eceef0']
const SHARED_COLORS = ['#00754a', '#e8f2ec', '#f1f2ed', '#ffffff', '#141414', '#4a4a4a', '#767676', '#e5e5e5']
const ALLOWED_SERVICE_CALLS = [
  'cloudReady', 'communityFeed', 'member', 'postDetail', 'comments', 'deleteComment', 'api',
  'toggleLike', 'toggleFavorite', 'toggleFollow', 'report', 'createPost', 'updatePost',
  'changePostVisibility', 'deletePost', 'uploadPhotos'
]

/** 花括号配平取 CSS 规则（正则会在连续规则共享分隔符时漏条） */
function cssRules(css) {
  const rules = []
  let depth = 0, head = '', body = '', i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0) body = ''
      else body += ch
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) { rules.push({ selector: head.trim(), body }); head = ''; body = '' }
      else body += ch
    } else if (depth === 0) head += ch
    else body += ch
    i += 1
  }
  return rules
}
const classesIn = selector => Array.from(new Set(Array.from(selector.matchAll(/\.([A-Za-z_][\w-]*)/g)).map(m => m[1])))

/** WXML 里所有 class 取值：静态 token + {{}} 表达式里的字符串字面量 */
function classTokens(wxml) {
  const tokens = new Set()
  Array.from(wxml.matchAll(/class\s*=\s*(["'])([\s\S]*?)\1/g)).forEach(match => {
    const value = match[2]
    Array.from(value.matchAll(/(['"])([^'"]+)\1/g)).forEach(literal => {
      literal[2].split(/\s+/).forEach(token => { if (/^[A-Za-z_][\w-]*$/.test(token)) tokens.add(token) })
    })
    value.replace(/{{[\s\S]*?}}/g, ' ').split(/\s+/).forEach(token => {
      const cleaned = token.replace(/[^\w-]/g, '')
      if (cleaned && /^[A-Za-z_]/.test(cleaned)) tokens.add(cleaned)
    })
  })
  return tokens
}

const results = []
function check(name, fn) {
  try { fn(); results.push(['PASS', name]) } catch (error) { results.push(['FAIL', name + ' :: ' + error.message]) }
}
const count = (haystack, needle) => haystack.split(needle).length - 1

/** 规则体里的属性名集合 */
function propsOf(body) {
  return new Set(String(body).split(';').map(decl => decl.split(':')[0].trim().toLowerCase()).filter(Boolean))
}
/** 某个标签上出现过的 class（静态 token + {{}} 里的字面量） */
function classesOnTag(wxml, tag) {
  const set = new Set()
  Array.from(wxml.matchAll(new RegExp('<' + tag + '\\b[^>]*>', 'g'))).forEach(match => {
    const classMatch = /class\s*=\s*(["'])([\s\S]*?)\1/.exec(match[0])
    if (!classMatch) return
    const value = classMatch[2]
    Array.from(value.matchAll(/(['"])([^'"]+)\1/g)).forEach(literal => {
      literal[2].split(/\s+/).forEach(token => { if (/^[A-Za-z_][\w-]*$/.test(token)) set.add(token) })
    })
    value.replace(/{{[\s\S]*?}}/g, ' ').split(/\s+/).forEach(token => {
      const cleaned = token.replace(/[^\w-]/g, '')
      if (cleaned && /^[A-Za-z_]/.test(cleaned)) set.add(cleaned)
    })
  })
  return set
}

/** 加载页面定义：只读 handler 表，不触发任何生命周期。 */
function pageDefinition(name) {
  const captured = []
  const previous = global.Page
  global.Page = value => captured.push(value)
  const file = require.resolve('../pages/' + name + '/' + name)
  delete require.cache[file]
  require(file)
  global.Page = previous
  assert.equal(captured.length, 1, name + ' 未注册 Page')
  return captured[0]
}

/* ==========================================================================
   1. 全局冻结项（本轮不得触碰 app.json / 全局样式）
   ========================================================================== */
const appJson = JSON.parse(read('app.json'))
check('app.json 仍是 13 页且顺序未变', () => {
  assert.equal(appJson.pages.length, 13)
  assert.deepEqual(appJson.pages, [
    'pages/me/me', 'pages/index/index', 'pages/map-search/map-search', 'pages/map-selection/map-selection',
    'pages/menu/menu', 'pages/itinerary/itinerary', 'pages/community/community', 'pages/plan-detail/plan-detail',
    'pages/place-detail/place-detail', 'pages/booking/booking', 'pages/post-edit/post-edit',
    'pages/post-detail/post-detail', 'pages/member/member'
  ])
})
check('原生导航 / 原生 tabBar 配置未被改动', () => {
  assert.equal(appJson.window.navigationStyle, 'default')
  assert.notEqual(appJson.tabBar.custom, true)
  assert.equal(appJson.tabBar.list.length, 5)
  assert.equal(appJson.window.backgroundColor, '#F1F2ED')
})
check('四页 json 保持契约标题且没有第三方组件', () => {
  PAGES.forEach(({ name, title }) => {
    const pageJson = JSON.parse(read('pages/' + name + '/' + name + '.json'))
    assert.equal(pageJson.navigationBarTitleText, title, name + ' 标题偏离设计契约')
    assert.equal(pageJson.navigationStyle, 'default', name + ' 必须保持原生导航')
    assert.deepEqual(Object.keys(pageJson.usingComponents || {}), [], name + ' 不得引入第三方组件')
  })
})
check('community.json 的分页契约保留（下拉刷新 + 160 触底距离）', () => {
  const pageJson = JSON.parse(read('pages/community/community.json'))
  assert.equal(pageJson.enablePullDownRefresh, true)
  assert.equal(pageJson.onReachBottomDistance, 160)
})

/* ==========================================================================
   2. legacy 基线脱离 + 前缀命名纪律
   ========================================================================== */
PAGES.forEach(({ name, prefix }) => {
  const wxssRaw = read('pages/' + name + '/' + name + '.wxss')
  const wxss = stripCss(wxssRaw)
  const wxml = stripXml(read('pages/' + name + '/' + name + '.wxml'))

  check(name + '.wxss 已移除 legacy mvp import', () => {
    assert.equal(wxssRaw.includes('@import "../../styles/mvp.wxss"'), false, '仍在 import legacy 基线')
    assert.equal(/@import\s/.test(wxss), false, name + ' 不应再 import 任何样式文件')
  })
  check(name + '.wxss 类名全部带 ' + prefix + ' 前缀', () => {
    const foreign = []
    cssRules(wxss).forEach(rule => {
      const selector = rule.selector
      if (!selector || selector.startsWith('@')) return
      const first = selector.trim().split(/\s*,\s*/)[0].trim()
      if (first === 'page' || /^(view|text|image|input|textarea|button|scroll-view|map)\b/.test(first)) return
      classesIn(selector).forEach(cls => { if (!cls.startsWith(prefix)) foreign.push(selector + ' → .' + cls) })
    })
    assert.deepEqual(foreign, [], name + ' 出现非本页前缀类名：' + foreign.join(', '))
  })
  check(name + ' 未使用裸 legacy 类名', () => {
    const used = new Set(classTokens(wxml))
    cssRules(wxss).forEach(rule => classesIn(rule.selector).forEach(cls => used.add(cls)))
    const hits = LEGACY_CLASSES.filter(cls => used.has(cls))
    assert.deepEqual(hits, [], name + ' 仍在用 legacy 类：' + hits.join(', '))
  })
  check(name + ' 未复用旧灰阶/森林绿颜色', () => {
    const joined = (wxss + wxml).toLowerCase()
    const hits = LEGACY_COLORS.filter(color => joined.includes(color))
    assert.deepEqual(hits, [], name + ' 残留旧配色：' + hits.join(', '))
  })
})

/* ==========================================================================
   3. 四页统一视觉语言（同一套色板与组件规格）
   ========================================================================== */
PAGES.forEach(({ name, root }) => {
  const wxss = stripCss(read('pages/' + name + '/' + name + '.wxss')).toLowerCase()
  const wxml = stripXml(read('pages/' + name + '/' + name + '.wxml'))
  check(name + ' 使用 Community UI 共享色板', () => {
    const missing = SHARED_COLORS.filter(color => !wxss.includes(color))
    assert.deepEqual(missing, [], name + ' 缺少共享色：' + missing.join(', '))
  })
  check(name + ' 画布底与卡片规格一致', () => {
    assert.ok(/page\s*\{[^}]*background:\s*#f1f2ed/.test(wxss), name + ' 页面底应为 #F1F2ED')
    assert.ok(wxss.includes('border-radius: 38rpx'), name + ' 卡片圆角应为 38rpx')
    assert.ok(wxss.includes('border-radius: 27rpx'), name + ' 内嵌块/图片圆角应为 27rpx')
    assert.ok(wxss.includes('999rpx'), name + ' 胶囊应为 999rpx')
  })
  check(name + ' 无渐变 / 普通卡片无投影 / 不使用第三方图标字体', () => {
    assert.equal(/linear-gradient|radial-gradient/.test(wxss), false, name + ' 出现渐变')
    assert.equal(/font-family/.test(wxss), false, name + ' 新增了外部字体栈')
    assert.equal(/@font-face|iconfont/.test(wxss), false, name + ' 引入字体图标')
    const shadows = Array.from(wxss.matchAll(/box-shadow/g)).length
    assert.ok(shadows <= 1, name + ' 普通卡片不应大量使用投影（' + shadows + ' 处）')
  })
  check(name + '.wxss 花括号配平且内联图标已编码', () => {
    const raw = stripCss(read('pages/' + name + '/' + name + '.wxss'))
    const open = count(raw, '{'), close = count(raw, '}')
    assert.equal(open, close, name + ' 花括号未配平（' + open + ' vs ' + close + '）')
    Array.from(raw.matchAll(/url\(\s*(["'])(.*?)\1\s*\)/g)).forEach(match => {
      assert.ok(match[2].startsWith('data:image/svg+xml,'), name + ' 出现了外部资源引用')
      assert.equal(match[2].includes('#'), false, name + ' 的 data URI 里有未编码的 #（WXSS 会截断）')
    })
  })
  check(name + ' 原生导航 / 未自绘 tabBar', () => {
    assert.equal(/navigation-bar|nav-bar|tabbar|custom-tab/.test(wxml + wxss), false, name + ' 出现自绘导航/tabBar')
  })
  check(name + ' 页面复位不会静默压掉组件样式（specificity 纪律）', () => {
    const rules = cssRules(stripCss(read('pages/' + name + '/' + name + '.wxss')))
    const offenders = []
    ;['button', 'input', 'textarea'].forEach(element => {
      // 复位规则：.<root> button / .<root> input / .<root> textarea（含 ::after / [aria-disabled]）
      const resetProps = new Set()
      let hasReset = false
      rules.forEach(rule => {
        const selector = rule.selector.trim()
        if (!new RegExp('^\\.' + root + '\\s+' + element + '(::|\\[|$|\\s*$|\\s*,)').test(selector)) return
        if (classesIn(selector).length !== 1) return
        hasReset = true
        propsOf(rule.body).forEach(prop => resetProps.add(prop))
      })
      if (!hasReset) return
      const classes = classesOnTag(wxml, element)
      rules.forEach(rule => {
        const selector = rule.selector.trim()
        const selectorClasses = classesIn(selector)
        // 只看 (0,1,0) 的裸类规则：它们会被 .<root> button(0,1,1) 压掉
        if (selectorClasses.length !== 1) return
        if (!classes.has(selectorClasses[0])) return
        const clash = Array.from(propsOf(rule.body)).filter(prop => resetProps.has(prop))
        if (clash.length) offenders.push(element + ' ← ' + selector + ' 冲突属性：' + clash.join('/'))
      })
    })
    assert.deepEqual(offenders, [], name + ' 的组件类会被页面复位压掉：' + offenders.join('；'))
  })
  check(name + ' busy/禁用态用 aria-disabled 而非原生 disabled', () => {
    assert.equal(/(^|[^-a-z])disabled="/.test(wxml), false, name + ' 使用了原生 disabled（会被微信内置 [disabled] 样式压过）')
    const wxss = stripCss(read('pages/' + name + '/' + name + '.wxss'))
    assert.ok(new RegExp('\\.' + root + '\\s+button\\[aria-disabled="true"\\]').test(wxss), name + ' 缺少 aria-disabled 视觉态')
  })
})
check('社区四页共用同一套作者行 / 头像 / 次级动作规格', () => {
  const community = stripCss(read('pages/community/community.wxss'))
  const detail = stripCss(read('pages/post-detail/post-detail.wxss'))
  const member = stripCss(read('pages/member/member.wxss'))
  const edit = stripCss(read('pages/post-edit/post-edit.wxss'))
  assert.ok(/\.com-avatar\s*\{[^}]*width:\s*73rpx/.test(community), '社区头像应为 73rpx')
  assert.ok(/\.pd-avatar\s*\{[^}]*width:\s*73rpx/.test(detail), '详情作者头像应为 73rpx')
  assert.ok(/\.pd-cmt__avatar\s*\{[^}]*width:\s*50rpx/.test(detail), '评论小头像应为 50rpx')
  assert.ok(/\.mem-avatar\s*\{[^}]*width:\s*138rpx/.test(member), '成员大头像应为 138rpx')
  assert.ok(/\.com-act\s*\{[^}]*height:\s*68rpx/.test(community), '社区次级动作应为 68rpx')
  assert.ok(/\.pd-act\s*\{[^}]*height:\s*68rpx/.test(detail), '详情次级动作应为 68rpx')
  assert.ok(/\.com-post__title\s*\{[^}]*font-size:\s*30rpx/.test(community), '帖子标题应 30rpx')
  assert.ok(/\.mem-row__title\s*\{[^}]*font-size:\s*28rpx/.test(member), '成员列表标题应 28rpx')
  assert.ok(/\.pe-label\s*\{[^}]*font-size:\s*27rpx/.test(edit), '表单 label 应 27rpx')
  assert.ok(/\.com-post__cover\s*\{[^}]*border-radius:\s*27rpx/.test(community), '封面圆角应 27rpx')
  assert.ok(/\.pd-photos__item\s*\{[^}]*border-radius:\s*27rpx/.test(detail), '详情图片圆角应 27rpx')
})

/* ==========================================================================
   4. 一屏一个实心绿主 CTA
   ========================================================================== */
check('community 只有「发布」一个实心绿主 CTA', () => {
  const wxml = stripXml(read('pages/community/community.wxml'))
  assert.equal(count(wxml, 'com-publish'), 1)
  const wxss = stripCss(read('pages/community/community.wxss')).toLowerCase()
  assert.equal(count(wxss, 'background: #00754a'), 1, '实心绿只应出现在发布按钮上')
})
check('member 只有「关注」在未关注态是实心绿', () => {
  const wxml = stripXml(read('pages/member/member.wxml'))
  assert.equal(count(wxml, 'mem-follow '), 1)
  const wxss = stripCss(read('pages/member/member.wxss')).toLowerCase()
  assert.equal(count(wxss, 'background: #00754a'), 1)
  assert.ok(/\.mem-follow--on\s*\{[^}]*background:\s*#ffffff/.test(wxss), '已关注应降级为描边次按钮')
})
check('post-detail 主 CTA 随状态切换（参考导入打开时让位给确认）', () => {
  const wxml = stripXml(read('pages/post-detail/post-detail.wxml'))
  assert.ok(wxml.includes("referencePreview ? 'pd-btn--quiet' : 'pd-btn--primary'"), '评论提交缺少主 CTA 状态降级')
  assert.ok(/class="pd-btn pd-btn--primary"[^>]*bindtap="confirmReference"/.test(wxml), '参考导入确认应为实心主 CTA')
  assert.equal(count(wxml, 'pd-btn--primary'), 2)
})
check('post-edit 只有「发布 / 保存修改」一个实心绿主 CTA', () => {
  const wxml = stripXml(read('pages/post-edit/post-edit.wxml'))
  assert.equal(count(wxml, 'pe-btn--primary'), 1)
  const wxss = stripCss(read('pages/post-edit/post-edit.wxss')).toLowerCase()
  assert.equal(count(wxss, 'background: #00754a'), 1)
})

/* ==========================================================================
   5. Community 首页：内容流优先
   ========================================================================== */
check('community 首页控制区只有三行，不 sticky 不吸顶', () => {
  const wxml = stripXml(read('pages/community/community.wxml'))
  const wxss = stripCss(read('pages/community/community.wxss'))
  assert.equal(count(wxml, 'com-controls__top'), 1)
  assert.equal(count(wxml, 'class="com-search"'), 1)
  assert.equal(count(wxml, 'class="com-types"'), 1)
  assert.equal(/position:\s*(fixed|sticky)/.test(wxss), false, '控制区不得吸顶')
})
check('community 保留推荐/关注、搜索、类型筛选、发布入口、分页加载', () => {
  const wxml = stripXml(read('pages/community/community.wxml'))
  ;['推荐', '关注', '搜索', '全部', '路线', '评价', '问题', '发布'].forEach(text => {
    assert.ok(wxml.includes(text), '缺少入口：' + text)
  })
  assert.ok(wxml.includes('bindconfirm="search"') && wxml.includes('bindtap="search"'))
  const js = stripJs(read('pages/community/community.js'))
  assert.ok(js.includes('onReachBottom') && js.includes('onPullDownRefresh'), '缺少分页/刷新钩子')
})
check('community「推荐」不暗示算法推荐', () => {
  const combined = stripXml(read('pages/community/community.wxml')) + stripJs(read('pages/community/community.js'))
  assert.equal(/AI|智能推荐|算法推荐|猜你喜欢/.test(combined), false, '推荐口径不得被写成算法推荐')
  assert.ok(stripXml(read('pages/community/community.wxml')).includes('最新公开内容'), '推荐应显式说明＝最新公开内容')
})
check('community 次级动作视觉降级（淡底胶囊，不是实体按钮）', () => {
  const wxss = stripCss(read('pages/community/community.wxss')).toLowerCase()
  assert.ok(/\.com-act\s*\{[^}]*background:\s*#f7f7f7/.test(wxss))
  assert.ok(/\.com-act--on\s*\{[^}]*background:\s*#e8f2ec/.test(wxss))
  assert.equal(/\.com-act\s*\{[^}]*background:\s*#00754a/.test(wxss), false)
})

/* ==========================================================================
   6. Member：身份 / 统计 / 关注 / 公开帖子 / 分页兼容
   ========================================================================== */
check('member 关注与粉丝只显示数字，没有名单入口', () => {
  const wxml = stripXml(read('pages/member/member.wxml'))
  assert.ok(wxml.includes('mem-stats'), '缺少统计区')
  const statsBlock = wxml.slice(wxml.indexOf('mem-stats'), wxml.indexOf('mem-stats__note'))
  assert.equal(/bindtap|catchtap/.test(statsBlock), false, '统计数字不得可点进名单')
  assert.equal(wxml.includes('粉丝列表'), false)
  assert.ok(wxml.includes('不提供公开名单'))
})
check('member 不显示 private 内容', () => {
  const js = stripJs(read('pages/member/member.js'))
  assert.ok(js.includes('u.posts().filter(p => p.authorId === this.id)'), '本机分支应只取公开内容')
  assert.equal(/visibility\s*===\s*'private'/.test(js), false, '成员页不得主动纳入 private 帖子')
})
check('member 真正接入 C1 分页（cursor / hasMore / loadingMore / 去重 / 竞态）', () => {
  const js = stripJs(read('pages/member/member.js'))
  const wxml = stripXml(read('pages/member/member.wxml'))
  // 端点经注册表；首屏保持命名包装与 20 条，翻页带 cursor + limit
  assert.ok(js.includes("require('../../config/endpoints').community"), '端点应来自 config/endpoints 注册表')
  assert.ok(js.includes('const PAGE_SIZE = 20'), '分页大小应为 20')
  assert.ok(js.includes('api.member(this.id)'), '首屏应沿用命名包装（默认 20 条）')
  assert.ok(js.includes('api.api(C.user(this.id), { cursor, limit: PAGE_SIZE })'), '翻页必须带 cursor + limit')
  // 分页状态机
  ;['hasMore', 'nextCursor', 'canLoadMore', 'loadingMore'].forEach(flag => {
    assert.ok(js.includes(flag), '缺少分页状态：' + flag)
  })
  assert.ok(js.includes('const hasMore = out.hasMore === true && Boolean(nextCursor)'), '没有真实 cursor 时不得给加载入口')
  // 去重合并
  assert.ok(js.includes('new Set(reset ? [] : this.data.posts.map(item => item.id))'), '缺少 seen 去重集合')
  assert.ok(js.includes('!seen.has(item.id)'), '合并时必须按 id 去重')
  // 竞态保护：请求序号 + 会话身份
  assert.ok(js.includes('beginRequest()'), '缺少请求序号')
  assert.ok(js.includes('isActive(identity, seq)'), '缺少会话/请求竞态守卫')
  assert.ok(js.includes('s.isCurrentSession(this.pageIdentity)'), '缺少账号切换检测')
  // 视图：只有真实 canLoadMore 才出现入口，加载完才说「已经到底了」
  assert.ok(wxml.includes('wx:if="{{canLoadMore}}"'), '加载更多按钮应由真实 canLoadMore 驱动')
  assert.equal(wxml.includes('wx:if="{{hasMore}}"'), false)
  assert.ok(wxml.includes('已经到底了') && wxml.includes('!canLoadMore'), '到底提示必须与 canLoadMore 互斥')
  assert.equal(wxml.includes('当前仅展示最近 20 篇公开内容。'), false, 'C1 之后不得再宣称 20 帖上限')
})
check('member 不开放别人的 followers/following 名单', () => {
  const combined = stripJs(read('pages/member/member.js')) + stripXml(read('pages/member/member.wxml'))
  assert.equal(/endpoints\.community\.(following|followers)|\/me\/(following|followers)|relationItems/.test(combined), false, '出现了关注/粉丝名单入口')
})

/* ==========================================================================
   7. Post detail：层级 / 两级评论 / 举报低频
   ========================================================================== */
check('post-detail 信息层级顺序：作者→正文→引用→图片→互动→评论→输入', () => {
  const wxml = stripXml(read('pages/post-detail/post-detail.wxml'))
  const order = ['pd-author', 'pd-body', 'pd-stops', 'pd-places', 'pd-photos', 'pd-actions', 'pd-cmts', 'pd-textarea', 'pd-reportrow']
  let cursor = -1
  order.forEach(marker => {
    const index = wxml.indexOf(marker)
    assert.ok(index >= 0, '缺少层级节点：' + marker)
    assert.ok(index > cursor, marker + ' 的位置不符合层级顺序')
    cursor = index
  })
})
check('post-detail 举报是低频二级动作', () => {
  const wxml = stripXml(read('pages/post-detail/post-detail.wxml'))
  assert.ok(wxml.includes('class="pd-link pd-link--danger"'), '举报应为文字动作')
  assert.ok(/pd-link pd-link--danger"[^>]*bindtap="openReport"/.test(wxml))
  assert.equal(/pd-btn--primary[^>]*openReport/.test(wxml), false, '举报不得做成主 CTA')
})
check('post-detail 只允许删除自己的评论（两级语义保留）', () => {
  const wxml = stripXml(read('pages/post-detail/post-detail.wxml'))
  assert.ok(wxml.includes('wx:if="{{item.canDelete}}"'), '删除入口必须由服务端 canDelete 决定')
  assert.ok(wxml.includes("item.rootId ? 'pd-cmt--reply' : ''"), '回复行应保留两级缩进语法')
  assert.ok(wxml.includes('wx:if="{{item.canReply}}"'))
  const js = stripJs(read('pages/post-detail/post-detail.js'))
  assert.ok(js.includes('if (!comment || !comment.canDelete) return'), '删除评论必须有 canDelete 守卫')
  assert.equal(/owned\s*&&[^)]*removeComment/.test(wxml), false, '作者身份不得成为删除别人评论的条件')
})

/* ==========================================================================
   8. Post edit：表单语法与类型字段
   ========================================================================== */
check('post-edit 使用统一表单语汇（label/input/textarea/selector/chip/图片/error）', () => {
  const wxml = stripXml(read('pages/post-edit/post-edit.wxml'))
  ;['pe-label', 'pe-input', 'pe-textarea', 'pe-selector', 'pe-chip', 'pe-photo', 'pe-err'].forEach(cls => {
    assert.ok(wxml.includes(cls), '缺少表单语汇：' + cls)
  })
  assert.ok(wxml.includes('bindtap="photo"') && wxml.includes('catchtap="removePhoto"'), '图片选择/移除入口丢失')
})
check('post-edit 保留 route/review/question 与各自专属字段', () => {
  const wxml = stripXml(read('pages/post-edit/post-edit.wxml'))
  const js = stripJs(read('pages/post-edit/post-edit.js'))
  ;['旅行方案', '地点评价', '提出问题'].forEach(label => assert.ok(js.includes(label), '缺少类型：' + label))
  assert.ok(wxml.includes('wx:for="{{labels}}"') && wxml.includes('bindtap="setType"'), '类型 chip 入口丢失')
  assert.ok(wxml.includes('推荐程度') && wxml.includes('旅行日期') && wxml.includes('建议游玩时间'))
  assert.ok(wxml.includes('附带方案') && wxml.includes('bindchange="plan"'))
  assert.ok(js.includes("types: ['route', 'review', 'question']"))
})
check('post-edit visibility 只有 public / private', () => {
  const wxml = stripXml(read('pages/post-edit/post-edit.wxml'))
  const js = stripJs(read('pages/post-edit/post-edit.js'))
  assert.ok(wxml.includes('data-public="true"') && wxml.includes('data-public="false"'))
  assert.ok(js.includes("visibility: d.public ? 'public' : 'private'"))
  assert.equal(/friends|unlisted|仅好友|部分可见/.test(wxml + js), false, '不得新增第三种可见范围')
})
check('post-edit 保留草稿与预览', () => {
  const js = stripJs(read('pages/post-edit/post-edit.js'))
  const wxml = stripXml(read('pages/post-edit/post-edit.wxml'))
  assert.ok(js.includes('s.savePostDraft') && js.includes('s.readPostDraft') && js.includes('s.clearPostDraft'))
  assert.ok(wxml.includes('bindtap="togglePreview"') && wxml.includes('wx:if="{{preview}}"'))
  assert.ok(wxml.includes('draftSavedAt'))
})

/* ==========================================================================
   9. WXML 结构完整性（不依赖其它批次的验收脚本）
   ========================================================================== */
const BALANCED_TAGS = ['view', 'text', 'button', 'block']
PAGES.forEach(({ name }) => {
  const wxml = stripXml(read('pages/' + name + '/' + name + '.wxml'))
  check(name + '.wxml 事件绑定的 handler 都存在于页面 JS', () => {
    const def = pageDefinition(name)
    const missing = []
    Array.from(wxml.matchAll(/(?:bind|catch)(?:\w+|:\w+)="([a-zA-Z]\w*)"/g)).forEach(match => {
      if (typeof def[match[1]] !== 'function') missing.push(match[1])
    })
    assert.deepEqual(Array.from(new Set(missing)), [], name + ' WXML 绑定了不存在的 handler')
  })
  check(name + '.wxml 标签配平且表达式未被转义', () => {
    BALANCED_TAGS.forEach(tag => {
      // 用词边界匹配，避免把 <textarea> 误算成 <text>
      const opened = Array.from(wxml.matchAll(new RegExp('<' + tag + '(?=[\\s/>])', 'g'))).length
      assert.equal(opened, count(wxml, '</' + tag + '>'), name + ' 的 <' + tag + '> 未配平（' + opened + ' vs ' + count(wxml, '</' + tag + '>') + '）')
    })
    assert.equal(wxml.includes('&amp;&amp;'), false, name + ' 把 && 写成了 &amp;&amp;')
    assert.equal(wxml.includes('&amp;&lt;'), false, name + ' 出现了被错误转义的表达式')
  })
})

/* ==========================================================================
   10. 不新造后端能力
   ========================================================================== */
PAGES.forEach(({ name }) => {
  check(name + '.js 只调用既有 service 能力', () => {
    const js = stripJs(read('pages/' + name + '/' + name + '.js'))
    const called = new Set()
    Array.from(js.matchAll(/\b(?:api|service)\.([A-Za-z_]\w*)\s*\(/g)).forEach(match => called.add(match[1]))
    const unknown = Array.from(called).filter(fn => !ALLOWED_SERVICE_CALLS.includes(fn))
    assert.deepEqual(unknown, [], name + ' 调用了未登记的服务：' + unknown.join(', '))
  })
  check(name + '.js 不含裸端点字符串', () => {
    const js = stripJs(read('pages/' + name + '/' + name + '.js'))
    const hits = ['/community/', '/posts/', '/users/', '/me/', '/comments/', '/reports']
      .filter(token => js.includes("'" + token) || js.includes('"' + token) || js.includes('`' + token))
    assert.deepEqual(hits, [], name + ' 出现裸端点：' + hits.join(', '))
  })
  check(name + ' 未新增第三方依赖', () => {
    const js = read('pages/' + name + '/' + name + '.js')
    assert.equal(/\brequire\(\s*['"][^./]/.test(js), false, name + ' 引入非相对路径依赖')
    assert.equal(/third-party|npm install/.test(js), false)
  })
})

/* ==========================================================================
   11. 结果输出
   ========================================================================== */
const failed = results.filter(row => row[0] === 'FAIL')
results.forEach(row => console.log(row[0] + ' ' + row[1]))
if (failed.length) {
  console.error('\n' + failed.length + ' / ' + results.length + ' checks failed')
  process.exitCode = 1
} else {
  console.log('\nPASS community UI: 4 pages detached from mvp baseline, prefixed class system, shared visual language,')
  console.log('     single solid CTA per screen, no gradients/third-party deps, no invented backend capability')
}
