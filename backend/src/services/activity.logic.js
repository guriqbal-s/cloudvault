// Activity logging. A failure to write a log row must NEVER fail the user's request, so every
// error is swallowed (and reported through the logger).

const trunc = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : null);

/** @param {{ db: object, logger: { error: Function } }} deps */
export function createActivityService({ db, logger }) {
  /**
   * @param {object} entry
   * @param {string|null} entry.userId        actor
   * @param {string} entry.action             an ActivityAction enum value
   * @param {string} entry.description        human readable sentence shown in the UI
   * @param {'FILE'|'FOLDER'} [entry.resourceType]
   * @param {string} [entry.resourceId]
   * @param {string} [entry.resourceName]     snapshot, so logs survive deletion
   * @param {object} [entry.metadata]
   * @param {{ip?: string, userAgent?: string}} [entry.meta]  request context
   */
  async function log(entry) {
    try {
      await db.activityLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          resourceName: trunc(entry.resourceName, 255),
          description: entry.description,
          metadata: entry.metadata ?? undefined,
          ip: trunc(entry.meta?.ip, 64),
          userAgent: trunc(entry.meta?.userAgent, 512),
        },
      });
    } catch (err) {
      logger.error('Failed to write activity log:', err);
    }
  }

  return { log };
}
