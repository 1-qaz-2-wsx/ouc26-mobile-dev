const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createCommunityApi } = require('../src/community-api')

function idFor(...parts) { return createHash('sha256').update(parts.join(':')).digest('hex') }
function fixture(seed = []) {
  let rows = new Map(seed)
  function scope(data) {
    return {
      async get(table, id) { return data.get(table + '/' + id) ? structuredClone(data.get(table + '/' + id)) : null },
      async set(table, id, value) { data.set(table + '/' + id, structuredClone(value)) },
      async remove(table, id) { data.delete(table + '/' + id) },
      collection(table) {
        let query = null, max = 100
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

const users = [
  ['users/owner', { id: 'owner', status: 'active', nickname: '作者', bio: '', profileVersion: 1 }],
  ['users/reader', { id: 'reader', status: 'active', nickname: '读者', bio: '', profileVersion: 1 }],
  ['users/admin', { id: 'admin', status: 'active', nickname: '维护员', role: 'admin', bio: '', profileVersion: 1 }]
]
const post = { id: 'post-1', authorId: 'owner', type: 'route', title: '公开路线', content: '路线内容', placeNames: [], places: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 1, publishedAt: 1, version: 1 }
const auth = token => ({ headers: { authorization: 'Bearer ' + token } })
const verify = token => ({ id: token })

test('stage5 reports are private, target-visible, idempotent, and rate limited', async () => {
  const repository = fixture([...users, ['posts/post-1', post], ['posts/private-1', Object.assign({}, post, { id: 'private-1', visibility: 'private' })], ['posts/post-2', Object.assign({}, post, { id: 'post-2' })]])
  const api = createCommunityApi({ repository, verify })
  const reader = auth('reader')
  const first = await api.handle('/reports', { targetType: 'post', targetId: 'post-1', reason: 'spam', details: '重复广告', requestKey: 'stage5-report-1' }, reader)
  const retry = await api.handle('/reports', { targetType: 'post', targetId: 'post-1', reason: 'spam', details: '重复广告', requestKey: 'stage5-report-1' }, reader)
  const duplicate = await api.handle('/reports', { targetType: 'post', targetId: 'post-1', reason: 'abuse', requestKey: 'stage5-report-2' }, reader)
  assert.deepEqual(retry, first)
  assert.equal(duplicate.id, first.id)
  assert.equal('reporterId' in first, false)
  assert.equal(repository.rows().get('reports/' + first.id).reporterId, 'reader')
  await assert.rejects(api.handle('/reports', { targetType: 'post', targetId: 'private-1', reason: 'spam', requestKey: 'stage5-report-private' }, reader), error => error.status === 404)
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000))
  repository.rows().set('rate_limits/' + idFor('report-rate', 'reader', bucket), { count: 10, expiresAt: Date.now() + 1000 })
  await assert.rejects(api.handle('/reports', { targetType: 'post', targetId: 'post-2', reason: 'spam', requestKey: 'stage5-report-limit' }, reader), error => error.status === 429)
})

test('stage5 admin processing is server-role guarded and audited', async () => {
  const repository = fixture([...users, ['posts/post-1', post]])
  const api = createCommunityApi({ repository, verify })
  const reader = auth('reader')
  const admin = auth('admin')
  const report = await api.handle('/reports', { targetType: 'post', targetId: 'post-1', reason: 'unsafe', requestKey: 'stage5-report-admin' }, reader)
  await assert.rejects(api.handle('/admin/reports', { role: 'admin' }, reader), error => error.status === 403)
  const list = await api.handle('/admin/reports', { status: 'pending' }, admin)
  assert.equal(list.items.length, 1)
  assert.equal('reporterId' in list.items[0], false)
  const resolved = await api.handle('/admin/reports/' + report.id + '/resolve', { status: 'resolved', takeDown: true, requestKey: 'stage5-resolve-1' }, admin)
  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.takenDown, true)
  assert.equal(repository.rows().get('posts/post-1').takenDown, true)
  assert.equal([...repository.rows().values()].some(row => row && row.action === 'post.takedown' && row.actorId === 'admin'), true)
  await assert.rejects(api.handle('/posts/post-1', {}, { headers: {} }), error => error.status === 404)
  await assert.rejects(api.handle('/admin/posts/post-1/takedown', { requestKey: 'stage5-takedown-spoof' }, reader), error => error.status === 403)
})

test('stage5 comment reports use the parent visibility boundary', async () => {
  const repository = fixture([...users, ['posts/post-1', post]])
  const api = createCommunityApi({ repository, verify })
  const reader = auth('reader')
  const comment = await api.handle('/posts/post-1/comments', { content: '待举报评论', requestKey: 'stage5-comment-create' }, reader)
  const report = await api.handle('/reports', { targetType: 'comment', targetId: comment.commentId, reason: 'abuse', requestKey: 'stage5-comment-report' }, auth('owner'))
  assert.equal(report.targetType, 'comment')
  assert.equal(repository.rows().get('reports/' + report.id).targetId, comment.commentId)
})

test('stage5 stable place contract survives public post projection', async () => {
  const route = Object.assign({}, post, {
    id: 'route-places', type: 'route',
    places: [{ id: 'qq-app-1', providerId: 'provider-1', provider: 'qq', name: '稳定地点', category: '景点', latitude: 40, longitude: 120 }],
    routeSnapshot: { stops: [{ id: 'qq-app-1', providerId: 'provider-1', provider: 'qq', name: '稳定地点', objectType: 'poi', planningRole: 'stop', latitude: 40, longitude: 120 }], items: [] }
  })
  const api = createCommunityApi({ repository: fixture([...users, ['posts/route-places', route]]), verify })
  const detail = await api.handle('/posts/route-places', {}, { headers: {} })
  assert.equal(detail.post.places[0].placeId, 'qq-app-1')
  assert.equal(detail.post.places[0].providerId, 'provider-1')
  assert.equal(detail.post.routeSnapshot.stops[0].placeId, 'qq-app-1')
  assert.equal(detail.post.routeSnapshot.stops[0].objectType, 'poi')
})
