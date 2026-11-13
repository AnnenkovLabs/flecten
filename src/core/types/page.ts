import type { CriterionId, PageId } from "./ids";

export interface Page {
  id: PageId;
  criterionId: CriterionId;
  title: string;
  files: string[];
}

export interface Handoff {
  pageId: PageId;
  changed: string[];
  invariants: string[];
  next: string;
  risks: string[];
}
