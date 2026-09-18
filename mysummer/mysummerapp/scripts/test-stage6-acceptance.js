const assert = require('node:assert/strict')

const memory = new Map()
let switchedTo = ''
const clone = value => value === undefined ? value : JSON.parse(JSON.stringify(value))

global.wx = {
  getStorageSync(key) { return memory.has(key) ? clone(memory.get(key)) : '' },
  setStorageSync(key, value) { memory.set(key, clone(value)) },
  removeStorageSync(key) { memory.delete(key) },
  getAccountInfoSync() { return { miniProgram: { envVersion: 'develop' } } },
  cloud: {
    callContainer() {
      const error = new Error('cloud.callContainer:fail errCode: 102002; request timeout; https://developers.weixin.qq.com/miniprogram/dev/wxcloudrun')
      error.code = 'CLOUD_REQUEST_FAILED'
      return Promise.reject(error)
    }
  },
  switchTab(options) { switchedTo = options.url },
  showToast() {},
  showModal(options) { options.success({ confirm: true }) },
  navigateTo() {}
}

const store = require('../utils/travel-store')
const ui = require('../utils/travel-ui')
const service = require('../utils/travel-services')

async function main() {
  store.setSession({ kind: 'guest', id: 'guest', nickname: '游客' })
  const loginPage = { data: {}, setData(value) { Object.assign(this.data, value) } }
  assert.equal(ui.requireAccount(loginPage, '社区评论'), false)
  assert.equal(switchedTo, '/pages/me/me', '游客互动应返回我的页面')
  assert.equal(store.takeLoginSource(), '社区评论', '返回来源应按账号入口保存')

  let definition
  global.Page = value => { definition = value }
  delete require.cache[require.resolve('../pages/community/community')]
  require('../pages/community/community')
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) {
      Object.keys(value).forEach(key => {
        const parts = key.split('.')
        if (parts.length === 1) this.data[key] = value[key]
      })
    }
  })
  assert.equal(service.cloudReady(), true)
  await page.refresh(true)
  assert.equal(page.data.busy, false)
  assert.equal(page.data.cloud, true, '云端失败不能伪装成本机演示内容')
  assert.equal(page.data.emptyMessage, '加载失败，请重试')
  assert.match(page.data.error, /云端暂时没有响应/)
  assert.doesNotMatch(page.data.error, /developers\.weixin\.qq\.com|102002/)
  console.log('PASS stage6 guest return source and cloud failure state keep retry visible without raw SDK details')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
