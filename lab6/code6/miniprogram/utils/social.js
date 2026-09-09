const STORAGE_KEY = 'lab6_social_state_v1'

function defaults() {
  return { likes: {}, favorites: {}, comments: {}, following: {}, notifications: [], profile: null }
}

function read() {
  return Object.assign(defaults(), wx.getStorageSync(STORAGE_KEY) || {})
}

function write(state) {
  wx.setStorageSync(STORAGE_KEY, state)
  return state
}

function stableCount(id, base, range) {
  var text = String(id || '')
  var total = 0
  for (var i = 0; i < text.length; i += 1) total += text.charCodeAt(i)
  return base + (total % range)
}

function addNotification(title, content, type) {
  var state = read()
  state.notifications.unshift({ id: String(Date.now()) + Math.random(), title: title, content: content, type: type || '互动', time: '刚刚', read: false })
  state.notifications = state.notifications.slice(0, 30)
  write(state)
}

function toggleMap(name, id) {
  var state = read()
  state[name][id] = !state[name][id]
  write(state)
  return Boolean(state[name][id])
}

module.exports = {
  clearSession: function () {
    wx.removeStorageSync(STORAGE_KEY)
  },
  addComment: function (photoId, comment) {
    var state = read()
    state.comments[photoId] = state.comments[photoId] || []
    state.comments[photoId].push(comment)
    write(state)
    addNotification('评论已发布', '你在一张作品下留下了评论', '评论')
  },
  addNotification: addNotification,
  decoratePhoto: function (photo) {
    var state = read()
    var id = photo._id
    return Object.assign({}, photo, {
      liked: Boolean(state.likes[id]), favorited: Boolean(state.favorites[id]),
      likeCount: stableCount(id, 8, 48) + (state.likes[id] ? 1 : 0),
      commentCount: (state.comments[id] || []).length
    })
  },
  getComments: function (photoId) { return read().comments[photoId] || [] },
  getFollowing: function () { return read().following },
  getNotifications: function () {
    return read().notifications.filter(function (item) { return item.type !== '点赞' })
  },
  getProfile: function () { return read().profile },
  markAllRead: function () {
    var state = read()
    state.notifications = state.notifications.map(function (item) { return Object.assign({}, item, { read: true }) })
    write(state)
  },
  saveProfile: function (profile) { var state = read(); state.profile = profile; write(state) },
  toggleFavorite: function (id) { var active = toggleMap('favorites', id); if (active) addNotification('已收藏作品', '这张照片已加入你的收藏', '收藏'); return active },
  toggleFollow: function (openid, name) { var active = toggleMap('following', openid); addNotification(active ? '关注成功' : '已取消关注', active ? '你开始关注 ' + name : '你不再关注 ' + name, '关注'); return active },
  toggleLike: function (id) { return toggleMap('likes', id) },
  unreadCount: function () {
    return read().notifications.filter(function (item) { return !item.read && item.type !== '点赞' }).length
  }
}
