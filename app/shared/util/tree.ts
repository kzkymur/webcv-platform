export type TreeNode = {
  name: string;
  path: string;
  children?: TreeNode[];
  isDir: boolean;
};

export function buildTree(paths: string[]): TreeNode[] {
  const root: Record<string, any> = {};
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      cur.children = cur.children || {};
      cur.children[part] = cur.children[part] || {};
      cur = cur.children[part];
    }
    cur.__file = true;
  }
  function toNodes(name: string, node: any, prefix: string): TreeNode {
    const path = prefix ? `${prefix}/${name}` : name;
    if (!node.children) return { name, path, isDir: false };
    return {
      name,
      path,
      isDir: true,
      children: Object.keys(node.children)
        .sort()
        .map((k) => toNodes(k, node.children[k], path)),
    };
  }
  return Object.keys(root.children || {})
    .sort()
    .map((k) => toNodes(k, root.children[k], ""));
}
