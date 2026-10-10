/** Local-only, read-only search over the scripts currently synchronized from Studio. */
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;
const DEFAULT_LIMIT = 3000;

export function compilePlaceQuery(query, settings = {}) {
  const text = String(query || '');
  if (!text.trim()) return { empty: true };
  if (text.length > 200) return { error: 'Search terms must be 200 characters or fewer.' };
  const regex = Boolean(settings.regex);
  const matchCase = Boolean(settings.matchCase);
  const wholeWord = Boolean(settings.wholeWord);
  const pattern = regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return { expression: new RegExp(pattern, matchCase ? 'g' : 'gi'), wholeWord };
  } catch (error) {
    return { error: `Invalid regular expression: ${error.message}` };
  }
}

export function searchScripts(scripts, query, settings = {}, maxResults = DEFAULT_LIMIT) {
  const compiled = compilePlaceQuery(query, settings);
  const result = { groups: [], matchCount: 0, fileCount: 0, searchedFiles: 0, truncated: false, error: compiled.error || null };
  if (compiled.empty || compiled.error) return result;
  const limit = Math.max(1, Math.min(10000, Number(maxResults) || DEFAULT_LIMIT));
  for (const script of scripts) {
    if (typeof script.source !== 'string') continue;
    result.searchedFiles++;
    const matches = [];
    const lines = script.source.split(/\r\n|\n|\r/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      compiled.expression.lastIndex = 0;
      let match;
      while ((match = compiled.expression.exec(line)) !== null) {
        const start = match.index;
        const length = match[0].length;
        // Empty regex matches would otherwise loop forever and do not select code.
        if (length === 0) {
          compiled.expression.lastIndex = Math.max(compiled.expression.lastIndex, start + 1);
          if (start >= line.length) break;
          continue;
        }
        if (compiled.wholeWord &&
          ((start > 0 && IDENTIFIER_CHAR.test(line[start - 1])) ||
           (start + length < line.length && IDENTIFIER_CHAR.test(line[start + length])))) continue;
        matches.push({ line: lineIndex + 1, column: start + 1, length,
          preview: matchPreview(line, start + 1, length) });
        result.matchCount++;
        if (result.matchCount >= limit) { result.truncated = true; break; }
      }
      if (result.truncated) break;
    }
    if (matches.length) {
      result.groups.push({ id: script.id, name: script.name, className: script.className,
        path: script.path, matches });
      result.fileCount++;
    }
    if (result.truncated) break;
  }
  return result;
}

/** Constrain a long source line around the match, without breaking offsets. */
export function matchPreview(line, column, length, width = 124) {
  const start = Math.max(0, column - 1);
  const left = Math.max(0, start - Math.floor(width * .38));
  const displayLength = Math.min(length, Math.max(24, Math.floor(width * .55)));
  const end = Math.min(line.length, start + displayLength);
  const right = Math.min(line.length, Math.max(left + width, end + 16));
  return {
    before: `${left ? '…' : ''}${line.slice(left, start)}`,
    matched: line.slice(start, end),
    after: `${line.slice(end, right)}${end < start + length || right < line.length ? '…' : ''}`,
  };
}
