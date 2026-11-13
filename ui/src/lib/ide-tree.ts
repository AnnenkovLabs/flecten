export interface FileNode {
  name: string;
  path: string;
  directory: boolean;
  children: FileNode[];
}

export function fileTree(
  paths: readonly string[],
  query = "",
  directories: readonly string[] = [],
): FileNode[] {
  const roots: FileNode[] = [];
  const filter = query.trim().toLocaleLowerCase();
  for (const path of [...directories, ...paths]) {
    if (filter && !path.toLocaleLowerCase().includes(filter)) continue;
    const parts = path.split("/");
    let nodes = roots;
    let prefix = "";
    for (const [index, name] of parts.entries()) {
      prefix = prefix ? `${prefix}/${name}` : name;
      let node = nodes.find((entry) => entry.path === prefix);
      if (!node) {
        node = {
          name,
          path: prefix,
          directory:
            index < parts.length - 1 || directories.includes(path) || directories.includes(path),
          children: [],
        };
        nodes.push(node);
      }
      nodes = node.children;
    }
  }
  const sort = (nodes: FileNode[]): void => {
    nodes.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    for (const node of nodes) sort(node.children);
  };
  sort(roots);
  return roots;
}
