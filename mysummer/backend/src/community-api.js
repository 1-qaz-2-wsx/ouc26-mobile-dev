const { randomUUID, createHash } = require('node:crypto');
const { failure } = require('./community-repository');
const { createModerationWorker } = require('./community-moderation');
const { sessionToken } = require('./session-token');
const {
  clone, hash, requestKey, normalizePostInput,
  sanitizeRouteSnapshot, validateUploadInput
} = require('./community-content');

const PUBLIC_STATUSES = new Set(['approved']);
const MODERATION_BYPASSED = 'not_required';
const MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const REPORT_WINDOW_MS = 60 * 60 * 1000;
const REPORT_LIMIT = 10;
const REPORT_REASONS = new Set(['spam', 'abuse', 'privacy', 'unsafe', 'other']);
const REPORT_TARGETS = new Set(['post', 'comment']);
const ADMIN_ROLES = new Set(['admin', 'moderator']);
const now = () => Date.now();
const idFor = (...parts) => createHash('sha256').update(parts.join(':')).digest('hex');
const timestamp = value => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
function rowId(row) {
  if (!row) return '';
  if (row.id !== undefined && row.id !== null) return String(row.id);
  if (row._id !== undefined && row._id !== null) return String(row._id);
  if (row.followerId !== undefined || row.followeeId !== undefined) return `${String(row.followerId || '')}:${String(row.followeeId || '')}`;
  if (row.postId !== undefined || row.userId !== undefined) return `${String(row.userId || '')}:${String(row.postId || '')}`;
  return '';
}
const compareDescending = (field, a, b) => {
  const time = timestamp(b[field]) - timestamp(a[field]);
  if (time) return time;
  const left = rowId(a), right = rowId(b);
  return right === left ? 0 : (right > left ? 1 : -1);
};
function encodeCursor(row, field = 'publishedAt') {
  return Buffer.from(JSON.stringify({ value: timestamp(row[field]), id: rowId(row) })).toString('base64url');
}
function decodeCursor(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Number.isFinite(Number(parsed.value)) || typeof parsed.id !== 'string') return null;
    return { value: Number(parsed.value), id: parsed.id };
  } catch { return null; }
}
function isAfterCursor(row, cursor, field = 'publishedAt') {
  if (!cursor) return true;
  const value = timestamp(row[field]);
  return value < cursor.value || (value === cursor.value && rowId(row) < cursor.id);
}
const cleanText = (value, min, max, field) => {
  if (typeof value !== 'string') throw failure(`${field}格式不正确`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw failure(`${field}长度不正确`);
  return text;
};
const publicPost = (post, moderationEnabled = true) => post && post.visibility === 'public'
  && (PUBLIC_STATUSES.has(post.moderationStatus) || (!moderationEnabled && post.moderationStatus === MODERATION_BYPASSED))
  && !post.deletedAt && !post.takenDown;
const publicCommentStatus = (comment, moderationEnabled = true) => comment
  && (PUBLIC_STATUSES.has(comment.moderationStatus) || (!moderationEnabled && comment.moderationStatus === MODERATION_BYPASSED));
const publicPostQuery = { visibility: 'public', takenDown: false };
function safePlace(place) {
  if (!place || typeof place !== 'object') return null;
  const id = place.id || place.placeId || place.providerId;
  const name = place.name || place.title;
  if (!id || !name) return null;
  const stableId = String(id);
  const result = { id: stableId, placeId: stableId, name: String(name), provider: String(place.provider || 'qq') };
  if (place.providerId !== undefined && place.providerId !== null && String(place.providerId).trim()) result.providerId = String(place.providerId);
  if (place.address) result.address = String(place.address);
  if (place.category) result.category = String(place.category);
  if (Number.isFinite(Number(place.latitude)) && Number.isFinite(Number(place.longitude))) { result.latitude = Number(place.latitude); result.longitude = Number(place.longitude); }
  return result;
}
function reportView(row) {
  const id = rowId(row);
  return {
    id, reportId: id, targetType: row && row.targetType || '', targetId: row && row.targetId || '',
    reason: row && row.reason || '', status: row && row.status || 'pending',
    createdAt: row && row.createdAt || null, updatedAt: row && row.updatedAt || null
  };
}
function adminReportView(row) {
  return Object.assign(reportView(row), {
    details: row && row.details || '', takenDown: Boolean(row && row.takenDown)
  });
}
function postView(post, stats = {}, viewer = null, moderationEnabled = true) {
  if (!post) return null;
  const isOwner = Boolean(viewer && viewer.id === post.authorId);
  const isPublic = publicPost(post, moderationEnabled);
  const result = {
    id: String(post.id),
    authorId: String(post.authorId || ''),
    type: post.type,
    title: post.title || '',
    content: post.content || '',
    placeNames: Array.isArray(post.placeNames) ? post.placeNames : [],
    photos: Array.isArray(post.photos) ? post.photos : [],
    mediaIds: isOwner && Array.isArray(post.photos) ? post.photos : [],
    places: Array.isArray(post.places) ? post.places.map(safePlace).filter(Boolean) : [],
    rating: post.rating ?? null,
    visitDate: post.visitDate || null,
    duration: post.duration || null,
    visibility: post.visibility,
    moderationStatus: isPublic || isOwner ? post.moderationStatus : undefined,
    publishedAt: post.publishedAt || null,
    createdAt: post.createdAt || null,
    updatedAt: post.updatedAt || null,
    deleted: isOwner ? Boolean(post.deletedAt) : false,
    moderationReason: isOwner ? (post.moderationReason || null) : undefined,
    version: Number(post.version || 1),
    likeCount: Number(stats.likeCount || 0),
    favoriteCount: Number(stats.favoriteCount || 0),
    commentCount: Number(stats.commentCount || 0),
    isOwner,
    permissions: {
      isOwner,
      canEdit: isOwner,
      canDelete: isOwner,
      canChangeVisibility: isOwner,
      canLike: Boolean(viewer && isPublic && !isOwner),
      canFavorite: Boolean(viewer && isPublic),
      canComment: Boolean(viewer && isPublic)
    }
  };
  // routeSnapshot is server-sanitized before persistence; publicly visible routes
  // may expose that whitelist, while private/non-public content remains owner-only.
  if (isOwner || (isPublic && post.type === 'route')) {
    try { result.routeSnapshot = post.routeSnapshot ? sanitizeRouteSnapshot(post.routeSnapshot) : null } catch { result.routeSnapshot = null }
  }
  return result;
}

function viewerFromRequest(verify, req, required = true) {
  const token = sessionToken(req);
  if (!token) { if (required) throw failure('请先微信登录', 401); return null; }
  return verify(token);
}
function publicReadPath(path) {
  return path === '/community/feed' || /^\/posts\/[^/]+$/.test(path) || /^\/posts\/[^/]+\/comments$/.test(path) || /^\/users\/[^/]+$/.test(path);
}
function createCommunityApi({ repository, verify, storage, moderationChecker, moderationEnabled = false }) {
  if (!repository) throw failure('社区数据库尚未配置', 503);
  // Audit is opt-in; the running service leaves it disabled until a separate authorization/configuration step.
  const useModeration = moderationEnabled === true;
  const publicStatus = () => useModeration ? 'pending' : MODERATION_BYPASSED;
  const shouldEnqueueModeration = () => useModeration;
  const isPublicPost = post => publicPost(post, useModeration);
  const isPublicCommentStatus = comment => publicCommentStatus(comment, useModeration);
  async function resolveAvatarUrl(avatarMediaId) {
    if (!avatarMediaId) return null;
    try {
      const media = await repository.get('media', avatarMediaId);
      const fileID = media && (media.fileID || media.fileId);
      if (!fileID) return null;
      if (storage && typeof storage.readUrl === 'function') return await storage.readUrl(fileID);
      return fileID;
    } catch { return null; }
  }
  async function profile(userId) {
    const user = await repository.get('users', userId);
    if (!user || user.status !== 'active') throw failure('用户资料不可用', 404);
    const avatarMediaId = user.avatarMediaId || null;
    return { id: user.id, nickname: user.nickname, bio: user.bio || '', avatarMediaId, avatarUrl: await resolveAvatarUrl(avatarMediaId), profileVersion: user.profileVersion || 1 };
  }
  async function getStats(userId) {
    return Object.assign(emptyUserStats(userId), await repository.get('post_stats', idFor('user', userId)) || {});
  }
  async function safeProfile(userId) {
    if (typeof userId !== 'string' || !userId) return { id: '', nickname: '微信用户', bio: '', avatarMediaId: null, avatarUrl: null, profileVersion: 1 };
    try { return await profile(userId); } catch (error) {
      if (error.status !== 404) throw error;
      return { id: userId, nickname: '微信用户', bio: '', avatarMediaId: null, avatarUrl: null, profileVersion: 1 };
    }
  }
  async function activeViewer(path, req) {
    const viewer = viewerFromRequest(verify, req, !publicReadPath(path));
    if (!viewer) return null;
    const user = await repository.get('users', viewer.id);
    if (!user || user.status !== 'active') throw failure('账号已受限或资料不可用', 403);
    return { id: user.id, nickname: user.nickname || viewer.nickname || '微信用户' };
  }
  async function idempotent(actorId, operation, requestId, payload, work) {
    if (!requestId) return typeof repository.transaction === 'function' ? repository.transaction(work) : work(repository);
    const recordId = idFor('request', actorId, operation, requestId);
    const bodyHash = hash(payload);
    const run = async db => {
      const existing = await db.get('idempotency_records', recordId);
      if (existing) {
        if (existing.bodyHash !== bodyHash) throw failure('同一幂等键对应了不同请求内容', 409);
        if (existing.result !== undefined) return clone(existing.result);
        throw failure('请求仍在处理中，请使用原幂等键重试', 409);
      }
      const result = await work(db);
      await db.set('idempotency_records', recordId, {
        id: recordId, actorId, operation, requestKey: requestId, bodyHash,
        result: clone(result), resultRef: result && (result.postId || result.mediaId || result.commentId) || null,
        createdAt: now(), expiresAt: now() + MEDIA_TTL_MS
      });
      return result;
    };
    return typeof repository.transaction === 'function' ? repository.transaction(run) : run(repository);
  }
  async function requireAdmin(viewer) {
    if (!viewer) throw failure('请先微信登录', 401);
    const user = await repository.get('users', viewer.id);
    const role = user && typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
    const roles = user && Array.isArray(user.roles) ? user.roles.map(value => String(value).trim().toLowerCase()) : [];
    if (!user || user.status !== 'active' || !(user.isAdmin === true || ADMIN_ROLES.has(role) || roles.some(value => ADMIN_ROLES.has(value)))) {
      throw failure('当前账号没有管理权限', 403);
    }
    return user;
  }
  async function findExistingReport(db, reporterId, targetType, targetId) {
    const deterministicId = idFor('report', reporterId, targetType, targetId);
    const direct = await db.get('reports', deterministicId);
    if (direct) return direct;
    if (!db || typeof db.collection !== 'function') return null;
    const result = await db.collection('reports').where({ reporterId, targetType, targetId }).limit(1).get();
    return result && Array.isArray(result.data) ? result.data[0] || null : null;
  }
  async function enforceReportRateLimit(db, viewerId) {
    const bucket = Math.floor(now() / REPORT_WINDOW_MS);
    const id = idFor('report-rate', viewerId, bucket);
    const existing = await db.get('rate_limits', id);
    const count = Number(existing && existing.count || 0);
    if (count >= REPORT_LIMIT) throw failure('举报操作过于频繁，请稍后再试', 429);
    const createdAt = existing && existing.createdAt || now();
    await db.set('rate_limits', id, {
      id, actorId: viewerId, operation: 'community.report', bucket,
      count: count + 1, createdAt, expiresAt: (bucket + 1) * REPORT_WINDOW_MS
    });
  }
  async function visibleReportTarget(db, targetType, targetId, viewer) {
    if (targetType === 'post') {
      const post = await db.get('posts', targetId);
      if (!post || (!isPublicPost(post) && post.authorId !== viewer.id)) throw failure('内容不可用', 404);
      return { post };
    }
    const comment = await db.get('comments', targetId);
    const post = comment && await db.get('posts', comment.postId);
    const canSeePost = Boolean(post && (isPublicPost(post) || post.authorId === viewer.id));
    const canSeeComment = Boolean(comment && !comment.deletedAt && (isPublicCommentStatus(comment) || comment.authorId === viewer.id));
    if (!comment || !post || !canSeePost || !canSeeComment) throw failure('内容不可用', 404);
    return { comment, post };
  }
  async function writeAudit(db, { actorId, action, targetType, targetId, reportId = null, requestId = null, metadata = null }) {
    const id = idFor('audit', actorId, action, targetType, targetId, reportId || '', requestId || '');
    if (await db.get('audit_events', id)) return id;
    await db.set('audit_events', id, {
      id, actorId, action, targetType, targetId, reportId,
      metadata: metadata && typeof metadata === 'object' ? clone(metadata) : null,
      createdAt: now()
    });
    return id;
  }
  async function takeDownTarget(db, targetType, targetId, actorId, reportId = null, requestId = null) {
    if (targetType === 'post') {
      const post = await db.get('posts', targetId);
      if (!post) throw failure('内容不可用', 404);
      if (!post.takenDown) await db.set('posts', targetId, Object.assign({}, post, { takenDown: true, updatedAt: now(), version: Number(post.version || 1) + 1 }));
      await writeAudit(db, { actorId, action: 'post.takedown', targetType, targetId, reportId, requestId });
      return true;
    }
    if (targetType === 'comment') {
      const comment = await db.get('comments', targetId);
      if (!comment) throw failure('内容不可用', 404);
      if (!comment.deletedAt) {
        if (isPublicCommentStatus(comment)) await updatePostStats(db, comment.postId, 'commentCount', -1);
        await db.set('comments', targetId, Object.assign({}, comment, { deletedAt: now(), updatedAt: now() }));
      }
      await writeAudit(db, { actorId, action: 'comment.takedown', targetType, targetId, reportId, requestId });
      return true;
    }
    throw failure('举报目标类型不支持', 400);
  }
  async function createReport(input, viewer) {
    const targetType = cleanText(String(input.targetType || ''), 1, 20, '举报目标类型').toLowerCase();
    if (!REPORT_TARGETS.has(targetType)) throw failure('举报目标类型不支持', 400);
    const targetId = cleanText(String(input.targetId || ''), 1, 128, '举报目标');
    const reason = cleanText(String(input.reason || ''), 1, 40, '举报原因').toLowerCase();
    if (!REPORT_REASONS.has(reason)) throw failure('举报原因不支持', 400);
    if (input.details !== undefined && input.details !== null && input.details !== '' && typeof input.details !== 'string') throw failure('补充说明格式不正确', 400);
    const details = input.details === undefined || input.details === null || input.details === '' ? '' : cleanText(input.details, 1, 500, '补充说明');
    const requestId = requestKey(input, true);
    const payload = { targetType, targetId, reason, details };
    return idempotent(viewer.id, 'report.create', requestId, payload, async db => {
      const existing = await findExistingReport(db, viewer.id, targetType, targetId);
      if (existing) return reportView(existing);
      await visibleReportTarget(db, targetType, targetId, viewer);
      await enforceReportRateLimit(db, viewer.id);
      const id = idFor('report', viewer.id, targetType, targetId);
      const createdAt = now();
      const report = { id, reporterId: viewer.id, targetType, targetId, reason, details, status: 'pending', takenDown: false, createdAt, updatedAt: createdAt };
      await db.set('reports', id, report);
      return reportView(report);
    });
  }
  async function listAdminReports(input, viewer) {
    await requireAdmin(viewer);
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
    const status = input.status === undefined || input.status === null || input.status === '' ? null : cleanText(String(input.status), 1, 20, '举报状态').toLowerCase();
    if (status && !['pending', 'resolved', 'dismissed'].includes(status)) throw failure('举报状态不支持', 400);
    const collection = repository.collection('reports');
    const query = status ? collection.where({ status }) : collection;
    const result = await query.orderBy('createdAt', 'asc').limit(500).get();
    const rows = (result.data || []).sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt)).slice(0, limit);
    return { items: rows.map(adminReportView), hasMore: (result.data || []).length > limit };
  }
  async function resolveAdminReport(reportId, input, viewer) {
    await requireAdmin(viewer);
    const status = cleanText(String(input.status || ''), 1, 20, '处理状态').toLowerCase();
    if (!['resolved', 'dismissed'].includes(status)) throw failure('处理状态不支持', 400);
    const takeDown = input.takeDown === true;
    const requestId = requestKey(input, true);
    return idempotent(viewer.id, 'admin.report.resolve', requestId, { reportId, status, takeDown }, async db => {
      const report = await db.get('reports', reportId);
      if (!report) throw failure('举报记录不存在', 404);
      let takenDown = Boolean(report.takenDown);
      if (takeDown) takenDown = await takeDownTarget(db, report.targetType, report.targetId, viewer.id, report.id, requestId);
      const next = Object.assign({}, report, { status, takenDown, handledBy: viewer.id, handledAt: now(), updatedAt: now() });
      await db.set('reports', reportId, next);
      await writeAudit(db, { actorId: viewer.id, action: 'report.' + status, targetType: report.targetType, targetId: report.targetId, reportId, requestId, metadata: { takeDown } });
      return adminReportView(next);
    });
  }
  async function directAdminTakedown(postId, input, viewer) {
    await requireAdmin(viewer);
    const requestId = requestKey(input, true);
    return idempotent(viewer.id, 'admin.post.takedown', requestId, { postId }, async db => {
      const post = await db.get('posts', postId);
      if (!post) throw failure('内容不可用', 404);
      const changed = await takeDownTarget(db, 'post', postId, viewer.id, null, requestId);
      return { postId, takenDown: changed, requestKey: requestId };
    });
  }
  async function ensureMediaOwned(db, ownerId, photos) {
    if (!photos.length) return [];
    const rows = await Promise.all(photos.map(id => db.get('media', id)));
    rows.forEach((media, index) => {
      if (!media || media.ownerId !== ownerId) throw failure(`第 ${index + 1} 张图片不可用`, 403);
      if (!['uploaded', 'attached'].includes(media.status) || (media.expiresAt && Number(media.expiresAt) < now())) throw failure(`第 ${index + 1} 张图片尚未完成上传`, 409);
      if (media.moderationStatus === 'rejected') throw failure(`第 ${index + 1} 张图片未通过检查`, 400);
    });
    return rows;
  }
  async function attachMedia(db, postId, photos) {
    await Promise.all(photos.map((mediaId, order) => db.set('post_media', idFor(postId, mediaId), { id: idFor(postId, mediaId), postId, mediaId, order, createdAt: now() })));
    await Promise.all(photos.map(async mediaId => {
      const media = await db.get('media', mediaId);
      if (media) await db.set('media', mediaId, Object.assign({}, media, { status: 'attached', postId, attachedAt: now() }));
    }));
  }
  async function enqueueModeration(db, targetType, targetId, targetVersion) {
    const id = idFor('moderation', targetType, targetId, targetVersion);
    if (await db.get('moderation_jobs', id)) return id;
    await db.set('moderation_jobs', id, {
      id, targetType, targetId, targetVersion, type: targetType, status: 'pending',
      attempts: 0, nextRunAt: now(), createdAt: now(), updatedAt: now()
    });
    return id;
  }
  function requireOwner(post, viewer) {
    if (!post || !viewer || post.authorId !== viewer.id) throw failure('无权操作该内容', 403);
  }
  function currentVersion(input, post) {
    if (input.version === undefined || input.version === null || input.version === '') return Number(post.version || 1);
    const version = Number(input.version);
    if (!Number.isInteger(version) || version !== Number(post.version || 1)) throw failure('内容已被其他设备更新，请重新加载', 409);
    return version;
  }
  async function decorate(post, viewer) {
    const stats = await repository.get('post_stats', idFor('post', post.id));
    const result = postView(post, stats || {}, viewer, useModeration);
    const isOwner = Boolean(viewer && viewer.id === post.authorId);
    const isPublic = isPublicPost(post);
    const photos = Array.isArray(post.photos) ? post.photos : [];
    const mediaRows = await Promise.all(photos.map(id => repository.get('media', String(id))));
    const photoUrls = await Promise.all(mediaRows.map(async media => {
      const fileID = media && (media.fileID || media.fileId);
      if (!fileID) return (media && (media.publicUrl || media.readUrl)) || null;
      if (storage && typeof storage.readUrl === 'function') return await storage.readUrl(fileID);
      return fileID;
    }));
    result.photos = photos.map((id, index) => {
      const media = mediaRows[index];
      if (!media) return isOwner ? id : null;
      const mediaPublic = media.moderationStatus === 'approved' || (!useModeration && media.moderationStatus === MODERATION_BYPASSED);
      if (media.ownerId !== post.authorId || !['uploaded', 'attached'].includes(media.status) || media.moderationStatus === 'rejected' || (isPublic && !mediaPublic)) return null;
      return photoUrls[index];
    }).filter(Boolean);
    result.viewerLiked = Boolean(viewer && await repository.get('post_likes', idFor(viewer.id, post.id)));
    result.viewerFavorited = Boolean(viewer && await repository.get('post_favorites', idFor(viewer.id, post.id)));
    result.author = await safeProfile(post.authorId);
    result.authorName = result.author.nickname;
    result.authorAvatar = result.author.avatarUrl || result.author.avatarMediaId || '';
    return result;
  }
  async function listOwnPosts(userId) {
    const result = await repository.collection('posts').where({ authorId: userId }).orderBy('createdAt', 'desc').limit(100).get();
    const rows = (result.data || []).sort((a, b) => compareDescending('createdAt', a, b));
    return Promise.all(rows.slice(0, 50).map(post => decorate(post, { id: userId })));
  }
  async function listRelation(table, field, value) {
    const result = await repository.collection(table).where({ [field]: value }).orderBy('createdAt', 'desc').limit(500).get();
    return result.data || [];
  }
  async function listRelationPage(table, field, value, input = {}) {
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
    const result = await repository.collection(table).where({ [field]: value }).orderBy('createdAt', 'desc').limit(500).get();
    const cursor = decodeCursor(input.cursor);
    const rows = (result.data || []).map(row => Object.assign({}, row, { id: rowId(row) }))
      .sort((a, b) => compareDescending('createdAt', a, b))
      .filter(row => isAfterCursor(row, cursor, 'createdAt'));
    const page = rows.slice(0, limit + 1);
    const hasMore = page.length > limit;
    return { rows: page.slice(0, limit), hasMore, nextCursor: hasMore && page.length ? encodeCursor(page[limit - 1], 'createdAt') : null };
  }
  function emptyPostStats(postId) {
    return { postId, likeCount: 0, favoriteCount: 0, commentCount: 0 };
  }
  function emptyUserStats(userId) {
    return { userId, followingCount: 0, followerCount: 0, likeReceivedCount: 0 };
  }
  function statsCounts(stats) {
    const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    return {
      likeCount: count(stats && stats.likeCount),
      favoriteCount: count(stats && stats.favoriteCount),
      commentCount: count(stats && stats.commentCount)
    };
  }
  function adjustCount(value, delta) {
    const current = Number(value), change = Number(delta);
    return Math.max(0, (Number.isFinite(current) ? current : 0) + (Number.isFinite(change) ? change : 0));
  }
  async function notificationBySource(db, sourceId, recipientId) {
    if (!sourceId || !recipientId || !db || typeof db.collection !== 'function') return null;
    const result = await db.collection('notifications').where({ sourceId, recipientId }).limit(1).get();
    return result && Array.isArray(result.data) ? result.data[0] || null : null;
  }
  async function ensureNotification(db, { type, sourceId, recipientId, actorId, postId = null, commentId = null }) {
    if (!recipientId || !sourceId || recipientId === actorId) return null;
    if (await notificationBySource(db, sourceId, recipientId)) return null;
    const id = idFor('notification', sourceId, recipientId);
    const existing = await db.get('notifications', id);
    if (existing) return null;
    await db.set('notifications', id, {
      id, sourceId, recipientId, type,
      actorId: actorId || null, postId: postId || null, commentId: commentId || null,
      readAt: null, createdAt: now()
    });
    return id;
  }
  async function notificationView(row) {
    const actor = await safeProfile(row && row.actorId);
    return {
      id: rowId(row), type: row.type || 'interaction',
      postId: row.postId || null, commentId: row.commentId || null,
      actorId: row.actorId || null, actorName: actor.nickname,
      readAt: row.readAt || null, createdAt: row.createdAt || null
    };
  }
  async function listNotifications(userId, input = {}) {
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
    const result = await repository.collection('notifications').where({ recipientId: userId }).orderBy('createdAt', 'desc').limit(500).get();
    const cursor = decodeCursor(input.cursor);
    const rows = (result.data || []).map(row => Object.assign({}, row, { id: rowId(row) }))
      .sort((a, b) => compareDescending('createdAt', a, b))
      .filter(row => isAfterCursor(row, cursor, 'createdAt'));
    const page = rows.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const items = await Promise.all(page.slice(0, limit).map(notificationView));
    const unreadCount = (result.data || []).filter(row => !row.readAt).length;
    return { items, nextCursor: hasMore && items.length ? encodeCursor(page[limit - 1], 'createdAt') : null, hasMore, unreadCount };
  }
  async function updatePostStats(db, postId, field, delta) {
    const statsId = idFor('post', postId);
    const stats = await db.get('post_stats', statsId) || emptyPostStats(postId);
    stats[field] = adjustCount(stats[field], delta);
    await db.set('post_stats', statsId, stats);
    return stats;
  }
  async function updateUserLikeStats(db, userId, delta) {
    if (!userId) return null;
    const statsId = idFor('user', userId);
    const stats = await db.get('post_stats', statsId) || emptyUserStats(userId);
    stats.likeReceivedCount = adjustCount(stats.likeReceivedCount, delta);
    await db.set('post_stats', statsId, stats);
    return stats;
  }
  async function hasFollow(followerId, followeeId) {
    if (!followerId || !followeeId) return false;
    const direct = await repository.get('follows', idFor(followerId, followeeId));
    if (direct) return true;
    const result = await repository.collection('follows').where({ followerId, followeeId }).limit(1).get();
    return Boolean(result.data && result.data.length);
  }
  async function relationView(row, targetField, viewer) {
    const targetId = String(row[targetField] || '');
    const user = await safeProfile(targetId);
    return {
      id: rowId(row),
      targetId,
      followerId: String(row.followerId || ''),
      followeeId: String(row.followeeId || ''),
      createdAt: row.createdAt || null,
      user,
      nickname: user.nickname,
      avatarMediaId: user.avatarMediaId || null,
      following: Boolean(viewer && await hasFollow(viewer.id, targetId))
    };
  }
  async function toggleRelation(table, relationId, fields, active, actorId) {
    if (!active) { await repository.remove(table, relationId); return false; }
    await repository.set(table, relationId, { ...fields, createdAt: now(), actorId });
    return true;
  }
  async function requestMediaUpload(input, viewer) {
    const checked = validateUploadInput(input);
    const requestId = requestKey(input);
    return idempotent(viewer.id, 'media.upload', requestId, checked, async db => {
      const mediaId = randomUUID();
      const extension = checked.mime === 'image/png' ? 'png' : checked.mime === 'image/webp' ? 'webp' : 'jpg';
      const storageKey = `community/${viewer.id}/${mediaId}.${extension}`;
      const createdAt = now();
      await db.set('media', mediaId, {
        id: mediaId, ownerId: viewer.id, storageKey, mime: checked.mime, size: checked.size,
        status: 'authorized', moderationStatus: useModeration ? 'pending' : MODERATION_BYPASSED, createdAt, expiresAt: createdAt + MEDIA_TTL_MS
      });
      return { mediaId, storageKey, mime: checked.mime, size: checked.size, expiresAt: createdAt + MEDIA_TTL_MS, requestKey: requestId || null };
    });
  }
  async function completeMediaUpload(mediaId, input, viewer) {
    if (typeof mediaId !== 'string' || !mediaId.trim()) throw failure('媒体标识无效', 400);
    const media = await repository.get('media', mediaId);
    if (!media || media.ownerId !== viewer.id) throw failure('媒体不可用', 404);
    const checked = validateUploadInput({ mime: input.mime || media.mime, size: input.size === undefined ? media.size : input.size });
    if (!input.storageKey || input.storageKey !== media.storageKey) throw failure('上传对象与授权不匹配', 400);
    if (media.status === 'uploaded' || media.status === 'attached') { if (shouldEnqueueModeration()) await enqueueModeration(repository, 'media', mediaId, Number(media.version || 1)); return { mediaId, status: media.status, mime: media.mime, size: media.size }; }
    const verifier = storage && (storage.verify || storage.stat || storage.head);
    if (typeof verifier !== 'function') throw failure('媒体服务尚未配置，暂不能确认上传对象', 503);
    const fileID = input.fileID || input.fileId || null;
    let actual;
    try { actual = await verifier.call(storage, fileID, media.storageKey); } catch { throw failure('媒体对象校验失败，请重试', 502); }
    if (!actual || Number(actual.size) !== checked.size || String(actual.mime || actual.contentType || '').toLowerCase() !== checked.mime) throw failure('上传对象类型或大小校验失败', 400);
    const next = Object.assign({}, media, { status: 'uploaded', mime: checked.mime, size: checked.size, fileID: input.fileID || input.fileId || null, completedAt: now(), expiresAt: now() + MEDIA_TTL_MS, version: Number(media.version || 1) });
    await repository.set('media', mediaId, next);
    if (shouldEnqueueModeration()) await enqueueModeration(repository, 'media', mediaId, next.version);
    return { mediaId, status: next.status, mime: next.mime, size: next.size };
  }
  async function createPost(input, viewer) {
    const normalized = normalizePostInput(input);
    const requestId = requestKey(input);
    const payload = Object.assign({}, normalized, { media: normalized.photos });
    return idempotent(viewer.id, 'post.create', requestId, payload, async db => {
      if (normalized.sourceKey) {
        const existing = await db.collection('posts').where({ authorId: viewer.id, sourceKey: normalized.sourceKey }).limit(1).get();
        const found = existing && Array.isArray(existing.data) ? existing.data[0] : null;
        if (found) return { postId: found.id, status: found.moderationStatus, version: Number(found.version || 1), requestKey: requestId || null, duplicated: true };
      }
      const media = await ensureMediaOwned(db, viewer.id, normalized.photos);
      const id = randomUUID();
      const createdAt = now();
      const post = {
        id, authorId: viewer.id, ...normalized, photos: normalized.photos, routeSnapshot: normalized.routeSnapshot,
        moderationStatus: normalized.visibility === 'public' ? publicStatus() : 'approved', moderationReason: null,
        publishedAt: normalized.visibility === 'public' ? (useModeration ? null : createdAt) : createdAt, deletedAt: null, takenDown: false,
        version: 1, createdAt, updatedAt: createdAt
      };
      await db.set('posts', id, post);
      await db.set('post_stats', idFor('post', id), { postId: id, likeCount: 0, favoriteCount: 0, commentCount: 0 });
      if (media.length) await attachMedia(db, id, normalized.photos);
      if (normalized.visibility === 'public' && shouldEnqueueModeration()) await enqueueModeration(db, 'post', id, 1);
      return { postId: id, status: post.moderationStatus, version: 1, requestKey: requestId || null };
    });
  }
  async function updatePost(postId, input, viewer) {
    const current = await repository.get('posts', postId);
    requireOwner(current, viewer);
    const suppliedVersion = input.version === undefined || input.version === null || input.version === '' ? null : Number(input.version);
    if (suppliedVersion !== null && !Number.isInteger(suppliedVersion)) throw failure('版本号不正确', 400);
    const version = suppliedVersion === null ? Number(current.version || 1) : suppliedVersion;
    const normalized = normalizePostInput(Object.assign({}, current, input), current);
    const requestId = requestKey(input);
    const payload = Object.assign({}, normalized, { postId, version: suppliedVersion, media: normalized.photos });
    return idempotent(viewer.id, 'post.update', requestId, payload, async db => {
      const latest = await db.get('posts', postId);
      requireOwner(latest, viewer);
      currentVersion({ version }, latest);
      const media = await ensureMediaOwned(db, viewer.id, normalized.photos);
      const updatedAt = now();
      const isPublic = normalized.visibility === 'public';
      const next = Object.assign({}, latest, normalized, {
        id: postId, authorId: viewer.id, photos: normalized.photos, routeSnapshot: normalized.routeSnapshot,
        version: version + 1, updatedAt,
        moderationStatus: isPublic ? publicStatus() : 'approved', moderationReason: null,
        publishedAt: isPublic ? (useModeration ? (latest.publishedAt || null) : (latest.publishedAt || updatedAt)) : (latest.publishedAt || updatedAt)
      });
      await db.set('posts', postId, next);
      if (media.length) await attachMedia(db, postId, normalized.photos);
      if (isPublic && shouldEnqueueModeration()) await enqueueModeration(db, 'post', postId, next.version);
      return { postId, status: next.moderationStatus, version: next.version, requestKey: requestId || null };
    });
  }
  async function changeVisibility(postId, input, viewer) {
    const current = await repository.get('posts', postId);
    requireOwner(current, viewer);
    const suppliedVersion = input.version === undefined || input.version === null || input.version === '' ? null : Number(input.version);
    if (suppliedVersion !== null && !Number.isInteger(suppliedVersion)) throw failure('版本号不正确', 400);
    const version = suppliedVersion === null ? Number(current.version || 1) : suppliedVersion;
    if (input.visibility !== 'public' && input.visibility !== 'private') throw failure('公开范围不正确', 400);
    const requestId = requestKey(input);
    return idempotent(viewer.id, 'post.visibility', requestId, { postId, visibility: input.visibility, version: suppliedVersion }, async db => {
      const latest = await db.get('posts', postId);
      requireOwner(latest, viewer);
      currentVersion({ version }, latest);
      const nextVersion = version + 1;
      const publicTarget = input.visibility === 'public';
      const next = Object.assign({}, latest, {
        visibility: input.visibility, version: nextVersion, updatedAt: now(),
        moderationStatus: publicTarget ? publicStatus() : 'approved', moderationReason: null,
        publishedAt: publicTarget ? (useModeration ? (latest.publishedAt || null) : (latest.publishedAt || now())) : (latest.publishedAt || now())
      });
      await db.set('posts', postId, next);
      if (publicTarget && shouldEnqueueModeration()) await enqueueModeration(db, 'post', postId, nextVersion);
      return { postId, visibility: next.visibility, status: next.moderationStatus, version: next.version };
    });
  }
  async function deletePost(postId, input, viewer) {
    const current = await repository.get('posts', postId);
    requireOwner(current, viewer);
    const suppliedVersion = input.version === undefined || input.version === null || input.version === '' ? null : Number(input.version);
    if (suppliedVersion !== null && !Number.isInteger(suppliedVersion)) throw failure('版本号不正确', 400);
    const version = suppliedVersion === null ? Number(current.version || 1) : suppliedVersion;
    const requestId = requestKey(input);
    return idempotent(viewer.id, 'post.delete', requestId, { postId, version: suppliedVersion }, async db => {
      const latest = await db.get('posts', postId);
      requireOwner(latest, viewer);
      currentVersion({ version }, latest);
      if (latest.deletedAt) return { postId, deleted: true, version: Number(latest.version || 1) };
      const next = Object.assign({}, latest, { deletedAt: now(), version: Number(latest.version || 1) + 1, updatedAt: now() });
      await db.set('posts', postId, next);
      return { postId, deleted: true, version: next.version };
    });
  }
  async function deleteComment(commentId, input, viewer) {
    const current = await repository.get('comments', commentId);
    if (!current || current.authorId !== viewer.id) throw failure('无权操作该评论', 403);
    const requestId = requestKey(input);
    return idempotent(viewer.id, 'comment.delete', requestId, { commentId }, async db => {
      const latest = await db.get('comments', commentId);
      if (!latest || latest.authorId !== viewer.id) throw failure('无权操作该评论', 403);
      if (latest.deletedAt) {
        const stats = await db.get('post_stats', idFor('post', latest.postId)) || emptyPostStats(latest.postId);
        return { commentId, deleted: true, counts: statsCounts(stats), requestKey: requestId || null };
      }
      const stats = isPublicCommentStatus(latest)
        ? await updatePostStats(db, latest.postId, 'commentCount', -1)
        : (await db.get('post_stats', idFor('post', latest.postId)) || emptyPostStats(latest.postId));
      await db.set('comments', commentId, Object.assign({}, latest, { deletedAt: now(), updatedAt: now() }));
      return { commentId, deleted: true, counts: statsCounts(stats), requestKey: requestId || null };
    });
  }
  async function handle(path, input, req) {
    const viewer = await activeViewer(path, req);
    if (path === '/reports') {
      if (!viewer) throw failure('提交举报前请先微信登录', 401);
      return createReport(input || {}, viewer);
    }
    if (path === '/admin/reports') {
      if (!viewer) throw failure('查看举报前请先微信登录', 401);
      return listAdminReports(input || {}, viewer);
    }
    const adminResolve = path.match(/^\/admin\/reports\/([^/]+)\/resolve$/);
    if (adminResolve) {
      if (!viewer) throw failure('处理举报前请先微信登录', 401);
      return resolveAdminReport(adminResolve[1], input || {}, viewer);
    }
    const adminTakedown = path.match(/^\/admin\/posts\/([^/]+)\/takedown$/);
    if (adminTakedown) {
      if (!viewer) throw failure('下架内容前请先微信登录', 401);
      return directAdminTakedown(adminTakedown[1], input || {}, viewer);
    }
    if (path === '/community/feed') {
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
      const type = input.type && input.type !== 'all' ? String(input.type) : null;
      const keyword = typeof input.keyword === 'string' ? input.keyword.trim().slice(0, 50).toLowerCase() : '';
      const followed = input.tab === 'following' && viewer ? await listRelation('follows', 'followerId', viewer.id) : [];
      if (input.tab === 'following' && !viewer) return { items: [], nextCursor: null, hasMore: false, requiresLogin: true };
      const authors = input.tab === 'following' ? new Set(followed.map(row => row.followeeId)) : null;
      const query = { ...publicPostQuery };
      if (type) query.type = type;
      const result = await repository.collection('posts').where(query).orderBy('publishedAt', 'desc').limit(500).get();
      const cursor = decodeCursor(input.cursor);
      const filtered = (result.data || [])
        .filter(post => isPublicPost(post) && (!authors || authors.has(post.authorId)) && (!keyword || `${post.title} ${post.content} ${(post.placeNames || []).join(' ')}`.toLowerCase().includes(keyword)))
        .sort((a, b) => compareDescending('publishedAt', a, b))
        .filter(post => isAfterCursor(post, cursor));
      const page = filtered.slice(0, limit + 1);
      const hasMore = page.length > limit;
      const items = await Promise.all(page.slice(0, limit).map(post => decorate(post, viewer)));
      return { items, nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null, hasMore };
    }
    if (path === '/me') {
      const [user, stats, posts, favorites, following, followers, notificationPage] = await Promise.all([
        profile(viewer.id), getStats(viewer.id), listOwnPosts(viewer.id), listRelation('post_favorites', 'userId', viewer.id),
        listRelation('follows', 'followerId', viewer.id), listRelation('follows', 'followeeId', viewer.id), listNotifications(viewer.id, { limit: 50 })
      ]);
      const favoriteRows = await Promise.all(favorites.map(async row => ({ row, post: await repository.get('posts', row.postId) })));
      const favoritePosts = await Promise.all(favoriteRows.map(({ row, post }) => {
        if (!post || (!isPublicPost(post) && post.authorId !== viewer.id)) return { id: row.postId, unavailable: true, title: '内容已不可用', content: '', placeNames: [], photos: [], permissions: { canRemove: true } };
        return decorate(post, viewer);
      }));
      return { user, stats, posts, favorites: favoritePosts, following, followers, notifications: notificationPage.items, unreadCount: notificationPage.unreadCount };
    }
    if (path === '/me/following' || path === '/me/followers') {
      const followingList = path === '/me/following';
      const targetField = followingList ? 'followeeId' : 'followerId';
      const page = await listRelationPage('follows', followingList ? 'followerId' : 'followeeId', viewer.id, input);
      const items = await Promise.all(page.rows.map(row => relationView(row, targetField, viewer)));
      return { items, nextCursor: page.nextCursor, hasMore: page.hasMore };
    }
    if (path === '/me/notifications') {
      return listNotifications(viewer.id, input);
    }
    if (path === '/me/notifications/read') {
      const ids = Array.isArray(input.ids) ? input.ids.filter(id => typeof id === 'string').slice(0, 50) : [];
      let cutoff = null;
      if (input.before !== undefined && input.before !== null && input.before !== '') {
        cutoff = Number(input.before);
        if (!Number.isFinite(cutoff)) throw failure('已读截止时间无效', 400);
      }
      const result = await repository.collection('notifications').where({ recipientId: viewer.id }).limit(500).get();
      const targets = (result.data || []).filter(row => {
        if (ids.length) return ids.includes(rowId(row));
        return cutoff === null || Number(row.createdAt) <= cutoff;
      });
      let marked = 0;
      await repository.transaction(async tx => {
        for (const row of targets) {
          const current = await tx.get('notifications', rowId(row));
          if (!current || current.recipientId !== viewer.id || current.readAt) continue;
          await tx.set('notifications', rowId(row), Object.assign({}, current, { readAt: now() }));
          marked += 1;
        }
      });
      return { marked };
    }
    if (path === '/me/profile') {
      const current = await repository.get('users', viewer.id);
      if (!current) throw failure('用户资料不可用', 404);
      const version = Number(input.version);
      if (!Number.isInteger(version) || version !== current.profileVersion) throw failure('资料已被其他设备更新，请重新加载', 409);
      const patch = { profileVersion: version + 1, updatedAt: now() };
      if (input.nickname !== undefined) patch.nickname = cleanText(input.nickname, 1, 20, '昵称');
      if (input.bio !== undefined) {
        if (typeof input.bio !== 'string' || input.bio.length > 100) throw failure('简介长度不正确');
        patch.bio = input.bio.trim();
      }
      if (input.avatarMediaId !== undefined && input.avatarMediaId !== null) patch.avatarMediaId = cleanText(input.avatarMediaId, 1, 128, '头像');
      await repository.set('users', viewer.id, { ...current, ...patch });
      return { user: await profile(viewer.id) };
    }
    if (path === '/media/uploads') {
      if (!viewer) throw failure('上传图片前请先微信登录', 401);
      return requestMediaUpload(input, viewer);
    }
    const mediaComplete = path.match(/^\/media\/([^/]+)\/complete$/);
    if (mediaComplete) {
      if (!viewer) throw failure('确认图片前请先微信登录', 401);
      return completeMediaUpload(mediaComplete[1], input, viewer);
    }
    if (path === '/posts') {
      if (!viewer) throw failure('发布内容前请先微信登录', 401);
      return createPost(input, viewer);
    }
    const editPath = path.match(/^\/posts\/([^/]+)\/edit$/);
    if (editPath) {
      if (!viewer) throw failure('编辑内容前请先微信登录', 401);
      return updatePost(editPath[1], input, viewer);
    }
    const visibilityPath = path.match(/^\/posts\/([^/]+)\/visibility$/);
    if (visibilityPath) {
      if (!viewer) throw failure('修改公开范围前请先微信登录', 401);
      return changeVisibility(visibilityPath[1], input, viewer);
    }
    const deletePath = path.match(/^\/posts\/([^/]+)\/delete$/);
    if (deletePath) {
      if (!viewer) throw failure('删除内容前请先微信登录', 401);
      return deletePost(deletePath[1], input, viewer);
    }
    const postMatch = path.match(/^\/posts\/([^/]+)$/);
    if (postMatch) {
      if (input.action === 'update' || input.action === 'edit') {
        if (!viewer) throw failure('编辑内容前请先微信登录', 401);
        return updatePost(postMatch[1], input, viewer);
      }
      if (input.action === 'visibility') {
        if (!viewer) throw failure('修改公开范围前请先微信登录', 401);
        return changeVisibility(postMatch[1], input, viewer);
      }
      if (input.action === 'delete') {
        if (!viewer) throw failure('删除内容前请先微信登录', 401);
        return deletePost(postMatch[1], input, viewer);
      }
      const post = await repository.get('posts', postMatch[1]);
      if (!post || (!isPublicPost(post) && post.authorId !== viewer?.id)) throw failure('内容不可用', 404);
      const decorated = await decorate(post, viewer);
      return { post: decorated, author: decorated.author, viewerFollowing: Boolean(viewer && await hasFollow(viewer.id, post.authorId)), permissions: decorated.permissions, isOwner: decorated.isOwner };
    }
    const toggle = path.match(/^\/posts\/([^/]+)\/(like|favorite)$/);
    if (toggle) {
      const action = toggle[2];
      const table = action === 'like' ? 'post_likes' : 'post_favorites';
      const active = input.active === true;
      const postId = toggle[1];
      const relationId = idFor(viewer.id, postId);
      const requestId = requestKey(input);
      const payload = { postId, active };
      return idempotent(viewer.id, 'post.' + action, requestId, payload, async tx => {
        const post = await tx.get('posts', postId);
        const existing = await tx.get(table, relationId);
        if (!post) {
          if (active || !existing) throw failure('内容不可用', 404);
          await tx.remove(table, relationId);
          return { active: false, counts: statsCounts(await tx.get('post_stats', idFor('post', postId)) || emptyPostStats(postId)), requestKey: requestId || null };
        }
        if (active && !isPublicPost(post)) throw failure('内容不可用', 404);
        if (active && post.authorId === viewer.id && action === 'like') throw failure('不能给自己的帖子点赞', 403);
        if (active === Boolean(existing)) {
          const stats = await tx.get('post_stats', idFor('post', post.id)) || emptyPostStats(post.id);
          return { active, counts: statsCounts(stats), requestKey: requestId || null };
        }
        if (active) await tx.set(table, relationId, { id: relationId, userId: viewer.id, postId: post.id, createdAt: now() });
        else await tx.remove(table, relationId);
        const field = action === 'like' ? 'likeCount' : 'favoriteCount';
        const stats = await updatePostStats(tx, post.id, field, active ? 1 : -1);
        if (action === 'like') {
          await updateUserLikeStats(tx, post.authorId, active ? 1 : -1);
          if (active && isPublicPost(post)) {
            await ensureNotification(tx, {
              type: 'like', sourceId: idFor('like', post.id, viewer.id),
              recipientId: post.authorId, actorId: viewer.id, postId: post.id
            });
          }
        }
        return { active, counts: statsCounts(stats), requestKey: requestId || null };
      });
    }
    const follow = path.match(/^\/users\/([^/]+)\/follow$/);
    if (follow) {
      if (follow[1] === viewer.id) throw failure('不能关注自己', 403);
      const target = await profile(follow[1]);
      const relationId = idFor(viewer.id, target.id);
      const active = input.active === true;
      const requestId = requestKey(input);
      return idempotent(viewer.id, 'user.follow', requestId, { followeeId: target.id, active }, async tx => {
        const existing = await tx.get('follows', relationId);
        if (active === Boolean(existing)) return { following: active, target, requestKey: requestId || null };
        if (active) await tx.set('follows', relationId, { followerId: viewer.id, followeeId: target.id, createdAt: now() });
        else await tx.remove('follows', relationId);
        const selfStatsId = idFor('user', viewer.id), targetStatsId = idFor('user', target.id);
        const selfStats = await tx.get('post_stats', selfStatsId) || emptyUserStats(viewer.id);
        const targetStats = await tx.get('post_stats', targetStatsId) || emptyUserStats(target.id);
        selfStats.followingCount = adjustCount(selfStats.followingCount, active ? 1 : -1);
        targetStats.followerCount = adjustCount(targetStats.followerCount, active ? 1 : -1);
        await tx.set('post_stats', selfStatsId, selfStats);
        await tx.set('post_stats', targetStatsId, targetStats);
        if (active) {
          await ensureNotification(tx, {
            type: 'follow', sourceId: idFor('follow', viewer.id, target.id),
            recipientId: target.id, actorId: viewer.id
          });
        }
        return { following: active, target, requestKey: requestId || null };
      });
    }
    const member = path.match(/^\/users\/([^/]+)$/);
    if (member) {
      const target = await profile(member[1]);
      const stats = await getStats(target.id);
      // Member pages expose only the target's public posts; the owner/me path keeps private ones.
      const source = input || {};
      const limit = Math.min(Math.max(Number(source.limit) || 20, 1), 50);
      const cursor = decodeCursor(source.cursor);
      const result = await repository.collection('posts').where({ authorId: target.id, visibility: 'public', takenDown: false }).orderBy('publishedAt', 'desc').limit(500).get();
      const rows = (result.data || [])
        .filter(isPublicPost)
        .sort((a, b) => compareDescending('publishedAt', a, b))
        .filter(row => isAfterCursor(row, cursor));
      const page = rows.slice(0, limit + 1);
      const hasMore = page.length > limit;
      const visible = page.slice(0, limit);
      return {
        user: target, stats,
        posts: await Promise.all(visible.map(post => decorate(post, viewer))),
        viewerFollowing: Boolean(viewer && await hasFollow(viewer.id, target.id)),
        nextCursor: hasMore && visible.length ? encodeCursor(visible[visible.length - 1]) : null,
        hasMore
      };
    }
    const commentDelete = path.match(/^\/comments\/([^/]+)\/delete$/);
    if (commentDelete) {
      if (!viewer) throw failure('删除评论前请先微信登录', 401);
      return deleteComment(commentDelete[1], input, viewer);
    }
    const commentPost = path.match(/^\/posts\/([^/]+)\/comments$/);
    if (commentPost) {
      const post = await repository.get('posts', commentPost[1]);
      const isOwner = Boolean(viewer && post && post.authorId === viewer.id);
      if (!post || (!isPublicPost(post) && !isOwner)) throw failure('内容不可用', 404);
      if (input.action === 'delete' && input.commentId) {
        if (!viewer) throw failure('删除评论前请先微信登录', 401);
        return deleteComment(String(input.commentId), input, viewer);
      }
      if (input.action === 'list' || input.mode === 'list') {
        const postIsPublic = isPublicPost(post);
        const query = postIsPublic ? { postId: post.id } : { postId: post.id, authorId: viewer.id };
        const rows = await repository.collection('comments').where(query).orderBy('createdAt', 'desc').limit(200).get();
        const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
        const cursor = decodeCursor(input.cursor);
        const commentVisible = row => postIsPublic
          ? isPublicCommentStatus(row) || Boolean(viewer && row.authorId === viewer.id)
          : true;
        const allRows = (rows.data || []).filter(commentVisible);
        const sorted = allRows.sort((a, b) => compareDescending('createdAt', a, b)).filter(row => {
          if (!row.deletedAt) return true;
          if (!postIsPublic || row.rootId) return false;
          return allRows.some(reply => reply.rootId === row.id && !reply.deletedAt && commentVisible(reply));
        }).filter(row => isAfterCursor(row, cursor, 'createdAt'));
        const page = sorted.slice(0, limit + 1);
        const hasMore = page.length > limit;
        const items = await Promise.all(page.slice(0, limit).map(async row => {
          const author = row.deletedAt ? { id: '', nickname: '已删除', bio: '', avatarMediaId: null, profileVersion: 1 } : await safeProfile(row.authorId);
          const replyTarget = row.replyToUserId ? await safeProfile(row.replyToUserId) : null;
          return {
            id: rowId(row), postId: row.postId, authorId: row.authorId,
            rootId: row.rootId || null, replyToId: row.replyToId || null,
            replyToUserId: row.replyToUserId || null, replyToUserName: replyTarget && replyTarget.nickname || '',
            content: row.deletedAt ? '评论已删除' : (row.content || ''),
            moderationStatus: row.moderationStatus, deletedAt: row.deletedAt || null, createdAt: row.createdAt,
            statusText: row.moderationStatus === 'pending' ? '审核中（仅自己可见）' : row.moderationStatus === 'rejected' ? '未通过' : '',
            canReply: !row.deletedAt && commentVisible(row),
            canDelete: Boolean(viewer && row.authorId === viewer.id && !row.deletedAt), author
          };
        }));
        return { items, nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1], 'createdAt') : null, hasMore };
      }
      if (!viewer) throw failure('发表评论前请先微信登录', 401);
      if (!isPublicPost(post)) throw failure('内容不可用', 404);
      const content = cleanText(input.content, 1, 1000, '评论');
      const replyToId = input.replyToId === undefined || input.replyToId === null || input.replyToId === ''
        ? null : cleanText(String(input.replyToId), 1, 128, '回复目标');
      let rootId = null;
      let replyToUserId = null;
      if (replyToId) {
        const target = await repository.get('comments', replyToId);
        if (!target || target.postId !== post.id || target.deletedAt) throw failure('回复目标不可用', 404);
        rootId = target.rootId || target.id;
        replyToUserId = target.authorId;
      }
      const requestId = requestKey(input);
      return idempotent(viewer.id, 'comment.create', requestId, { postId: post.id, rootId, replyToId, content }, async db => {
        const latestPost = await db.get('posts', post.id);
        if (!latestPost || !isPublicPost(latestPost)) throw failure('内容不可用', 404);
        let latestReplyTarget = null;
        if (replyToId) {
          latestReplyTarget = await db.get('comments', replyToId);
          if (!latestReplyTarget || latestReplyTarget.postId !== latestPost.id || latestReplyTarget.deletedAt) throw failure('回复目标不可用', 404);
          rootId = latestReplyTarget.rootId || latestReplyTarget.id;
          replyToUserId = latestReplyTarget.authorId;
        }
        const id = randomUUID();
        const comment = { id, postId: latestPost.id, authorId: viewer.id, rootId, replyToId, replyToUserId, content, moderationStatus: publicStatus(), moderationReason: null, deletedAt: null, version: 1, createdAt: now(), updatedAt: now() };
        await db.set('comments', id, comment);
        const stats = isPublicCommentStatus(comment)
          ? await updatePostStats(db, latestPost.id, 'commentCount', 1)
          : (await db.get('post_stats', idFor('post', latestPost.id)) || emptyPostStats(latestPost.id));
        if (isPublicCommentStatus(comment)) {
          const recipients = new Set([latestPost.authorId]);
          if (latestReplyTarget && latestReplyTarget.authorId) recipients.add(latestReplyTarget.authorId);
          for (const recipientId of recipients) {
            await ensureNotification(db, {
              type: replyToId ? 'reply' : 'comment', sourceId: idFor('comment', id),
              recipientId, actorId: viewer.id, postId: latestPost.id, commentId: id
            });
          }
        }
        if (shouldEnqueueModeration()) await enqueueModeration(db, 'comment', id, 1);
        return { commentId: id, status: comment.moderationStatus, version: 1, counts: statsCounts(stats), requestKey: requestId || null };
      });
    }
    throw failure('接口不存在', 404);
  }
  // Keep the consumer unavailable while moderation is paused; re-enable it only
  // together with an explicit moderation configuration and acceptance pass.
  const moderation = useModeration ? createModerationWorker({ repository, checker: moderationChecker }) : null;
  return { handle, moderation, moderationWorker: moderation };
}
module.exports = { createCommunityApi };
