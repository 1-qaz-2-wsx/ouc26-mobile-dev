const engine = require('./game-engine.js')

const DIRECTIONS = ['up', 'down', 'left', 'right']
const DELTAS = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 }
}
const DEFAULT_OPTIONS = {
  batchSize: 250,
  maxStates: 50000,
  timeoutMs: 1200,
  isCancelled: () => false
}

function toIndex(row, col) {
  return row * engine.BOARD_SIZE + col
}

function toCompact(state) {
  const boxes = []
  const walkable = []
  const targets = []
  for (let row = 0; row < engine.BOARD_SIZE; row += 1) {
    for (let col = 0; col < engine.BOARD_SIZE; col += 1) {
      const index = toIndex(row, col)
      const tile = state.map[row][col]
      walkable[index] = tile !== 0 && tile !== 1
      if (tile === 3) targets.push(index)
      if (state.boxes[row][col]) boxes.push(index)
    }
  }
  return {
    player: toIndex(state.player.row, state.player.col),
    boxes: boxes.sort((a, b) => a - b),
    walkable,
    targets,
    targetSet: new Set(targets)
  }
}

function stateKey(player, boxes) {
  return `${player}|${boxes.join(',')}`
}

function step(index, direction) {
  const delta = DELTAS[direction]
  const row = Math.floor(index / engine.BOARD_SIZE)
  const col = index % engine.BOARD_SIZE
  const nextRow = row + delta.row
  const nextCol = col + delta.col
  if (nextRow < 0 || nextRow >= engine.BOARD_SIZE || nextCol < 0 || nextCol >= engine.BOARD_SIZE) return -1
  return toIndex(nextRow, nextCol)
}

function isWin(boxes, targetSet) {
  return boxes.length > 0 && boxes.every(box => targetSet.has(box))
}

function isDeadlocked(boxes, board) {
  const boxSet = new Set(boxes)
  const blocked = index => index < 0 || !board.walkable[index]
  for (const box of boxSet) {
    if (board.targetSet.has(box)) continue
    const verticalWall = blocked(step(box, 'up')) || blocked(step(box, 'down'))
    const horizontalWall = blocked(step(box, 'left')) || blocked(step(box, 'right'))
    if (verticalWall && horizontalWall) return true
  }
  return false
}

function transition(node, direction, board) {
  const nextPlayer = step(node.player, direction)
  if (nextPlayer < 0 || !board.walkable[nextPlayer]) return null
  const boxIndex = node.boxes.indexOf(nextPlayer)
  if (boxIndex < 0) return { player: nextPlayer, boxes: node.boxes, pushed: false }

  const boxDestination = step(nextPlayer, direction)
  if (boxDestination < 0 || !board.walkable[boxDestination] || node.boxes.includes(boxDestination)) return null
  const boxes = node.boxes.slice()
  boxes[boxIndex] = boxDestination
  boxes.sort((a, b) => a - b)
  if (isDeadlocked(boxes, board)) return null
  return { player: nextPlayer, boxes, pushed: true }
}

function minimumMatchingDistance(boxes, targets) {
  let best = Infinity
  const used = new Array(targets.length).fill(false)
  function visit(boxIndex, score) {
    if (score >= best) return
    if (boxIndex === boxes.length) {
      best = score
      return
    }
    const boxRow = Math.floor(boxes[boxIndex] / engine.BOARD_SIZE)
    const boxCol = boxes[boxIndex] % engine.BOARD_SIZE
    targets.forEach((target, targetIndex) => {
      if (used[targetIndex]) return
      const targetRow = Math.floor(target / engine.BOARD_SIZE)
      const targetCol = target % engine.BOARD_SIZE
      used[targetIndex] = true
      visit(boxIndex + 1, score + Math.abs(boxRow - targetRow) + Math.abs(boxCol - targetCol))
      used[targetIndex] = false
    })
  }
  visit(0, 0)
  return best
}

function findReachablePlayerCells(initial, board) {
  const boxSet = new Set(initial.boxes)
  const queue = [{ index: initial.player, firstDirection: '', distance: 0 }]
  const reachable = new Map([[initial.player, queue[0]]])
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    DIRECTIONS.forEach(direction => {
      const next = step(current.index, direction)
      if (next < 0 || !board.walkable[next] || boxSet.has(next) || reachable.has(next)) return
      const entry = {
        index: next,
        firstDirection: current.firstDirection || direction,
        distance: current.distance + 1
      }
      reachable.set(next, entry)
      queue.push(entry)
    })
  }
  return reachable
}

function findHeuristicHint(initial, board) {
  const reachable = findReachablePlayerCells(initial, board)
  let best = null
  initial.boxes.forEach((box, boxIndex) => {
    DIRECTIONS.forEach(direction => {
      const destination = step(box, direction)
      const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }[direction]
      const stand = step(box, opposite)
      const route = reachable.get(stand)
      if (!route || destination < 0 || !board.walkable[destination] || initial.boxes.includes(destination)) return

      const boxes = initial.boxes.slice()
      boxes[boxIndex] = destination
      boxes.sort((a, b) => a - b)
      if (isDeadlocked(boxes, board)) return

      const onTarget = boxes.filter(item => board.targetSet.has(item)).length
      const movedOffTarget = board.targetSet.has(box) && !board.targetSet.has(destination)
      const score = minimumMatchingDistance(boxes, board.targets) * 10 - onTarget * 25 +
        (movedOffTarget ? 35 : 0) + route.distance
      const firstDirection = route.firstDirection || direction
      if (!best || score < best.score) best = { direction: firstDirection, score }
    })
  })

  if (best) return best.direction
  for (const direction of DIRECTIONS) {
    if (transition(initial, direction, board)) return direction
  }
  return ''
}

function findHint(state, customOptions) {
  const options = Object.assign({}, DEFAULT_OPTIONS, customOptions || {})
  const board = toCompact(state)
  const initial = { player: board.player, boxes: board.boxes, firstDirection: '' }
  const queue = [initial]
  let queueCursor = 0
  const visited = new Set([stateKey(initial.player, initial.boxes)])
  const startedAt = Date.now()

  return new Promise(resolve => {
    function finishWithFallback(reason) {
      if (options.isCancelled()) {
        resolve({ direction: '', source: '', cancelled: true, reason: 'cancelled', explored: visited.size })
        return
      }
      const direction = findHeuristicHint(initial, board)
      resolve({
        direction,
        source: direction ? 'heuristic' : '',
        cancelled: false,
        reason: direction ? reason : 'no-safe-move',
        explored: visited.size
      })
    }

    function runBatch() {
      if (options.isCancelled()) {
        finishWithFallback('cancelled')
        return
      }
      if (Date.now() - startedAt >= options.timeoutMs || visited.size >= options.maxStates) {
        finishWithFallback('limit')
        return
      }

      let processed = 0
      while (processed < options.batchSize && queueCursor < queue.length) {
        const node = queue[queueCursor]
        queueCursor += 1
        for (const direction of DIRECTIONS) {
          const next = transition(node, direction, board)
          if (!next) continue
          const firstDirection = node.firstDirection || direction
          if (isWin(next.boxes, board.targetSet)) {
            resolve({ direction: firstDirection, source: 'bfs', cancelled: false, reason: '', explored: visited.size })
            return
          }
          const key = stateKey(next.player, next.boxes)
          if (visited.has(key)) continue
          visited.add(key)
          queue.push({ player: next.player, boxes: next.boxes, firstDirection })
        }
        processed += 1
      }

      if (queueCursor >= queue.length) {
        finishWithFallback('unsolved')
        return
      }
      setTimeout(runBatch, 0)
    }

    if (isWin(initial.boxes, board.targetSet)) {
      resolve({ direction: '', source: '', cancelled: false, reason: 'already-complete', explored: 1 })
      return
    }
    runBatch()
  })
}

module.exports = { findHint, findHeuristicHint, stateKey }
