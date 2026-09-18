const { readConfig } = require('../src/config')
const { createJuheTrainProvider } = require('../src/planning/providers/juhe-train')

async function main() {
  const [departureStation, arrivalStation, date, confirmation] = process.argv.slice(2)
  if (!departureStation || !arrivalStation || !date || confirmation !== '--confirm-one-call') {
    console.error('用法：node scripts/query-train-once.js 出发站 到达站 YYYY-MM-DD --confirm-one-call')
    process.exitCode = 2
    return
  }
  const config = readConfig()
  if (!config.juheTrainKey || !config.juheTrainEnabled) {
    console.error(JSON.stringify({ ok: false, code: 'TRAIN_NOT_READY', message: '请先在本机配置 JUHE_TRAIN_KEY，并将 JUHE_TRAIN_ENABLED 设为 true。' }))
    process.exitCode = 2
    return
  }
  try {
    const provider = createJuheTrainProvider({ config })
    const result = await provider.search({ departureStation, arrivalStation, date })
    process.stdout.write(JSON.stringify({ ok: true, status: result.status, query: result.query, fetchedAt: result.fetchedAt || null, quotes: result.quotes, usage: result.capabilities.usage }, null, 2) + '\n')
  } catch (error) {
    const safeMessage = error && error.status ? error.message : '火车单次查询失败，请查看服务端诊断。'
    console.error(JSON.stringify({ ok: false, code: error && error.code ? error.code : 'TRAIN_QUERY_FAILED', message: safeMessage }))
    process.exitCode = 1
  }
}

main()
