import type { Redis, Cluster } from "ioredis";

export type SiteEventType =
  | "pipeline.job.started"
  | "pipeline.job.completed"
  | "pipeline.job.failed"
  | "pipeline.stage.started"
  | "pipeline.stage.progress"
  | "pipeline.stage.log"
  | "pipeline.stage.completed"
  | "pipeline.stage.failed"
  | "ai.activity.created"
  | "deployment.updated"
  | "site.updated";

export interface SiteEvent {
  type: SiteEventType;
  workspaceUuid: string;
  siteUuid?: string | null;
  jobId?: string | null;
  timestamp: string;
  payload?: Record<string, unknown> | null;
}

function channelName(workspaceUuid: string): string {
  return `events:${workspaceUuid}`;
}

/**
 * Publish a typed site/workspace event to Redis pub/sub. The SSE broadcaster
 * subscribes to the workspace channel and forwards matching events to clients.
 */
export async function publishEvent(
  redis: Redis | Cluster,
  event: SiteEvent,
): Promise<void> {
  await redis.publish(channelName(event.workspaceUuid), JSON.stringify(event));
}

export interface EventFilter {
  workspaceUuid: string;
  siteUuid?: string;
  types?: SiteEventType[];
}

/**
 * Returns true when an event passes a client filter. Site streams only see
 * events for their site (or workspace-wide events with no siteUuid).
 */
export function eventMatchesFilter(event: SiteEvent, filter: EventFilter): boolean {
  if (event.workspaceUuid !== filter.workspaceUuid) return false;
  if (filter.siteUuid && event.siteUuid && event.siteUuid !== filter.siteUuid) {
    return false;
  }
  if (filter.types && !filter.types.includes(event.type)) return false;
  return true;
}
