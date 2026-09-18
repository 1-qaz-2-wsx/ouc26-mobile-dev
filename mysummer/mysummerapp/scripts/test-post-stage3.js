const assert = require('node:assert/strict')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : '' },
  setStorageSync(key, value) { storage.set(key, JSON.parse(JSON.stringify(value))) },
  removeStorageSync(key) { storage.delete(key) },
  showToast() {}, showModal(options) { options.success({ confirm: true }) },
  navigateTo() {}, redirectTo() {}, switchTab() {}, navigateBack() {},
  chooseMedia() { throw new Error('not used in this test') }
}
let definition
global.Page = value => { definition = value }
const store = require('../utils/travel-store')
const services = require('../utils/travel-services')
services.demoLogin()
require('../pages/post-edit/post-edit')

function page() {
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.entries(values).forEach(([key, value]) => { const parts = key.split('.'); let target = this.data; parts.slice(0, -1).forEach(part => { target = target[part] || (target[part] = {}) }); target[parts[parts.length - 1]] = value }) }
  })
}

async function main() {
  const first = page(); first.onLoad({}); first.setData({ typeIndex: 2, title: '问题', content: '草稿正文', places: '漠河' }); first.field({ currentTarget: { dataset: { key: 'content' } }, detail: { value: '草稿正文已保存' } })
  assert.equal(store.readPostDraft().content, '草稿正文已保存')
  const second = page(); second.onLoad({}); assert.equal(second.data.content, '草稿正文已保存')
  await second.publish()
  assert.equal(store.readPostDraft(), null)
  assert.equal(store.read().posts.at(-1).title, '问题')
  console.log('PASS stage3 post draft is account-scoped, restored after reload, and cleared only after local publish success')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
