// 开发者统一配置。正式发布前改为已加入微信 request 合法域名的 HTTPS 后端。
// 腾讯 Key / 微信 AppSecret 只放 backend/.env，绝不能放进小程序。
module.exports = {
  get apiBaseUrl() { return require('./backend').currentBaseUrl() },
  // 后端须实现 /auth/wechat；社区分享使用微信原生能力。
  // 行程提醒（订阅消息 / 提醒排程）已于 2026-09-18 搁置废弃，不再需要 /reminders/schedule。
  // 真实跳转按 type 配置 {appId, path}，path 支持 {name}/{date}/{serviceNo}。
  providers: { train: null, flight: null, hotel: null, ticket: null }
}
