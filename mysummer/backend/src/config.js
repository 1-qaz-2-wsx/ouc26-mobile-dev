const fs = require('node:fs')
const path = require('node:path')

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match || Object.hasOwn(process.env, match[1])) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

function integerEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function providerEnv(name) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return ''
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function booleanEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  throw new Error(`${name} must be a boolean`)
}

function readConfig(options = {}) {
  if (options.loadEnvFile !== false) {
    loadDotEnv(options.envFile || path.join(__dirname, '..', '.env'))
  }
  return {
    tencentMapKey: providerEnv('TENCENT_MAP_KEY'),
    tencentMapSk: providerEnv('TENCENT_MAP_SK'),
    wechatAppId: providerEnv('WECHAT_APP_ID'),
    sessionSecret: process.env.SESSION_SECRET || '',
    cloudbaseEnv: process.env.CLOUDBASE_ENV_ID || 'cloud1-d3g8eu6faa3e4bee6',
    cloudbaseApiKey: process.env.CLOUDBASE_APIKEY || '',
    host: process.env.HOST || '127.0.0.1',
    port: integerEnv('PORT', 8787, 1, 65535),
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    planningDraftEnabled: booleanEnv('PLANNING_DRAFT_ENABLED', false),
    planningMapSessionLimit: integerEnv('PLANNING_MAP_SESSION_LIMIT', 0, 0, 20),
    planningTrainSessionLimit: integerEnv('PLANNING_TRAIN_SESSION_LIMIT', 0, 0, 2),
    planningBudgetScope: providerEnv('PLANNING_BUDGET_SCOPE'),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions',
    timeoutMs: integerEnv('ASSIST_TIMEOUT_MS', 15000, 100, 60000),
    maxConcurrency: integerEnv('ASSIST_MAX_CONCURRENCY', 2, 1, 10),
    maxUpstreamCalls: integerEnv('ASSIST_MAX_UPSTREAM_CALLS', 20, 1, 100),
    maxOutputTokens: integerEnv('ASSIST_MAX_OUTPUT_TOKENS', 800, 64, 2000),
    juheTrainKey: providerEnv('JUHE_TRAIN_KEY'),
    juheTrainEnabled: booleanEnv('JUHE_TRAIN_ENABLED', false),
    juheTrainEnvironment: providerEnv('JUHE_TRAIN_ENVIRONMENT') || 'test',
    juheTrainQueryUrl: providerEnv('JUHE_TRAIN_QUERY_URL') || 'https://apis.juhe.cn/fapigw/train/query',
    juheTrainDailyLimit: integerEnv('JUHE_TRAIN_DAILY_LIMIT', 10, 0, 100),
    juheFlightKey: providerEnv('JUHE_FLIGHT_KEY'),
    juheFlightEnabled: booleanEnv('JUHE_FLIGHT_ENABLED', false),
    juheFlightEnvironment: providerEnv('JUHE_FLIGHT_ENVIRONMENT') || 'test',
    juheFlightQueryUrl: providerEnv('JUHE_FLIGHT_QUERY_URL') || 'https://apis.juhe.cn/flight/query',
    juheFlightDailyLimit: integerEnv('JUHE_FLIGHT_DAILY_LIMIT', 3, 0, 100),
    hotelProviderStatus: providerEnv('HOTEL_PROVIDER_STATUS') || 'cooperation_required'
  }
}

module.exports = { loadDotEnv, readConfig, booleanEnv }
