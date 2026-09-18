const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommunityRepository, createIdentityService, key } = require('../src/community-repository');
const { collections } = require('../src/community-schema');

// Test-only transactional fixture. Production never instantiates this adapter.
function fixture() {
  let rows = new Map();
  let failNext = false;
  const scope = (data, inTransaction) => ({ collection: table => ({ doc: id => {
    const path = table + '/' + id;
    return {
      get: async () => ({ data: data.has(path) ? [structuredClone(data.get(path))] : [] }),
      set: async value => { data.set(path, structuredClone(value)); return {}; },
      [inTransaction ? 'delete' : 'remove']: async () => { data.delete(path); return {}; }
    };
  } }) });
  const db = {
    collection: table => scope(rows, false).collection(table),
    async runTransaction(work) {
      const snapshot = structuredClone(rows);
      const result = await work(scope(snapshot, true));
      if (failNext) { failNext = false; throw new Error('simulated transaction failure'); }
      rows = snapshot;
      return result;
    }
  };
  return { repository: createCommunityRepository(db), fail: () => { failNext = true; }, rows: () => rows };
}
const identity = { appid: 'wx1af4250928ed4699', openid: 'test-only-openid', legacyId: 'a'.repeat(64) };

test('schema: server-only collections and unique business relationships', () => {
  assert.equal(new Set(collections.map(c => c.name)).size, collections.length);
  assert.ok(collections.every(c => c.permission === 'ADMINONLY'));
  for (const name of ['user_identities', 'post_likes', 'post_favorites', 'follows', 'idempotency_records']) {
    assert.ok(collections.find(c => c.name === 'community_' + name).indexes.some(i => i.MgoKeySchema.MgoIsUnique));
  }
});
test('identity survives repeat login and legacy signature key rotation', async () => {
  const f = fixture();
  let count = 0;
  const service = createIdentityService(f.repository, { newId: () => 'user-' + ++count });
  const first = await service.resolve(identity);
  const second = await service.resolve({ ...identity, legacyId: 'b'.repeat(64) });
  assert.equal(first.user.id, second.user.id);
  assert.equal([...f.rows().keys()].filter(k => k.startsWith('community_users/')).length, 1);
  assert.equal((await f.repository.get('user_aliases', 'b'.repeat(64))).userId, first.user.id);
  assert.ok(!JSON.stringify(second).includes(identity.openid));
  assert.ok(!JSON.stringify(second).includes(identity.appid));
});
test('failed transaction cannot leave orphan user or alias', async () => {
  const f = fixture();
  f.fail();
  await assert.rejects(createIdentityService(f.repository).resolve(identity), /simulated/);
  assert.equal(f.rows().size, 0);
});
test('alias ownership collision rolls back identity creation', async () => {
  const f = fixture();
  await f.repository.set('user_aliases', identity.legacyId, { userId: 'someone-else' });
  await assert.rejects(createIdentityService(f.repository).resolve(identity), e => e.status === 409);
  assert.equal(f.rows().size, 1);
});
test('restricted users cannot recover session and invalid identities cannot write', async () => {
  const f = fixture();
  const service = createIdentityService(f.repository);
  const { user } = await service.resolve(identity);
  await f.repository.set('users', user.id, { ...user, status: 'restricted' });
  await assert.rejects(service.resolve(identity), e => e.status === 403);
  await assert.rejects(service.resolve({ ...identity, appid: '' }), e => e.status === 401);
});
test('repository validates table names, SDK error envelopes and delete methods', async () => {
  const f = fixture();
  await assert.rejects(f.repository.get('secrets', 'x'), e => e.status === 400);
  await f.repository.set('users', 'x', { id: 'x' });
  await f.repository.transaction(tx => tx.remove('users', 'x'));
  assert.equal(await f.repository.get('users', 'x'), null);
  assert.throws(() => createCommunityRepository(null), e => e.status === 503);
  const broken = createCommunityRepository({ runTransaction: async () => ({ code: 'DENIED' }) });
  await assert.rejects(broken.transaction(() => 1), e => e.status === 503);
  assert.notEqual(key('a:b', 'c'), key('a', 'b:c'));
});
