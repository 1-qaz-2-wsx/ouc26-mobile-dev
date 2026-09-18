const store = require('./travel-store')
const services = require('./travel-services')

let timer = null
let busy = false
let queued = false

function schedule() {
  if (store.session().kind !== 'wechat') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    syncNow().catch(error => console.warn('旅行数据后台同步失败：' + (error.message || error)))
  }, 600)
}

async function syncNow(options = {}) {
  if (store.session().kind !== 'wechat') return null
  if (busy) { queued = true; return null }
  const identity = store.sessionIdentity()
  const revision = Number(store.read().sync && store.read().sync.localRevision || 0)
  busy = true
  try {
    const source = options.state || store.read()
    const result = await services.travelSync(store.syncPayload(source))
    if (!store.isCurrentSession(identity)) return null
    const current = store.read()
    if (Number(current.sync && current.sync.localRevision || 0) !== revision) {
      schedule()
      return null
    }
    return store.applyRemote(result, identity)
  } finally {
    busy = false
    if (queued) { queued = false; schedule() }
  }
}

function install() { store.setSyncHook(schedule) }

module.exports = { install, schedule, syncNow }
