function failure(message = '规划数据库暂不可用') {
  return Object.assign(new Error(message), { status: 503, code: 'PLANNING_STORAGE_UNAVAILABLE' })
}
function documentData(result) {
  if (result?.code) throw failure()
  return Array.isArray(result?.data) ? result.data[0] || null : result?.data || null
}
const TABLES = new Set(['planning_jobs', 'planning_drafts', 'planning_provider_budgets'])
function createPlanningRepository(db) {
  if (!db || typeof db.runTransaction !== 'function') throw failure('规划数据库尚未配置')
  function scope(database) {
    const ref = (table, id) => {
      if (!TABLES.has(table) || typeof id !== 'string' || !id || id.length > 160) throw failure('规划数据库参数无效')
      return database.collection(table).doc(id)
    }
    return {
      async get(table, id) { return documentData(await ref(table, id).get()) },
      async set(table, id, data) {
        const writable = structuredClone(data)
        // CloudBase injects _id into reads, but rejects writing that immutable
        // field back through doc(id).set(). Keep document identity in the ref.
        delete writable._id
        const result = await ref(table, id).set(writable)
        if (result?.code) throw failure()
      }
    }
  }
  return {
    ...scope(db),
    async transaction(work) {
      let value
      const result = await db.runTransaction(async tx => { value = await work(scope(tx)) })
      if (result?.code) throw failure()
      return value
    }
  }
}
module.exports = { createPlanningRepository }
