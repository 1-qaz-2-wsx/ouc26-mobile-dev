Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      { pagePath: '/pages/index/index', text: '社区' },
      { pagePath: '/pages/mine/mine', text: '我的' }
    ]
  },
  methods: {
    switchTab: function (event) {
      var index = event.currentTarget.dataset.index
      var item = this.data.list[index]
      if (!item || index === this.data.selected) return
      wx.switchTab({ url: item.pagePath })
    }
  }
})
