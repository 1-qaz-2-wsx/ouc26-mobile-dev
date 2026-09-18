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
      const result = await work(scope(draft))
      rows = draft
      return result
    },
    rows() { return rows }
  }
}

const users = [
  ['users/owner', { id: 'owner', status: 'active', nickname: '作者', bio: '路线作者', profileVersion: 1 }],
  ['users/reader', { id: 'reader', status: 'active', nickname: '读者', bio: '', profileVersion: 1 }],
  ['users/replier', { id: 'replier', status: 'active', nickname: '回复者', bio: '', profileVersion: 1 }]
]
const post = { id: 'post-1', authorId: 'owner', type: 'route', title: '公开路线', content: '路线内容', placeNames: [], places: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 1, publishedAt: 1, version: 1 }
const auth = token => ({ headers: { authorization: 'Bearer ' + token } })
const verify = token => ({ id: token })

test('stage4 likes and favorites are idempotent, count safely, and notify once', async () => {
  const repository = fixture([...users, ['posts/post-1', post]])
  const api = createCommunityApi({ repository, verify })
  const reader = auth('reader')
  const owner = auth('owner')

  const like = await api.handle('/posts/post-1/like', { active: true, requestKey: 'stage4-like-1' }, reader)
  const likeRetry = await api.handle('/posts/post-1/like', { active: true, requestKey: 'stage4-like-1' }, reader)
  assert.equal(like.active, true)
  assert.deepEqual(likeRetry, like)
  const stats = repository.rows().get('post_stats/' + idFor('post', 'post-1'))
  assert.equal(stats.likeCount, 1)
  assert.equal(repository.rows().get('post_stats/' + idFor('user', 'owner')).likeReceivedCount, 1)
  assert.equal([...repository.rows().values()].filter(row => row && row.type === 'like').length, 1)
  await assert.rejects(api.handle('/posts/post-1/like', { active: true }, owner), error => error.status === 403)

  const favorite = await api.handle('/posts/post-1/favorite', { active: true, requestKey: 'stage4-fav-1' }, reader)
  await api.handle('/posts/post-1/favorite', { active: true, requestKey: 'stage4-fav-1' }, reader)
  assert.equal(favorite.active, true)
  assert.equal(repository.rows().get('post_stats/' + idFor('post', 'post-1')).favoriteCount, 1)
  await api.handle('/posts/post-1/favorite', { active: true }, owner)
  assert.equal(repository.rows().get('post_stats/' + idFor('post', 'post-1')).favoriteCount, 2, '收藏自己的公开帖子允许')

  const unlike = await api.handle('/posts/post-1/like', { active: false, requestKey: 'stage4-unlike-1' }, reader)
  await api.handle('/posts/post-1/like', { active: false, requestKey: 'stage4-unlike-1' }, reader)
  assert.equal(unlike.active, false)
  assert.equal(repository.rows().get('post_stats/' + idFor('post', 'post-1')).likeCount, 0)
  assert.equal(repository.rows().get('post_stats/' + idFor('user', 'owner')).likeReceivedCount, 0)

  await repository.set('post_favorites', idFor('reader', 'missing-post'), { id: idFor('reader', 'missing-post'), userId: 'reader', postId: 'missing-post', createdAt: 1 })
  const me = await api.handle('/me', {}, reader)
  assert.equal(me.favorites.some(item => item.id === 'missing-post' && item.unavailable && item.content === '' && item.photos.length === 0), true)
  const removeMissing = await api.handle('/posts/missing-post/favorite', { active: false, requestKey: 'stage4-missing-1' }, reader)
  assert.equal(removeMissing.active, false)
  assert.equal(repository.rows().has('post_favorites/' + idFor('reader', 'missing-post')), false)
})

test('stage4 follow is idempotent and creates a single target notification', async () => {
  const repository = fixture([...users, ['posts/post-1', post]])
  const api = createCommunityApi({ repository, verify })
  const first = await api.handle('/users/owner/follow', { active: true, requestKey: 'stage4-follow-1' }, auth('reader'))
  const retry = await api.handle('/users/owner/follow', { active: true, requestKey: 'stage4-follow-1' }, auth('reader'))
  assert.equal(first.following, true)
  assert.deepEqual(retry, first)
  assert.equal(repository.rows().get('post_stats/' + idFor('user', 'owner')).followerCount, 1)
  assert.equal(repository.rows().get('post_stats/' + idFor('user', 'reader')).followingCount, 1)
  assert.equal([...repository.rows().values()].filter(row => row && row.type === 'follow').length, 1)
  const removed = await api.handle('/users/owner/follow', { active: false, requestKey: 'stage4-unfollow-1' }, auth('reader'))
  assert.equal(removed.following, false)
  assert.equal(repository.rows().get('post_stats/' + idFor('user', 'owner')).followerCount, 0)
  assert.equal(repository.rows().get('post_stats/' + idFor('user', 'reader')).followingCount, 0)
})

test('stage4 comments support two levels, count changes, deletion placeholders, and reply notifications', async () => {
  const repository = fixture([...users, ['posts/post-1', post]])
  const api = createCommunityApi({ repository, verify })
  const reader = auth('reader')
  const replier = auth('replier')

  const root = await api.handle('/posts/post-1/comments', { content: '第一层', requestKey: 'stage4-comment-1' }, reader)
  assert.equal(root.status, 'not_required')
  assert.equal(root.counts.commentCount, 1)
  const rootRow = repository.rows().get('comments/' + root.commentId)
  assert.equal(rootRow.rootId, null)
  assert.equal([...repository.rows().values()].filter(row => row && row.type === 'comment').length, 1)

  const reply = await api.handle('/posts/post-1/comments', { content: '第二层', replyToId: root.commentId, requestKey: 'stage4-comment-2' }, replier)
  assert.equal(reply.counts.commentCount, 2)
  const replyRow = repository.rows().get('comments/' + reply.commentId)
  assert.equal(replyRow.rootId, root.commentId)
  assert.equal(replyRow.replyToId, root.commentId)

  const listed = await api.handle('/posts/post-1/comments', { action: 'list', limit: 10 }, { headers: {} })
  assert.equal(listed.items.length, 2)
  const listedReply = listed.items.find(item => item.id === reply.commentId)
  assert.equal(listedReply.rootId, root.commentId)
  assert.equal(listedReply.replyToUserName, '读者')
  assert.equal(listedReply.canReply, true)

  const deletedRoot = await api.handle('/comments/' + root.commentId + '/delete', { requestKey: 'stage4-comment-delete-1' }, reader)
  const deletedRootRetry = await api.handle('/comments/' + root.commentId + '/delete', { requestKey: 'stage4-comment-delete-1' }, reader)
  assert.equal(deletedRoot.deleted, true)
  assert.deepEqual(deletedRootRetry, deletedRoot)
  assert.equal(deletedRoot.counts.commentCount, 1)
  const withPlaceholder = await api.handle('/posts/post-1/comments', { action: 'list', limit: 10 }, { headers: {} })
  assert.equal(withPlaceholder.items.some(item => item.id === root.commentId && item.content === '评论已删除'), true)
  assert.equal(withPlaceholder.items.find(item => item.id === root.commentId).canReply, false)
  await assert.rejects(
    api.handle('/posts/post-1/comments', { content: '不能回复已删除根评论', replyToId: root.commentId, requestKey: 'stage4-comment-deleted-target' }, replier),
    error => error.status === 404
  )
  await assert.rejects(
    api.handle('/comments/' + reply.commentId + '/delete', { requestKey: 'stage4-comment-owner-delete' }, auth('owner')),
    error => error.status === 403
  )

  const deletedReply = await api.handle('/comments/' + reply.commentId + '/delete', { requestKey: 'stage4-comment-delete-2' }, replier)
  assert.equal(deletedReply.counts.commentCount, 0)
  const empty = await api.handle('/posts/post-1/comments', { action: 'list', limit: 10 }, { headers: {} })
  assert.deepEqual(empty.items, [])

  const ownerNotice = await api.handle('/me/notifications', { limit: 20 }, auth('owner'))
  const readerNotice = await api.handle('/me/notifications', { limit: 20 }, reader)
  assert.equal(ownerNotice.items.filter(item => item.type === 'comment').length, 1)
  assert.equal(ownerNotice.items.filter(item => item.type === 'reply').length, 1)
  assert.equal(readerNotice.items.filter(item => item.type === 'reply').length, 1)
})

test('stage4 notifications support single/all read without cross-account mutation', async () => {
  const repository = fixture([...users, ['posts/post-1', post]])
  const api = createCommunityApi({ repository, verify })
  await api.handle('/users/owner/follow', { active: true, requestKey: 'stage4-notice-follow' }, auth('reader'))
  await api.handle('/posts/post-1/like', { active: true, requestKey: 'stage4-notice-like' }, auth('reader'))
  let ownerNotice = await api.handle('/me/notifications', { limit: 20 }, auth('owner'))
  assert.equal(ownerNotice.unreadCount, 2)
  const firstId = ownerNotice.items[0].id
  const markedOne = await api.handle('/me/notifications/read', { ids: [firstId] }, auth('owner'))
  assert.equal(markedOne.marked, 1)
  ownerNotice = await api.handle('/me/notifications', { limit: 20 }, auth('owner'))
  assert.equal(ownerNotice.unreadCount, 1)
  const readerNotice = await api.handle('/me/notifications', { limit: 20 }, auth('reader'))
  assert.equal(readerNotice.unreadCount, 0)
  const markedAll = await api.handle('/me/notifications/read', { ids: [] }, auth('owner'))
  assert.equal(markedAll.marked, 1)
  ownerNotice = await api.handle('/me/notifications', { limit: 20 }, auth('owner'))
  assert.equal(ownerNotice.unreadCount, 0)
})
