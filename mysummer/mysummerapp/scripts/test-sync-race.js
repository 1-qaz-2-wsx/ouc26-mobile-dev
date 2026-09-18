const assert = require('node:assert/strict')

const memory = {}
global.wx = {
  getStorageSync(key) { return memory[key] || null },
  setStorageSync(key, value) { memory[key] = JSON.parse(JSON.stringify(value)) }
}

const store = require('../utils/travel-store')
const services = require('../utils/travel-services')
const sync = require('../utils/travel-sync')

function plan(version, title) {
  return {
    id: 'plan-race', version, title,
    items: [{ id: 'item-1', title, type: 'train', date: '2026-10-01', start: '08:00', end: '12:00', price: 100 }],
    trips: []
  }
}

async function main() {
  store.setSession({ kind: 'wechat', id: 'wx-race', token: 'token-race' })
  store.putPlan(plan(1, '初始内容'))

  let resolveFirst
  services.travelSync = () => new Promise(resolve => { resolveFirst = resolve })
  const first = sync.syncNow()
  store.putPlan(plan(2, '用户在同步期间的新编辑'))
  resolveFirst({ plans: [plan(1, '服务端旧内容')], trips: [], serverTime: 'old' })
  assert.equal(await first, null, '旧同步响应应被丢弃')
  assert.equal(store.getPlan('plan-race').items[0].title, '用户在同步期间的新编辑')
  assert.equal(store.read().sync.dirty, true, '新编辑仍应保持待同步')

  services.travelSync = async payload => {
    assert.equal(payload.clientRevision, store.read().sync.localRevision)
    return { plans: [plan(3, '服务端已确认新内容')], trips: [], serverTime: 'new' }
  }
  await sync.syncNow()
  assert.equal(store.getPlan('plan-race').version, 3)
  assert.equal(store.read().sync.dirty, false)

  store.putPlan(plan(4, '等待重试的编辑'))
  services.travelSync = async () => { throw new Error('temporary outage') }
  await assert.rejects(sync.syncNow(), /temporary outage/)
  assert.equal(store.read().sync.dirty, true, '失败不得伪造已同步状态')
  assert.equal(store.getPlan('plan-race').items[0].title, '等待重试的编辑')
  services.travelSync = async () => ({ plans: [plan(4, '等待重试的编辑')], trips: [], serverTime: 'retry' })
  await new Promise(resolve => setTimeout(resolve, 700))
  console.log('PASS sync race keeps edits, retries with latest revision, and preserves failure state')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
