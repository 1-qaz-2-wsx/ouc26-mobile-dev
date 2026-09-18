const { planningError } = require('./schema')
function createProviderBudget({ repository, limits, scope, clock = Date.now } = {}) {
  if (!repository || typeof repository.transaction !== 'function') throw new TypeError('provider budget repository required')
  if (typeof scope !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(scope)) throw new TypeError('provider budget scope required')
  return {
    async reserve(provider, count = 1) {
      const limit = limits[provider]
      if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(count) || count < 1) throw planningError('INVALID_PROVIDER_CALL', '供应商调用预算无效', 422)
      const id = `${scope}:${provider}`
      return repository.transaction(async tx => {
        const current = await tx.get('planning_provider_budgets', id)
        const used = Number(current?.used || 0)
        if (!Number.isInteger(used) || used < 0) throw planningError('PROVIDER_BUDGET_CORRUPT', '供应商额度账本异常', 503)
        if (used + count > limit) throw planningError('PROVIDER_SESSION_LIMIT', '本轮真实查询次数已用完', 429, { retryable: false })
        const next = { scope, provider, used: used + count, limit, updatedAt: new Date(Number(clock())).toISOString() }
        await tx.set('planning_provider_budgets', id, next)
        return { provider, scope, used: next.used, limit }
      })
    }
  }
}
module.exports = { createProviderBudget }
