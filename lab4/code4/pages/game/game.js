const data = require('../../utils/data.js')
const engine = require('../../utils/game-engine.js')
const hintEngine = require('../../utils/hint-engine.js')
const storage = require('../../utils/storage.js')

const ICON_ROOT = '/images/icons/'
const DIRECTION_LABELS = { up: '上', down: '下', left: '左', right: '右' }
const CHALLENGE_UNDO_LIMIT = 3
const HINT_LIMIT = 3

Page({
  data: {
    levelIndex: 0,
    levelText: '01',
    levelName: data.levels[0].name,
    parMoves: data.levels[0].parMoves,
    canvasSize: 320,
    moves: 0,
    bestMoves: 0,
    isComplete: false,
    canUndo: false,
    practiceMode: true,
    undoRemaining: CHALLENGE_UNDO_LIMIT,
    undoUnlimited: true,
    hintRemaining: HINT_LIMIT,
    hintLoading: false,
    hintDirection: '',
    statusText: '可使用方向键，也可以在棋盘上滑动',
    statusTone: 'normal',
    invalidDirection: '',
    vibrationEnabled: true
  },

  onLoad(options) {
    const rawLevel = Number(options.level)
    const levelIndex = Number.isInteger(rawLevel) && rawLevel >= 0 && rawLevel < data.levels.length ? rawLevel : 0
    const level = data.levels[levelIndex]
    const info = this.getWindowInfo()
    const canvasSize = Math.min(Math.floor(info.windowWidth - 48), 360)
    const saved = storage.readData()
    const practiceMode = saved.settings.practiceMode !== false
    if (!data.isLevelUnlocked(levelIndex, saved.best, practiceMode)) {
      wx.showModal({
        title: '关卡尚未解锁',
        content: '挑战模式下需要先完成上一关。',
        showCancel: false,
        success: () => {
          if (getCurrentPages().length > 1) wx.navigateBack()
          else wx.reLaunch({ url: '/pages/index/index' })
        }
      })
      return
    }
    this.setData({
      levelIndex,
      levelText: level.number,
      levelName: level.name,
      parMoves: level.parMoves,
      canvasSize,
      bestMoves: Number(saved.best[levelIndex]) || 0,
      practiceMode,
      vibrationEnabled: saved.settings.vibration !== false
    }, () => {
      this.ctx = wx.createCanvasContext('gameCanvas', this)
      this.initLevel(levelIndex)
      this.drawBoard()
    })
  },

  onUnload() {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer)
    this.cancelHintRequest(false)
  },

  getWindowInfo() {
    if (wx.getWindowInfo) return wx.getWindowInfo()
    return wx.getSystemInfoSync()
  },

  initLevel(levelIndex) {
    try {
      this.cancelHintRequest(false)
      this.game = engine.createGame(data.levels[levelIndex])
      this.setData({
        moves: 0,
        isComplete: false,
        canUndo: false,
        undoRemaining: CHALLENGE_UNDO_LIMIT,
        undoUnlimited: this.data.practiceMode,
        hintRemaining: HINT_LIMIT,
        hintLoading: false,
        hintDirection: '',
        statusText: '可使用方向键，也可以在棋盘上滑动',
        statusTone: 'normal',
        invalidDirection: ''
      })
    } catch (error) {
      wx.showModal({ title: '关卡数据错误', content: error.message, showCancel: false })
    }
  },

  drawBoard() {
    if (!this.ctx || !this.game || !this.game.player) return
    const ctx = this.ctx
    const cell = this.data.canvasSize / engine.BOARD_SIZE
    ctx.setFillStyle('#cfe8ec')
    ctx.fillRect(0, 0, this.data.canvasSize, this.data.canvasSize)

    for (let row = 0; row < engine.BOARD_SIZE; row += 1) {
      for (let col = 0; col < engine.BOARD_SIZE; col += 1) {
        const tile = this.game.map[row][col]
        if (tile === 0) {
          ctx.setFillStyle('#b8d7dd')
          ctx.fillRect(col * cell, row * cell, cell, cell)
          continue
        }
        const icon = tile === 1 ? 'stone.png' : tile === 3 ? 'pig.png' : 'ice.png'
        ctx.drawImage(ICON_ROOT + icon, col * cell, row * cell, cell, cell)
        if (this.game.boxes[row][col]) {
          ctx.drawImage(ICON_ROOT + 'box.png', col * cell, row * cell, cell, cell)
          if (tile === 3) {
            ctx.setStrokeStyle('#ffd66b')
            ctx.setLineWidth(Math.max(2, cell * 0.08))
            ctx.strokeRect(col * cell + 3, row * cell + 3, cell - 6, cell - 6)
          }
        }
      }
    }
    ctx.drawImage(ICON_ROOT + 'bird.png', this.game.player.col * cell, this.game.player.row * cell, cell, cell)
    ctx.draw()
  },

  move(direction) {
    if (this.data.isComplete || !this.game) return
    this.cancelHintRequest()
    const result = engine.move(this.game, direction)
    if (!result.moved) {
      this.showInvalidMove(direction, result.reason)
      return
    }

    this.game = result.state
    const update = {
      moves: this.game.moves,
      canUndo: this.game.history.length > 0 && (this.data.undoUnlimited || this.data.undoRemaining > 0),
      invalidDirection: '',
      hintDirection: '',
      statusText: result.deadlocked ? '箱子进入非目标死角，请撤销或重新开始' : (result.pushed ? '推动成功，继续规划路线' : '移动成功'),
      statusTone: result.deadlocked ? 'warning' : 'normal'
    }
    this.setData(update)
    this.drawBoard()
    if (result.pushed) this.vibrate(result.deadlocked ? 'medium' : 'light')
    if (engine.isWin(this.game)) this.completeLevel()
  },

  showInvalidMove(direction, reason) {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer)
    const message = reason === 'box-blocked' ? '箱子后方被挡住，换一条路线试试' : '这个方向无法移动'
    this.setData({ invalidDirection: direction, statusText: message, statusTone: 'error' })
    this.vibrate('light')
    this.feedbackTimer = setTimeout(() => {
      const deadlocked = this.game && engine.isDeadlocked(this.game)
      this.setData({
        invalidDirection: '',
        statusText: deadlocked ? '箱子仍在非目标死角，请撤销或重新开始' : '可撤销误操作，或使用方向提示',
        statusTone: deadlocked ? 'warning' : 'normal'
      })
    }, 700)
  },

  vibrate(type) {
    if (!this.data.vibrationEnabled || !wx.vibrateShort) return
    wx.vibrateShort({ type })
  },

  up() { this.move('up') },
  down() { this.move('down') },
  left() { this.move('left') },
  right() { this.move('right') },

  undoMove() {
    if (this.data.isComplete || !this.game) return
    if (!this.data.undoUnlimited && this.data.undoRemaining <= 0) return
    this.cancelHintRequest()
    const result = engine.undo(this.game)
    if (!result.undone) return
    this.game = result.state
    const deadlocked = engine.isDeadlocked(this.game)
    const undoRemaining = this.data.undoUnlimited ? this.data.undoRemaining : this.data.undoRemaining - 1
    this.setData({
      moves: this.game.moves,
      undoRemaining,
      canUndo: this.game.history.length > 0 && (this.data.undoUnlimited || undoRemaining > 0),
      statusText: deadlocked
        ? '已撤销一步，但仍有箱子位于死角'
        : (this.data.undoUnlimited ? '已撤销上一步' : `已撤销上一步，剩余 ${undoRemaining} 次`),
      statusTone: deadlocked ? 'warning' : 'normal',
      invalidDirection: '',
      hintDirection: ''
    })
    this.drawBoard()
  },

  async showHint() {
    if (!this.game || this.data.isComplete || this.data.hintLoading || this.data.hintRemaining <= 0) return
    const requestId = (this.hintRequestId || 0) + 1
    this.hintRequestId = requestId
    this.setData({
      hintLoading: true,
      hintDirection: '',
      statusText: '正在分析安全通关路线…',
      statusTone: 'hint'
    })

    try {
      const result = await hintEngine.findHint(this.game, {
        isCancelled: () => requestId !== this.hintRequestId
      })
      if (requestId !== this.hintRequestId || result.cancelled) return
      if (!result.direction) {
        this.setData({
          hintLoading: false,
          statusText: '当前局面未找到安全提示，请撤销或重新开始',
          statusTone: 'warning'
        })
        return
      }

      const hintRemaining = this.data.hintRemaining - 1
      const sourceText = result.source === 'bfs' ? '路径搜索' : '安全策略'
      this.setData({
        hintLoading: false,
        hintRemaining,
        hintDirection: result.direction,
        statusText: `建议向${DIRECTION_LABELS[result.direction]}（${sourceText}），剩余 ${hintRemaining} 次`,
        statusTone: 'hint'
      })
      if (this.hintHighlightTimer) clearTimeout(this.hintHighlightTimer)
      this.hintHighlightTimer = setTimeout(() => {
        if (requestId === this.hintRequestId) this.setData({ hintDirection: '' })
      }, 1500)
    } catch (error) {
      if (requestId !== this.hintRequestId) return
      this.setData({
        hintLoading: false,
        statusText: '提示计算失败，请稍后重试',
        statusTone: 'error'
      })
    }
  },

  cancelHintRequest(updateData = true) {
    this.hintRequestId = (this.hintRequestId || 0) + 1
    if (this.hintHighlightTimer) {
      clearTimeout(this.hintHighlightTimer)
      this.hintHighlightTimer = null
    }
    if (updateData) this.setData({ hintLoading: false, hintDirection: '' })
  },

  completeLevel() {
    if (this.data.isComplete) return
    this.cancelHintRequest()
    const level = data.levels[this.data.levelIndex]
    const result = storage.saveBest(this.data.levelIndex, this.game.moves)
    const stars = data.getStars(this.game.moves, level.parMoves)
    const starsText = '★'.repeat(stars) + '☆'.repeat(3 - stars)
    this.setData({
      isComplete: true,
      bestMoves: result.best,
      statusText: `挑战完成 · ${starsText}`,
      statusTone: 'success'
    })
    this.vibrate('heavy')

    const hasNext = this.data.levelIndex < data.levels.length - 1
    wx.showModal({
      title: result.isNewBest ? '刷新最佳记录！' : '挑战成功！',
      content: `本关 ${this.game.moves} 步，获得 ${starsText}\n推荐步数：${level.parMoves}，最佳记录：${result.best}`, 
      confirmText: hasNext ? '下一关' : '关卡列表',
      cancelText: '再玩一次',
      success: res => {
        if (res.confirm) {
          if (hasNext) wx.redirectTo({ url: '../game/game?level=' + (this.data.levelIndex + 1) })
          else wx.navigateBack()
        } else {
          this.restartGame()
        }
      }
    })
  },

  restartGame() {
    this.initLevel(this.data.levelIndex)
    this.drawBoard()
  },

  toggleVibration(e) {
    const enabled = Boolean(e.detail.value)
    storage.updateSettings({ vibration: enabled })
    this.setData({ vibrationEnabled: enabled })
  },

  backToLevels() {
    wx.navigateBack()
  },

  onTouchStart(e) {
    const touch = e.changedTouches && e.changedTouches[0]
    if (touch) {
      this.touchStart = { x: touch.clientX, y: touch.clientY }
      this.touchHandled = false
    }
  },

  onTouchMove() {},

  onTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0]
    if (!touch || !this.touchStart || this.touchHandled) return
    const deltaX = touch.clientX - this.touchStart.x
    const deltaY = touch.clientY - this.touchStart.y
    this.touchStart = null
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 28) return
    this.touchHandled = true
    if (Math.abs(deltaX) > Math.abs(deltaY)) this.move(deltaX > 0 ? 'right' : 'left')
    else this.move(deltaY > 0 ? 'down' : 'up')
  },

  onTouchCancel() {
    this.touchStart = null
    this.touchHandled = false
  },

  onShareAppMessage() {
    return {
      title: `冰原推箱子｜第 ${this.data.levelIndex + 1} 关`,
      path: '/pages/game/game?level=' + this.data.levelIndex,
      imageUrl: data.levels[this.data.levelIndex].image
    }
  }
})
