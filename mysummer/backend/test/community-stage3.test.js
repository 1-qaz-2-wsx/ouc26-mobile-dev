const test = require('node:test')
const assert = require('node:assert/strict')
const { createCommunityApi } = require('../src/community-api')

function fixture(seed = []) {
  let rows = new Map(seed)
  function scope(data) {
    return {
      async get(table, id) { return data.get(table + '/' + id) ? structuredClone(data.get(table + '/' + id)) : null },
      async set(table, id, value) { data.set(table + '/' + id, structuredClone(value)) },
      async remove(table, id) { data.delete(table + '/' + id) },
      collection(table) {
        let query = null
        let max = 100
        const chain = {
          where(value) { query = value; return chain },
          orderBy() { return chain },
          limit(value) { max = value; return chain },
          async get() {
            let values = [...data.entries()].filter(([key]) => key.startsWith(table + '/')).map(([, value]) => structuredClone(value))
            if (query) values = values.filter(row => Object.entries(query).every(([key, value]) => row[key] === value))
            return { data: values.slice(0, max) }
          }
        }
        return chain
      }
    }
  }
  return {
    async get(table, id) { return scope(rows).get(table, id) },
    async set(table, id, value) { return scope(rows).set(table, id, value) },
    async remove(table, id) { return scope(rows).remove(table, id) },
    collection(table) { return scope(rows).collection(table) },
    async transaction(work) {
      const draft = new Map([...rows.entries()].map(([key, value]) => [key, structuredClone(value)]))
      const value = await work(scope(draft))
      rows = draft
      return value
    },
    rows() { return rows }
  }
}

const auth = { headers: { authorization: 'Bearer token' } }
const base = [
  ['users/author', { id: 'author', status: 'active', nickname: '作者', bio: '', profileVersion: 1 }],
  ['users/reader', { id: 'reader', status: 'active', nickname: '读者', bio: '', profileVersion: 1 }]
]
const verify = () => ({ id: 'author' })
const routeSnapshot = { request: { startDate: '2026-10-01', days: 2, budget: 2000, privateNote: 'drop' }, stops: [{ id: 'qq-city', name: '长春', latitude: 43.8, longitude: 125.3 }], items: [{ id: 'ticket-1', type: 'ticket', title: '景点', date: '2026-10-01', start: '09:00', end: '10:00', privateNote: 'drop' }] }
const place = { id: 'qq-place-1', provider: 'qq', name: '长春景点', latitude: 43.8, longitude: 125.3, category: '景点' }

test('stage3 create is validated, sanitizes route snapshot, enqueues moderation, and is idempotent', async () => {
  const repository = fixture(base)
  const api = createCommunityApi({ repository, verify, moderationEnabled: true })
  const input = { type: 'route', title: '路线', content: '正文', routeSnapshot, requestKey: 'route-key-1' }
  const first = await api.handle('/posts', input, auth)
  const second = await api.handle('/posts', input, auth)
  assert.equal(first.postId, second.postId)
  assert.equal(repository.rows().get('posts/' + first.postId).routeSnapshot.request.privateNote, undefined)
  assert.equal(repository.rows().get('moderation_jobs/' + require('node:crypto').createHash('sha256').update(['moderation', 'post', first.postId, 1].join(':')).digest('hex')).status, 'pending')
  await assert.rejects(api.handle('/posts', { ...input, title: '不同内容' }, auth), error => error.status === 409)
})

test('stage3 review requires a confirmed place and travel date', async () => {
  const api = createCommunityApi({ repository: fixture(base), verify, moderationEnabled: true })
  await assert.rejects(api.handle('/posts', { type: 'review', title: '评价', content: '很好', rating: 5, visitDate: '2026-10-01' }, auth), error => error.status === 400)
  await assert.rejects(api.handle('/posts', { type: 'review', title: '评价', content: '很好', rating: 5, visitDate: '2026-02-30', places: [place] }, auth), error => error.status === 400)
  await assert.rejects(api.handle('/posts', { type: 'question', title: '问题', content: '请问？', visibility: 'unknown' }, auth), error => error.status === 400)
  const result = await api.handle('/posts', { type: 'review', title: '评价', content: '很好', rating: 5, visitDate: '2026-10-01', places: [place], requestKey: 'review-key-1' }, auth)
  assert.equal(result.status, 'pending')
})

test('stage3 edit, visibility and soft delete enforce owner version', async () => {
  const repository = fixture(base)
  const api = createCommunityApi({ repository, verify, moderationEnabled: true })
  const created = await api.handle('/posts', { type: 'review', title: '评价', content: '很好', rating: 5, visitDate: '2026-10-01', places: [place], requestKey: 'edit-seed-1' }, auth)
  const edited = await api.handle('/posts/' + created.postId + '/edit', { type: 'review', title: '新评价', content: '更新', rating: 4, visitDate: '2026-10-01', places: [place], visibility: 'public', version: 1, requestKey: 'edit-key-1' }, auth)
  assert.equal(edited.version, 2)
  const editedRetry = await api.handle('/posts/' + created.postId + '/edit', { type: 'review', title: '新评价', content: '更新', rating: 4, visitDate: '2026-10-01', places: [place], visibility: 'public', version: 1, requestKey: 'edit-key-1' }, auth)
  assert.equal(editedRetry.version, edited.version)
  await assert.rejects(api.handle('/posts/' + created.postId + '/visibility', { visibility: 'private', version: 1 }, auth), error => error.status === 409)
  const hidden = await api.handle('/posts/' + created.postId + '/visibility', { visibility: 'private', version: 2, requestKey: 'hide-key-1' }, auth)
  assert.equal(hidden.visibility, 'private')
  const hiddenRetry = await api.handle('/posts/' + created.postId + '/visibility', { visibility: 'private', version: 2, requestKey: 'hide-key-1' }, auth)
  assert.equal(hiddenRetry.version, hidden.version)
  const deleted = await api.handle('/posts/' + created.postId + '/delete', { version: 3, requestKey: 'delete-key-1' }, auth)
  assert.equal(deleted.deleted, true)
  const deletedRetry = await api.handle('/posts/' + created.postId + '/delete', { version: 3, requestKey: 'delete-key-1' }, auth)
  assert.equal(deletedRetry.version, deleted.version)
  const detail = await api.handle('/posts/' + created.postId, {}, auth)
  assert.equal(detail.post.deletedAt, undefined)
  assert.equal(detail.post.permissions.isOwner, true)
})

test('stage3 media requires ownership and verified object metadata', async () => {
  const repository = fixture(base)
  const api = createCommunityApi({ repository, verify, storage: { async verify(key) { return { size: 1024, mime: 'image/jpeg', key } } } })
  const upload = await api.handle('/media/uploads', { mime: 'image/jpeg', size: 1024, requestKey: 'media-key-1' }, auth)
  assert.equal(upload.mime, 'image/jpeg')
  assert.equal(repository.rows().get('media/' + upload.mediaId).moderationStatus, 'not_required')
  const complete = await api.handle('/media/' + upload.mediaId + '/complete', { storageKey: upload.storageKey, mime: 'image/jpeg', size: 1024 }, auth)
  assert.equal(complete.status, 'uploaded')
  assert.equal([...repository.rows().keys()].some(key => key.startsWith('moderation_jobs/')), false)
  await assert.rejects(api.handle('/media/' + upload.mediaId + '/complete', { storageKey: 'other', mime: 'image/jpeg', size: 1024 }, auth), error => error.status === 400)
})

test('stage3 moderation worker writes only current-version verdicts and retries unavailable service', async () => {
  const repository = fixture(base)
  const api = createCommunityApi({ repository, verify, moderationEnabled: true, moderationChecker: async () => ({ status: 'approved' }) })
  const created = await api.handle('/posts', { type: 'review', title: '评价', content: '很好', rating: 5, visitDate: '2026-10-01', places: [place], requestKey: 'moderation-key-1' }, auth)
  await assert.rejects(api.handle('/posts/' + created.postId, {}, { headers: {} }), error => error.status === 404)
  const result = await api.moderation.consume({ limit: 10 })
  assert.equal(result.outcomes[0].status, 'succeeded')
  const detail = await api.handle('/posts/' + created.postId, {}, { headers: {} })
  assert.equal(detail.post.moderationStatus, 'approved')
  const unavailable = createCommunityApi({ repository: fixture(base), verify, moderationEnabled: true })
  const pending = await unavailable.handle('/posts', { type: 'review', title: '评价', content: '很好', rating: 5, visitDate: '2026-10-01', places: [place], requestKey: 'moderation-key-2' }, auth)
  const retry = await unavailable.moderation.consume({ limit: 10 })
  assert.equal(retry.outcomes[0].status, 'retry')
  assert.equal(pending.status, 'pending')
})

test('moderation is paused by default and does not block public content', async () => {
  const repository = fixture(base)
  let checks = 0
  const api = createCommunityApi({ repository, verify, moderationChecker: async () => { checks += 1; return { status: 'rejected' } } })
  assert.equal(api.moderation, null)
  const created = await api.handle('/posts', { type: 'review', title: '评价', content: '很好', rating: 5, visitDate: '2026-10-01', places: [place], requestKey: 'paused-key-1' }, auth)
  assert.equal(created.status, 'not_required')
  const stored = repository.rows().get('posts/' + created.postId)
  assert.equal(stored.moderationStatus, 'not_required')
  assert.equal(typeof stored.publishedAt, 'number')
  assert.equal([...repository.rows().keys()].some(key => key.startsWith('moderation_jobs/')), false)
  const detail = await api.handle('/posts/' + created.postId, {}, { headers: {} })
  assert.equal(detail.post.moderationStatus, 'not_required')
  const feed = await api.handle('/community/feed', { tab: 'recommend', limit: 10 }, { headers: {} })
  assert.equal(feed.items.some(item => item.id === created.postId), true)
  const comment = await api.handle('/posts/' + created.postId + '/comments', { content: '已确认', requestKey: 'paused-comment-1' }, auth)
  assert.equal(comment.status, 'not_required')
  assert.equal(checks, 0)
})
