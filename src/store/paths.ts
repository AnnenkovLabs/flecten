import { join } from "node:path";

export interface ProjectPaths {
  liquid: string;
  db: string;
  profile: string;
  terms: string;
  /** Held by the one core that works in the project; see `src/app/project-lock.ts`. */
  lock: string;
}

export interface SessionPaths {
  root: string;
  session: string;
  spec: string;
  pages: string;
  events: string;
  logs: string;
  queue: string;
  attachments: string;
}

export function projectPaths(root: string): ProjectPaths {
  const liquid = join(root, ".liquid");
  return {
    liquid,
    db: join(liquid, "liquid.db"),
    profile: join(liquid, "profile.json"),
    terms: join(liquid, "terms.jsonl"),
    lock: join(liquid, "sidecar.lock"),
  };
}

export function sessionPaths(root: string, sessionId: string): SessionPaths {
  const session = join(root, ".liquid", "sessions", sessionId);
  return {
    root,
    session,
    spec: join(session, "spec.json"),
    pages: join(session, "pages"),
    events: join(session, "events.jsonl"),
    logs: join(session, "logs"),
    queue: join(session, "queue.json"),
    attachments: join(session, "attachments"),
  };
}
