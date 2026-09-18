/**
 * G1B 样式隔离验收
 *
 * 只做静态结构检查，不做截图级视觉比对：
 *   - 三个 G2/G3 页面已脱离 mvp import
 *   - mvp.wxss 头部明确 LEGACY ONLY
 *   - app.wxss 不再保留已确认 dead 的旧类，也未新增全局 button/input 高侵入规则
 *   - tokens.wxss 仍是令牌源，不是组件样式垃圾场
 *   - 13 pages / 5 native tabs / native nav 契约不因样式治理被破坏
 *   - audit-style-usage.js 可运行并产生明确分类
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const EXPECTED_PAGES = [
  'pages/me/me',
  'pages/index/index',
  'pages/map-search/map-search',
  'pages/map-selection/map-selection',
  'pages/menu/menu',
  'pages/itinerary/itinerary',
  'pages/community/community',
  'pages/plan-detail/plan-detail',
  'pages/place-detail/place-detail',
  'pages/booking/booking',
  'pages/post-edit/post-edit',
  'pages/post-detail/post-detail',
  'pages/member/member'
]

/* ---------------------------------------------------------------- app.json */
const appJson = JSON.parse(read('app.json'))
assert.deepEqual(appJson.pages, EXPECTED_PAGES, '13 pages / page order must stay frozen')
assert.equal(appJson.window.navigationStyle, 'default', 'native navigation bar must be kept')
assert.equal(appJson.tabBar.custom, undefined, 'tabBar must remain native (no custom)')
assert.equal(appJson.tabBar.list.length, 5, 'the 5 native tabs must stay frozen')

/* ---------------------------------------------------------------- G2/G3 脱离 mvp */
;[
  'pages/index/index.wxss',
  'pages/place-detail/place-detail.wxss',
  'pages/menu/menu.wxss',
  // G4 批次新增：方案详情与预订记录页同样不得回退到灰阶基线
  'pages/plan-detail/plan-detail.wxss',
  'pages/booking/booking.wxss'
].forEach(file => {
  const css = read(file)
  assert.ok(!css.includes('@import "../../styles/mvp.wxss"'),
    file + ' must no longer import the legacy mvp baseline')
})

/* ---------------------------------------------------------------- mvp LEGACY ONLY */
const mvp = read('styles/mvp.wxss')
assert.match(mvp, /LEGACY ONLY/, 'mvp.wxss must be explicitly marked LEGACY ONLY')
assert.match(mvp, /禁止新页面 import|禁止新页面\s*import|不得再 import/i,
  'mvp.wxss header must prohibit new page imports')

/* ---------------------------------------------------------------- app.wxss dead class / element rule guard */
const appWxss = read('app.wxss')
;['.primary-button', '.ghost-button', '.page-shell', '.section-subtitle', '.link-row', '.status-note'].forEach(selector => {
  assert.ok(!appWxss.includes(selector), 'app.wxss must not retain the dead legacy selector ' + selector)
})

function parseRuleSelectors(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []
  let depth = 0
  let bodyStart = -1
  let start = 0
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (ch === '{') {
      if (depth === 0) bodyStart = i + 1
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        const selector = stripped.slice(start, bodyStart - 1).trim()
        if (selector && !selector.startsWith('@')) selectors.push(selector)
        start = i + 1
      }
    }
  }
  return selectors
}

const intrusiveElementRules = parseRuleSelectors(appWxss).filter(selector => {
  const first = selector.trim().split(/\s*,\s*/)[0].trim()
  return /^(button|input|textarea)([.:\s,]|$)/.test(first)
})
assert.deepEqual(intrusiveElementRules, [],
  'app.wxss must not add standalone global button/input/textarea element rules: ' + intrusiveElementRules.join(', '))

/* ---------------------------------------------------------------- tokens.wxss 非组件垃圾场 */
const tokens = read('styles/tokens.wxss')
;['.btn', '.card', '.chip', '.panel'].forEach(selector => {
  assert.ok(!tokens.includes(selector + ' {'), 'tokens.wxss must not become a component class dump: ' + selector)
})
assert.match(tokens, /page\s*\{/, 'tokens.wxss must keep the page-scoped token host')
assert.match(tokens, /--brand:\s*#00754a/, 'tokens.wxss must keep the brand token')

/* ---------------------------------------------------------------- audit script 可运行并分类 */
const audit = JSON.parse(execFileSync(process.execPath, ['scripts/audit-style-usage.js'], {
  cwd: ROOT,
  encoding: 'utf8'
}))
assert.ok(Array.isArray(audit.rows), 'audit-style-usage.js must emit a rows array')
assert.ok(audit.rows.length > 0, 'audit-style-usage.js must emit selector classifications')
const categories = new Set(audit.rows.map(row => row.category))
;['SAFE_DELETE', 'REFERENCED', 'DYNAMIC_OR_AMBIGUOUS'].forEach(category => {
  assert.ok(categories.has(category), 'audit-style-usage.js must emit category ' + category)
})
assert.ok(Array.isArray(audit.mvpDirectImports), 'audit must report direct mvp imports')

console.log('PASS style quarantine: G2/G3 detached from mvp, LEGACY ONLY marker, dead app classes removed,')
console.log('     no new global button/input rules, tokens remain tokens, audit script produces classifications')
