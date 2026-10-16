// Хранилище кэша и истории в браузере. IndexedDB вмещает сотни мегабайт (разобранный матч весит ~250 КБ),
// localStorage с его 5 МБ для этого не годится. Если IndexedDB недоступен (приватный режим, запрет), кэш живёт в памяти вкладки.

export async function openStore() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('dota-ruin', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    const run = (mode, fn) => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('abort'));
    });
    await run('readonly', (s) => s.get('__probe__'));
    return {
      persistent: true,
      get: async (key) => (await run('readonly', (s) => s.get(key))) ?? null,
      set: (key, value) => run('readwrite', (s) => s.put(value, key)).catch(() => {}), // переполнение квоты не должно ломать разбор
      del: (key) => run('readwrite', (s) => s.delete(key)).catch(() => {}),
    };
  } catch {
    const mem = new Map();
    return { persistent: false, get: async (k) => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); } };
  }
}
