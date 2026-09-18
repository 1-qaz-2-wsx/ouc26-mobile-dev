function createUnavailableProvider({ id, name, kind, productId = null, environment = 'not_configured', reason, configured = false, enabled = false, dailyLimit = null, status = enabled ? 'ready' : 'cooperation_required' }) {
  return {
    id,
    name,
    capabilities() {
      return { id, name, kind, productId, configured, enabled, environment, status, dailyLimit, limitations: [reason] }
    },
    async search() {
      return { status: 'unavailable', quotes: [], capabilities: this.capabilities(), message: reason }
    }
  }
}

module.exports = { createUnavailableProvider }
