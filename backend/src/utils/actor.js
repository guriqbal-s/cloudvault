// The access layer wants an "actor" ({ id, permissions }); the auth middleware sets
// req.user = { user, roles, permissions, rank, sessionId }. This adapts one to the other.
export function actorOf(req) {
  const p = req.user;
  return { id: p.user.id, user: p.user, roles: p.roles, permissions: p.permissions, rank: p.rank };
}

/** Request context recorded on activity log rows. */
export const metaOf = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
