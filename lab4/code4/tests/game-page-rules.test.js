const assert = require('assert')
const engine = require('../utils/game-engine.js')
const data = require('../utils/data.js')

const simpleLevel = {
  map: [
    [1,1,1,1,1,1,1,1],
    [1,5,4,2,3,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,1,1,1,1,1,1,1]
  ]
}

global.wx = {
  vibrateShort() {},
  getStorageSync() { return {} },
  setStorageSync() {}
}

let pageDefinition = null
global.Page = definition => { pageDefinition = definition }
require('../pages/game/game.js')

function makePage(practiceMode) {
  const page = Object.assign({}, pageDefinition)
  page.data = Object.assign({}, pageDefinition.data, {
    practiceMode,
    undoUnlimited: practiceMode,
    undoRemaining: 3,
    hintRemaining: 3,
    hintLoading: false,
    hintDirection: '',
    isComplete: false,
    canUndo: false,
    moves: 0,
    vibrationEnabled: false
  })
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch)
    if (callback) callback()
  }
  page.ctx = {
    setFillStyle() {}, fillRect() {}, drawImage() {}, setStrokeStyle() {},
    setLineWidth() {}, strokeRect() {}, draw() {}
  }
  page.game = engine.createGame(simpleLevel)
  return page
}

async function run() {
  const challenge = makePage(false)
  for (let count = 0; count < 3; count += 1) {
    challenge.move('right')
    challenge.undoMove()
  }
  assert.strictEqual(challenge.data.undoRemaining, 0)
  challenge.move('right')
  assert.strictEqual(challenge.data.canUndo, false)
  const movesBeforeBlockedUndo = challenge.game.moves
  challenge.undoMove()
  assert.strictEqual(challenge.game.moves, movesBeforeBlockedUndo)

  const practice = makePage(true)
  for (let count = 0; count < 4; count += 1) {
    practice.move('right')
    practice.undoMove()
  }
  assert.strictEqual(practice.data.undoRemaining, 3)

  const hints = makePage(false)
  await hints.showHint()
  await hints.showHint()
  await hints.showHint()
  assert.strictEqual(hints.data.hintRemaining, 0)
  await hints.showHint()
  assert.strictEqual(hints.data.hintRemaining, 0)
  hints.cancelHintRequest(false)

  const cancellation = makePage(false)
  cancellation.game = engine.createGame(data.levels[11])
  const pendingHint = cancellation.showHint()
  const legalDirection = ['up', 'down', 'left', 'right'].find(direction =>
    engine.simulateMove(cancellation.game, direction).moved)
  cancellation.move(legalDirection)
  await pendingHint
  assert.strictEqual(cancellation.data.hintRemaining, 3, '移动取消的提示不应扣减次数')
  assert.strictEqual(cancellation.data.hintLoading, false)

  const gesture = makePage(true)
  const gestures = []
  gesture.move = direction => gestures.push(direction)
  gesture.onTouchStart({ changedTouches: [{ clientX: 20, clientY: 80 }] })
  gesture.onTouchMove()
  gesture.onTouchEnd({ changedTouches: [{ clientX: 90, clientY: 82 }] })
  gesture.onTouchEnd({ changedTouches: [{ clientX: 130, clientY: 82 }] })
  assert.deepStrictEqual(gestures, ['right'], '一次滑动只能触发一次移动')

  console.log('game page rule tests passed')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
