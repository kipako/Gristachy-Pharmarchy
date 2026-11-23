import { randomUUID } from "node:crypto";

export function recordAuditEvent(
  db,
  { actorId = null, eventType, entityType, entityId, metadata = {} }
) {
  db.prepare(
    `
    INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json)
    VALUES (@id, @actorId, @eventType, @entityType, @entityId, @metadataJson)
  `
  ).run({
    id: randomUUID(),
    actorId,
    eventType,
    entityType,
    entityId,
    metadataJson: JSON.stringify(metadata)
  });
}

export function listAuditEvents(db, { entityType, entityId }) {
  return db
    .prepare(
      `
      SELECT a.id, a.event_type, a.entity_type, a.entity_id, a.metadata_json, a.created_at,
             s.display_name AS actor_name, s.role AS actor_role
      FROM audit_events a
      LEFT JOIN staff_users s ON s.id = a.actor_id
      WHERE a.entity_type = ? AND a.entity_id = ?
      ORDER BY a.created_at ASC, a.id ASC
    `
    )
    .all(entityType, entityId)
    .map((event) => {
      let metadata;
      try {
        metadata = JSON.parse(event.metadata_json);
      } catch {
        metadata = {};
      }
      return {
        id: event.id,
        eventType: event.event_type,
        entityType: event.entity_type,
        entityId: event.entity_id,
        metadata,
        createdAt: event.created_at,
        actor: event.actor_name ? { name: event.actor_name, role: event.actor_role } : null
      };
    });
}
