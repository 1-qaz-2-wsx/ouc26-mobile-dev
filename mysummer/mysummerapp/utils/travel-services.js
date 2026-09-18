const store = require('./travel-store')
const endpoints = require('../config/endpoints')
const P = endpoints.platform, C = endpoints.community, T = endpoints.travel, G = endpoints.planning
// 服务端错误信封为 { ok:false, code, message, requestId }，规划校验失败时另带
// fieldErrors:[{path,message}]。逐字段原因必须透给调用方，否则只能显示笼统文案。
function backendError(data, fallback) {
  const e = new Error(data && data.message || fallback)
  e.code = data && data.code
  if (data && Array.isArray(data.fieldErrors)) e.fieldErrors = data.fieldErrors
  return e
}
function request(url,data,method,header) {
  return new Promise((resolve,reject)=>wx.request({url,data,method:method||'GET',header:header||{},timeout:10000,
    success:r=>{if(r.statusCode>=200&&r.statusCode<300)resolve(r.data);else {const e=backendError(r.data,'服务请求失败（'+r.statusCode+'）');e.status=r.statusCode;reject(e)}},
    fail:()=>reject(new Error(url.indexOf('http://127.0.0.1:8787')===0?'无法连接本地后端，请在项目根目录运行 npm run start:local --prefix backend，再重试':'无法连接服务，请检查网络；开发者需检查 HTTPS 证书与 request 合法域名'))}))
}
function sessionChangedError() { const error = new Error('会话已切换'); error.code = 'SESSION_CHANGED'; return error }
function currentResponse(identity, value) { if (!store.isCurrentSession(identity)) throw sessionChangedError(); return value }
function cloudReady() {
  const cloud=require('../config/cloud'),c=store.config()
  return Boolean((cloud.env&&cloud.service&&typeof wx!=='undefined'&&wx.cloud&&typeof wx.cloud.callContainer==='function')||c.apiBaseUrl)
}
function authHeaders(token) {
  const value = token ? 'Bearer ' + token : ''
  // 云托管（callContainer）会用自己的环境凭证占用 Authorization，登录令牌会被覆盖；
  // 因此额外发送 x-app-authorization，后端按该头优先读取。本地直连同名头无害。
  return { 'content-type': 'application/json', Authorization: value, 'x-app-authorization': value }
}
function api(path,data) {
  const c=store.config(),s=store.session(),identity=store.sessionIdentity(s)
  const cloud=require('../config/cloud')
  if(cloud.env&&cloud.service) {
    if(!wx.cloud||!wx.cloud.callContainer)return Promise.reject(new Error('当前微信版本不支持云托管，请升级微信'))
    return wx.cloud.callContainer({config:{env:cloud.env},path,method:'POST',header:Object.assign({'X-WX-SERVICE':cloud.service},authHeaders(s.token)),data}).then(r=>{if(r.statusCode>=200&&r.statusCode<300)return currentResponse(identity,r.data);const e=backendError(r.data,'云托管服务暂不可用');e.status=r.statusCode;throw e})
  }
  if(!c.apiBaseUrl) return Promise.reject(new Error('真机服务尚未部署，请开发者配置 HTTPS 后端地址；仍可使用本地规划'))
  return request(c.apiBaseUrl+path,data,'POST',authHeaders(s.token)).then(value=>currentResponse(identity,value))
}
async function login() {
  const cloud=require('../config/cloud')
  if(!store.config().apiBaseUrl&&!(cloud.env&&cloud.service))throw new Error('云托管尚未配置环境 ID 和服务名；可以继续游客规划')
  const data=await api(P.wechatLogin,{})
  if(!data.token||!data.user||!data.user.id)throw new Error('登录服务返回格式错误')
  const current=store.session()
  // The backend user ID is canonical. Local travel data keeps its historical
  // wx- namespace through travel-store's one-way compatibility migration.
  store.setSession(Object.assign({},current,{kind:'wechat',id:String(data.user.id),nickname:data.user.nickname||'微信用户',bio:data.user.bio||'',avatarMediaId:data.user.avatarMediaId||null,avatarUrl:data.user.avatarUrl||null,profileVersion:data.user.profileVersion||1,token:data.token,expiresAt:data.expiresAt}))
}
function demoLogin() { store.setSession({kind:'demo',id:'demo',nickname:'本地演示用户'}) }
// 2026-09-18 Owner 决定：行程提醒功能搁置废弃。前端不再申请订阅消息、不再排程提醒，
// 后端也不实现 /reminders/schedule；开启行程只写本机/云端行程数据。
function openProvider(item) {
  // LEGACY（2026-09-18）：方案页与补充信息页都不再跳第三方，本函数只剩本机演示链路的测试调用点；
  // 后续清理演示方案时与 supplier-adapters / config.providers 一起删除。
  const target=item.quote&&item.quote.bookingTarget
  if(target&&target.kind==='manual')return Promise.reject(new Error('当前是演示库存，不能据此购买。请复制条件到官方平台查询，或手动关联实际订单'))
  if(target&&target.kind==='miniProgram'&&/^wx[a-zA-Z0-9]{16}$/.test(target.appId))return new Promise((resolve,reject)=>wx.navigateToMiniProgram({appId:target.appId,path:target.path||'',success:resolve,fail:()=>reject(new Error('第三方跳转失败，请使用官方平台查询'))}))
  const p=store.config().providers[item.type]
  if(!p||!/^wx[a-zA-Z0-9]{16}$/.test(p.appId))return Promise.reject(new Error('该供应商购买入口未配置。可复制推荐信息到官方平台查询，或手动记录已有订单'))
  const path=String(p.path||'').replace(/\{name\}/g,encodeURIComponent(item.title)).replace(/\{date\}/g,encodeURIComponent(item.date)).replace(/\{serviceNo\}/g,encodeURIComponent(item.serviceNo||''))
  return new Promise((resolve,reject)=>wx.navigateToMiniProgram({appId:p.appId,path,success:resolve,fail:()=>reject(new Error('第三方跳转失败，请检查 AppID、路径或直接使用官方平台'))}))
}
function revalidateQuote(item){if(item.quoteState==='detached')return Promise.resolve({available:false,status:'detached',checkedAt:new Date().toISOString(),message:'推荐已被手动修改，原报价不再对应当前内容；请重新规划或手动记录实际订单'});if(!item.quote)return Promise.resolve({available:false,status:'missing',checkedAt:new Date().toISOString(),message:'该推荐缺少供应商报价，请重新规划'});return require('./supplier-adapters').revalidate(item.quote)}
async function savePhotos(paths) {
  return Promise.all(paths.map(path=>new Promise((resolve,reject)=>wx.saveFile({tempFilePath:path,success:r=>resolve(r.savedFilePath),fail:()=>reject(new Error('照片保存失败，请检查存储权限和可用空间'))}))))
}
async function validateSession() {
  if(store.session().kind!=='wechat')return
  const identity=store.sessionIdentity()
  try { await api(P.session,{}) } catch(e) {
    if(e.status===401&&store.isCurrentSession(identity))store.setSession({kind:'guest',id:'guest',nickname:'游客'})
    throw e
  }
}
async function communityFeed(options={}) { return api(C.feed,{tab:options.tab||'recommend',keyword:options.keyword||'',type:options.type||'all',cursor:options.cursor||null,limit:options.limit||20}) }
async function travelSync(data={}) { return api(T.sync,data) }
async function me() { return api(C.me,{}) }
async function following(options={}) { return api(C.following,{cursor:options.cursor||null,limit:options.limit||20}) }
async function followers(options={}) { return api(C.followers,{cursor:options.cursor||null,limit:options.limit||20}) }
async function notifications(options={}) { return api(C.notifications,{cursor:options.cursor||null,limit:options.limit||20}) }
async function markNotificationsRead(ids, before) { return api(C.notificationsRead,{ids:Array.isArray(ids)?ids:[],before:before === undefined || before === null ? null : before}) }
async function updateProfile(data) { return api(C.profile,data) }
async function createPost(data) { return api(C.posts,data) }
async function updatePost(id, data) { return api(C.postEdit(id), data) }
async function changePostVisibility(id, data) { return api(C.postVisibility(id), data) }
async function deletePost(id, data={}) { return api(C.postDelete(id), data) }
async function postDetail(id) { return api(C.post(id),{}) }
async function report(data) { return api(C.reports, Object.assign({}, data, { requestKey: data && data.requestKey || store.id('report') })) }
async function toggleLike(id,active,requestKey) { return api(C.postLike(id),{active:active===true,requestKey:requestKey||null}) }
async function toggleFavorite(id,active,requestKey) { return api(C.postFavorite(id),{active:active===true,requestKey:requestKey||null}) }
async function toggleFollow(id,active,requestKey) { return api(C.userFollow(id),{active:active===true,requestKey:requestKey||null}) }
async function comments(id,data={}) { return api(C.postComments(id),data) }
async function deleteComment(id, data={}) { return api(C.commentDelete(id), data) }
async function member(id) { return api(C.user(id),{}) }
function fileInfo(tempFilePath) {
  if (typeof wx.getFileInfo !== 'function') return Promise.reject(new Error('当前微信版本无法校验图片大小，请升级微信后重试'))
  return new Promise((resolve, reject) => wx.getFileInfo({ filePath: tempFilePath, success: resolve, fail: () => reject(new Error('无法读取图片信息，请重新选择')) }))
}
function mimeFor(path) {
  const ext = (String(path).match(/\.([a-z0-9]+)$/i) || [,'jpg'])[1].toLowerCase()
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg' : ''
}
async function requestMediaUpload(meta, requestKey) { return api(C.mediaUploads, { mime: meta.mime, size: meta.size, requestKey }) }
async function completeMediaUpload(upload, fileID, meta) { return api(C.mediaComplete(upload.mediaId), { storageKey: upload.storageKey, fileID, mime: meta.mime, size: meta.size, requestKey: upload.requestKey || null }) }
async function uploadMedia(tempFilePath, folder='community', options={}) {
  const cloud=require('../config/cloud')
  const s=store.session()
  if (!wx.cloud || !cloud.env) throw new Error('云端存储尚未初始化')
  const info = await fileInfo(tempFilePath)
  const meta = { size: Number(info.size), mime: mimeFor(tempFilePath) }
  if (!meta.mime) throw new Error('仅支持 JPG、PNG 或 WebP 图片')
  if (!Number.isInteger(meta.size) || meta.size <= 0 || meta.size > 10 * 1024 * 1024) throw new Error('图片大小不能超过 10 MB')
  const suppliedKey = options && typeof options.requestKey === 'string' ? options.requestKey.trim() : ''
  const uploadRequestKey = suppliedKey.length >= 8 ? suppliedKey.slice(0, 128) : store.id('media')
  const upload = await requestMediaUpload(meta, uploadRequestKey)
  const result=await new Promise((resolve,reject)=>wx.cloud.uploadFile({cloudPath:upload.storageKey,filePath:tempFilePath,success:resolve,fail:()=>reject(new Error('图片上传失败，请重试'))}))
  if (!result.fileID) throw new Error('图片上传失败，请重试')
  await api(C.mediaComplete(upload.mediaId), { storageKey: upload.storageKey, fileID: result.fileID, mime: meta.mime, size: meta.size, requestKey: uploadRequestKey + '-complete' })
  return upload.mediaId
}
async function uploadPhotos(paths, folder='community/posts', options={}) {
  if (folder && typeof folder === 'object') { options = folder; folder = 'community/posts' }
  const result = []
  for (let index = 0; index < (paths || []).length; index += 1) {
    const item = paths[index]
    const existing = item && typeof item === 'object' ? item.mediaId : ''
    const path = item && typeof item === 'object' ? item.path : item
    const baseKey = options && typeof options.requestKey === 'string' ? options.requestKey.trim() : ''
    const uploadKey = baseKey.length >= 8 ? (baseKey + '-media-' + index).slice(0, 128) : ''
    const mediaId = existing || await uploadMedia(path, folder, { requestKey: uploadKey })
    result.push(mediaId)
    if (options && typeof options.onProgress === 'function') await options.onProgress(index, mediaId)
  }
  return result
}
module.exports=Object.assign({request,api,backendError,cloudReady,sessionChangedError,isSessionChanged:error=>Boolean(error&&error.code==='SESSION_CHANGED'),login,validateSession,demoLogin,openProvider,revalidateQuote,savePhotos,uploadMedia,uploadPhotos,requestMediaUpload,completeMediaUpload,communityFeed,travelSync,me,following,followers,notifications,markNotificationsRead,updateProfile,createPost,updatePost,changePostVisibility,deletePost,postDetail,report,toggleLike,toggleFavorite,toggleFollow,comments,deleteComment,member},require('./tencent-map').create(api))
