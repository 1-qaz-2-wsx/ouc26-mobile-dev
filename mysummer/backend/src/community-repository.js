const { createHash, randomUUID } = require('node:crypto');
const { collections } = require('./community-schema');
const allowed = new Set(collections.map(item => item.name));

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function key(...parts) { return createHash('sha256').update(JSON.stringify(parts)).digest('hex'); }
function documentData(result) {
  if (result?.code) throw failure('社区数据库暂不可用', 503);
  return Array.isArray(result?.data) ? result.data[0] || null : result?.data || null;
}

// Inject the real server SDK database. There is deliberately no memory/file fallback.
function createCommunityRepository(db) {
  if (!db || typeof db.runTransaction !== 'function') throw failure('社区数据库尚未配置', 503);
  function collectionName(table) {
    if (typeof table !== 'string') throw failure('数据库参数无效');
    return table.startsWith('travel_') || table.startsWith('community_') ? table : 'community_' + table;
  }
  function scope(database, transactional = false) {
    function ref(table, id) {
      const name = collectionName(table);
      if (!allowed.has(name) || typeof id !== 'string' || !id || id.length > 128) throw failure('数据库参数无效');
      return database.collection(name).doc(id);
    }
    return {
      async get(table, id) { return documentData(await ref(table, id).get()); },
      async set(table, id, data) {
        const result = await ref(table, id).set(data);
        if (result?.code) throw failure('社区数据库暂不可用', 503);
      },
      async remove(table, id) {
        const document = ref(table, id);
        const result = transactional ? await document.delete() : await document.remove();
        if (result?.code) throw failure('社区数据库暂不可用', 503);
      }
      ,collection(table) {
        const name = collectionName(table);
        if (!allowed.has(name)) throw failure('数据库参数无效');
        return database.collection(name);
      }
    };
  }
  return {
    ...scope(db),
    async transaction(work) {
      // Read result through closure: SDK versions differ in return envelope.
      let value;
      const result = await db.runTransaction(async tx => { value = await work(scope(tx, true)); });
      if (result?.code) throw failure('社区数据库暂不可用', 503);
      return value;
    },
    collection(table) { return scope(db).collection(table); }
  };
}

function createIdentityService(repository, { clock = Date.now, newId = randomUUID } = {}) {
  return {
    async resolve({ appid, openid, legacyId }) {
      if (typeof appid !== 'string' || !/^wx[0-9a-f]{16}$/.test(appid) || typeof openid !== 'string' || !openid || openid.length > 128) throw failure('微信身份无效', 401);
      if (legacyId !== undefined && (typeof legacyId !== 'string' || !/^[a-f0-9]{64}$/.test(legacyId))) throw failure('旧身份无效');
      const identityId = key('wechat', appid, openid);
      const candidateId = newId();
      const now = clock();
      return repository.transaction(async tx => {
        const identity = await tx.get('user_identities', identityId);
        const userId = identity?.userId || candidateId;
        let user = identity ? await tx.get('users', userId) : null;
        if (identity && !user) throw failure('账号资料异常，请联系维护人员', 503);
        if (user && user.status !== 'active') throw failure('账号已受限', 403);
        if (!identity) {
          user = { id: userId, nickname: '微信用户', bio: '', avatarMediaId: null, profileVersion: 1, status: 'active', createdAt: now, updatedAt: now };
          await tx.set('users', userId, user);
          await tx.set('user_identities', identityId, { userId, provider: 'wechat', appid, openid, createdAt: now });
        }
        if (legacyId) {
          const alias = await tx.get('user_aliases', legacyId);
          if (alias && alias.userId !== userId) throw failure('旧账号归属冲突', 409);
          if (!alias) await tx.set('user_aliases', legacyId, { userId, createdAt: now });
        }
        // Explicit projection: never return the identity record or OpenID.
        return { user: { id: user.id, nickname: user.nickname, bio: user.bio, avatarMediaId: user.avatarMediaId, profileVersion: user.profileVersion }, legacyId };
      });
    }
  };
}
module.exports = { createCommunityRepository, createIdentityService, key, failure };
