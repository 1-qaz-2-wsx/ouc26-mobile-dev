const assert = require('assert')
const engine = require('../utils/game-engine.js')
const hintEngine = require('../utils/hint-engine.js')
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

async function run() {
  const state = engine.createGame(simpleLevel)
  const before = JSON.stringify(state)

  const exact = await hintEngine.findHint(state, { timeoutMs: 500, maxStates: 1000, batchSize: 20 })
  assert.strictEqual(exact.direction, 'right')
  assert.strictEqual(exact.source, 'bfs')
  assert.strictEqual(JSON.stringify(state), before, '提示搜索不应修改当前游戏状态')

  const fallback = await hintEngine.findHint(state, { timeoutMs: 500, maxStates: 1, batchSize: 1 })
  assert.strictEqual(fallback.direction, 'right')
  assert.strictEqual(fallback.source, 'heuristic')
  const fallbackMove = engine.simulateMove(state, fallback.direction)
  assert.strictEqual(fallbackMove.moved, true)
  assert.strictEqual(fallbackMove.deadlocked, false)

  const cancelled = await hintEngine.findHint(state, { isCancelled: () => true })
  assert.strictEqual(cancelled.cancelled, true)
  assert.strictEqual(cancelled.direction, '')

  for (const level of data.levels) {
    const levelState = engine.createGame(level)
    const safe = await hintEngine.findHint(levelState, { maxStates: 1, timeoutMs: 500 })
    assert.ok(safe.direction, `关卡 ${level.number} 应能给出降级提示`)
    const next = engine.simulateMove(levelState, safe.direction)
    assert.strictEqual(next.moved, true, `关卡 ${level.number} 的提示必须可执行`)
    assert.strictEqual(next.deadlocked, false, `关卡 ${level.number} 的提示不能立即造成墙角死锁`)
  }

  console.log('hint-engine tests passed')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
