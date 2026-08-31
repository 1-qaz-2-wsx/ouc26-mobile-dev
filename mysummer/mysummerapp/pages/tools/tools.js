const { budgetPlans, lodgingOptions, foodOptions } = require('../../utils/data-query')

const DEFAULTS = { planIndex: 1, lodgingIndex: 0, foodIndex: 1 }

Page({
  data: { budgetPlans, lodgingOptions, foodOptions, ...DEFAULTS, result: null },
  onLoad() { this.calculate() },
  selectPlan(event) { this.setData({ planIndex: Number(event.currentTarget.dataset.index) }, () => this.calculate()) },
  selectLodging(event) { this.setData({ lodgingIndex: Number(event.currentTarget.dataset.index) }, () => this.calculate()) },
  selectFood(event) { this.setData({ foodIndex: Number(event.currentTarget.dataset.index) }, () => this.calculate()) },
  resetBudget() {
    this.setData(DEFAULTS, () => {
      this.calculate()
      wx.showToast({ title: '已恢复默认方案', icon: 'none' })
    })
  },
  calculate() {
    const plan = budgetPlans[this.data.planIndex]
    const lodging = lodgingOptions[this.data.lodgingIndex]
    const foodDaily = foodOptions[this.data.foodIndex]
    // 基础总额不包含应急预算，应急预算单独按 15% 计算。
    const accommodation = lodging.pricePerNight * plan.nights
    const food = foodDaily * plan.days
    const baseTotal = plan.transportCost + accommodation + food + plan.ticketCost + plan.otherCost
    const emergency = Math.round(baseTotal * 0.15)
    this.setData({ result: { plan, lodging, foodDaily, transport: plan.transportCost, accommodation, food, ticket: plan.ticketCost, other: plan.otherCost, baseTotal, emergency, recommendedTotal: baseTotal + emergency } })
  }
})
