// 后端路由的单一来源。后端路由分发表见 backend/src/app.js（platform / community /
// travel / planning 四域，统一仅 POST 且必须 application/json）。
// 调用方一律引用本文件，避免同一路径在多处以字符串字面量出现后悄悄分叉。
// 带参数的路径用函数生成，参数必须做 encodeURIComponent。

const platform = {
  wechatLogin: '/auth/wechat',
  session: '/auth/session',
  mapSearch: '/maps/search',
  mapRegeo: '/maps/regeo',
  mapDetail: '/maps/detail',
  mapPoi: '/maps/poi'
}

const community = {
  feed: '/community/feed',
  me: '/me',
  following: '/me/following',
  followers: '/me/followers',
  profile: '/me/profile',
  notifications: '/me/notifications',
  notificationsRead: '/me/notifications/read',
  posts: '/posts',
  post: id => '/posts/' + encodeURIComponent(id),
  postEdit: id => '/posts/' + encodeURIComponent(id) + '/edit',
  postVisibility: id => '/posts/' + encodeURIComponent(id) + '/visibility',
  postDelete: id => '/posts/' + encodeURIComponent(id) + '/delete',
  postLike: id => '/posts/' + encodeURIComponent(id) + '/like',
  postFavorite: id => '/posts/' + encodeURIComponent(id) + '/favorite',
  postComments: id => '/posts/' + encodeURIComponent(id) + '/comments',
  commentDelete: id => '/comments/' + encodeURIComponent(id) + '/delete',
  user: id => '/users/' + encodeURIComponent(id),
  userFollow: id => '/users/' + encodeURIComponent(id) + '/follow',
  mediaUploads: '/media/uploads',
  mediaComplete: id => '/media/' + encodeURIComponent(id) + '/complete',
  reports: '/reports',
  adminReports: '/admin/reports',
  adminReportResolve: id => '/admin/reports/' + encodeURIComponent(id) + '/resolve',
  adminPostTakedown: id => '/admin/posts/' + encodeURIComponent(id) + '/takedown'
}

const travel = {
  sync: '/travel/sync'
}

const planning = {
  capabilities: '/planning/capabilities',
  validate: '/planning/requests/validate',
  jobsCreate: '/planning/jobs/create',
  jobsGet: '/planning/jobs/get',
  jobsCancel: '/planning/jobs/cancel',
  draftsCreate: '/planning/drafts/create',
  draftsGet: '/planning/drafts/get',
  draftsPreview: '/planning/drafts/preview',
  draftsCommit: '/planning/drafts/commit',
  draftsCancel: '/planning/drafts/cancel',
  draftsRestore: '/planning/drafts/restore'
}

// 2026-09-18 Owner 决定：行程提醒功能搁置废弃，前端不再有 /reminders/schedule 调用点；
// 补充信息改为在本页手填，不再有 /bookings/import 调用点。本文件只保留真实存在的路由。
module.exports = { platform, community, travel, planning }
