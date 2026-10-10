/** Score filename matches first, then hierarchy segments and subsequences. */
function subsequenceScore(target, term) {
  let at = -1, gaps = 0;
  for (const letter of term) {
    const next = target.indexOf(letter, at + 1);
    if (next === -1) return -1;
    if (at !== -1) gaps += next - at - 1;
    at = next;
  }
  return Math.max(0, 120 - gaps * 5 - target.length / 2);
}

export function parseQuickOpenQuery(raw) {
  const value = String(raw || '').trim();
  const position = /^(.*?):([1-9]\d{0,6})(?::([1-9]\d{0,5}))?$/.exec(value);
  return position
    ? { query: position[1].trim(), line: Number(position[2]), column: Number(position[3] || 1) }
    : { query: value, line: null, column: 1 };
}

export function quickOpenMatches(scripts, query, recentIds = [], limit = 80) {
  const lower = query.toLocaleLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const recent = new Map(recentIds.map((id, index) => [id, index]));
  return scripts.flatMap((script, index) => {
    const name = script.name.toLocaleLowerCase();
    const path = script.path.toLocaleLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (name === token) score += 1200;
      else if (name.startsWith(token)) score += 900;
      else if (name.includes(token)) score += 660;
      else if (path.includes(token)) score += 320;
      else {
        const fuzzy = subsequenceScore(name, token);
        if (fuzzy < 0) return [];
        score += fuzzy;
      }
    }
    score += Math.max(0, 110 - (recent.get(script.id) ?? 999) * 12);
    if (!tokens.length) score += Math.max(0, 50 - index * .01);
    return [{ ...script, score, index }];
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.index - b.index).slice(0, limit);
}
