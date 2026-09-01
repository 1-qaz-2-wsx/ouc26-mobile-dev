const KEYS = {
  session: 'oucUserSession',
  favorites: 'favoriteNewsIds',
  history: 'readingHistory',
  settings: 'oucAppSettings'
}

const DEFAULT_SETTINGS = { theme: 'system', fontSize: 'medium' }

function uniqueIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean)))
}

function getSession() {
  const session = wx.getStorageSync(KEYS.session)
  return session && session.isLoggedIn ? session : null
}

function generateRandomNickname() {
  return `海大读者${Math.floor(1000 + Math.random() * 9000)}`
}

function createSession(userInfo, loginCode) {
  const oldSession = wx.getStorageSync(KEYS.session) || {}
  const suffix = String(loginCode || Date.now()).slice(-6).toUpperCase()
  const session = {
    userId: oldSession.userId || `OUC-LOCAL-${Date.now().toString(36).toUpperCase()}-${suffix}`,
    nickName: userInfo.nickName || '微信用户',
    avatarUrl: userInfo.avatarUrl || '',
    loginAt: Date.now(),
    wechatConnected: Boolean(loginCode),
    profileAuthorized: Boolean(userInfo.nickName && userInfo.avatarUrl),
    isLoggedIn: true
  }
  wx.setStorageSync(KEYS.session, session)
  return session
}

function updateSession(profile) {
  const session = getSession()
  if (!session) return null
  const updated = Object.assign({}, session, profile || {})
  updated.profileAuthorized = Boolean(updated.nickName && updated.avatarUrl)
  wx.setStorageSync(KEYS.session, updated)
  return updated
}

function clearSession() { wx.removeStorageSync(KEYS.session) }
function requireLogin() {
  if (getSession()) return true
  wx.showModal({
    title: '请先登录',
    content: '登录后才能收藏新闻，是否前往个人中心登录？',
    confirmText: '去登录',
    confirmColor: '#005a9c',
    success: res => {
      if (res.confirm) wx.switchTab({ url: '/pages/my/my' })
    }
  })
  return false
}
function getFavoriteIds() { return uniqueIds(wx.getStorageSync(KEYS.favorites)) }
function saveFavoriteIds(ids) {
  const result = uniqueIds(ids)
  wx.setStorageSync(KEYS.favorites, result)
  return result
}
function isFavorite(id) { return Boolean(getSession()) && getFavoriteIds().includes(id) }
function toggleFavorite(id) {
  if (!getSession()) return null
  const ids = getFavoriteIds()
  const index = ids.indexOf(id)
  if (index >= 0) {
    ids.splice(index, 1)
    saveFavoriteIds(ids)
    return false
  }
  ids.unshift(id)
  saveFavoriteIds(ids)
  return true
}
function removeFavorites(idsToRemove) {
  if (!getSession()) return getFavoriteIds()
  const removing = new Set(idsToRemove)
  return saveFavoriteIds(getFavoriteIds().filter(id => !removing.has(id)))
}

function getHistory() {
  const history = wx.getStorageSync(KEYS.history)
  return Array.isArray(history) ? history.filter(item => item && item.id) : []
}
function recordHistory(id) {
  const history = getHistory().filter(item => item.id !== id)
  history.unshift({ id: id, readAt: Date.now() })
  wx.setStorageSync(KEYS.history, history.slice(0, 50))
  return history
}
function setReadState(id, isRead) {
  const history = getHistory().filter(item => item.id !== id)
  if (isRead) history.unshift({ id: id, readAt: Date.now() })
  wx.setStorageSync(KEYS.history, history)
}
function clearHistory() { wx.removeStorageSync(KEYS.history) }

function getSettings() {
  const saved = wx.getStorageSync(KEYS.settings)
  return Object.assign({}, DEFAULT_SETTINGS, saved && typeof saved === 'object' ? saved : {})
}
function saveSettings(partial) {
  const settings = Object.assign({}, getSettings(), partial)
  wx.setStorageSync(KEYS.settings, settings)
  return settings
}
function isDarkTheme(settings) {
  if (settings.theme === 'dark') return true
  if (settings.theme === 'light') return false
  try { return wx.getSystemInfoSync().theme === 'dark' } catch (e) { return false }
}
function applyAppearance(settings) {
  const dark = isDarkTheme(settings || getSettings())
  try {
    wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: dark ? '#0b2235' : '#005a9c' })
    wx.setTabBarStyle({
      color: dark ? '#94a3b8' : '#64748b',
      selectedColor: dark ? '#38bdf8' : '#005a9c',
      backgroundColor: dark ? '#10283b' : '#ffffff',
      borderStyle: dark ? 'black' : 'white'
    })
  } catch (e) {}
  return dark
}
function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

module.exports = {
  KEYS, getSession, generateRandomNickname, createSession, updateSession, clearSession, requireLogin,
  getFavoriteIds, saveFavoriteIds, isFavorite, toggleFavorite, removeFavorites,
  getHistory, recordHistory, setReadState, clearHistory,
  getSettings, saveSettings, isDarkTheme, applyAppearance, formatTime
}
