import { join } from "node:path";
import { canonicalPath } from "../util/canonical-path";

export interface ProjectPaths {
  flecten: string;
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
  const flecten = join(root, ".flecten");
  return {
    flecten,
    db: join(flecten, "flecten.db"),
    profile: join(flecten, "profile.json"),
    terms: join(flecten, "terms.jsonl"),
    lock: join(flecten, "sidecar.lock"),
  };
}

export function sessionPaths(root: string, sessionId: string): SessionPaths {
  root = canonicalPath(root);
  const session = join(root, ".flecten", "sessions", sessionId);
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
