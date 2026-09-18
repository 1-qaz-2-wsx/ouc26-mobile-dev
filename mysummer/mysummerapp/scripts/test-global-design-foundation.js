/**
 * G1A 全局设计基础设施 · 静态验收
 *
 * 覆盖：app.json 结构（13 页冻结 / 5 tab 顺序 / 原生导航与 tabBar）、
 *      tabBar PNG 图标（存在性 + 可解码 + 尺寸 + 配色语义）、
 *      styles/tokens.wxss 关键令牌、app.wxss 令牌引入与页面底色。
 *
 * 边界：只做结构与像素统计，不做截图级视觉比对。
 * 参考：specs/frontend-refactor/design-system-contract.md §1 / §4
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ROOT = path.resolve(__dirname, '..')

/* 与改造前的 app.json 逐条一致：13 页、顺序冻结 */
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

const GREY = [0x76, 0x76, 0x76]
const GREEN = [0x00, 0x75, 0x4a]

/* 5 个原生 tab：顺序、文案、图标语义、配色语义全部固定 */
const EXPECTED_TABS = [
  { pagePath: 'pages/index/index', text: '首页', name: 'home', normal: GREY, active: GREEN },
  { pagePath: 'pages/menu/menu', text: '菜单', name: 'menu', normal: GREY, active: GREEN },
  { pagePath: 'pages/itinerary/itinerary', text: '行程', name: 'trip', normal: GREY, active: GREEN },
  { pagePath: 'pages/community/community', text: '社区', name: 'community', normal: GREY, active: GREEN },
  { pagePath: 'pages/me/me', text: '我的', name: 'me', normal: GREY, active: GREEN }
]

const ICON_SIZE = 81
/* 图标不透明像素占比的安全区间：排除空图与整块实心 */
const COVERAGE_MIN = 8
const COVERAGE_MAX = 45

/* tokens.wxss 必须含有的关键令牌（值为契约 §1 真值，大小写不敏感） */
const REQUIRED_TOKENS = [
  ['--brand', '#00754a'],
  ['--brand-press', '#005f3b'],
  ['--brand-tint', '#e8f2ec'],
  ['--brand-deep', '#1e3932'],
  ['--surface', '#ffffff'],
  ['--sunken', '#f7f7f7'],
  ['--canvas', '#f1f2ed'],
  ['--greige', '#e9ebe3'],
  ['--greige-2', '#dfe6dc'],
  ['--map', '#e6e7eb'],
  ['--stroke', '#9cc3b0'],
  ['--hairline', '#e5e5e5'],
  ['--ink', '#141414'],
  ['--body', '#4a4a4a'],
  ['--muted', '#767676'],
  ['--faint', '#9a9a9a'],
  ['--warn', '#8a4c13'],
  ['--warn-bg', '#fbf4ec'],
  ['--danger', '#b3261e'],
  ['--danger-bg', '#fdf0ee'],
  ['--gold', '#d39e40'],
  ['--gold-l', '#f6e4b9'],
  ['--cream', '#f9f0e3'],
  ['--r-tag', '15rpx'],
  ['--r-inner', '27rpx'],
  ['--r-card', '38rpx'],
  ['--r-panel', '46rpx'],
  ['--r-pill', '999rpx'],
  ['--sp-page', '31rpx'],
  ['--sp-card', '38rpx'],
  ['--sp-gap', '23rpx'],
  ['--sp-block', '46rpx'],
  ['--tap-min', '88rpx']
]

/* 旧全局类：本批明确要求保留，不得删除 */
const PRESERVED_APP_CLASSES = [
  '.card',
  '.tag',
  '.muted',
  '.section-title',
  '.empty-card'
]

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')
const normalize = text => text.replace(/\s+/g, ' ').toLowerCase()

/* ---------------------------------------------------------------- PNG 解码 */
function decodePng(file) {
  const buf = fs.readFileSync(file)
  assert.ok(buf.length > 100, `${file} 体积过小（${buf.length} 字节）`)
  assert.deepEqual(
    Array.from(buf.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${file} 不是合法 PNG`
  )

  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  const idat = []
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos)
    const tag = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + length)
    if (tag === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
    } else if (tag === 'IDAT') {
      idat.push(body)
    } else if (tag === 'IEND') {
      break
    }
    pos += 12 + length
  }

  assert.equal(depth, 8, `${file} 位深应为 8`)
  assert.equal(colorType, 6, `${file} 应为 RGBA（colorType 6）`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = 4
  const stride = width * bpp
  assert.equal(raw.length, (stride + 1) * height, `${file} 扫描线长度与 IHDR 不符`)

  const pixels = Buffer.alloc(stride * height)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const row = y * stride
    const prev = row - stride
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i]
      const a = i >= bpp ? pixels[row + i - bpp] : 0
      const b = y > 0 ? pixels[prev + i] : 0
      const c = i >= bpp && y > 0 ? pixels[prev + i - bpp] : 0
      let value
      if (filter === 0) value = x
      else if (filter === 1) value = x + a
      else if (filter === 2) value = x + b
      else if (filter === 3) value = x + ((a + b) >> 1)
      else if (filter === 4) {
        const est = a + b - c
        const pa = Math.abs(est - a)
        const pb = Math.abs(est - b)
        const pc = Math.abs(est - c)
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        value = x + pred
      } else {
        throw new Error(`${file} 使用了不支持的过滤器 ${filter}`)
      }
      pixels[row + i] = value & 0xff
    }
    p += stride
  }

  let opaque = 0
  const colors = new Map()
  for (let i = 0; i < width * height; i++) {
    const alpha = pixels[i * 4 + 3]
    if (alpha > 0) opaque++
    if (alpha > 200) {
      const key = `${pixels[i * 4]},${pixels[i * 4 + 1]},${pixels[i * 4 + 2]}`
      colors.set(key, (colors.get(key) || 0) + 1)
    }
  }
  let dominant = ''
  let best = -1
  colors.forEach((count, key) => {
    if (count > best) {
      best = count
      dominant = key
    }
  })
  return { width, height, pixels, coverage: (opaque / (width * height)) * 100, dominant }
}

/* ---------------------------------------------------------------- app.json */
const appJsonRaw = read('app.json')
let appJson
assert.doesNotThrow(() => { appJson = JSON.parse(appJsonRaw) }, 'app.json 必须可解析')

assert.ok(Array.isArray(appJson.pages), 'app.json 缺少 pages')
assert.equal(appJson.pages.length, 13, '页面数量必须仍为 13')
assert.deepEqual(appJson.pages, EXPECTED_PAGES, '13 个页面及其顺序必须与冻结清单完全一致')

assert.equal(appJson.window.navigationStyle, 'default', '导航栏必须保持原生（default）')
assert.equal(appJson.window.backgroundColor, '#F1F2ED', 'window.backgroundColor 应为 #F1F2ED')
assert.equal(appJson.window.navigationBarBackgroundColor, '#ffffff', '导航栏底色不应改动')
assert.equal(appJson.window.navigationBarTextStyle, 'black', '导航栏文字样式不应改动')

const tabBar = appJson.tabBar
assert.ok(tabBar, 'app.json 缺少 tabBar')
assert.notEqual(tabBar.custom, true, '不得使用 custom tabBar（自绘）')
assert.equal(tabBar.color, '#767676', 'tabBar.color 应为 #767676')
assert.equal(tabBar.selectedColor, '#00754A', 'tabBar.selectedColor 应为 #00754A')
assert.equal(tabBar.backgroundColor, '#ffffff', 'tabBar 底色应保持白色')
assert.equal(tabBar.borderStyle, 'black', 'tabBar 分隔线应保持 black')
assert.ok(Array.isArray(tabBar.list), 'tabBar.list 缺失')
assert.equal(tabBar.list.length, 5, 'tabBar 必须仍为 5 项')

EXPECTED_TABS.forEach((expected, index) => {
  const item = tabBar.list[index]
  assert.equal(item.pagePath, expected.pagePath, `第 ${index + 1} 个 tab 的 pagePath 不应改动`)
  assert.equal(item.text, expected.text, `第 ${index + 1} 个 tab 的 text 不应改动`)
  assert.equal(item.iconPath, `assets/tabbar/${expected.name}.png`, `第 ${index + 1} 个 tab 缺少 iconPath`)
  assert.equal(
    item.selectedIconPath,
    `assets/tabbar/${expected.name}-on.png`,
    `第 ${index + 1} 个 tab 缺少 selectedIconPath`
  )
})

/* ---------------------------------------------------------------- tabBar 图标 */
EXPECTED_TABS.forEach(expected => {
  const normalFile = path.join(ROOT, `assets/tabbar/${expected.name}.png`)
  const activeFile = path.join(ROOT, `assets/tabbar/${expected.name}-on.png`)
  assert.ok(fs.existsSync(normalFile), `缺少图标 ${normalFile}`)
  assert.ok(fs.existsSync(activeFile), `缺少图标 ${activeFile}`)
  assert.ok(fs.statSync(normalFile).size > 0, `${expected.name}.png 为空文件`)
  assert.ok(fs.statSync(activeFile).size > 0, `${expected.name}-on.png 为空文件`)

  const normal = decodePng(normalFile)
  const active = decodePng(activeFile)
  assert.equal(normal.width, ICON_SIZE, `${expected.name}.png 宽度应为 ${ICON_SIZE}px`)
  assert.equal(normal.height, ICON_SIZE, `${expected.name}.png 高度应为 ${ICON_SIZE}px`)
  assert.equal(active.width, ICON_SIZE, `${expected.name}-on.png 宽度应为 ${ICON_SIZE}px`)
  assert.equal(active.height, ICON_SIZE, `${expected.name}-on.png 高度应为 ${ICON_SIZE}px`)

  assert.ok(
    normal.coverage >= COVERAGE_MIN && normal.coverage <= COVERAGE_MAX,
    `${expected.name}.png 不透明占比异常（${normal.coverage.toFixed(1)}%）`
  )
  assert.ok(
    active.coverage >= COVERAGE_MIN && active.coverage <= COVERAGE_MAX,
    `${expected.name}-on.png 不透明占比异常（${active.coverage.toFixed(1)}%）`
  )

  assert.equal(
    normal.dominant,
    expected.normal.join(','),
    `${expected.name}.png 主色应为 #767676（未选中）`
  )
  assert.equal(
    active.dominant,
    expected.active.join(','),
    `${expected.name}-on.png 主色应为 #00754A（选中）`
  )

  /* 同一图标的两态必须是同一形状，只换颜色 */
  assert.ok(normal.pixels.equals(active.pixels) === false, '两态不应完全相同')
  let shapeMismatch = 0
  for (let i = 0; i < normal.width * normal.height; i++) {
    if (normal.pixels[i * 4 + 3] !== active.pixels[i * 4 + 3]) shapeMismatch++
  }
  assert.equal(shapeMismatch, 0, `${expected.name} 两态图标形状不一致（仅应换色）`)
})

/* ---------------------------------------------------------------- tokens.wxss */
const tokensFile = path.join(ROOT, 'styles/tokens.wxss')
assert.ok(fs.existsSync(tokensFile), '缺少 styles/tokens.wxss')
const tokens = normalize(read('styles/tokens.wxss'))
REQUIRED_TOKENS.forEach(([name, value]) => {
  assert.ok(tokens.includes(`${name}: ${value}`), `tokens.wxss 缺少或写错令牌 ${name}: ${value}`)
})
assert.ok(tokens.includes('page {'), 'tokens.wxss 的令牌应挂在 page 选择器上')

/* ---------------------------------------------------------------- app.wxss */
const appWxss = normalize(read('app.wxss'))
assert.ok(
  appWxss.includes('@import "./styles/tokens.wxss";'),
  'app.wxss 顶部必须引入 styles/tokens.wxss'
)
assert.ok(
  appWxss.indexOf('@import "./styles/tokens.wxss";') < appWxss.indexOf('page {'),
  'tokens.wxss 的引入必须在页面基础样式之前'
)
assert.ok(appWxss.includes('background: #f1f2ed;'), '页面基础背景应为 #F1F2ED')
assert.ok(appWxss.includes('color: #141414;'), '页面主文本色应为 #141414')
assert.ok(appWxss.includes('pingfang sc'), '应保留系统字体降级栈')
PRESERVED_APP_CLASSES.forEach(cls => {
  assert.ok(appWxss.includes(`${cls} {`), `app.wxss 不应删除既有类 ${cls}`)
})
assert.equal(
  fs.existsSync(path.join(ROOT, 'styles/components.wxss')),
  false,
  '本批不新增 styles/components.wxss（属后续批次）'
)

console.log(
  'PASS global design foundation: 13 pages frozen, 5 native tabs with PNG icons (81px, #767676/#00754A), ' +
  'tokens.wxss tokens, #F1F2ED canvas, default navigationStyle, no custom tabBar'
)
