const assert = require('assert')
const engine = require('../utils/game-engine.js')
const data = require('../utils/data.js')

const DIRECTIONS = ['up', 'down', 'left', 'right']
const MAX_STATES = 600000

function stateKey(state) {
  const boxes = []
  for (let row = 0; row < engine.BOARD_SIZE; row += 1) {
    for (let col = 0; col < engine.BOARD_SIZE; col += 1) {
      if (state.boxes[row][col]) boxes.push(row * engine.BOARD_SIZE + col)
    }
  }
  return `${state.player.row},${state.player.col}|${boxes.join(',')}`
}

function solve(level) {
  const initial = engine.createGame(level)
  initial.history = []
  const queue = [initial]
  const visited = new Set([stateKey(initial)])

  for (let cursor = 0; cursor < queue.length && visited.size <= MAX_STATES; cursor += 1) {
    const state = queue[cursor]
    if (engine.isWin(state)) return state.moves
    for (const direction of DIRECTIONS) {
      const result = engine.move(state, direction)
      if (!result.moved || result.deadlocked) continue
      result.state.history = []
      const key = stateKey(result.state)
      if (visited.has(key)) continue
      visited.add(key)
      queue.push(result.state)
    }
  }
  return 0
}

const solutions = data.levels.map(level => {
  const moves = solve(level)
  assert.ok(moves > 0, `关卡 ${level.number} ${level.name} 在 ${MAX_STATES} 个状态内未找到解`)
  assert.ok(moves <= level.parMoves, `关卡 ${level.number} 的推荐步数 ${level.parMoves} 低于最少步数 ${moves}`)
  return `${level.number}:${moves}`
})

console.log(`level solvability passed (${solutions.join(', ')})`)
