const { createJuheTrainProvider } = require('./providers/juhe-train')
const { createUnavailableProvider } = require('./providers/unavailable')

function createPlanningProviders({ config = {}, fetchImpl, clock } = {}) {
  const train = createJuheTrainProvider({ config, fetchImpl, clock })
  const flight = createUnavailableProvider({
    id: 'juhe-flight-818',
    name: '聚合数据·航班查询 818',
    kind: 'transport',
    productId: '818',
    environment: config.juheFlightEnvironment || 'test',
    configured: Boolean(config.juheFlightKey),
    enabled: false,
    status: 'disabled',
    dailyLimit: Number.isInteger(config.juheFlightDailyLimit) ? config.juheFlightDailyLimit : 3,
    reason: '航班接口暂不调用：当前仅保留少量免费次数，等待单独授权后再启用'
  })
  const hotel = createUnavailableProvider({
    id: 'hotel-provider',
    name: '酒店实时房价与库存',
    kind: 'lodging',
    environment: 'not_configured',
    reason: '酒店 API 需要先完成合作邮件和资格确认；当前只能展示酒店地点缺口，不能声称有房/有价'
  })
  return { train, flight, hotel, all: () => [train, flight, hotel] }
}

module.exports = { createPlanningProviders }
