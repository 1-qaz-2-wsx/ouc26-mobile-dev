const test = require('node:test')
const assert = require('node:assert/strict')
const { createCommunityApi } = require('../src/community-api')
const { createCommunityStorage } = require('../src/community-storage')

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
const place = { id: 'qq-place-1', provider: 'qq', name: '长春景点', latitude: 43.8, longitude: 125.3, category: '景点' }

test('community-storage verifies size/mime and returns signed read URLs', async () => {
  const storage = createCommunityStorage({
    async getFileInfo({ fileList }) { return { fileList: fileList.map(fileID => ({ fileID, size: 2048, mime: 'image/png', code: 'SUCCESS' })) } },
    async getTempFileURL({ fileList }) { return { fileList: fileList.map(({ fileID }) => ({ fileID, tempFileURL: 'https://signed/' + encodeURIComponent(fileID), code: 'SUCCESS' })) } }
  })
  const actual = await storage.verify('cloud://env/community/u/abc.png', 'community/u/abc.png')
  assert.equal(actual.size, 2048)
  assert.equal(actual.mime, 'image/png')
  assert.equal(await storage.readUrl('cloud://env/community/u/abc.png'), 'https://signed/' + encodeURIComponent('cloud://env/community/u/abc.png'))
})

test('community-storage rejects mismatched storageKey and missing object', async () => {
  const storage = createCommunityStorage({
    async getFileInfo({ fileList }) { return { fileList: [{ fileID: fileList[0], code: 'NOT_FOUND' }] } },
    async getTempFileURL() { return { fileList: [] } }
  })
  await assert.rejects(storage.verify('cloud://env/community/u/abc.png', 'other/key.png'), error => error.status === 400)
  await assert.rejects(storage.verify('cloud://env/community/u/abc.png', 'community/u/abc.png'), error => error.status === 404)
  assert.equal(await storage.readUrl('cloud://env/community/u/abc.png'), null)
})

test('sourceKey dedups repeated legacy republish into one cloud post', async () => {
  const repository = fixture(base)
  const api = createCommunityApi({ repository, verify })
  const payload = { type: 'review', title: '旧评价', content: '旧内容', rating: 5, visitDate: '2026-10-01', places: [place], sourceKey: 'local:guest:post-1' }
  const first = await api.handle('/posts', Object.assign({}, payload, { requestKey: 'republish-1' }), auth)
  const second = await api.handle('/posts', Object.assign({}, payload, { requestKey: 'republish-2' }), auth)
  assert.equal(second.postId, first.postId)
  assert.equal(second.duplicated, true)
  const postRows = [...repository.rows().keys()].filter(key => key.startsWith('posts/'))
  assert.equal(postRows.length, 1)
})

test('profile resolves avatarUrl and decorate resolves photos and authorAvatar through storage.readUrl', async () => {
  const repository = fixture(base)
  repository.rows().set('users/author', { id: 'author', status: 'active', nickname: '作者', bio: '', profileVersion: 1, avatarMediaId: 'avatar-media' })
  repository.rows().set('media/avatar-media', { id: 'avatar-media', ownerId: 'author', fileID: 'cloud://env/community/author/avatar-media.jpg', status: 'uploaded' })
  repository.rows().set('media/media-1', { id: 'media-1', ownerId: 'author', fileID: 'cloud://env/community/author/media-1.jpg', status: 'uploaded', moderationStatus: 'not_required', mime: 'image/jpeg', size: 1024 })
  repository.rows().set('posts/post-1', { id: 'post-1', authorId: 'author', type: 'review', title: '评价', content: '很好', placeNames: ['长春'], places: [place], photos: ['media-1'], routeSnapshot: null, rating: 5, visitDate: '2026-10-01', duration: null, visibility: 'public', sourceKey: null, moderationStatus: 'not_required', moderationReason: null, publishedAt: 1700000000000, deletedAt: null, takenDown: false, version: 1, createdAt: 1700000000000, updatedAt: 1700000000000 })
  const storage = { async readUrl(fileID) { return 'https://signed/' + encodeURIComponent(fileID) } }
  const api = createCommunityApi({ repository, verify, storage })
  const me = await api.handle('/me', {}, auth)
  assert.equal(me.user.avatarUrl, 'https://signed/' + encodeURIComponent('cloud://env/community/author/avatar-media.jpg'))
  const detail = await api.handle('/posts/post-1', {}, auth)
  assert.equal(detail.post.photos[0], 'https://signed/' + encodeURIComponent('cloud://env/community/author/media-1.jpg'))
  assert.equal(detail.post.authorAvatar, 'https://signed/' + encodeURIComponent('cloud://env/community/author/avatar-media.jpg'))
})

test('profile without storage returns fileID as avatarUrl fallback', async () => {
  const repository = fixture(base)
  repository.rows().set('users/author', { id: 'author', status: 'active', nickname: '作者', bio: '', profileVersion: 1, avatarMediaId: 'avatar-media' })
  repository.rows().set('media/avatar-media', { id: 'avatar-media', ownerId: 'author', fileID: 'cloud://env/community/author/avatar-media.jpg', status: 'uploaded' })
  const api = createCommunityApi({ repository, verify })
  const me = await api.handle('/me', {}, auth)
  assert.equal(me.user.avatarUrl, 'cloud://env/community/author/avatar-media.jpg')
})
