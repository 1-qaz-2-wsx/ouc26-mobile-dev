const test = require('node:test')
const assert = require('node:assert/strict')
const { createCommunityApi } = require('../src/community-api')

function fixture(extra = []) {
  const rows = new Map([
    ['users/user-1', { id: 'user-1', status: 'active', nickname: '测试用户', bio: '', avatarMediaId: null, profileVersion: 1 }],
    ['post_favorites/fav-1', { id: 'fav-1', userId: 'user-1', postId: 'post-1', createdAt: 1 }],
    ['posts/post-1', { id: 'post-1', authorId: 'user-2', title: '公开路线', content: '路线内容', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 1, publishedAt: 1 }]
  ])
  for (const [path, value] of extra) rows.set(path, value)
  return {
    async get(table, id) { return rows.get(table + '/' + id) || null },
    collection(table) {
      let query = null
      let max = 100
      const api = {
        where(value) { query = value; return api },
        orderBy() { return api },
        limit(value) { max = value; return api },
        async get() {
          let result = [...rows.entries()].filter(([key]) => key.startsWith(table + '/')).map(([, value]) => structuredClone(value))
          if (query) result = result.filter(row => Object.entries(query).every(([key, value]) => row[key] === value))
          return { data: result.slice(0, max) }
        }
      }
      return api
    }
  }
}

function memberPost(authorId, index, publishedAt = 1000 - index) {
  const id = `member-${String(index).padStart(2, '0')}`
  return {
    id, authorId, title: `公开帖 ${index}`, content: '成员主页分页', placeNames: [], photos: [],
    visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false,
    createdAt: publishedAt, publishedAt
  }
}

function memberProfileSeed(targetId, extra = []) {
  return [
    ['users/' + targetId, { id: targetId, status: 'active', nickname: '成员', bio: '', avatarMediaId: null, profileVersion: 1 }],
    ...extra
  ]
}

function memberPosts(authorId, count, publishedAt) {
  return Array.from({ length: count }, (_, offset) => {
    const post = memberPost(authorId, offset + 1, publishedAt)
    return ['posts/' + post.id, post]
  })
}

test('GET /me returns profile and favorite posts without Promise misuse', async () => {
  const api = createCommunityApi({ repository: fixture(), verify: token => { assert.equal(token, 'token'); return { id: 'user-1' } } })
  const result = await api.handle('/me', {}, { headers: { authorization: 'Bearer token' } })
  assert.equal(result.user.nickname, '测试用户')
  assert.equal(result.favorites.length, 1)
  assert.equal(result.favorites[0].id, 'post-1')
})

test('guest can read public detail/comments and receives a whitelisted DTO', async () => {
  const api = createCommunityApi({ repository: fixture(), verify: () => { throw new Error('guest must not verify a token') } })
  const detail = await api.handle('/posts/post-1', {}, { headers: {} })
  assert.equal(detail.post.id, 'post-1')
  assert.equal(detail.post.permissions.isOwner, false)
  assert.equal('deletedAt' in detail.post, false)
  assert.equal('takenDown' in detail.post, false)
  const comments = await api.handle('/posts/post-1/comments', { action: 'list' }, { headers: {} })
  assert.deepEqual(comments.items, [])
})

test('owner detail is not blocked by private comments and pagination is stable', async () => {
  const privatePost = { id: 'private-1', authorId: 'user-1', title: '草稿', content: '私密内容', placeNames: [], photos: [], visibility: 'private', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 4, publishedAt: 4 }
  const posts = [2, 3, 4].map(value => ['posts/post-' + value, { id: 'post-' + value, authorId: 'user-2', title: '公开' + value, content: '内容', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: value, publishedAt: value }])
  const api = createCommunityApi({ repository: fixture([['users/user-2', { id: 'user-2', status: 'active', nickname: '另一个用户', bio: '', avatarMediaId: null, profileVersion: 1 }], ['posts/private-1', privatePost], ...posts]), verify: token => { if (token === 'token') return { id: 'user-1' }; if (token === 'other') return { id: 'user-2' }; throw new Error('unexpected token') } })
  const detail = await api.handle('/posts/private-1', {}, { headers: { authorization: 'Bearer token' } })
  assert.equal(detail.isOwner, true)
  const comments = await api.handle('/posts/private-1/comments', { action: 'list' }, { headers: { authorization: 'Bearer token' } })
  assert.deepEqual(comments.items, [])
  await assert.rejects(api.handle('/posts/private-1', {}, { headers: {} }), error => error.status === 404)
  await assert.rejects(api.handle('/posts/private-1', {}, { headers: { authorization: 'Bearer other' } }), error => error.status === 404)
  const first = await api.handle('/community/feed', { limit: 2 }, { headers: {} })
  assert.deepEqual(first.items.map(item => item.id), ['post-4', 'post-3'])
  assert.equal(first.hasMore, true)
  const second = await api.handle('/community/feed', { limit: 2, cursor: first.nextCursor }, { headers: {} })
  assert.deepEqual(second.items.map(item => item.id), ['post-2', 'post-1'])
})

test('following and follower lists expose safe profiles with stable cursor pagination', async () => {
  const extra = [
    ['users/user-2', { id: 'user-2', status: 'active', nickname: '被关注者', bio: '路线作者', avatarMediaId: 'cloud://two', profileVersion: 1 }],
    ['users/user-3', { id: 'user-3', status: 'active', nickname: '粉丝甲', bio: '', avatarMediaId: null, profileVersion: 1 }],
    ['follows/follow-2', { id: 'follow-2', followerId: 'user-1', followeeId: 'user-2', createdAt: 20 }],
    ['follows/follow-3', { id: 'follow-3', followerId: 'user-1', followeeId: 'user-3', createdAt: 10 }],
    ['follows/follower-3', { id: 'follower-3', followerId: 'user-3', followeeId: 'user-1', createdAt: 30 }],
    ['follows/follower-missing', { id: 'follower-missing', followerId: 'missing-user', followeeId: 'user-1', createdAt: 20 }]
  ]
  const api = createCommunityApi({ repository: fixture(extra), verify: token => ({ id: token === 'token' ? 'user-1' : 'unknown' }) })
  const auth = { headers: { authorization: 'Bearer token' } }
  const followingFirst = await api.handle('/me/following', { limit: 1 }, auth)
  assert.equal(followingFirst.items[0].targetId, 'user-2')
  assert.equal(followingFirst.items[0].user.nickname, '被关注者')
  assert.equal(followingFirst.items[0].following, true)
  assert.equal(followingFirst.hasMore, true)
  const followingSecond = await api.handle('/me/following', { limit: 1, cursor: followingFirst.nextCursor }, auth)
  assert.deepEqual(followingSecond.items.map(item => item.targetId), ['user-3'])
  assert.equal(new Set(followingFirst.items.concat(followingSecond.items).map(item => item.id)).size, 2)

  const followers = await api.handle('/me/followers', { limit: 10 }, auth)
  assert.deepEqual(followers.items.map(item => item.targetId), ['user-3', 'missing-user'])
  assert.equal(followers.items[0].following, true, 'viewer can back-follow without changing the original relation')
  assert.equal(followers.items[1].user.nickname, '微信用户', 'missing author falls back without crashing the list')
  assert.equal(followers.items[1].following, false)
})

test('public feed cursor handles 25 same-time posts across two pages without duplicates', async () => {
  const posts = Array.from({ length: 24 }, (_, index) => {
    const number = index + 2, id = `page-${String(number).padStart(2, '0')}`
    return [`posts/${id}`, { id, authorId: 'user-2', title: `测试帖 ${number}`, content: '分页', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 100, publishedAt: 100 }]
  })
  const firstPost = ['posts/post-1', { id: 'page-01', authorId: 'user-2', title: '测试帖 1', content: '分页', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 100, publishedAt: 100 }]
  const api = createCommunityApi({ repository: fixture([['users/user-2', { id: 'user-2', status: 'active', nickname: '作者', bio: '', avatarMediaId: null, profileVersion: 1 }], firstPost, ...posts]), verify: () => { throw new Error('guest must not verify a token') } })
  const first = await api.handle('/community/feed', { limit: 20 }, { headers: {} })
  const second = await api.handle('/community/feed', { limit: 20, cursor: first.nextCursor }, { headers: {} })
  const ids = first.items.concat(second.items).map(item => item.id)
  assert.equal(first.items.length, 20)
  assert.equal(second.items.length, 5)
  assert.equal(second.hasMore, false)
  assert.equal(new Set(ids).size, 25)
  assert.deepEqual(ids, Array.from({ length: 25 }, (_, index) => `page-${String(25 - index).padStart(2, '0')}`))
})

test('self-follow is rejected before target relation writes', async () => {
  const api = createCommunityApi({ repository: fixture(), verify: () => ({ id: 'user-1' }) })
  await assert.rejects(api.handle('/users/user-1/follow', { active: true }, { headers: { authorization: 'Bearer token' } }), error => error.status === 403)
})

test('follow is idempotent, updates both counters once, and controls the following feed', async () => {
  const rows = new Map([
    ['users/a', { id: 'a', status: 'active', nickname: '作者 A', bio: '', avatarMediaId: null, profileVersion: 1 }],
    ['users/b', { id: 'b', status: 'active', nickname: '读者 B', bio: '', avatarMediaId: null, profileVersion: 1 }],
    ['posts/a-post', { id: 'a-post', authorId: 'a', title: 'A 的公开路线', content: '内容', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 1, publishedAt: 1 }]
  ])
  const repository = {
    async get(table, id) { return rows.get(table + '/' + id) || null },
    async set(table, id, value) { rows.set(table + '/' + id, structuredClone(value)) },
    async remove(table, id) { rows.delete(table + '/' + id) },
    async transaction(work) { return work(this) },
    collection(table) {
      let query = null, max = 100
      const chain = {
        where(value) { query = value; return chain },
        orderBy() { return chain },
        limit(value) { max = value; return chain },
        async get() {
          let result = [...rows.entries()].filter(([key]) => key.startsWith(table + '/')).map(([, value]) => structuredClone(value))
          if (query) result = result.filter(row => Object.entries(query).every(([key, value]) => row[key] === value))
          return { data: result.slice(0, max) }
        }
      }
      return chain
    }
  }
  const api = createCommunityApi({ repository, verify: token => ({ id: token === 'b-token' ? 'b' : 'a' }) })
  const bAuth = { headers: { authorization: 'Bearer b-token' } }
  const first = await api.handle('/users/a/follow', { active: true }, bAuth)
  const repeat = await api.handle('/users/a/follow', { active: true }, bAuth)
  assert.equal(first.following, true)
  assert.equal(repeat.following, true)
  const bProfile = await api.handle('/me', {}, bAuth)
  assert.equal(bProfile.stats.followingCount, 1)
  const aProfile = await api.handle('/me', {}, { headers: { authorization: 'Bearer a-token' } })
  assert.equal(aProfile.stats.followerCount, 1)
  const followed = await api.handle('/community/feed', { tab: 'following', limit: 20 }, bAuth)
  assert.deepEqual(followed.items.map(item => item.id), ['a-post'])
  await api.handle('/users/a/follow', { active: false }, bAuth)
  const after = await api.handle('/community/feed', { tab: 'following', limit: 20 }, bAuth)
  assert.deepEqual(after.items, [])
  const bAfter = await api.handle('/me', {}, bAuth)
  const aAfter = await api.handle('/me', {}, { headers: { authorization: 'Bearer a-token' } })
  assert.equal(bAfter.stats.followingCount, 0)
  assert.equal(aAfter.stats.followerCount, 0)
})

test('member profile returns the first public page by default and continues through nextCursor', async () => {
  const api = createCommunityApi({
    repository: fixture(memberProfileSeed('user-x', memberPosts('user-x', 45))),
    verify: () => { throw new Error('guest must not verify a token') }
  })
  const guest = { headers: {} }
  const expected = Array.from({ length: 45 }, (_, offset) => `member-${String(offset + 1).padStart(2, '0')}`)

  const first = await api.handle('/users/user-x', {}, guest)
  assert.equal(first.user.id, 'user-x')
  assert.equal(first.posts.length, 20)
  assert.deepEqual(first.posts.map(item => item.id), expected.slice(0, 20))
  assert.equal(first.hasMore, true)
  assert.equal(typeof first.nextCursor, 'string')
  assert.ok(first.nextCursor.length > 0)
  assert.equal(first.viewerFollowing, false)
  assert.equal('followers' in first, false, 'relation lists stay closed')
  assert.equal('following' in first, false)

  const second = await api.handle('/users/user-x', { cursor: first.nextCursor }, guest)
  assert.equal(second.user.id, 'user-x')
  assert.deepEqual(second.posts.map(item => item.id), expected.slice(20, 40))
  assert.equal(second.hasMore, true)
  assert.ok(second.nextCursor)

  const third = await api.handle('/users/user-x', { cursor: second.nextCursor }, guest)
  assert.deepEqual(third.posts.map(item => item.id), expected.slice(40))
  assert.equal(third.hasMore, false)
  assert.equal(third.nextCursor, null)

  const collected = first.posts.concat(second.posts, third.posts).map(item => item.id)
  assert.equal(new Set(collected).size, 45)
  assert.deepEqual(collected, expected)
})

test('member profile cursor keeps same-time posts stable across pages', async () => {
  const api = createCommunityApi({
    repository: fixture(memberProfileSeed('user-same', memberPosts('user-same', 25, 500))),
    verify: () => { throw new Error('guest must not verify a token') }
  })
  const guest = { headers: {} }
  const first = await api.handle('/users/user-same', { limit: 20 }, guest)
  const second = await api.handle('/users/user-same', { limit: 20, cursor: first.nextCursor }, guest)
  assert.equal(first.posts.length, 20)
  assert.equal(first.hasMore, true)
  assert.equal(second.posts.length, 5)
  assert.equal(second.hasMore, false)
  assert.equal(second.nextCursor, null)
  const ids = first.posts.concat(second.posts).map(item => item.id)
  assert.equal(new Set(ids).size, 25)
  assert.deepEqual(ids, Array.from({ length: 25 }, (_, offset) => `member-${String(25 - offset).padStart(2, '0')}`))

  const repeat = await api.handle('/users/user-same', { limit: 20, cursor: first.nextCursor }, guest)
  assert.deepEqual(repeat.posts.map(item => item.id), second.posts.map(item => item.id))
})

test('member profile pagination only exposes truly public posts, even to the author', async () => {
  const rows = [
    ['posts/public-new', { id: 'public-new', authorId: 'user-p', title: '公开新', content: '', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 200, publishedAt: 200 }],
    ['posts/public-legacy', { id: 'public-legacy', authorId: 'user-p', title: '公开旧', content: '', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'not_required', deletedAt: null, takenDown: false, createdAt: 100, publishedAt: 100 }],
    ['posts/private-1', { id: 'private-1', authorId: 'user-p', title: '私密', content: '', placeNames: [], photos: [], visibility: 'private', moderationStatus: 'approved', deletedAt: null, takenDown: false, createdAt: 180, publishedAt: 180 }],
    ['posts/deleted-1', { id: 'deleted-1', authorId: 'user-p', title: '已删除', content: '', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: 170, takenDown: false, createdAt: 170, publishedAt: 170 }],
    ['posts/taken-down-1', { id: 'taken-down-1', authorId: 'user-p', title: '已下架', content: '', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'approved', deletedAt: null, takenDown: true, createdAt: 160, publishedAt: 160 }],
    ['posts/pending-1', { id: 'pending-1', authorId: 'user-p', title: '审核中', content: '', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'pending', deletedAt: null, takenDown: false, createdAt: 150, publishedAt: 150 }],
    ['posts/rejected-1', { id: 'rejected-1', authorId: 'user-p', title: '未通过', content: '', placeNames: [], photos: [], visibility: 'public', moderationStatus: 'rejected', deletedAt: null, takenDown: false, createdAt: 140, publishedAt: 140 }]
  ]
  const api = createCommunityApi({
    repository: fixture(memberProfileSeed('user-p', rows)),
    verify: () => ({ id: 'user-p' })
  })
  const guest = await api.handle('/users/user-p', {}, { headers: {} })
  assert.deepEqual(guest.posts.map(item => item.id), ['public-new', 'public-legacy'])
  assert.equal(guest.hasMore, false)
  assert.equal(guest.nextCursor, null)

  const owner = await api.handle('/users/user-p', {}, { headers: { authorization: 'Bearer token' } })
  assert.deepEqual(owner.posts.map(item => item.id), ['public-new', 'public-legacy'], 'member page is not the owner/me surface')
})

test('member profile keeps viewerFollowing for logged-in viewers while paging', async () => {
  const seed = memberProfileSeed('user-x', memberPosts('user-x', 25))
  seed.push(['users/reader-x', { id: 'reader-x', status: 'active', nickname: '读者', bio: '', avatarMediaId: null, profileVersion: 1 }])
  seed.push(['follows/follow-x', { id: 'follow-x', followerId: 'reader-x', followeeId: 'user-x', createdAt: 5 }])
  const api = createCommunityApi({
    repository: fixture(seed),
    verify: token => { assert.equal(token, 'reader-token'); return { id: 'reader-x' } }
  })
  const auth = { headers: { authorization: 'Bearer reader-token' } }
  const first = await api.handle('/users/user-x', {}, auth)
  assert.equal(first.viewerFollowing, true)
  assert.equal(first.posts.length, 20)
  const second = await api.handle('/users/user-x', { cursor: first.nextCursor }, auth)
  assert.equal(second.viewerFollowing, true)
  assert.equal(second.posts.length, 5)
  assert.equal(second.hasMore, false)
  await assert.rejects(api.handle('/users/user-x/followers', {}, auth), error => error.status === 404)
  await assert.rejects(api.handle('/users/user-x/following', {}, auth), error => error.status === 404)
})

test('member profile clamps limit to 1..50 and treats a broken cursor as the first page', async () => {
  const api = createCommunityApi({
    repository: fixture(memberProfileSeed('user-limit', memberPosts('user-limit', 60))),
    verify: () => { throw new Error('guest must not verify a token') }
  })
  const guest = { headers: {} }
  const single = await api.handle('/users/user-limit', { limit: 1 }, guest)
  assert.equal(single.posts.length, 1)
  assert.equal(single.hasMore, true)
  assert.ok(single.nextCursor)

  const max = await api.handle('/users/user-limit', { limit: 50 }, guest)
  assert.equal(max.posts.length, 50)
  assert.equal(max.hasMore, true)
  const rest = await api.handle('/users/user-limit', { limit: 50, cursor: max.nextCursor }, guest)
  assert.equal(rest.posts.length, 10)
  assert.equal(rest.hasMore, false)
  assert.equal(rest.nextCursor, null)

  assert.equal((await api.handle('/users/user-limit', { limit: 999 }, guest)).posts.length, 50)
  assert.equal((await api.handle('/users/user-limit', { limit: -3 }, guest)).posts.length, 1)
  assert.equal((await api.handle('/users/user-limit', { limit: 0 }, guest)).posts.length, 20, 'falsy limit falls back to the default')
  assert.equal((await api.handle('/users/user-limit', { limit: 'abc' }, guest)).posts.length, 20)
  assert.equal((await api.handle('/users/user-limit', { cursor: 'not-a-cursor' }, guest)).posts.length, 20)
})

test('legacy member profile call keeps the previous response keys', async () => {
  const api = createCommunityApi({
    repository: fixture(memberProfileSeed('user-x', memberPosts('user-x', 25))),
    verify: () => { throw new Error('guest must not verify a token') }
  })
  const legacy = await api.handle('/users/user-x', {}, { headers: {} })
  assert.deepEqual(Object.keys(legacy).sort(), ['hasMore', 'nextCursor', 'posts', 'stats', 'user', 'viewerFollowing'])
  assert.equal(legacy.posts.length, 20)
  assert.equal(legacy.user.id, 'user-x')
  assert.equal(typeof legacy.stats.followerCount, 'number')
  assert.equal(typeof legacy.stats.followingCount, 'number')
  assert.equal(typeof legacy.hasMore, 'boolean')
})
