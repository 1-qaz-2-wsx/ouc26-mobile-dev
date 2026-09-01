const assert = require('assert')

let cache = {
  boxGameData: {
    version: 1,
    best: { 0: 42 },
    settings: { vibration: false }
  }
}

global.wx = {
  getStorageSync(key) { return cache[key] },
  setStorageSync(key, value) { cache[key] = value }
}

const storage = require('../utils/storage.js')
const migrated = storage.readData()
assert.strictEqual(migrated.version, 2)
assert.strictEqual(migrated.best[0], 42)
assert.strictEqual(migrated.settings.vibration, false)
assert.strictEqual(migrated.settings.practiceMode, true)
assert.strictEqual(cache.boxGameData.version, 2)

storage.updateSettings({ practiceMode: false })
assert.strictEqual(storage.readData().settings.practiceMode, false)

const first = storage.saveBest(1, 20)
assert.deepStrictEqual(first, { best: 20, isNewBest: true })
const slower = storage.saveBest(1, 25)
assert.deepStrictEqual(slower, { best: 20, isNewBest: false })
const faster = storage.saveBest(1, 18)
assert.deepStrictEqual(faster, { best: 18, isNewBest: true })

console.log('storage tests passed')
