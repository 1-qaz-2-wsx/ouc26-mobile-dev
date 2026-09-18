// PRD v2.1: separate records, never unbounded arrays of followers/comments.
// All collections are server-only; HTTP handlers enforce viewer permissions.
const ENV_ID = 'cloud1-d3g8eu6faa3e4bee6';
const index = (name, fields, unique = false) => ({
  IndexName: name,
  MgoKeySchema: {
    MgoIndexKeys: Object.entries(fields).map(([Name, direction]) => ({ Name, Direction: String(direction) })),
    MgoIsUnique: unique
  }
});
const schema = {
  users: [index('status_created', { status: 1, createdAt: -1 })],
  user_identities: [index('identity_unique', { provider: 1, appid: 1, openid: 1 }, true)],
  user_aliases: [index('user_aliases', { userId: 1 })],
  posts: [index('author_created', { authorId: 1, createdAt: -1, _id: -1 }), index('public_feed', { visibility: 1, moderationStatus: 1, deletedAt: 1, takenDown: 1, publishedAt: -1 }), index('author_source', { authorId: 1, sourceKey: 1 })],
  post_places: [index('post_place_unique', { postId: 1, placeId: 1 }, true), index('place_posts', { placeId: 1 })],
  media: [index('owner_created', { ownerId: 1, createdAt: -1 }), index('storage_unique', { storageKey: 1 }, true)],
  post_media: [index('post_media_unique', { postId: 1, mediaId: 1 }, true), index('media_posts', { mediaId: 1 })],
  post_likes: [index('user_post_unique', { userId: 1, postId: 1 }, true), index('post_likes', { postId: 1, createdAt: -1 })],
  post_favorites: [index('user_post_unique', { userId: 1, postId: 1 }, true), index('user_favorites', { userId: 1, createdAt: -1, _id: -1 })],
  follows: [index('follow_unique', { followerId: 1, followeeId: 1 }, true), index('followers', { followeeId: 1, createdAt: -1, _id: -1 }), index('following', { followerId: 1, createdAt: -1, _id: -1 })],
  comments: [index('post_comments', { postId: 1, rootId: 1, createdAt: -1, _id: -1 }), index('root_replies', { rootId: 1, createdAt: 1, _id: 1 })],
  notifications: [index('event_recipient_unique', { sourceId: 1, recipientId: 1 }, true), index('recipient_created', { recipientId: 1, createdAt: -1, _id: -1 })],
  reports: [index('report_unique', { reporterId: 1, targetType: 1, targetId: 1 }, true), index('pending_reports', { status: 1, createdAt: 1 })],
  idempotency_records: [index('request_unique', { actorId: 1, operation: 1, requestKey: 1 }, true), index('expiry', { expiresAt: 1 })],
  moderation_jobs: [index('target_version_unique', { targetType: 1, targetId: 1, targetVersion: 1 }, true), index('pending_jobs', { status: 1, nextRunAt: 1 })],
  post_stats: [index('rank_score', { rankScore: -1, _id: -1 })],
  feed_snapshots: [index('expiry', { expiresAt: 1 })],
  feed_snapshot_items: [index('snapshot_position_unique', { snapshotId: 1, position: 1 }, true)],
  rate_limits: [index('expiry', { expiresAt: 1 })],
  audit_events: [index('actor_time', { actorId: 1, createdAt: -1 })]
};
const collections = Object.entries(schema).map(([name, indexes]) => ({
  name: 'community_' + name, indexes, permission: 'ADMINONLY'
}));
const travelCollections = [
  { name: 'travel_plans', indexes: [index('owner_updated', { ownerId: 1, updatedAt: -1, _id: -1 })], permission: 'ADMINONLY' },
  { name: 'travel_trips', indexes: [index('owner_updated', { ownerId: 1, updatedAt: -1, _id: -1 })], permission: 'ADMINONLY' },
  // 2026-09-18：行程提醒功能搁置废弃，travel_reminders 集合保留兼容（旧客户端仍可同步），不再有新产品写入。
  { name: 'travel_reminders', indexes: [index('owner_trip', { ownerId: 1, tripId: 1, eventAt: 1 }), index('owner_send', { ownerId: 1, sendAt: 1 })], permission: 'ADMINONLY' },
  { name: 'travel_bookings', indexes: [index('owner_updated', { ownerId: 1, updatedAt: -1, _id: -1 })], permission: 'ADMINONLY' }
];
const planningCollections = [
  { name: 'planning_jobs', indexes: [index('owner_updated', { ownerId: 1, updatedAt: -1 }), index('owner_idempotency', { ownerId: 1, idempotencyKey: 1 }, true)], permission: 'ADMINONLY' },
  { name: 'planning_drafts', indexes: [index('owner_updated', { ownerId: 1, updatedAt: -1 })], permission: 'ADMINONLY' },
  { name: 'planning_provider_budgets', indexes: [index('provider_scope', { provider: 1, scope: 1 }, true)], permission: 'ADMINONLY' }
];
module.exports = { ENV_ID, collections: collections.concat(travelCollections, planningCollections) };
