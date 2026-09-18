const assert = require('node:assert/strict')
const { afterEach, test } = require('node:test')
const { buildMessages, createApp } = require('../src/app')

const servers = []
const baseConfig = {
  apiKey: 'test-key-not-real', model: 'deepseek-v4-flash', apiUrl: 'https://mock.invalid/chat/completions',
  timeoutMs: 50, maxConcurrency: 2, maxUpstreamCalls: 20, maxOutputTokens: 800
}
const validBody = {
  question: '不坐夜车时怎样调整？',
  plan: { days: 7, budget: 3000, interests: ['森林'], allowNightTrain: false, stops: [{ placeId: 'yichun', nights: 2 }, { placeId: 'harbin', nights: 2 }] }
}

async function start(overrides = {}, fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: '建议放慢节奏。' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) {
  const app = createApp({ ...baseConfig, ...overrides }, { fetchImpl })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  servers.push(app.server)
  const { port } = app.server.address()
  return { ...app, url: `http://127.0.0.1:${port}` }
}

async function post(url, body) {
  const response = await fetch(`${url}/api/assist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

test('health reports readiness without exposing configuration secrets', async () => {
  const { url } = await start()
  const response = await fetch(`${url}/health`)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.aiConfigured, true)
  assert.equal(JSON.stringify(body).includes('test-key'), false)
})

test('missing key returns AI_NOT_CONFIGURED and does not call upstream', async () => {
  let calls = 0
  const { url } = await start({ apiKey: '' }, async () => { calls += 1 })
  const result = await post(url, validBody)
  assert.equal(result.status, 503)
  assert.equal(result.body.code, 'AI_NOT_CONFIGURED')
  assert.equal(calls, 0)
})

test('valid request returns only the contracted success fields', async () => {
  let upstreamBody
  const { url } = await start({}, async (_url, options) => {
    upstreamBody = JSON.parse(options.body)
    return new Response(JSON.stringify({ choices: [{ message: { content: '  建议增加换乘余量。  ' } }] }), { status: 200 })
  })
  const result = await post(url, validBody)
  assert.equal(result.status, 200)
  assert.deepEqual(Object.keys(result.body).sort(), ['answer', 'ok', 'requestId', 'source'])
  assert.equal(result.body.answer, '建议增加换乘余量。')
  assert.equal(upstreamBody.model, 'deepseek-v4-flash')
  assert.deepEqual(upstreamBody.thinking, { type: 'disabled' })
  assert.equal(upstreamBody.max_tokens, 800)
})

test('system prompt explicitly limits facts and preserves the upstream request contract', () => {
  const messages = buildMessages(validBody)
  const system = messages[0].content
  assert.match(system, /只能使用下方“已知事实”和“用户计划”中明确出现的信息/)
  assert.match(system, /每句话必须是已知事实的直接复述，或明确标注“待核验”/)
  assert.match(system, /禁止引入下方未出现的地点/)
  assert.match(system, /禁止推断或声称任何行程时长、换乘耗时、班次时间、班次频率、票价、余票、预算是否足够/)
  assert.match(system, /禁止 Markdown/)
  assert.deepEqual(messages.map((message) => message.role), ['system', 'user'])
  assert.match(messages[1].content, /只回答上面这个问题，不主动扩写其他计划建议/)
})

test('unsafe unsupported claims are blocked and never exposed as success', async () => {
  const unsafeAnswers = [
    '这会浪费至少半天车程。',
    '白天车次可能只有早午各一班。',
    '3000元预算仅够基础食宿与城际大巴。'
  ]
  for (const answer of unsafeAnswers) {
    const { url } = await start({}, async () => new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 }))
    const result = await post(url, validBody)
    assert.equal(result.status, 502)
    assert.equal(result.body.ok, false)
    assert.equal(result.body.code, 'AI_UNSAFE_RESPONSE')
  }
})

test('fact-only and verification wording passes the lightweight safety gate', async () => {
  const answer = '伊春是补给和住宿点。当前班次与实际费用待核验，计划预算为3000元。'
  const { url } = await start({}, async () => new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 }))
  const result = await post(url, validBody)
  assert.equal(result.status, 200)
  assert.equal(result.body.answer, answer)
})

test('markdown is converted to concise plain text without changing response fields', async () => {
  const { url } = await start({}, async () => new Response(JSON.stringify({ choices: [{ message: { content: '**伊春**：当前班次待核验。\n- 汤旺河接驳待核验。' } }] }), { status: 200 }))
  const result = await post(url, validBody)
  assert.equal(result.status, 200)
  assert.equal(result.body.answer, '伊春：当前班次待核验。\n汤旺河接驳待核验。')
  assert.deepEqual(Object.keys(result.body).sort(), ['answer', 'ok', 'requestId', 'source'])
})

test('invalid and overlong inputs are rejected before upstream', async () => {
  let calls = 0
  const { url } = await start({}, async () => { calls += 1 })
  const badShape = await post(url, { ...validBody, extra: true })
  const tooLong = await post(url, { ...validBody, question: '旅'.repeat(501) })
  const unknownPlace = await post(url, { ...validBody, plan: { ...validBody.plan, stops: [{ placeId: 'unknown', nights: 1 }] } })
  assert.equal(badShape.status, 400)
  assert.equal(tooLong.body.code, 'INVALID_REQUEST')
  assert.equal(unknownPlace.status, 400)
  assert.equal(calls, 0)
})

test('oversized JSON body is rejected with HTTP 413', async () => {
  const { url } = await start()
  const response = await fetch(`${url}/api/assist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(17 * 1024) })
  })
  const body = await response.json()
  assert.equal(response.status, 413)
  assert.equal(body.code, 'PAYLOAD_TOO_LARGE')
})

test('private-looking strings are redacted before forwarding', async () => {
  let sent = ''
  const { url } = await start({}, async (_url, options) => {
    sent = options.body
    return new Response(JSON.stringify({ choices: [{ message: { content: '好的。' } }] }), { status: 200 })
  })
  await post(url, { ...validBody, question: '联系 13812345678 或 me@example.com，再看 https://private.example/x' })
  assert.equal(sent.includes('13812345678'), false)
  assert.equal(sent.includes('me@example.com'), false)
  assert.equal(sent.includes('https://private.example/x'), false)
})

test('upstream 429 maps to a truthful rate-limit error with no retry', async () => {
  let calls = 0
  const { url } = await start({}, async () => { calls += 1; return new Response('{}', { status: 429 }) })
  const result = await post(url, validBody)
  assert.equal(result.status, 429)
  assert.equal(result.body.code, 'AI_RATE_LIMITED')
  assert.equal(calls, 1)
})

test('timeout aborts upstream and returns AI_TIMEOUT', async () => {
  const { url } = await start({ timeoutMs: 20 }, async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  const result = await post(url, validBody)
  assert.equal(result.status, 504)
  assert.equal(result.body.code, 'AI_TIMEOUT')
})

test('concurrency limit rejects excess requests without consuming a call', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { url, getState } = await start({ maxConcurrency: 1 }, async () => {
    await gate
    return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), { status: 200 })
  })
  const first = post(url, validBody)
  await new Promise((resolve) => setTimeout(resolve, 10))
  const second = await post(url, validBody)
  assert.equal(second.status, 429)
  assert.equal(second.body.code, 'AI_BUSY')
  assert.equal(getState().upstreamCalls, 1)
  release()
  assert.equal((await first).status, 200)
})

test('default hard cap rejects the 21st upstream call', async () => {
  let calls = 0
  const { url, getState } = await start({ maxUpstreamCalls: 20 }, async () => {
    calls += 1
    return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), { status: 200 })
  })
  for (let index = 0; index < 20; index += 1) assert.equal((await post(url, validBody)).status, 200)
  const blocked = await post(url, validBody)
  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.code, 'AI_LIMIT_REACHED')
  assert.equal(calls, 20)
  assert.equal(getState().upstreamCalls, 20)
})
