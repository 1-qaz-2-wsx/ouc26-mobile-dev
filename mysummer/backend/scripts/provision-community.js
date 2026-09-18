// Provision CloudBase document collections for the community / travel /
// planning data layer.
//
// Collection creation is idempotent via the node-sdk's `createCollection`.
// The node-sdk does NOT expose an index-management API, so this script emits a
// machine-readable manifest and console instructions for the owner to apply in
// the CloudBase console (or via @cloudbase/manager-node if added later).
//
// Run from the backend directory:
//   node scripts/provision-community.js
const fs = require('node:fs')
const path = require('node:path')
const { loadDotEnv } = require('../src/config')
const { collections } = require('../src/community-schema')

function isAlreadyExists(message) {
  return /already|exist|已存在|DATABASE_COLLECTION.*EXIST|ResourceExists/i.test(String(message || ''))
}

async function main() {
  loadDotEnv(path.join(__dirname, '..', '.env'))
  const envId = process.env.CLOUDBASE_ENV_ID || 'cloud1-d3g8eu6faa3e4bee6'
  const accessKey = process.env.CLOUDBASE_APIKEY || ''
  if (!accessKey) {
    console.error('缺少 CLOUDBASE_APIKEY：请先在 backend/.env 填入 CloudBase API 密钥（勿提交/截图）。')
    process.exit(1)
  }

  const tcb = require('@cloudbase/node-sdk')
  const app = tcb.init({ env: envId, accessKey })
  const db = app.database()

  const summary = { created: [], skipped: [], failed: [] }
  for (const collection of collections) {
    const name = collection.name
    try {
      const result = await db.createCollection(name)
      const code = result && (result.code || result.errCode || result.error)
      if (code && !/success|ok/i.test(String(code))) {
        if (isAlreadyExists(code)) { summary.skipped.push(name); console.log(`- 集合 ${name} 已存在，跳过`) }
        else { summary.failed.push(name); console.warn(`✗ 集合 ${name} 创建失败：${code}`) }
      } else {
        summary.created.push(name)
        console.log(`✓ 集合 ${name} 已创建`)
      }
    } catch (error) {
      const message = String(error && (error.message || error.code || error) || '')
      if (isAlreadyExists(message)) { summary.skipped.push(name); console.log(`- 集合 ${name} 已存在，跳过`) }
      else { summary.failed.push(name); console.warn(`✗ 集合 ${name} 创建失败：${message}`) }
    }
  }

  // Index manifest: the SDK has no createIndex; hand the exact spec to the owner.
  const manifest = collections.map(c => ({ collection: c.name, indexes: c.indexes }))
  const manifestPath = path.join(__dirname, 'community-indexes-manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  console.log(`\n索引清单已写入 ${manifestPath}`)
  console.log('node-sdk 不暴露建索引接口，请在 CloudBase 控制台按清单为每个集合创建索引。')
  console.log('关键唯一索引：user_identities.identity_unique、media.storage_unique、')
  console.log('  post_likes.user_post_unique、post_favorites.user_post_unique、follows.follow_unique、')
  console.log('  idempotency_records.request_unique、notifications.event_recipient_unique、reports.report_unique。')
  console.log(`\n汇总：创建 ${summary.created.length}，已存在/跳过 ${summary.skipped.length}，失败 ${summary.failed.length}`)

  if (summary.failed.length) {
    console.error('有集合创建失败，请检查 CloudBase 权限与网络后重试。')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('建库失败：' + String(error && (error.message || error) || error))
  process.exit(1)
})
