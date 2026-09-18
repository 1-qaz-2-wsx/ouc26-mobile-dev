const { planningError } = require('./schema')
const { sessionToken } = require('../session-token')

function createPlanningApi({ planning, verify, enabled = false }) {
  return async function handle(path, input, req) {
    // 令牌读取口径与 platform / community / travel 一致，见 session-token.js。
    const token = sessionToken(req)
    if (!token) throw planningError('UNAUTHENTICATED', '请先微信登录再创建规划任务', 401)
    const user = verify(token)
    if (!user || !user.id) throw planningError('UNAUTHENTICATED', '登录状态无效', 401)
    if (!enabled) throw planningError('PLANNING_NOT_ENABLED', '新规划任务尚未启用；菜单已保留，不会回退为演示库存', 503)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw planningError('INVALID_REQUEST', '请求格式错误', 422)
    if ('ownerId' in input) throw planningError('INVALID_REQUEST', '不能由客户端指定任务所属账号', 422)
    const ownerId = String(user.id)
    if (path === '/planning/jobs/create') {
      const created = await planning.jobs.create({ ownerId, idempotencyKey: input.idempotencyKey, request: input.request })
      if (!created.reused || created.job.taskStatus === 'queued') {
        // The memory job service catches executor errors and records a safe failure.
        void planning.jobs.run({ ownerId, jobId: created.job.id }).catch(() => console.error(JSON.stringify({ event: 'planning_dispatch_failed', jobId: created.job.id })))
      }
      return { ok: true, ...created }
    }
    if (path === '/planning/drafts/create') {
      const job = await planning.jobs.get({ ownerId, jobId: input.jobId })
      if (!['partial', 'succeeded'].includes(job.taskStatus) || !job.result) throw planningError('JOB_NOT_READY', '规划任务尚未完成', 409)
      return { ok: true, draft: await planning.draftRevisions.create({ ownerId, result: job.result }) }
    }
    if (path.startsWith('/planning/drafts/')) {
      if (typeof input.draftId !== 'string' || !input.draftId.trim()) throw planningError('INVALID_REQUEST', '缺少方案编号', 422)
      const args = { ownerId, draftId: input.draftId, expectedVersion: input.expectedVersion }
      if (path === '/planning/drafts/get') return { ok: true, draft: await planning.draftRevisions.get(args) }
      if (path === '/planning/drafts/preview') return { ok: true, preview: await planning.draftRevisions.preview({ ...args, request: input.request }) }
      if (path === '/planning/drafts/commit') return { ok: true, draft: await planning.draftRevisions.commit({ ...args, previewId: input.previewId }) }
      if (path === '/planning/drafts/cancel') return { ok: true, ...await planning.draftRevisions.cancel({ ...args, previewId: input.previewId }) }
      if (path === '/planning/drafts/restore') return { ok: true, draft: await planning.draftRevisions.restore({ ...args, sourceVersion: input.sourceVersion }) }
      throw planningError('NOT_FOUND', '规划接口不存在', 404)
    }
    if (typeof input.jobId !== 'string' || !input.jobId.trim()) throw planningError('INVALID_REQUEST', '缺少任务编号', 422)
    if (path === '/planning/jobs/get') return { ok: true, job: await planning.jobs.get({ ownerId, jobId: input.jobId }) }
    if (path === '/planning/jobs/cancel') return { ok: true, job: await planning.jobs.cancel({ ownerId, jobId: input.jobId }) }
    throw planningError('NOT_FOUND', '规划接口不存在', 404)
  }
}
module.exports = { createPlanningApi }
