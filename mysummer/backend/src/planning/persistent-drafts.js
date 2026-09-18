const { randomUUID } = require('node:crypto')
const { normalizePlanRequest } = require('./normalizer')
const { planningError, inputHash } = require('./schema')
const { validatePlan } = require('./plan-schema')

function createPersistentDraftRevisionService({ repository, evaluate, newId = randomUUID } = {}) {
  if (!repository || typeof repository.transaction !== 'function') throw new TypeError('planning repository required')
  if (typeof evaluate !== 'function') throw new TypeError('draft evaluator required')
  const assertOwner = (draft, ownerId) => { if (!draft || draft.ownerId !== ownerId) throw planningError('NOT_FOUND', '方案不存在', 404) }
  const expectVersion = (draft, version) => { if (!Number.isInteger(version) || version !== draft.version) throw planningError('VERSION_CONFLICT', '方案已变化，请重新预览', 409) }
  const publicDraft = draft => ({ id: draft.id, version: draft.version, result: structuredClone(draft.history[draft.version - 1]), persistence: 'cloudbase' })
  function protectLocks(original, next) {
    if (inputHash(original.locks) !== inputHash(next.locks)) throw planningError('LOCK_PROTECTED', '本次编辑不能更改已有锁', 422)
    const oldItems = new Map(original.menuItems.map(item => [item.menuItemId, item]))
    const nextItems = new Map(next.menuItems.map(item => [item.menuItemId, item]))
    for (const lock of original.locks) for (const id of new Set([lock.targetId, lock.itemId, lock.menuItemId, ...(lock.itemIds || []), ...(lock.menuItemIds || [])].filter(Boolean))) {
      if (!oldItems.has(id) || !nextItems.has(id) || inputHash(oldItems.get(id)) !== inputHash(nextItems.get(id))) throw planningError('LOCK_PROTECTED', '被锁定地点不可删除或修改', 422)
    }
  }
  async function read(ownerId, draftId) {
    const draft = await repository.get('planning_drafts', draftId)
    assertOwner(draft, ownerId)
    return draft
  }
  return {
    persistence: 'cloudbase',
    async create({ ownerId, result }) {
      if (typeof ownerId !== 'string' || !ownerId.trim()) throw planningError('UNAUTHENTICATED', '缺少账号', 401)
      normalizePlanRequest(result?.plan?.inputSnapshot); validatePlan(result.plan)
      const id = newId(), draft = { id, ownerId, version: 1, history: [structuredClone(result)], previews: {}, createdAt: Date.now(), updatedAt: Date.now() }
      await repository.set('planning_drafts', id, draft)
      return publicDraft(draft)
    },
    async get({ ownerId, draftId }) { return publicDraft(await read(ownerId, draftId)) },
    async preview({ ownerId, draftId, expectedVersion, request, signal = new AbortController().signal }) {
      const before = await read(ownerId, draftId); expectVersion(before, expectedVersion)
      const { normalizedRequest: next } = normalizePlanRequest(request)
      const original = before.history[before.version - 1].plan.inputSnapshot
      protectLocks(original, next); signal.throwIfAborted()
      const result = await evaluate({ request: structuredClone(next), signal }); signal.throwIfAborted()
      if (!result?.plan || inputHash(result.plan.inputSnapshot) !== inputHash(next)) throw planningError('INVALID_PREVIEW', '预览与编辑请求不一致', 500)
      validatePlan(result.plan)
      const changedFields = Object.keys(next).filter(key => inputHash(original[key] ?? null) !== inputHash(next[key] ?? null))
      const id = newId()
      return repository.transaction(async tx => {
        const draft = await tx.get('planning_drafts', draftId); assertOwner(draft, ownerId); expectVersion(draft, expectedVersion)
        draft.previews ||= {}
        draft.previews[id] = { id, draftId, ownerId, baseVersion: expectedVersion, result: structuredClone(result), status: 'pending', changedFields }
        draft.updatedAt = Date.now(); await tx.set('planning_drafts', draftId, draft)
        return { id, baseVersion: expectedVersion, result: structuredClone(result), changedFields, impact: 'full_draft_recomputed', requiresRequote: true, persistence: 'cloudbase' }
      })
    },
    async commit({ ownerId, draftId, previewId, expectedVersion }) {
      return repository.transaction(async tx => {
        const draft = await tx.get('planning_drafts', draftId); assertOwner(draft, ownerId); expectVersion(draft, expectedVersion)
        const preview = draft.previews?.[previewId]
        if (!preview || preview.ownerId !== ownerId || preview.draftId !== draftId) throw planningError('NOT_FOUND', '预览不存在', 404)
        if (preview.status !== 'pending' || preview.baseVersion !== draft.version) throw planningError('VERSION_CONFLICT', '预览已失效', 409)
        if (preview.result.plan.feasibility === 'blocked') throw planningError('PREVIEW_BLOCKED', '存在硬冲突，不能应用此预览', 422)
        draft.history.push(structuredClone(preview.result)); draft.version++; preview.status = 'committed'; draft.updatedAt = Date.now()
        await tx.set('planning_drafts', draftId, draft); return publicDraft(draft)
      })
    },
    async cancel({ ownerId, draftId, previewId }) {
      return repository.transaction(async tx => {
        const draft = await tx.get('planning_drafts', draftId); assertOwner(draft, ownerId)
        const preview = draft.previews?.[previewId]
        if (!preview || preview.ownerId !== ownerId || preview.draftId !== draftId) throw planningError('NOT_FOUND', '预览不存在', 404)
        if (!['pending', 'cancelled'].includes(preview.status)) throw planningError('VERSION_CONFLICT', '预览已应用', 409)
        preview.status = 'cancelled'; draft.updatedAt = Date.now(); await tx.set('planning_drafts', draftId, draft)
        return { cancelled: true }
      })
    },
    async restore({ ownerId, draftId, expectedVersion, sourceVersion }) {
      return repository.transaction(async tx => {
        const draft = await tx.get('planning_drafts', draftId); assertOwner(draft, ownerId); expectVersion(draft, expectedVersion)
        if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > draft.version) throw planningError('INVALID_VERSION', '历史版本不存在', 422)
        draft.history.push(structuredClone(draft.history[sourceVersion - 1])); draft.version++; draft.updatedAt = Date.now()
        await tx.set('planning_drafts', draftId, draft); return publicDraft(draft)
      })
    }
  }
}

module.exports = { createPersistentDraftRevisionService }
