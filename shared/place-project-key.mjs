/**
 * Published Places use their Roblox universe/place identity.
 * Unpublished Places all report 0-0, so keep named local projects apart.
 * Roblox does not provide a stable ID for unsaved local files; duplicate
 * names or renaming may still require manual project selection.
 */
export function projectKeyForPlace(status) {
  const key = typeof status?.placeKey === 'string' ? status.placeKey.trim() : '';
  if (!key || key === 'offline') return null;
  if (key !== '0-0') return key;
  const name = typeof status?.placeName === 'string' ? status.placeName.trim().normalize('NFC') : '';
  return name ? `unsaved:${name.toLocaleLowerCase('en-US').slice(0, 180)}` : null;
}

/** Never attach the live Studio script to an unrelated saved Place project. */
export function canUseScriptContext(projectKey, status) {
  return status?.connected === true && status?.ready === true && status?.protocolVersion !== 1 &&
    typeof projectKey === 'string' &&
    projectKeyForPlace(status) === projectKey;
}
