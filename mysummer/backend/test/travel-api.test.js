const test = require('node:test');
const assert = require('node:assert/strict');
const { createTravelApi } = require('../src/travel-api');

function fixture() {
  const rows = new Map();
  const scope = (data, transactional) => ({
    get: async (table, id) => data.get(table + '/' + id) || null,
    set: async (table, id, value) => { data.set(table + '/' + id, structuredClone(value)); },
    remove: async (table, id) => { data.delete(table + '/' + id); },
    collection: table => {
      const api = {
        doc(id) {
          return {
            get: async () => ({ data: data.has(table + '/' + id) ? [structuredClone(data.get(table + '/' + id))] : [] }),
            set: async value => { data.set(table + '/' + id, structuredClone(value)); return {}; },
            remove: async () => { data.delete(table + '/' + id); return {}; },
            delete: async () => { data.delete(table + '/' + id); return {}; }
          };
        },
        where(query) { api.query = query; return api; },
        orderBy(field, direction) { api.order = { field, direction }; return api; },
        limit(value) { api.max = value; return api; },
        async get() {
          let dataRows = [...data.entries()].filter(([key]) => key.startsWith(table + '/')).map(([, value]) => structuredClone(value));
          if (api.query) dataRows = dataRows.filter(row => Object.entries(api.query).every(([key, value]) => row[key] === value));
          if (api.order) dataRows.sort((a, b) => String(b[api.order.field] || '').localeCompare(String(a[api.order.field] || '')));
          return { data: dataRows.slice(0, api.max || 20) };
        }
      };
      return api;
    }
  });
  const db = {
    collection: table => scope(rows, false).collection(table),
    async runTransaction(work) {
      const draft = new Map([...rows.entries()].map(([key, value]) => [key, structuredClone(value)]));
      const tx = scope(draft, true);
      const value = await work(tx);
      rows.clear(); for (const [key, item] of draft) rows.set(key, item);
      return value;
    }
  };
  return { repository: require('../src/community-repository').createCommunityRepository(db), rows };
}

function request() { return { headers: { authorization: 'Bearer valid-token' } }; }

test('travel sync persists owner data and returns reminders grouped by trip', async () => {
  const f = fixture();
  const api = createTravelApi({ repository: f.repository, verify: token => { assert.equal(token, 'valid-token'); return { id: 'user-1' }; } });
  const result = await api.handle('/travel/sync', {
    reminderMinutes: 45,
    plans: [{ id: 'plan-1', version: 1, updatedAt: 10, request: { days: 2 }, stops: [], items: [] }],
    trips: [{ id: 'trip-1', version: 1, updatedAt: 10, planId: 'plan-1', records: {}, reminders: [] }],
    reminders: [{ id: 'trip-1:r1', tripId: 'trip-1', version: 1, updatedAt: 10, title: '出发', eventAt: '2026-10-01 08:00', sendAt: '2026-10-01T07:15:00.000Z' }]
  }, request());
  assert.equal(result.plans[0].id, 'plan-1');
  assert.equal(result.trips[0].reminders.length, 1);
  assert.equal(result.reminderMinutes, 45);
  assert.equal(f.rows.get('travel_plans/plan-1').ownerId, 'user-1');
  assert.equal(f.rows.get('travel_trips/trip-1').ownerId, 'user-1');
  assert.equal(f.rows.get('travel_reminders/trip-1:r1').ownerId, 'user-1');
});

test('travel sync keeps newer server version and reports same-version conflict', async () => {
  const f = fixture();
  const api = createTravelApi({ repository: f.repository, verify: () => ({ id: 'user-1' }) });
  const base = { plans: [{ id: 'plan-1', version: 2, updatedAt: 20, title: 'server' }], trips: [], reminders: [] };
  await api.handle('/travel/sync', base, request());
  const result = await api.handle('/travel/sync', { plans: [{ id: 'plan-1', version: 2, updatedAt: 20, title: 'client' }], trips: [], reminders: [] }, request());
  assert.equal(result.conflicts[0].id, 'plan-1');
 assert.equal(result.plans[0].title, 'server');
});

// 2026-09-18：用户补录的车票/航班/住宿实际信息（bookings）走同一条同步通道。
// 它是用户记录，不是订单、不是核验结果；服务端只做 owner 隔离、版本冲突与字段白名单。
function booking(overrides = {}) {
  return Object.assign({
    id: 'plan-1:train:leg-1', planId: 'plan-1', sectionId: 'leg:leg-1', kind: 'train', version: 1, updatedAt: 10,
    fields: { serviceNo: 'G1024', seatClass: '二等座', unitPrice: '612', quantity: '2' }
  }, overrides);
}

test('travel sync persists recording bookings per owner and returns them', async () => {
  const f = fixture();
  const api = createTravelApi({ repository: f.repository, verify: () => ({ id: 'user-1' }) });
  const result = await api.handle('/travel/sync', { plans: [], trips: [], bookings: [booking()] }, request());
  assert.equal(result.bookings.length, 1);
  assert.equal(result.bookings[0].sectionId, 'leg:leg-1');
  assert.equal(result.bookings[0].kind, 'train');
  assert.equal(result.bookings[0].ownerId, undefined, '返回体不得带 ownerId');
  assert.equal(f.rows.get('travel_bookings/plan-1:train:leg-1').ownerId, 'user-1');

  // 版本更高时覆盖，同版本同内容不产生冲突。
  const newer = await api.handle('/travel/sync', {
    plans: [], trips: [], bookings: [booking({ version: 2, updatedAt: 20, fields: { serviceNo: 'G2048' } })]
  }, request());
  assert.equal(newer.bookings[0].fields.serviceNo, 'G2048');
  assert.deepEqual(newer.conflicts, []);

  // 同版本不同内容：服务端保留自己那份并回报冲突，不静默覆盖。
  const conflicted = await api.handle('/travel/sync', {
    plans: [], trips: [], bookings: [booking({ version: 2, updatedAt: 20, fields: { serviceNo: 'G9999' } })]
  }, request());
  assert.equal(conflicted.conflicts[0].type, 'booking');
  assert.equal(conflicted.bookings[0].fields.serviceNo, 'G2048');
});

test('travel sync rejects malformed bookings without touching stored rows', async () => {
  const f = fixture();
  const api = createTravelApi({ repository: f.repository, verify: () => ({ id: 'user-1' }) });
  await assert.rejects(api.handle('/travel/sync', {
    plans: [], trips: [], bookings: [booking({ planId: undefined })]
  }, request()), /方案标识/);
  await assert.rejects(api.handle('/travel/sync', {
    plans: [], trips: [], bookings: [booking({ planId: 'plan-1', sectionId: 'bad section id' })]
  }, request()), /卡片标识/);
  await assert.rejects(api.handle('/travel/sync', {
    plans: [], trips: [], bookings: [booking({ kind: 'ticket' })]
  }, request()), /类型无效/);
  await assert.rejects(api.handle('/travel/sync', { plans: [], trips: [], bookings: 'x' }, request()), /bookings必须是数组/);
  assert.equal([...f.rows.keys()].some(key => key.startsWith('travel_bookings/')), false);

  // 删除墓碑：客户端删除后仍上报一次，服务端保留该行，客户端按 deleted 过滤。
  const removed = await api.handle('/travel/sync', {
    plans: [], trips: [], bookings: [booking({ version: 2, updatedAt: 30, deleted: true })]
  }, request());
  assert.equal(removed.bookings[0].deleted, true);

  // 旧客户端仍带 reminders / reminderMinutes：功能虽已废弃，但不得因为兼容字段直接 400。
  const legacy = await api.handle('/travel/sync', {
    plans: [], trips: [], reminderMinutes: 60, reminders: [{ id: 'trip-9:r1', tripId: 'trip-9', version: 1, updatedAt: 1 }]
  }, request());
  assert.equal(legacy.plans.length, 0);
  assert.equal(legacy.reminderMinutes, 60);
});
