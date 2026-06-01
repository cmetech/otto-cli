import type { CellEntry } from './cell-archive.js';

export interface TreeNode {
  cell: CellEntry;
  children: TreeNode[];
}

export interface CellTree {
  root: TreeNode | null;
  byId: Map<number, TreeNode>;
  orphans: TreeNode[];
}

export function projectTree(cells: CellEntry[]): CellTree {
  const byId = new Map<number, TreeNode>();
  for (const cell of cells) byId.set(cell.id, { cell, children: [] });
  const orphans: TreeNode[] = [];
  const rootCandidates: TreeNode[] = [];
  for (const cell of cells) {
    const node = byId.get(cell.id)!;
    if (cell.parentId === null) {
      rootCandidates.push(node);
      continue;
    }
    const parent = byId.get(cell.parentId);
    if (parent) parent.children.push(node);
    else orphans.push(node);
  }
  let root: TreeNode | null = null;
  if (rootCandidates.length >= 1) {
    root = rootCandidates[0];
    // 1d/1d2 invariant: exactly one root. Defensive: extra roots become orphans.
    for (let i = 1; i < rootCandidates.length; i++) orphans.push(rootCandidates[i]);
  }
  return { root, byId, orphans };
}

export function findLeaves(tree: CellTree): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of tree.byId.values()) {
    if (node.children.length === 0) out.push(node);
  }
  return out;
}

export function validateLeafId(tree: CellTree, id: number): void {
  if (!tree.byId.has(id)) {
    throw new Error(`cell id ${id} not found`);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function summarizeCell(cell: CellEntry): string {
  const okFlag = cell.ok ? 'ok ' : 'err';
  const detail = cell.ok
    ? `value=${truncate(JSON.stringify(cell.value ?? null), 40)}`
    : `error=${truncate(cell.error?.message ?? '', 40)}`;
  const codePreview = truncate(cell.code.split('\n')[0], 60);
  return `#${cell.id} ${okFlag} ${detail.padEnd(45)} ${codePreview}`;
}

function renderNode(
  node: TreeNode,
  depth: number,
  lastSibling: boolean,
  currentLeaf: number | null | undefined,
  out: string[],
): void {
  const indent = '  '.repeat(depth);
  const connector = lastSibling ? '└─' : '├─';
  const marker = currentLeaf === node.cell.id ? ' *' : '';
  out.push(`${indent}${connector} ${summarizeCell(node.cell)}${marker}`);
  const last = node.children.length - 1;
  node.children.forEach((child, i) => renderNode(child, depth + 1, i === last, currentLeaf, out));
}

export function formatTreeText(tree: CellTree, currentLeaf?: number | null): string {
  const lines: string[] = [];
  if (tree.root) renderNode(tree.root, 0, true, currentLeaf ?? null, lines);
  if (tree.orphans.length > 0) {
    lines.push('# orphans:');
    const last = tree.orphans.length - 1;
    tree.orphans.forEach((o, i) => renderNode(o, 0, i === last, currentLeaf ?? null, lines));
  }
  return lines.join('\n');
}
