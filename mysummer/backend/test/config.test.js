const test = require('node:test')
const assert = require('node:assert/strict')
const { readConfig } = require('../src/config')

test('provider credentials ignore accidental outer quotes from runtime environment variables', () => {
  const names = ['TENCENT_MAP_KEY', 'TENCENT_MAP_SK', 'WECHAT_APP_ID', 'SESSION_SECRET']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  try {
    process.env.TENCENT_MAP_KEY = '"ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z1234"'
    process.env.TENCENT_MAP_SK = "'map-secret'"
    process.env.WECHAT_APP_ID = '"wx1234567890123456"'
    process.env.SESSION_SECRET = '"keep-session-value-unchanged"'

    const config = readConfig({ loadEnvFile: false })
    assert.equal(config.tencentMapKey, 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z1234')
    assert.equal(config.tencentMapSk, 'map-secret')
    assert.equal(config.wechatAppId, 'wx1234567890123456')
    assert.equal(config.sessionSecret, '"keep-session-value-unchanged"')
  } finally {
    names.forEach(name => {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    })
  }
})
