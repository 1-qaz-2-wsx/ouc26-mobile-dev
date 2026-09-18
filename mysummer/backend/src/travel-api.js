const { failure } = require('./community-repository');
const { sessionToken } = require('./session-token');

const MAX_PLANS = 50;
const MAX_TRIPS = 50;
const MAX_REMINDERS = 400;
// 用户自己补录的车次/席别/房型等实际信息。按方案实例 + 卡片定位，不计入方案/行程版本。
const MAX_BOOKINGS = 200;
const ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SECTION_ID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;
const BOOKING_KINDS = ['train', 'flight', 'hotel'];
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const stamp = () => Date.now();

function viewerFromRequest(verify, req) {
  const token = sessionToken(req);
  if (!token) throw failure('请先微信登录', 401);
  return verify(token);
}

function id(value, field) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw failure(`${field}标识无效`, 400);
  return value;
}

function time(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))) return value;
  return fallback;
}

function normalize(row, ownerId, type) {
  if (!plainObject(row)) throw failure(`${type}数据格式无效`, 400);
  const result = clone(row);
  result.id = id(result.id, type);
  result.ownerId = ownerId;
  result.version = Number.isInteger(result.version) && result.version > 0 ? result.version : 1;
  result.createdAt = time(result.createdAt, stamp());
  result.updatedAt = time(result.updatedAt, stamp());
  delete result._openid;
  if (JSON.stringify(result).length > 220000) throw failure(`${type}内容过大`, 413);
  return result;
}

// 补充信息（bookings）是用户手动记录、跨设备同步的实际出行信息，不是订单也不是核验结果。
// 它必须能定位回「哪份方案的哪张卡」：planId + sectionId 都由客户端生成，服务端只做白名单校验。
// deleted 行是删除墓碑：本机删除后仍上报一次，服务端保存后由客户端过滤，避免下次同步把旧记录带回来。
function normalizeBooking(row, ownerId) {
  const result = normalize(row, ownerId, '补充信息');
  if (typeof result.planId !== 'string' || !ID_PATTERN.test(result.planId)) throw failure('补充信息缺少有效方案标识', 400);
  if (typeof result.sectionId !== 'string' || !SECTION_ID_PATTERN.test(result.sectionId)) throw failure('补充信息缺少有效卡片标识', 400);
  if (!BOOKING_KINDS.includes(result.kind)) throw failure('补充信息类型无效', 400);
  if (result.deleted !== undefined && typeof result.deleted !== 'boolean') throw failure('补充信息删除标记无效', 400);
  return result;
}

function withoutOwner(row) {
  if (!row) return row;
  const result = { ...row };
  delete result.ownerId;
  return result;
}

function newer(incoming, current) {
  const a = Number(incoming.updatedAt) || Date.parse(incoming.updatedAt) || 0;
  const b = Number(current.updatedAt) || Date.parse(current.updatedAt) || 0;
  return a > b;
}

function equivalent(a, b) {
  return JSON.stringify({ ...a, ownerId: undefined }) === JSON.stringify({ ...b, ownerId: undefined });
}

function createTravelApi({ repository, verify }) {
  if (!repository) throw failure('旅行数据服务尚未配置', 503);

  async function owned(table, ownerId, limit) {
    const result = await repository.collection(table).where({ ownerId }).orderBy('updatedAt', 'desc').limit(limit).get();
    return Array.isArray(result.data) ? result.data : [];
  }

  async function sync(input, req) {
    const viewer = viewerFromRequest(verify, req);
    if (!plainObject(input)) throw failure('同步请求必须是对象', 400);
    const plansInput = Array.isArray(input.plans) ? input.plans.slice(0, MAX_PLANS) : [];
    const tripsInput = Array.isArray(input.trips) ? input.trips.slice(0, MAX_TRIPS) : [];
    const remindersInput = Array.isArray(input.reminders) ? input.reminders.slice(0, MAX_REMINDERS) : [];
    const bookingsInput = Array.isArray(input.bookings) ? input.bookings.slice(0, MAX_BOOKINGS) : [];
    if (input.plans !== undefined && !Array.isArray(input.plans)) throw failure('plans必须是数组', 400);
    if (input.trips !== undefined && !Array.isArray(input.trips)) throw failure('trips必须是数组', 400);
    if (input.reminders !== undefined && !Array.isArray(input.reminders)) throw failure('reminders必须是数组', 400);
    if (input.bookings !== undefined && !Array.isArray(input.bookings)) throw failure('bookings必须是数组', 400);
    if (input.reminderMinutes !== undefined && (!Number.isInteger(Number(input.reminderMinutes)) || Number(input.reminderMinutes) < 0 || Number(input.reminderMinutes) > 10080)) throw failure('提醒提前量无效', 400);

    const plans = plansInput.map(row => normalize(row, viewer.id, '方案'));
    const trips = tripsInput.map(row => normalize(row, viewer.id, '行程'));
    const bookings = bookingsInput.map(row => normalizeBooking(row, viewer.id));
    const reminders = remindersInput.map(row => normalize(row, viewer.id, '提醒')).map(row => {
      if (!row.tripId || typeof row.tripId !== 'string' || !ID_PATTERN.test(row.tripId)) throw failure('提醒缺少有效行程', 400);
      return row;
    });
    const conflicts = [];
    const existingReminders = await owned('travel_reminders', viewer.id, MAX_REMINDERS);
    await repository.transaction(async tx => {
      for (const row of plans) {
        const current = await tx.get('travel_plans', row.id);
        if (!current || row.version > Number(current.version || 1) || (row.version === Number(current.version || 1) && newer(row, current))) await tx.set('travel_plans', row.id, row);
        else if (row.version === Number(current.version || 1) && !equivalent(row, current)) conflicts.push({ type: 'plan', id: row.id, serverVersion: current.version });
      }
      for (const row of trips) {
        const stored = { ...row };
        delete stored.reminders;
        const current = await tx.get('travel_trips', row.id);
        if (!current || row.version > Number(current.version || 1) || (row.version === Number(current.version || 1) && newer(row, current))) {
          await tx.set('travel_trips', row.id, stored);
        } else if (row.version === Number(current.version || 1) && !equivalent(stored, current)) conflicts.push({ type: 'trip', id: row.id, serverVersion: current.version });
      }
      for (const row of bookings) {
        const current = await tx.get('travel_bookings', row.id);
        if (!current || row.version > Number(current.version || 1) || (row.version === Number(current.version || 1) && newer(row, current))) {
          await tx.set('travel_bookings', row.id, row);
        } else if (row.version === Number(current.version || 1) && !equivalent(row, current)) {
          conflicts.push({ type: 'booking', id: row.id, serverVersion: current.version });
        }
      }
      const tripIds = new Set(trips.map(row => row.id));
      for (const row of reminders) {
        const current = await tx.get('travel_reminders', row.id);
        if (!current || row.version > Number(current.version || 1) || newer(row, current)) await tx.set('travel_reminders', row.id, row);
      }
      for (const old of existingReminders) {
        if (!tripIds.has(old.tripId)) continue;
        if (!reminders.some(row => row.id === old.id)) await tx.remove('travel_reminders', old.id);
      }
    });

    const [serverPlans, serverTrips, serverReminders, serverBookings] = await Promise.all([
      owned('travel_plans', viewer.id, MAX_PLANS), owned('travel_trips', viewer.id, MAX_TRIPS),
      owned('travel_reminders', viewer.id, MAX_REMINDERS), owned('travel_bookings', viewer.id, MAX_BOOKINGS)
    ]);
    const remindersByTrip = new Map();
    for (const row of serverReminders) {
      const list = remindersByTrip.get(row.tripId) || [];
      list.push(withoutOwner(row));
      remindersByTrip.set(row.tripId, list);
    }
    return {
      plans: serverPlans.map(withoutOwner),
      trips: serverTrips.map(row => ({ ...withoutOwner(row), reminders: remindersByTrip.get(row.id) || [] })),
      bookings: serverBookings.map(withoutOwner),
      reminderMinutes: Number.isInteger(Number(input.reminderMinutes)) ? Number(input.reminderMinutes) : undefined,
      conflicts: conflicts.slice(0, 20),
      serverTime: stamp()
    };
  }

  return { handle: async (path, input, req) => { if (path === '/travel/sync') return sync(input, req); throw failure('接口不存在', 404); } };
}

module.exports = { createTravelApi, normalize };
