function pad(value) {
  return value < 10 ? '0' + value : String(value)
}

function formatDate(date) {
  var value = date || new Date()
  return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate())
}

function fileExtension(filePath) {
  var match = String(filePath || '').match(/\.([a-zA-Z0-9]+)$/)
  return match ? match[1].toLowerCase() : 'jpg'
}

function normalizePhoto(photo, index) {
  var item = Object.assign({}, photo)
  var location = []

  if (item.province) {
    location.push(item.province)
  }
  if (item.country && item.country !== item.province) {
    location.push(item.country)
  }

  item.displayName = item.nickName || '微信用户'
  item.displayLocation = item.bio || (location.length ? location.join(' · ') : '来自图片分享社区')
  item.displayIndex = pad((index || 0) + 1)
  item.avatarLetter = item.displayName.slice(0, 1)
  return item
}

function friendlyError(error, fallback) {
  var message = error && (error.errMsg || error.message)

  if (message && message.toLowerCase().indexOf('permission') !== -1) {
    return '暂无操作权限，请检查 photos 集合安全规则'
  }
  if (message && message.indexOf('Environment not found') !== -1) {
    return '未找到云环境，请在开发者工具中选择正确环境'
  }
  if (message && message.indexOf('FunctionName') !== -1) {
    return 'getOpenid 云函数尚未部署'
  }
  return fallback || '操作失败，请稍后重试'
}

module.exports = {
  fileExtension: fileExtension,
  formatDate: formatDate,
  friendlyError: friendlyError,
  normalizePhoto: normalizePhoto
}
