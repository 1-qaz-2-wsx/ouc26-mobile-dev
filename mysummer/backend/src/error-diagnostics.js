// Log only derived categories and code locations, never raw messages or payloads.
const { basename } = require('node:path')
function diagnostic(error, requestId, route) {
  const message = String(error && error.message || '')
  const code = String(error && error.code || '')
  const signal = code + ' ' + message
  const category = /collection.*(not.*exist|not.*found)|集合.*不存在/i.test(signal) ? 'DATABASE_COLLECTION_MISSING'
    : /index|索引/i.test(signal) ? 'DATABASE_INDEX_ERROR'
    : /permission|denied|unauthorized|credential|access.?key|鉴权|权限/i.test(signal) ? 'DATABASE_OR_AUTH_PERMISSION'
    : /timeout|timed.out|超时/i.test(signal) ? 'DEPENDENCY_TIMEOUT'
    : /is not a function|is not iterable|cannot read|undefined|null/i.test(signal) ? 'CODE_OR_DATA_SHAPE_ERROR'
    : 'UNCLASSIFIED'
  const frames = String(error && error.stack || '').split('\n').slice(1).map(line => {
    const match = line.match(/(?:\(|\s)((?:[A-Za-z]:)?[^()\s]+\.(?:js|cjs|mjs)):(\d+):(\d+)\)?$/)
    return match ? basename(match[1].replace(/\\/g, '/')) + ':' + match[2] + ':' + match[3] : null
  }).filter(Boolean).slice(0, 5)
  return { event: 'request_failed', requestId, route, category,
    errorType: ['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(error && error.name) ? error.name : 'Error', frames }
}
module.exports = { diagnostic }
