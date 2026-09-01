const data = require('../../utils/data.js')
const storage = require('../../utils/storage.js')

const GROUP_DESCRIPTIONS = {
  经典冰原: '熟悉规则与基础推箱技巧',
  专项训练: '练习路线规划与多箱配合',
  困难试炼: '用更少步数完成最终挑战'
}

Page({
  data: {
    completedCount: 0,
    totalStars: 0,
    totalLevels: data.levels.length,
    totalPossibleStars: data.levels.length * 3,
    practiceMode: true,
    levelGroups: []
  },

  onShow() {
    this.refreshProgress(storage.readData())
  },

  refreshProgress(saved) {
    const practiceMode = saved.settings.practiceMode !== false
    const decorated = data.levels.map(item => {
      const best = Number(saved.best[item.id]) || 0
      const stars = data.getStars(best, item.parMoves)
      const unlocked = data.isLevelUnlocked(item.id, saved.best, practiceMode)
      return Object.assign({}, item, {
        best,
        stars,
        unlocked,
        locked: !unlocked,
        starsText: stars ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '尚未评级'
      })
    })

    const groupNames = ['经典冰原', '专项训练', '困难试炼']
    const levelGroups = groupNames.map((name, index) => ({
      name,
      order: String(index + 1).padStart(2, '0'),
      description: GROUP_DESCRIPTIONS[name],
      levels: decorated.filter(item => item.group === name)
    }))

    this.setData({
      practiceMode,
      levelGroups,
      completedCount: decorated.filter(item => item.best > 0).length,
      totalStars: decorated.reduce((sum, item) => sum + item.stars, 0)
    })
  },

  togglePracticeMode(e) {
    const practiceMode = Boolean(e.detail.value)
    storage.updateSettings({ practiceMode })
    this.refreshProgress(storage.readData())
    wx.showToast({
      title: practiceMode ? '练习模式已开启' : '挑战模式已开启',
      icon: 'none'
    })
  },

  chooseLevel(e) {
    const level = Number(e.currentTarget.dataset.level)
    const locked = e.currentTarget.dataset.locked === true || e.currentTarget.dataset.locked === 'true'
    if (locked) {
      wx.showToast({ title: '请先完成上一关', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '../game/game?level=' + level })
  },

  onShareAppMessage() {
    return {
      title: '冰原推箱子｜十二关脑力挑战',
      path: '/pages/index/index',
      imageUrl: '/images/level01.png'
    }
  }
})
