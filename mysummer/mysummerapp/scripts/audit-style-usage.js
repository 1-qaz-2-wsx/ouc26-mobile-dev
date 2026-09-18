/**
 * G1B 静态样式审计（只读，不修改任何源文件）。
 *
 * 扫描目标：
 *   - mysummerapp/** / *.wxml  静态 class 与 class 表达式里的动态 class 字面量
 *   - mysummerapp/** / *.js    字符串/模板字面量里可能拼进 class 的候选
 *   - mysummerapp/** / *.wxss  页面样式对全局类名的选择器依赖
 *
 * 输出四类结论，供人工复核后执行删除：
 *   SAFE_DELETE / REFERENCED / DYNAMIC_OR_AMBIGUOUS / LEGACY_IMPORT_DEPENDENCY
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const APP_WXSS = 'app.wxss'
const MVP_WXSS = 'styles/mvp.wxss'

function walk(dir, exts, out) {
  out = out || []
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    if (entry.name === 'node_modules') return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, exts, out)
    else if (exts.includes(path.extname(entry.name))) out.push(path.relative(ROOT, full).replace(/\\/g, '/'))
  })
  return out
}

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function parseRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  let depth = 0
  let bodyStart = -1
  let start = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0) bodyStart = i + 1
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        const selector = css.slice(start, bodyStart - 1).trim()
        if (selector && !selector.startsWith('@')) rules.push(selector)
        start = i + 1
      }
    }
  }
  return rules
}

function classesInSelector(selector) {
  return Array.from(new Set(
    Array.from(selector.matchAll(/\.([A-Za-z_][\w-]*)/g)).map(match => match[1])
  ))
}

function quotedLiterals(value) {
  const literals = []
  const re = /(['"])(.*?)\1/g
  let match
  while ((match = re.exec(value))) literals.push(match[2])
  return literals
}

function wxmlEvidence(content) {
  const evidence = {
    static: new Set(),
    dynamic: new Set()
  }
  const re = /class\s*=\s*(["'])([\s\S]*?)\1/g
  let match
  while ((match = re.exec(content))) {
    const value = match[2]
    quotedLiterals(value).forEach(literal => {
      if (literal && /^[A-Za-z_][\w-]*$/.test(literal)) evidence.dynamic.add(literal)
    })
    const staticPart = value.replace(/{{[\s\S]*?}}/g, ' ')
    staticPart.split(/\s+/).forEach(token => {
      if (/^[A-Za-z_][\w-]*$/.test(token)) evidence.static.add(token)
    })
  }
  return evidence
}

function jsEvidence(content) {
  const tokens = new Set()
  const re = /(['"`])(.*?)\1/g
  let match
  while ((match = re.exec(content))) {
    const literal = match[2]
    if (!literal || literal.includes('${')) continue
    Array.from(literal.matchAll(/\b([A-Za-z_][\w-]*)\b/g)).forEach(m => tokens.add(m[1]))
  }
  return tokens
}

const wxmlFiles = walk(ROOT, ['.wxml'])
// scripts/** 是静态验收脚本，不是运行时会拼 class 的页面逻辑；它们会把人名/测试断言误当成 runtime 引用。
const jsFiles = walk(ROOT, ['.js']).filter(file => !file.startsWith('scripts/'))
const wxssFiles = walk(ROOT, ['.wxss'])

const wxmlStatic = new Set()
const wxmlDynamic = new Set()
wxmlFiles.forEach(file => {
  const found = wxmlEvidence(read(file))
  found.static.forEach(value => wxmlStatic.add(value))
  found.dynamic.forEach(value => wxmlDynamic.add(value))
})

const jsTokens = new Set()
jsFiles.forEach(file => jsEvidence(read(file)).forEach(value => jsTokens.add(value)))

const pageWxssClasses = new Set()
wxssFiles.filter(file => file !== APP_WXSS && file !== MVP_WXSS && !file.startsWith('scripts/')).forEach(file => {
  parseRules(read(file)).forEach(selector => {
    classesInSelector(selector).forEach(name => pageWxssClasses.add(name))
  })
})

const wxssByFile = new Map(wxssFiles.map(file => [file, read(file)]))
const directImport = file => wxssByFile.get(file).includes('@import "../../styles/mvp.wxss"')

function resolveImport(fromFile, spec) {
  const target = spec.replace(/^['"]|['"]$/g, '')
  const base = path.posix.dirname(fromFile.replace(/\\/g, '/'))
  const joined = path.posix.normalize(path.posix.join(base, target))
  return wxssByFile.has(joined) ? joined : null
}

function importedFiles(file) {
  const specs = Array.from(wxssByFile.get(file).matchAll(/@import\s+(['"][^'"]+['"])/g)).map(match => match[1])
  return specs.map(spec => resolveImport(file, spec)).filter(Boolean)
}

function reachesMvp(file, seen) {
  if (directImport(file)) return true
  seen = seen || new Set()
  if (seen.has(file)) return false
  seen.add(file)
  return importedFiles(file).some(next => reachesMvp(next, seen))
}

const mvpDirect = wxssFiles.filter(file => directImport(file))
const mvpIndirect = wxssFiles.filter(file => !directImport(file) && reachesMvp(file))

function classify(selector) {
  const classes = classesInSelector(selector)
  if (!classes.length) return 'REFERENCED'

  const statuses = classes.map(name => {
    if (wxmlStatic.has(name) || wxmlDynamic.has(name) || pageWxssClasses.has(name)) return 'REFERENCED'
    if (jsTokens.has(name)) return 'DYNAMIC_OR_AMBIGUOUS'
    return 'SAFE_DELETE'
  })

  if (statuses.every(status => status === 'SAFE_DELETE')) return 'SAFE_DELETE'
  if (statuses.includes('DYNAMIC_OR_AMBIGUOUS') && !statuses.includes('REFERENCED')) return 'DYNAMIC_OR_AMBIGUOUS'
  return 'REFERENCED'
}

const rows = []
;[APP_WXSS, MVP_WXSS].forEach(file => {
  parseRules(read(file)).forEach(selector => {
    rows.push({ file, selector, category: classify(selector) })
  })
})

const summary = {
  mvpDirectImports: mvpDirect,
  mvpIndirectImports: mvpIndirect.filter(file => !mvpDirect.includes(file)),
  rows
}

console.log(JSON.stringify(summary, null, 2))
