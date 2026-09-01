const assert = require('assert')
const engine = require('../utils/game-engine.js')
const data = require('../utils/data.js')

data.levels.forEach(level => {
  const result = engine.validateLevel(level)
  assert.strictEqual(result.valid, true, `关卡 ${level.id + 1} 校验失败：${result.errors.join('；')}`)
})

assert.strictEqual(data.levels.length, 12)
assert.strictEqual(data.isLevelUnlocked(0, {}, false), true)
assert.strictEqual(data.isLevelUnlocked(1, {}, false), false)
assert.strictEqual(data.isLevelUnlocked(1, { 0: 20 }, false), true)
assert.strictEqual(data.isLevelUnlocked(11, {}, true), true)

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

let state = engine.createGame(simpleLevel)
const blocked = engine.move(state, 'up')
assert.strictEqual(blocked.moved, false)
assert.strictEqual(blocked.state.moves, 0)

const pushed = engine.move(state, 'right')
assert.strictEqual(pushed.moved, true)
assert.strictEqual(pushed.pushed, true)
assert.strictEqual(pushed.state.moves, 1)
assert.strictEqual(pushed.state.boxes[1][3], 1)

const simulated = engine.simulateMove(state, 'right')
assert.strictEqual(simulated.moved, true)
assert.strictEqual(simulated.state.history.length, 0)
assert.strictEqual(state.history.length, 0)

const undone = engine.undo(pushed.state)
assert.strictEqual(undone.undone, true)
assert.deepStrictEqual(undone.state.player, { row: 1, col: 1 })
assert.strictEqual(undone.state.boxes[1][2], 1)
assert.strictEqual(undone.state.moves, 0)
assert.strictEqual(pushed.state.moves, 1, '撤销不应修改原状态')

let winState = pushed.state
winState = engine.move(winState, 'right').state
assert.strictEqual(engine.isWin(winState), true)

const cornerLevel = {
  map: [
    [1,1,1,1,1,1,1,1],
    [1,2,2,2,2,2,3,1],
    [1,4,2,2,2,2,2,1],
    [1,5,2,2,2,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,1,1,1,1,1,1,1]
  ]
}
const cornerMove = engine.move(engine.createGame(cornerLevel), 'up')
assert.strictEqual(cornerMove.deadlocked, true)
const cornerState = cornerMove.state
assert.strictEqual(engine.isDeadlocked(cornerState), true)

let historyState = engine.createGame(simpleLevel)
for (let index = 0; index < 60; index += 1) {
  const direction = index % 2 === 0 ? 'down' : 'up'
  historyState = engine.move(historyState, direction).state
}
assert.strictEqual(historyState.history.length, engine.HISTORY_LIMIT)

const invalidLevel = simpleLevel.map.map(row => row.slice())
invalidLevel[1][1] = 2
assert.strictEqual(engine.validateLevel(invalidLevel).valid, false)

console.log('game-engine tests passed')
