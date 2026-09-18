const store = require('./travel-store')
function key(identity) { return store.PREFIX + ':planning-result:' + encodeURIComponent(identity.kind + ':' + identity.id) }
function save(identity, result, metadata = {}) {
  if (!store.isCurrentSession(identity)) throw new Error('会话已切换，结果未保存')
  wx.setStorageSync(key(identity), { schemaVersion: 'planning-cache.v1', result, jobId: metadata.jobId || '', draftId: metadata.draftId || '', savedAt: Date.now() })
}
function readEntry(identity) {
  if (!store.isCurrentSession(identity)) return null
  const value = wx.getStorageSync(key(identity))
  return value && value.schemaVersion === 'planning-cache.v1' ? value : null
}
function read(identity) { const entry = readEntry(identity); return entry ? entry.result : null }
module.exports = { save, read, readEntry }
