// Only the developer changes this URL. No secret belongs in this file.
const productionBaseUrl = '' // e.g. https://api.your-owned-domain.cn
function resolveBaseUrl(platform, envVersion) {
  if (platform === 'devtools' && envVersion === 'develop') return 'http://127.0.0.1:8787'
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::443)?$/.test(productionBaseUrl)) return ''
  return productionBaseUrl
}
function currentBaseUrl() {
  try {
    const platform = wx.getDeviceInfo ? wx.getDeviceInfo().platform : wx.getSystemInfoSync().platform
    const version = wx.getAccountInfoSync().miniProgram.envVersion
    return resolveBaseUrl(platform, version)
  } catch { return '' }
}
module.exports = { resolveBaseUrl, currentBaseUrl }
