// One-time local credential migration. Never prints credentials.
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const root = path.resolve(__dirname, '..')
function parse(content) {
  const result = {}
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_]+)\s*=\s*(.*)$/)
    if (m) result[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2')
  }
  return result
}
const target = path.join(root, '.env')
const source = path.join(root, '.env.platform.example')
let content = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
const current = parse(content)
const legacy = fs.existsSync(source) ? parse(fs.readFileSync(source, 'utf8')) : {}
const names = ['TENCENT_MAP_KEY', 'TENCENT_MAP_SK', 'WECHAT_APP_ID', 'SESSION_SECRET']
for (const name of names) {
  let value = current[name] || legacy[name] || ''
  if (name === 'SESSION_SECRET' && value.length < 32) value = randomBytes(32).toString('hex')
  if (!value || current[name] === value) continue
  if (/[\r\n]/.test(value)) throw new Error('Invalid configuration format')
  const line = name + '=' + JSON.stringify(value)
  const pattern = new RegExp('^' + name + '\\s*=.*$', 'm')
  content = pattern.test(content) ? content.replace(pattern, () => line) : content.trimEnd() + '\n' + line + '\n'
}
fs.writeFileSync(target, content, { mode: 0o600 })
const configured = parse(content)
console.log(JSON.stringify({ mapConfigured: !!configured.TENCENT_MAP_KEY, wechatConfigured: !!(configured.WECHAT_APP_ID && configured.WECHAT_APP_SECRET), sessionConfigured: (configured.SESSION_SECRET || '').length >= 32 }))
