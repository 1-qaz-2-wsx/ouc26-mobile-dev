const { PLACES } = require('./travel-context')

const QUESTION_MAX = 500
const BODY_MAX_BYTES = 16 * 1024

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message) {
  const error = new Error(message)
  error.code = 'INVALID_REQUEST'
  error.status = 400
  throw error
}

function validateRequest(body) {
  if (!plainObject(body)) invalid('请求体必须是 JSON 对象。')
  const allowedRoot = new Set(['question', 'plan'])
  if (Object.keys(body).some((key) => !allowedRoot.has(key))) invalid('请求包含不支持的字段。')

  if (typeof body.question !== 'string') invalid('question 必须是字符串。')
  const question = body.question.trim()
  if (!question) invalid('question 不能为空。')
  if ([...question].length > QUESTION_MAX) invalid(`question 不能超过 ${QUESTION_MAX} 个字符。`)

  const plan = body.plan
  if (!plainObject(plan)) invalid('plan 必须是对象。')
  const allowedPlan = new Set(['days', 'budget', 'interests', 'allowNightTrain', 'stops'])
  if (Object.keys(plan).some((key) => !allowedPlan.has(key))) invalid('plan 包含不支持的字段。')
  if (!Number.isInteger(plan.days) || plan.days < 1 || plan.days > 30) invalid('days 必须是 1 到 30 的整数。')
  if (plan.budget !== null && (!Number.isFinite(plan.budget) || plan.budget < 0 || plan.budget > 1000000)) {
    invalid('budget 必须是 null 或 0 到 1000000 的有限数字。')
  }
  if (!Array.isArray(plan.interests) || plan.interests.length > 8) invalid('interests 必须是最多 8 项的数组。')
  const interests = plan.interests.map((item) => {
    if (typeof item !== 'string' || !item.trim() || [...item.trim()].length > 30) invalid('每项兴趣必须是 1 到 30 个字符的字符串。')
    return item.trim()
  })
  if (typeof plan.allowNightTrain !== 'boolean') invalid('allowNightTrain 必须是布尔值。')
  if (!Array.isArray(plan.stops) || plan.stops.length < 1 || plan.stops.length > 12) invalid('stops 必须包含 1 到 12 站。')
  const seen = new Set()
  const stops = plan.stops.map((stop) => {
    if (!plainObject(stop) || Object.keys(stop).some((key) => !['placeId', 'nights'].includes(key))) invalid('stop 格式无效。')
    if (typeof stop.placeId !== 'string' || !Object.hasOwn(PLACES, stop.placeId)) invalid('stop 引用了未知地点。')
    if (seen.has(stop.placeId)) invalid('同一地点不能重复出现。')
    seen.add(stop.placeId)
    if (!Number.isInteger(stop.nights) || stop.nights < 0 || stop.nights > 30) invalid('nights 必须是 0 到 30 的整数。')
    return { placeId: stop.placeId, nights: stop.nights }
  })
  if (stops.reduce((sum, stop) => sum + stop.nights, 0) > 30) invalid('总住宿晚数不能超过 30。')

  return { question, plan: { days: plan.days, budget: plan.budget, interests, allowNightTrain: plan.allowNightTrain, stops } }
}

function sanitizeQuestion(text) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已隐藏]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已隐藏]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[证件号已隐藏]')
    .replace(/(?<!\d)(?:\d[ -]?){15,19}(?!\d)/g, '[账号已隐藏]')
    .replace(/https?:\/\/\S+/gi, '[链接已隐藏]')
}

module.exports = { BODY_MAX_BYTES, QUESTION_MAX, sanitizeQuestion, validateRequest }
