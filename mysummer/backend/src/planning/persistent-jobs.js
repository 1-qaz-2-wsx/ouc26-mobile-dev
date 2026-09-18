const { createHash, randomUUID } = require('node:crypto')
const { inputHash, planningError } = require('./schema')

function createPersistentPlanningJobService({ repository, clock = Date.now, newId = randomUUID, executor, leaseMs = 30000, timeoutMs = 120000 } = {}) {
  if (!repository || typeof repository.transaction !== 'function') throw new TypeError('planning repository required')
  if (typeof executor !== 'function') throw new TypeError('planning job executor is required')
  const controllers = new Map()
  const terminal = new Set(['cancelled', 'succeeded', 'partial', 'failed'])
  const now = () => Number(clock())
  const docId = (ownerId, key) => `job_${createHash('sha256').update(`${ownerId}\u0000${key}`).digest('hex')}`
  const assertInput = (ownerId, key, request) => {
    if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 128) throw planningError('UNAUTHENTICATED', '缺少规划任务所属账号', 401)
    if (typeof key !== 'string' || !key.trim() || key.length > 128) throw planningError('INVALID_IDEMPOTENCY_KEY', '幂等键必须是 1 到 128 个字符的字符串', 422)
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw planningError('INVALID_CONSTRAINTS', '规划请求必须是对象', 422)
  }
  const assertOwner = (job, ownerId) => {
    if (!job || job.ownerId !== ownerId) throw planningError('NOT_FOUND', '规划任务不存在', 404)
  }
  const publicJob = job => ({
    id: job.id, idempotencyKey: job.idempotencyKey, inputHash: job.inputHash,
    taskStatus: job.taskStatus, phase: job.phase, providerCalls: { ...(job.providerCalls || {}) },
    createdAt: job.createdAt, updatedAt: job.updatedAt, leaseExpiresAt: job.leaseExpiresAt,
    result: structuredClone(job.result), error: structuredClone(job.error),
    cancellationRequested: Boolean(job.cancellationRequested), persistence: 'cloudbase'
  })
  async function read(ownerId, jobId) {
    const job = await repository.get('planning_jobs', jobId)
    assertOwner(job, ownerId)
    return job
  }
  return {
    persistence: 'cloudbase',
    async create({ ownerId, idempotencyKey, request }) {
      assertInput(ownerId, idempotencyKey, request)
      const hash = inputHash(request), id = docId(ownerId, idempotencyKey)
      return repository.transaction(async tx => {
        const existing = await tx.get('planning_jobs', id)
        if (existing) {
          assertOwner(existing, ownerId)
          if (existing.inputHash !== hash) throw planningError('IDEMPOTENCY_CONFLICT', '幂等键已用于另一份规划请求', 409)
          return { job: publicJob(existing), reused: true }
        }
        const timestamp = now()
        const job = { id, ownerId, idempotencyKey, inputHash: hash, request: structuredClone(request), taskStatus: 'queued', phase: 'queued', providerCalls: {}, createdAt: timestamp, updatedAt: timestamp, leaseToken: null, leaseExpiresAt: null, cancellationRequested: false, result: null, error: null }
        await tx.set('planning_jobs', id, job)
        return { job: publicJob(job), reused: false }
      })
    },
    async get({ ownerId, jobId }) { return publicJob(await read(ownerId, jobId)) },
    async run({ ownerId, jobId }) {
      const token = newId()
      const claimed = await repository.transaction(async tx => {
        const job = await tx.get('planning_jobs', jobId)
        assertOwner(job, ownerId)
        if (terminal.has(job.taskStatus) || (job.leaseToken && job.leaseExpiresAt > now())) return null
        job.leaseToken = token
        job.leaseExpiresAt = now() + leaseMs
        job.taskStatus = 'running'
        job.phase = 'running'
        job.updatedAt = now()
        await tx.set('planning_jobs', jobId, job)
        return job
      })
      if (!claimed) return publicJob(await read(ownerId, jobId))
      const controller = new AbortController()
      controllers.set(jobId, { token, controller })
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      let result = null
      let failure = null
      try {
        result = await executor({
          job: publicJob(claimed), request: structuredClone(claimed.request), signal: controller.signal,
          recordCall: () => { throw planningError('BUDGET_LIMIT', '供应商调用必须通过全局额度账本', 429, { retryable: false }) },
          isCancellationRequested: () => controller.signal.aborted
        })
      } catch (error) {
        failure = error
      } finally {
        clearTimeout(timer)
        if (controllers.get(jobId)?.token === token) controllers.delete(jobId)
      }
      return repository.transaction(async tx => {
        const job = await tx.get('planning_jobs', jobId)
        assertOwner(job, ownerId)
        if (job.leaseToken !== token) return publicJob(job)
        if (job.cancellationRequested) {
          job.taskStatus = 'cancelled'; job.phase = 'cancelled'
        } else if (timedOut) {
          job.taskStatus = 'failed'; job.phase = 'failed'; job.error = { code: 'PLANNING_TIMEOUT', message: '规划任务超时', retryable: true }
        } else if (failure) {
          job.taskStatus = 'failed'; job.phase = 'failed'; job.error = { code: failure.code || 'PLANNING_FAILED', message: failure.status ? failure.message : '规划任务执行失败', retryable: failure.retryable === true }
        } else {
          job.taskStatus = result?.partial ? 'partial' : 'succeeded'; job.phase = 'completed'; job.result = result || null; job.error = null
        }
        job.leaseToken = null; job.leaseExpiresAt = null; job.updatedAt = now()
        await tx.set('planning_jobs', jobId, job)
        return publicJob(job)
      })
    },
    async cancel({ ownerId, jobId }) {
      const result = await repository.transaction(async tx => {
        const job = await tx.get('planning_jobs', jobId)
        assertOwner(job, ownerId)
        if (!terminal.has(job.taskStatus)) {
          job.cancellationRequested = true
          if (job.taskStatus === 'queued') { job.taskStatus = 'cancelled'; job.phase = 'cancelled'; job.leaseToken = null; job.leaseExpiresAt = null }
          job.updatedAt = now()
          await tx.set('planning_jobs', jobId, job)
        }
        return publicJob(job)
      })
      controllers.get(jobId)?.controller.abort()
      return result
    }
  }
}

module.exports = { createPersistentPlanningJobService }
