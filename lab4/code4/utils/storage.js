const STORAGE_KEY = 'boxGameData'
const VERSION = 2

function defaults() {
  return {
    version: VERSION,
    best: {},
    settings: { vibration: true, practiceMode: true }
  }
}

function readData() {
  const saved = wx.getStorageSync(STORAGE_KEY)
  if (saved) {
    const migrated = {
      version: VERSION,
      best: saved.best || {},
      settings: Object.assign({}, defaults().settings, saved.settings || {})
    }
    if (saved.version !== VERSION) wx.setStorageSync(STORAGE_KEY, migrated)
    return {
      version: VERSION,
      best: migrated.best,
      settings: migrated.settings
    }
  }

  // 兼容旧版本直接保存在 boxGameBest 中的最佳成绩。
  const legacyBest = wx.getStorageSync('boxGameBest') || {}
  const data = defaults()
  data.best = legacyBest
  wx.setStorageSync(STORAGE_KEY, data)
  return data
}

function saveData(data) {
  wx.setStorageSync(STORAGE_KEY, Object.assign({}, data, { version: VERSION }))
}

function saveBest(levelId, moves) {
  const data = readData()
  const oldBest = Number(data.best[levelId]) || 0
  if (!oldBest || moves < oldBest) {
    data.best[levelId] = moves
    saveData(data)
    return { best: moves, isNewBest: true }
  }
  return { best: oldBest, isNewBest: false }
}

function updateSettings(patch) {
  const data = readData()
  data.settings = Object.assign({}, data.settings, patch)
  saveData(data)
  return data.settings
}

module.exports = { readData, saveBest, updateSettings }
