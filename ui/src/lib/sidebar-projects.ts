import { z } from "zod";
import type { Project, Task } from "./types";

const KEY = "flecten.sidebar.projects";
const schema = z.object({
  order: z.array(z.string()),
  collapsed: z.array(z.string()),
  standaloneCollapsed: z.boolean().default(false),
});
type Preferences = z.infer<typeof schema>;

export function readSidebarProjects(): Preferences {
  try {
    const result = schema.safeParse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
    if (result.success) return result.data;
  } catch {
    // The sidebar still works when preferences are unavailable.
  }
  return { order: [], collapsed: [], standaloneCollapsed: false };
}

export function saveSidebarProjects(prefs: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Keep the updated preferences for this window.
  }
}

export function orderSidebarFolders(projects: Project[], order: string[]): Project[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return projects
    .filter((project) => project.projectRoot !== null)
    .sort((a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
}

export function searchSidebarProjects(
  projects: Project[],
  query: string,
  locale: string,
): Project[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (!needle) return projects;
  return projects.flatMap((project) => {
    if (project.name.toLocaleLowerCase(locale).includes(needle)) return [project];
    const tasks = searchSidebarTasks(project.tasks ?? [], needle, locale);
    return tasks.length ? [{ ...project, tasks }] : [];
  });
}

export function searchSidebarTasks(tasks: Task[], needle: string, locale: string): Task[] {
  if (!needle) return tasks;
  return tasks.filter(
    (task) =>
      task.title.toLocaleLowerCase(locale).includes(needle) ||
      task.lastPrompt?.toLocaleLowerCase(locale).includes(needle),
  );
}
