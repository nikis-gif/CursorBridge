// Pure Explorer helpers, shared with Node tests. No direct DataModel mutations.
const SERVICE_ORDER = ['Workspace', 'Players', 'CoreGui', 'Lighting', 'MaterialService',
  'NetworkClient', 'ReplicatedFirst', 'ReplicatedStorage', 'ServerScriptService',
  'ServerStorage', 'StarterGui', 'StarterPack', 'StarterPlayer', 'Teams',
  'SoundService', 'TextChatService', 'Chat', 'TestService', 'LocalizationService'];
const SERVICE_RANK = new Map(SERVICE_ORDER.map((name, i) => [name, i]));

export function buildExplorerRows(nodes, expanded, searchTerm = '', maxRows = 1000000, childPages = new Map(), fullyIndexed = false) {
  const term = searchTerm.trim().toLocaleLowerCase();
  const children = new Map();
  for (const node of nodes.values()) {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  }
  for (const [parentId, group] of children) {
    group.sort((a, b) => {
      if (parentId === 'game') {
        const orderA = SERVICE_RANK.get(a.className) ?? 500;
        const orderB = SERVICE_RANK.get(b.className) ?? 500;
        if (orderA !== orderB) return orderA - orderB;
      }
      // Explorer places Workspace's camera and terrain ahead of arbitrary children.
      // These engine-owned entries are special, even if GetChildren() returns
      // custom instances between them. The remaining children keep Studio order.
      const parent = nodes.get(parentId);
      if (parent?.className === 'Workspace') {
        const priority = (node) => node.className === 'Camera' ? 0 : node.className === 'Terrain' ? 1 : 2;
        const orderA = priority(a);
        const orderB = priority(b);
        if (orderA !== orderB) return orderA - orderB;
      }
      // Studio child order is not alphabetical. Preserve GetChildren() order when supplied.
      // Older plugins omit this field: insertion order is the backward-compatible fallback.
      const aOrder = Number.isFinite(a.siblingOrder) ? a.siblingOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b.siblingOrder) ? b.siblingOrder : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
  }
  const visible = new Set();
  if (term) {
    for (const node of nodes.values()) {
      if (!node.name.toLocaleLowerCase().includes(term) && !node.className.toLocaleLowerCase().includes(term)) continue;
      const seen = new Set();
      let current = node;
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        visible.add(current.id);
        current = nodes.get(current.parentId);
      }
    }
  }
  const rows = [];
  function visit(parentId, depth, ancestors) {
    if (rows.length >= maxRows || depth >= 512 || ancestors.has(parentId)) return;
    const next = new Set(ancestors);
    next.add(parentId);
    for (const node of children.get(parentId) || []) {
      if (rows.length >= maxRows) return;
      if (term && !visible.has(node.id)) continue;
      const hasChildren = !!children.get(node.id)?.length || node.hasChildren === true;
      const isExpanded = term ? true : expanded.has(node.id);
      rows.push({ id: node.id, node, depth, hasChildren, expanded: isExpanded });
      if (isExpanded && hasChildren) {
        visit(node.id, depth + 1, next);
        const page = childPages.get(node.id);
        // A page marker appears even when zero children have been fetched.
        // It never represents an Instance and cannot be moved or deleted.
        if (!fullyIndexed && !term && node.hasChildren === true && page?.complete !== true && rows.length < maxRows) {
          rows.push({ id: `@cursor-page:${node.id}`, node: null,
            depth: depth + 1, parentId: node.id, pageMarker: true });
        }
      }
    }
  }
  visit('game', 0, new Set());
  return { rows, truncated: rows.length >= maxRows };
}

export function selectRange(orderedIds, anchorId, destinationId) {
  const start = orderedIds.indexOf(anchorId);
  const end = orderedIds.indexOf(destinationId);
  if (start < 0 || end < 0) return new Set([destinationId]);
  return new Set(orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1));
}

export function uniqueRoots(nodes, selectedIds) {
  const selected = new Set(selectedIds);
  return [...selected].filter((id) => {
    const visited = new Set();
    let current = nodes.get(id);
    if (!current || current.parentId === 'game') return false;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (selected.has(current.parentId)) return false;
      current = nodes.get(current.parentId);
    }
    return true;
  });
}

export function isNodeInside(nodes, candidateId, ancestorId) {
  const visited = new Set();
  let current = nodes.get(candidateId);
  while (current && !visited.has(current.id)) {
    if (current.id === ancestorId) return true;
    visited.add(current.id);
    current = nodes.get(current.parentId);
  }
  return false;
}

export function pathForNode(nodes, id) {
  const segments = [];
  const visited = new Set();
  let current = nodes.get(id);
  while (current && !visited.has(current.id)) {
    segments.unshift(current.name);
    visited.add(current.id);
    current = nodes.get(current.parentId);
  }
  return ['game', ...segments].join(' / ');
}
