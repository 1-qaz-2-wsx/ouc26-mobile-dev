const assert = require('node:assert/strict')
let appDefinition
let initOptions
let containerRequest
const storage = new Map()
global.App = value => { appDefinition = value }
global.wx = {
  cloud: {
    init: options => { initOptions = options },
    callContainer: options => { containerRequest = options; return Promise.resolve({ statusCode: 200, data: { ok: true } }) }
  },
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  getDeviceInfo: () => ({ platform: 'devtools' }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } })
}
require('../app')
appDefinition.onLaunch()
assert.deepEqual(initOptions, { env: 'cloud1-d3g8eu6faa3e4bee6', traceUser: true })
const service = require('../utils/travel-services')
service.api('/maps/search', { keyword: '北京' }).then(result => {
  assert.deepEqual(result, { ok: true })
  assert.equal(containerRequest.config.env, 'cloud1-d3g8eu6faa3e4bee6')
  assert.equal(containerRequest.header['X-WX-SERVICE'], 'travel-assistant-api')
  assert.equal(containerRequest.path, '/maps/search')
  assert.equal(containerRequest.method, 'POST')
  console.log('PASS CloudBase initializes once and routes API through the intended environment/service (mocked)')
}).catch(error => { console.error(error); process.exitCode = 1 })
