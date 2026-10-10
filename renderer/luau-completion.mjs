// Lightweight live DataModel completions. This is NOT the Roblox Luau compiler or type checker.
export const ROOT_SYMBOLS = [
  'game', 'workspace', 'script', 'Instance', 'Enum', 'Vector3', 'Vector2',
  'CFrame', 'UDim2', 'UDim', 'Color3', 'BrickColor', 'task', 'math',
  'table', 'string', 'utf8', 'coroutine', 'print', 'warn', 'require',
  'pairs', 'ipairs', 'type', 'typeof', 'assert', 'setmetatable',
];

export const SERVICES = [
  'Workspace', 'ReplicatedFirst', 'ReplicatedStorage', 'ServerScriptService',
  'ServerStorage', 'StarterGui', 'StarterPack', 'StarterPlayer', 'Lighting',
  'SoundService', 'Players', 'Teams', 'TextChatService', 'TestService',
  'LocalizationService',
];

const IDENTIFIER = /^[A-Za-z_][A-Za-z_0-9]*$/;

export function getChildren(nodes, parentId) {
  return [...nodes.values()]
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function parseExpression(expression) {
  const trimmed = expression.trim();
  const result = [];
  const root = trimmed.match(/^(game|workspace|script)/i);
  if (!root) return null;
  result.push(root[1]);
  let tail = trimmed.slice(root[0].length);
  while (tail.length) {
    const dot = tail.match(/^\.([A-Za-z_][A-Za-z_0-9]*)/);
    const bracket = tail.match(/^\[("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/);
    const parent = tail.match(/^\.Parent/);
    if (dot) {
      result.push(dot[1]);
      tail = tail.slice(dot[0].length);
    } else if (bracket) {
      const escaped = bracket[1];
      let name;
      if (escaped.startsWith('"')) {
        try { name = JSON.parse(escaped); } catch { return null; }
      } else {
        name = escaped.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      }
      result.push(name);
      tail = tail.slice(bracket[0].length);
    } else if (parent) {
      result.push('Parent');
      tail = tail.slice(parent[0].length);
    } else {
      return null;
    }
  }
  return result;
}

export function resolveExpression(expression, nodes, currentScriptId = null) {
  const parts = parseExpression(expression);
  if (!parts) return null;
  const root = parts.shift().toLowerCase();
  let selected;
  if (root === 'script') selected = nodes.get(currentScriptId);
  else if (root === 'game') selected = { id: 'game' };
  else selected = getChildren(nodes, 'game').find((node) => node.name.toLowerCase() === 'workspace');
  if (!selected) return null;
  for (const part of parts) {
    if (part === 'Parent') selected = nodes.get(selected.parentId) || (selected.parentId === 'game' ? { id: 'game' } : null);
    else selected = getChildren(nodes, selected.id).find((node) => node.name === part);
    if (!selected) return null;
  }
  return selected;
}

export function findHierarchyCompletion(lineBeforeCursor, nodes, currentScriptId) {
  const getService = lineBeforeCursor.match(/game:GetService\(["']([^"']*)$/);
  if (getService) {
    return { type: 'services', partial: getService[1], values: SERVICES };
  }
  const trailing = lineBeforeCursor.match(/((?:game|workspace|script)(?:\.[A-Za-z_][\w]*|\[(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\])*)\.([A-Za-z_0-9]*)$/i);
  if (trailing) {
    const parent = resolveExpression(trailing[1], nodes, currentScriptId);
    return parent ? { type: 'children', partial: trailing[2], values: getChildren(nodes, parent.id) } : null;
  }
  if (/[A-Za-z_][\w]*$/.test(lineBeforeCursor)) {
    const match = lineBeforeCursor.match(/([A-Za-z_][\w]*)$/);
    return { type: 'roots', partial: match[1], values: ROOT_SYMBOLS };
  }
  return null;
}

export function makeMonacoSuggestions(context, monaco, position) {
  if (!context) return [];
  const partial = context.partial;
  const range = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: position.column - partial.length,
    endColumn: position.column,
  };
  if (context.type === 'roots' || context.type === 'services') {
    return context.values
      .filter((name) => name.toLowerCase().startsWith(partial.toLowerCase()))
      .map((name) => ({ label: name, kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: name, range, detail: context.type === 'services' ? 'Roblox service' : 'Luau global' }));
  }
  return context.values
    .filter((node) => node.name.toLowerCase().startsWith(partial.toLowerCase()))
    .slice(0, 150)
    .map((node) => {
      const simple = IDENTIFIER.test(node.name);
      return {
        label: { label: node.name, description: node.className },
        kind: node.isScript ? monaco.languages.CompletionItemKind.Module : monaco.languages.CompletionItemKind.Field,
        insertText: simple ? node.name : `[${JSON.stringify(node.name)}]`,
        range: simple ? range : { ...range, startColumn: range.startColumn - 1 },
        detail: `${node.className} (live Studio instance)`,
        sortText: `${node.isScript ? '1' : '0'}${node.name.toLowerCase()}`,
      };
    });
}
