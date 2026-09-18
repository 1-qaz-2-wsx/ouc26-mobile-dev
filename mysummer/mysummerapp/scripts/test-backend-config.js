const assert = require('node:assert/strict')
const config = require('../config/backend')
assert.equal(config.resolveBaseUrl('devtools', 'develop'), 'http://127.0.0.1:8787')
for (const platform of ['ios', 'android', 'devtools']) {
  for (const version of ['trial', 'release']) assert.notEqual(config.resolveBaseUrl(platform, version), 'http://127.0.0.1:8787')
}
assert.notEqual(config.resolveBaseUrl('ios', 'develop'), 'http://127.0.0.1:8787')
assert.equal(config.currentBaseUrl(), '')
console.log('PASS local URL restricted to developer tools; devices/releases never use loopback')
