const common = require('../../utils/common.js')
const store = require('../../utils/store.js')

Page({
  data: {
    swiperImg: [
      { src: '/images/newsimage1.jpg', title: '向海图强，逐梦深蓝' },
      { src: '/images/newsimage2.jpg', title: '海纳百川，取则行远' },
      { src: '/images/newsimage3.jpg', title: '青春海大，扬帆起航' }
    ],
    categories: ['全部', '海大要闻', '综合新闻', '校园动态'],
    activeCategory: '全部',
    keyword: '',
    allNews: [],
    newsList: [],
    activeNews: null,
    showActions: false,
    isDark: false
  },

  onLoad() { this.reloadData() },
  onShow() { this.reloadData() },
  onPullDownRefresh() {
    this.reloadData()
    wx.stopPullDownRefresh()
    wx.showToast({ title: '已刷新', icon: 'success' })
  },

  reloadData() {
    const favoriteIds = store.getSession() ? store.getFavoriteIds() : []
    const readIds = store.getHistory().map(item => item.id)
    const allNews = common.getNewsList().map(item => Object.assign({}, item, {
      isFavorite: favoriteIds.includes(item.id),
      isRead: readIds.includes(item.id)
    }))
    this.setData({ allNews, isDark: store.applyAppearance(store.getSettings()) })
    this.applyFilters()
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilters()
  },
  clearSearch() {
    this.setData({ keyword: '' })
    this.applyFilters()
  },
  selectCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.category })
    this.applyFilters()
  },
  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase()
    const category = this.data.activeCategory
    const list = this.data.allNews.filter(item => {
      const categoryMatched = category === '全部' || item.category === category
      const text = `${item.title}${item.summary}`.toLowerCase()
      return categoryMatched && (!keyword || text.includes(keyword))
    })
    this.setData({ newsList: list })
  },

  goToDetail(e) {
    wx.navigateTo({ url: '../detail/detail?id=' + e.currentTarget.dataset.id })
  },
  toggleFavorite(e) {
    if (!store.requireLogin()) return
    const id = e.currentTarget.dataset.id
    const added = store.toggleFavorite(id)
    wx.showToast({ title: added ? '已收藏' : '已取消收藏', icon: 'none' })
    this.reloadData()
  },
  openActions(e) {
    const result = common.getNewsDetail(e.currentTarget.dataset.id)
    this.setData({ activeNews: Object.assign({}, result.news, { isFavorite: store.isFavorite(result.news.id) }), showActions: true })
  },
  closeActions() { this.setData({ showActions: false }) },
  toggleActiveFavorite() {
    this.toggleFavorite({ currentTarget: { dataset: { id: this.data.activeNews.id } } })
    this.closeActions()
  },
  toggleRead() {
    const isRead = store.getHistory().some(item => item.id === this.data.activeNews.id)
    store.setReadState(this.data.activeNews.id, !isRead)
    wx.showToast({ title: isRead ? '已标记未读' : '已标记已读', icon: 'none' })
    this.closeActions()
    this.reloadData()
  },
  onShareAppMessage(e) {
    const id = e.target && e.target.dataset.id
    const result = common.getNewsDetail(id)
    const article = result.news || this.data.activeNews || {}
    return {
      title: article.title || '海大新闻网',
      path: '/pages/detail/detail?id=' + article.id,
      imageUrl: article.poster || '/images/newsimage1.jpg'
    }
  }
})
