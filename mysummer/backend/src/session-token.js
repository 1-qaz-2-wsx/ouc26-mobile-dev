// 小程序登录令牌的读取口径，四条链路（platform / community / travel / planning）共用。
//
// 背景：CloudBase 云托管（wx.cloud.callContainer）会为环境凭证占用 Authorization 头，
// 客户端自带的登录令牌因此会被平台覆盖，导致社区、旅行、会话接口在云端全部鉴权失败。
// 小程序侧改为同时发送 x-app-authorization，服务端统一按
//   x-app-authorization → authorization
// 的顺序读取，本地直连与云托管两条链路行为等价。
const APP_AUTH_HEADER = 'x-app-authorization'

function headerValue(req, name) {
  const headers = (req && req.headers) || {}
  const value = headers[name]
  // 同名头重复出现时 Node 会给出数组，取首个，避免出现 "Bearer a, Bearer b"。
  return Array.isArray(value) ? value[0] : value
}

function bearer(value) {
  if (value === undefined || value === null) return ''
  // 大小写与多余空白都要容忍，否则 `bearer  <token>` 会被当成无效令牌。
  return String(value).replace(/^Bearer\s+/i, '').trim()
}

function sessionToken(req) {
  return bearer(headerValue(req, APP_AUTH_HEADER) || headerValue(req, 'authorization'))
}

module.exports = { APP_AUTH_HEADER, headerValue, bearer, sessionToken }
