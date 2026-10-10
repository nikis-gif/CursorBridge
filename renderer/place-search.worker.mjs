import { searchScripts } from './place-search.mjs';

self.onmessage = ({ data }) => {
  if (!data || data.type !== 'search') return;
  try {
    const result = searchScripts(data.scripts, data.query, data.settings);
    self.postMessage({ requestId: data.requestId, ...result });
  } catch (error) {
    self.postMessage({ requestId: data.requestId, groups: [], matchCount: 0, fileCount: 0,
      error: error?.message || 'Search failed.', truncated: false });
  }
};
