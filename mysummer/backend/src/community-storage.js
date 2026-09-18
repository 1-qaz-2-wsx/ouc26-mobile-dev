// CloudBase 对象存储适配器，注入 createCommunityApi 的 `storage` 依赖。
// 提供两个能力（契约见 community-api.js 的 completeMediaUpload 与 decorate）：
//   - verify(fileID)   -> { size, mime }  核对对象存在且大小/类型与授权一致
//   - readUrl(fileID)  -> 带签名的短时读取 URL（私有桶、限时读取）
// 客户端经 wx.cloud.uploadFile 直传后回传 fileID；服务端用 fileID 校验与签名，
// 不构造或猜测桶名，也不生成上传凭证。
const { failure } = require('./community-repository')

// 签名 URL 有效期（秒）。图片随每次 /me、/feed、/posts/:id 重新解析，短时效足够。
const READ_URL_MAX_AGE = 600

function normalizeMime(value) {
  const raw = String(value || '').toLowerCase().trim()
  return raw.split(';')[0].trim() || ''
}

function firstItem(result) {
  if (!result || typeof result !== 'object') return null
  if (result.code) throw failure('存储服务暂不可用', 503)
  const list = Array.isArray(result.fileList) ? result.fileList : null
  if (!list || !list.length) return null
  const item = list[0] || {}
  if (item.code && item.code !== 'SUCCESS') return null
  return item
}

function createCommunityStorage(cloudbase) {
  if (!cloudbase || typeof cloudbase.getFileInfo !== 'function' || typeof cloudbase.getTempFileURL !== 'function') {
    throw failure('媒体服务尚未配置', 503)
  }

  async function verify(fileID, storageKey) {
    if (typeof fileID !== 'string' || !fileID) throw failure('媒体对象缺失，无法确认上传', 400)
    // fileID 形如 cloud://<env>.<bucket>/<path>，其路径段即 storageKey；绑定二者防止换对象。
    if (typeof storageKey === 'string' && storageKey && !fileID.endsWith('/' + storageKey)) {
      throw failure('上传对象与授权不匹配', 400)
    }
    let result
    try { result = await cloudbase.getFileInfo({ fileList: [fileID] }) } catch { throw failure('媒体对象校验失败，请重试', 502) }
    const item = firstItem(result)
    if (!item || !Number(item.size)) throw failure('媒体对象不存在或不可读', 404)
    return { size: Number(item.size), mime: normalizeMime(item.mime || item.contentType) }
  }

  async function readUrl(fileID) {
    if (typeof fileID !== 'string' || !fileID) return null
    try {
      const result = await cloudbase.getTempFileURL({ fileList: [{ fileID, maxAge: READ_URL_MAX_AGE }] })
      const item = firstItem(result)
      return item && item.tempFileURL ? item.tempFileURL : null
    } catch { return null }
  }

  return { verify, readUrl, stat: verify, head: verify }
}

module.exports = { createCommunityStorage, normalizeMime, READ_URL_MAX_AGE }
