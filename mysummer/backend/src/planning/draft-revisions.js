const { randomUUID } = require('node:crypto')
const { normalizePlanRequest } = require('./normalizer')
const { planningError, inputHash } = require('./schema')
const { validatePlan } = require('./plan-schema')

// Versioned local drafts only. No supplier query, booking, or cloud persistence.
function createDraftRevisionService({ evaluate, newId = randomUUID } = {}) {
  if (typeof evaluate !== 'function') throw new TypeError('draft evaluator required')
  const drafts = new Map()
  const previews = new Map()
  const get = (ownerId, draftId) => {
    const draft = drafts.get(draftId)
    if (!draft || draft.ownerId !== ownerId) throw planningError('NOT_FOUND', '方案不存在', 404)
    return draft
  }
  const publicDraft = draft => ({ id: draft.id, version: draft.version, result: structuredClone(draft.history[draft.version - 1]), persistence: 'memory_test_only' })
  const expectVersion = (draft, version) => {
    if (!Number.isInteger(version) || version !== draft.version) throw planningError('VERSION_CONFLICT', '方案已变化，请重新预览', 409)
  }
  function protectLocks(original, next) {
    if (inputHash(original.locks) !== inputHash(next.locks)) throw planningError('LOCK_PROTECTED', '本次编辑不能更改已有锁', 422)
    const oldItems = new Map(original.menuItems.map(item => [item.menuItemId, item]))
    const nextItems = new Map(next.menuItems.map(item => [item.menuItemId, item]))
    for (const lock of original.locks) {
      // Locks reference occurrence IDs; protect every referenced occurrence,
      // regardless of lock variant, rather than silently ignoring new variants.
      const refs = new Set([lock.targetId, lock.itemId, lock.menuItemId, ...(lock.itemIds || []), ...(lock.menuItemIds || [])].filter(Boolean))
      for (const id of refs) {
        if (!oldItems.has(id) || !nextItems.has(id) || inputHash(oldItems.get(id)) !== inputHash(nextItems.get(id))) throw planningError('LOCK_PROTECTED', '被锁定地点不可删除或修改', 422)
      }
    }
  }
  return {
    persistence: 'memory_test_only',
    create({ ownerId, result }) {
      if (typeof ownerId !== 'string' || !ownerId.trim()) throw planningError('UNAUTHENTICATED', '缺少账号', 401)
      normalizePlanRequest(result?.plan?.inputSnapshot)
      validatePlan(result.plan)
      const draft = { id: newId(), ownerId, version: 1, history: [structuredClone(result)] }
      drafts.set(draft.id, draft)
      return publicDraft(draft)
    },
    get({ ownerId, draftId }) { return publicDraft(get(ownerId, draftId)) },
    async preview({ ownerId, draftId, expectedVersion, request, signal = new AbortController().signal }) {
      const draft = get(ownerId, draftId)
      expectVersion(draft, expectedVersion)
      const { normalizedRequest: next } = normalizePlanRequest(request)
      const original = draft.history[draft.version - 1].plan.inputSnapshot
      protectLocks(original, next)
      signal.throwIfAborted()
      const result = await evaluate({ request: structuredClone(next), signal })
      signal.throwIfAborted()
      expectVersion(draft, expectedVersion)
      if (!result?.plan || inputHash(result.plan.inputSnapshot) !== inputHash(next)) throw planningError('INVALID_PREVIEW', '预览与编辑请求不一致', 500)
      validatePlan(result.plan)
      const changedFields = Object.keys(next).filter(key => inputHash(original[key] ?? null) !== inputHash(next[key] ?? null))
      const preview = { id: newId(), draftId, ownerId, baseVersion: expectedVersion, result: structuredClone(result), status: 'pending', changedFields }
      previews.set(preview.id, preview)
      return { id: preview.id, baseVersion: expectedVersion, result: structuredClone(result), changedFields, impact: 'full_draft_recomputed', requiresRequote: true, persistence: 'memory_test_only' }
    },
    commit({ ownerId, draftId, previewId, expectedVersion }) {
      const draft = get(ownerId, draftId)
      expectVersion(draft, expectedVersion)
      const preview = previews.get(previewId)
      if (!preview || preview.ownerId !== ownerId || preview.draftId !== draftId) throw planningError('NOT_FOUND', '预览不存在', 404)
      if (preview.status !== 'pending' || preview.baseVersion !== draft.version) throw planningError('VERSION_CONFLICT', '预览已失效', 409)
      if (preview.result.plan.feasibility === 'blocked') throw planningError('PREVIEW_BLOCKED', '存在硬冲突，不能应用此预览', 422)
      draft.history.push(structuredClone(preview.result))
      draft.version++
      preview.status = 'committed'
      return publicDraft(draft)
    },
    cancel({ ownerId, draftId, previewId }) {
      get(ownerId, draftId)
      const preview = previews.get(previewId)
      if (!preview || preview.ownerId !== ownerId || preview.draftId !== draftId) throw planningError('NOT_FOUND', '预览不存在', 404)
      if (preview.status !== 'pending' && preview.status !== 'cancelled') throw planningError('VERSION_CONFLICT', '预览已应用', 409)
      preview.status = 'cancelled'
      return { cancelled: true }
    },
    restore({ ownerId, draftId, expectedVersion, sourceVersion }) {
      const draft = get(ownerId, draftId)
      expectVersion(draft, expectedVersion)
      if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > draft.version) throw planningError('INVALID_VERSION', '历史版本不存在', 422)
      draft.history.push(structuredClone(draft.history[sourceVersion - 1]))
      draft.version++
      return publicDraft(draft)
    }
  }
}
module.exports = { createDraftRevisionService }
