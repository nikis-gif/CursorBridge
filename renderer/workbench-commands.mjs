// Pure workbench behaviors shared by the renderer and automated tests.
export const INSERT_GROUPS = [
  { name: 'Scripting', classes: ['Script', 'LocalScript', 'ModuleScript', 'Folder'] },
  { name: '3D & organization', classes: ['Model', 'Part', 'MeshPart', 'SpawnLocation', 'Attachment', 'Configuration'] },
  { name: 'Communication', classes: ['RemoteEvent', 'RemoteFunction', 'BindableEvent', 'BindableFunction'] },
  { name: 'Data', classes: ['BoolValue', 'IntValue', 'NumberValue', 'StringValue', 'ObjectValue'] },
  { name: 'Interface', classes: ['ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel', 'ImageButton', 'UIListLayout', 'UICorner', 'UIPadding'] },
  { name: 'Media', classes: ['Sound', 'Animation'] },
];

export function moveTab(ids, fromId, toId, placeAfter = false) {
  const source = ids.indexOf(fromId);
  const target = ids.indexOf(toId);
  if (source < 0 || target < 0 || fromId === toId) return [...ids];
  const next = [...ids];
  next.splice(source, 1);
  const newTarget = next.indexOf(toId);
  next.splice(newTarget + (placeAfter ? 1 : 0), 0, fromId);
  return next;
}

export function clipboardMutation(clipboard, nodes, placeKey, parentId) {
  if (!clipboard || clipboard.placeKey !== placeKey) throw new Error('Clipboard belongs to another Studio session.');
  if (!nodes.has(parentId)) throw new Error('Choose a destination in the connected place.');
  const ids = [...new Set(clipboard.ids || [])];
  if (!ids.length || ids.some((id) => !nodes.has(id))) throw new Error('The copied selection has changed in Studio.');
  if (clipboard.mode === 'cut') {
    for (const id of ids) {
      let current = nodes.get(parentId);
      const seen = new Set();
      while (current && !seen.has(current.id)) {
        if (current.id === id) throw new Error('Cannot move an instance into its own descendants.');
        seen.add(current.id);
        current = nodes.get(current.parentId);
      }
    }
    return { action: 'move', ids, parentId };
  }
  if (clipboard.mode === 'copy') return { action: 'duplicate', ids, parentId };
  throw new Error('Unknown clipboard operation.');
}
