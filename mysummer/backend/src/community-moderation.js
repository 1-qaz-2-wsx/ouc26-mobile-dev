const { failure } = require('./community-repository')

const targetTable = type => type === 'comment' ? 'comments' : type === 'media' ? 'media' : 'posts'
const nowDefault = () => Date.now()

function createModerationWorker({ repository, checker, clock = nowDefault, maxAttempts = 5, baseDelayMs = 30_000 } = {}) {
  if (!repository) throw failure('社区数据库尚未配置', 503)

  async function updateJob(job, patch) {
    const next = Object.assign({}, job, patch, { updatedAt: clock() })
    await repository.set('moderation_jobs', job.id, next)
    return next
  }

  async function processJob(job) {
    if (!job || !job.id || !job.targetId || !job.targetType) return { status: 'ignored' }
    const table = targetTable(job.targetType)
    const target = await repository.get(table, job.targetId)
    if (!target || target.deletedAt || Number(target.version || 1) !== Number(job.targetVersion || 1)) {
      await updateJob(job, { status: 'stale', finishedAt: clock(), lastError: null })
      return { status: 'stale', jobId: job.id }
    }
    if (typeof checker !== 'function') {
      const attempts = Number(job.attempts || 0) + 1
      const terminal = attempts >= maxAttempts
      await updateJob(job, {
        status: terminal ? 'failed' : 'pending',
        attempts,
        nextRunAt: clock() + baseDelayMs * Math.min(32, Math.pow(2, attempts - 1)),
        lastError: 'MODERATION_NOT_CONFIGURED'
      })
      return { status: terminal ? 'failed' : 'retry', jobId: job.id }
    }
    try {
      const verdict = await checker({ targetType: job.targetType, target: JSON.parse(JSON.stringify(target)), targetVersion: job.targetVersion })
      if (!verdict || !['approved', 'rejected'].includes(verdict.status)) throw failure('审核服务返回格式不正确', 502)
      const reason = verdict.reason ? String(verdict.reason).slice(0, 500) : null
      const latest = await repository.get(table, job.targetId)
      if (!latest || latest.deletedAt || Number(latest.version || 1) !== Number(job.targetVersion || 1)) {
        await updateJob(job, { status: 'stale', finishedAt: clock(), lastError: null })
        return { status: 'stale', jobId: job.id }
      }
      const patch = { moderationStatus: verdict.status, moderationReason: reason, updatedAt: clock() }
      if (job.targetType !== 'media' && verdict.status === 'approved' && !latest.publishedAt) patch.publishedAt = clock()
      await repository.transaction(async tx => {
        const current = await tx.get(table, job.targetId)
        const currentJob = await tx.get('moderation_jobs', job.id)
        if (!current || !currentJob || current.deletedAt || Number(current.version || 1) !== Number(job.targetVersion || 1)) {
          if (currentJob) await tx.set('moderation_jobs', job.id, Object.assign({}, currentJob, { status: 'stale', finishedAt: clock(), updatedAt: clock() }))
          return
        }
        await tx.set(table, job.targetId, Object.assign({}, current, patch))
        await tx.set('moderation_jobs', job.id, Object.assign({}, currentJob, { status: 'succeeded', verdict: verdict.status, finishedAt: clock(), updatedAt: clock(), lastError: null }))
      })
      return { status: 'succeeded', jobId: job.id, verdict: verdict.status }
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1
      const terminal = attempts >= maxAttempts
      await updateJob(job, {
        status: terminal ? 'failed' : 'pending',
        attempts,
        nextRunAt: clock() + baseDelayMs * Math.min(32, Math.pow(2, attempts - 1)),
        lastError: error && error.code ? String(error.code).slice(0, 80) : 'MODERATION_UPSTREAM_ERROR'
      })
      return { status: terminal ? 'failed' : 'retry', jobId: job.id }
    }
  }

  async function consume({ limit = 10 } = {}) {
    const max = Math.min(Math.max(Number(limit) || 10, 1), 50)
    const result = await repository.collection('moderation_jobs').where({ status: 'pending' }).orderBy('nextRunAt', 'asc').limit(max).get()
    const eligible = (result.data || []).filter(job => Number(job.nextRunAt || 0) <= clock())
    const outcomes = []
    for (const job of eligible) outcomes.push(await processJob(job))
    return { processed: outcomes.length, outcomes }
  }

  return { processJob, consume }
}

module.exports = { createModerationWorker }
