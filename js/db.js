// IndexedDB 래퍼 — 프로젝트와 미디어(사진·영상·오디오)를 기기 안에 저장한다.
let dbp;
function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('reels-maker', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('projects', { keyPath: 'id' });
        r.result.createObjectStore('media', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export const get = (s, id) => tx(s, 'readonly', (o) => o.get(id));
export const all = (s) => tx(s, 'readonly', (o) => o.getAll());
export const put = (s, v) => tx(s, 'readwrite', (o) => o.put(v));
export const del = (s, id) => tx(s, 'readwrite', (o) => o.delete(id));
