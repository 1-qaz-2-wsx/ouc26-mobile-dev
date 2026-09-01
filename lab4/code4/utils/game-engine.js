const BOARD_SIZE = 8
const HISTORY_LIMIT = 50
const DIRECTIONS = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 }
}

function cloneGrid(grid) {
  return grid.map(row => row.slice())
}

function getLevelMap(levelData) {
  return Array.isArray(levelData) ? levelData : levelData && levelData.map
}

function validateLevel(levelData) {
  const source = getLevelMap(levelData)
  const errors = []
  if (!Array.isArray(source) || source.length !== BOARD_SIZE) {
    return { valid: false, errors: ['地图必须为 8×8 二维数组'] }
  }

  let players = 0
  let boxes = 0
  let targets = 0
  source.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== BOARD_SIZE) {
      errors.push(`第 ${rowIndex + 1} 行必须包含 8 个格子`)
      return
    }
    row.forEach(cell => {
      if (![0, 1, 2, 3, 4, 5].includes(cell)) errors.push(`发现不支持的格子值：${cell}`)
      if (cell === 5) players += 1
      if (cell === 4) boxes += 1
      if (cell === 3) targets += 1
    })
  })
  if (players !== 1) errors.push(`玩家数量必须为 1，当前为 ${players}`)
  if (boxes !== targets) errors.push(`箱子数（${boxes}）与目标数（${targets}）必须相同`)
  if (boxes === 0) errors.push('关卡至少需要一个箱子和目标点')
  return { valid: errors.length === 0, errors }
}

function createGame(levelData) {
  const source = getLevelMap(levelData)
  const validation = validateLevel(source)
  if (!validation.valid) throw new Error(validation.errors.join('；'))

  const map = source.map(row => row.map(cell => (cell === 4 || cell === 5) ? 2 : cell))
  const boxes = source.map(row => row.map(cell => cell === 4 ? 1 : 0))
  let player = null
  source.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
    if (cell === 5) player = { row: rowIndex, col: colIndex }
  }))
  return { map, boxes, player, moves: 0, history: [] }
}

function isWalkable(state, row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE &&
    state.map[row][col] !== 0 && state.map[row][col] !== 1
}

function snapshot(state) {
  return {
    player: { row: state.player.row, col: state.player.col },
    boxes: cloneGrid(state.boxes),
    moves: state.moves
  }
}

function isWin(state) {
  let boxCount = 0
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (state.boxes[row][col]) {
        boxCount += 1
        if (state.map[row][col] !== 3) return false
      }
    }
  }
  return boxCount > 0
}

function findDeadlockedBox(state) {
  if (isWin(state)) return null
  const blocked = (row, col) => !isWalkable(state, row, col)
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (!state.boxes[row][col] || state.map[row][col] === 3) continue
      const verticalWall = blocked(row - 1, col) || blocked(row + 1, col)
      const horizontalWall = blocked(row, col - 1) || blocked(row, col + 1)
      if (verticalWall && horizontalWall) return { row, col }
    }
  }
  return null
}

function isDeadlocked(state) {
  return Boolean(findDeadlockedBox(state))
}

function transition(state, direction, recordHistory) {
  const delta = DIRECTIONS[direction]
  if (!delta) return { state, moved: false, pushed: false, reason: 'unknown-direction', deadlocked: false }

  const nextRow = state.player.row + delta.row
  const nextCol = state.player.col + delta.col
  if (!isWalkable(state, nextRow, nextCol)) {
    return { state, moved: false, pushed: false, reason: 'wall', deadlocked: false }
  }

  let pushed = false
  const boxes = cloneGrid(state.boxes)
  if (boxes[nextRow][nextCol]) {
    const boxRow = nextRow + delta.row
    const boxCol = nextCol + delta.col
    if (!isWalkable(state, boxRow, boxCol) || boxes[boxRow][boxCol]) {
      return { state, moved: false, pushed: false, reason: 'box-blocked', deadlocked: false }
    }
    boxes[boxRow][boxCol] = 1
    boxes[nextRow][nextCol] = 0
    pushed = true
  }

  const history = recordHistory
    ? state.history.concat([snapshot(state)]).slice(-HISTORY_LIMIT)
    : state.history
  const nextState = {
    map: state.map,
    boxes,
    player: { row: nextRow, col: nextCol },
    moves: state.moves + 1,
    history
  }
  return {
    state: nextState,
    moved: true,
    pushed,
    reason: '',
    deadlocked: isDeadlocked(nextState)
  }
}

function move(state, direction) {
  return transition(state, direction, true)
}

function simulateMove(state, direction) {
  return transition(state, direction, false)
}

function undo(state) {
  if (!state.history.length) return { state, undone: false }
  const previous = state.history[state.history.length - 1]
  return {
    state: {
      map: state.map,
      boxes: cloneGrid(previous.boxes),
      player: { row: previous.player.row, col: previous.player.col },
      moves: previous.moves,
      history: state.history.slice(0, -1)
    },
    undone: true
  }
}

module.exports = {
  BOARD_SIZE,
  HISTORY_LIMIT,
  createGame,
  move,
  simulateMove,
  undo,
  isWin,
  isDeadlocked,
  findDeadlockedBox,
  validateLevel
}
