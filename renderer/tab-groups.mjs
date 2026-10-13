/** Keep the secondary group's pinned document out of unrelated primary tabs. */
export function primaryTabIds(openIds, primaryId, secondaryId) {
  return openIds.filter(id => id !== secondaryId || id === primaryId);
}
