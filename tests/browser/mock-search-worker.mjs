import { searchScripts } from '__SEARCH_MODULE_URI__';
export default class MockPlaceSearchWorker {
  constructor() { this.onmessage = null; this.onerror = null; this.closed = false; }
  postMessage(data) {
    Promise.resolve().then(() => {
      if (this.closed) return;
      try {
        this.onmessage?.({data:{requestId:data.requestId,...searchScripts(data.scripts,data.query,data.settings)}});
      } catch (error) { this.onerror?.(error); }
    });
  }
  terminate() { this.closed = true; }
}
