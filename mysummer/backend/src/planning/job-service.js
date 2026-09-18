const { randomUUID } = require('node:crypto')
const { inputHash, planningError } = require('./schema')

function createPlanningJobService({ clock = Date.now, newId = randomUUID, executor, leaseMs = 30000, timeoutMs = 120000, maxExternalCalls = 30 } = {}) {
  if (typeof executor !== 'function') throw new TypeError('planning job executor is required')
  const jobs = new Map()
  const idempotency = new Map()

  function now() { return Number(clock()) }
  function key(ownerId, idempotencyKey) { return `${ownerId}\u0000${idempotencyKey}` }
  function assertOwner(job, ownerId) {
    if (!job || job.ownerId !== ownerId) throw planningError('NOT_FOUND', '规划任务不存在', 404)
  }
  function publicJob(job) {
    return {
      id: job.id,
      idempotencyKey: job.idempotencyKey,
      inputHash: job.inputHash,
      taskStatus: job.taskStatus,
      phase: job.phase,
      providerCalls: { ...job.providerCalls },
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      leaseExpiresAt: job.leaseExpiresAt,
      result: structuredClone(job.result),
      error: structuredClone(job.error),
      cancellationRequested: job.cancellationRequested,
      persistence: 'memory_test_only'
    }
  }
  function assertInput(ownerId, idempotencyKey, request) {
    if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 128) throw planningError('UNAUTHENTICATED', '缺少规划任务所属账号', 401)
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128) throw planningError('INVALID_IDEMPOTENCY_KEY', '幂等键必须是 1 到 128 个字符的字符串', 422)
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw planningError('INVALID_CONSTRAINTS', '规划请求必须是对象', 422)
  }
  function recordCall(jobId, provider, count = 1) {
    const job = jobs.get(jobId)
    if (!job) throw planningError('NOT_FOUND', '规划任务不存在', 404)
    if (typeof provider !== 'string' || !provider || !Number.isInteger(count) || count < 1) throw planningError('INVALID_PROVIDER_CALL', '供应商调用记录无效', 422)
    const total = Object.values(job.providerCalls).reduce((sum, value) => sum + value, 0)
    if (total + count > maxExternalCalls) throw planningError('BUDGET_LIMIT', '单个规划任务的外部查询次数已达上限', 429, { retryable: false })
    job.providerCalls[provider] = (job.providerCalls[provider] || 0) + count
    job.updatedAt = now()
    return publicJob(job)
  }
  function isExpired(job) { return job.leaseExpiresAt !== null && job.leaseExpiresAt <= now() }
  function clearLease(job) {
    job.leaseToken = null
    job.leaseExpiresAt = null
  }
  function claim(job) {
    if (job.controller) return false
    if (job.taskStatus === 'cancelled' || job.taskStatus === 'succeeded' || job.taskStatus === 'partial' || job.taskStatus === 'failed') return false
    if (job.leaseToken && !isExpired(job)) return false
    job.leaseToken = newId()
    job.leaseExpiresAt = now() + leaseMs
    job.taskStatus = 'running'
    job.phase = 'running'
    job.updatedAt = now()
    return true
  }
  async function run(jobId) {
    const job = jobs.get(jobId)
    if (!job) throw planningError('NOT_FOUND', '规划任务不存在', 404)
    if (!claim(job)) return publicJob(job)
    const token = job.leaseToken
    const controller = new AbortController()
    job.controller = controller
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    let abortListener
    const aborted = new Promise((resolve, reject) => {
      abortListener = () => reject(planningError('PLANNING_ABORTED', '规划任务已停止', 409))
      controller.signal.addEventListener('abort', abortListener, { once: true })
    })
    try {
      const execution = executor({
        job: publicJob(job),
        request: job.request,
        signal: controller.signal,
        recordCall: (provider, count = 1) => {
          controller.signal.throwIfAborted()
          if (job.leaseToken !== token) throw planningError('LEASE_LOST', '任务执行权限已失效', 409)
          return recordCall(job.id, provider, count)
        },
        isCancellationRequested: () => job.cancellationRequested
      })
      const result = await Promise.race([execution, aborted])
      if (job.leaseToken !== token) return publicJob(job)
      if (job.cancellationRequested) {
        job.taskStatus = 'cancelled'
        job.phase = 'cancelled'
      } else if (timedOut || controller.signal.aborted) {
        job.taskStatus = 'failed'
        job.phase = 'failed'
        job.error = { code: 'PLANNING_TIMEOUT', message: '规划任务超时', retryable: true }
      } else {
        job.taskStatus = result && result.partial ? 'partial' : 'succeeded'
        job.phase = 'completed'
        job.result = result || null
      }
    } catch (error) {
      if (job.cancellationRequested) {
        job.taskStatus = 'cancelled'
        job.phase = 'cancelled'
      } else if (timedOut || controller.signal.aborted) {
        job.taskStatus = 'failed'
        job.phase = 'failed'
        job.error = { code: 'PLANNING_TIMEOUT', message: '规划任务超时', retryable: true }
      } else {
        job.taskStatus = 'failed'
        job.phase = 'failed'
        job.error = { code: error.code || 'PLANNING_FAILED', message: error.status ? error.message : '规划任务执行失败', retryable: error.retryable === true }
      }
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', abortListener)
      if (job.leaseToken === token) clearLease(job)
      job.controller = null
      job.updatedAt = now()
    }
    return publicJob(job)
  }
  return {
    persistence: 'memory_test_only',
    create({ ownerId, idempotencyKey, request }) {
      assertInput(ownerId, idempotencyKey, request)
      const hash = inputHash(request)
      const existingId = idempotency.get(key(ownerId, idempotencyKey))
      if (existingId) {
        const existing = jobs.get(existingId)
        if (existing.inputHash !== hash) throw planningError('IDEMPOTENCY_CONFLICT', '幂等键已用于另一份规划请求', 409)
        return { job: publicJob(existing), reused: true }
      }
      const timestamp = now()
      const job = {
        id: newId(),
        ownerId,
        idempotencyKey,
        inputHash: hash,
        request,
        taskStatus: 'queued',
        phase: 'queued',
        providerCalls: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        leaseToken: null,
        leaseExpiresAt: null,
        controller: null,
        cancellationRequested: false,
        result: null,
        error: null
      }
      jobs.set(job.id, job)
      idempotency.set(key(ownerId, idempotencyKey), job.id)
      return { job: publicJob(job), reused: false }
    },
    get({ ownerId, jobId }) {
      const job = jobs.get(jobId)
      assertOwner(job, ownerId)
      return publicJob(job)
    },
    async run({ ownerId, jobId }) {
      const job = jobs.get(jobId)
      assertOwner(job, ownerId)
      return run(jobId)
    },
    cancel({ ownerId, jobId }) {
      const job = jobs.get(jobId)
      assertOwner(job, ownerId)
      if (['succeeded', 'partial', 'failed', 'cancelled'].includes(job.taskStatus)) return publicJob(job)
      job.cancellationRequested = true
      if (job.controller) job.controller.abort()
      else {
        job.taskStatus = 'cancelled'
        job.phase = 'cancelled'
      }
      job.updatedAt = now()
      return publicJob(job)
    },
    recordCall,
    snapshot() { return [...jobs.values()].map(publicJob) }
  }
}

module.exports = { createPlanningJobService }
