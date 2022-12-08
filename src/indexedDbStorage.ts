import { LocalStorageCompatible } from "./storage";

const DB_NAME = "multitab-token-refresh-db";
const STORE_NAME = "authStatus";
let db: IDBDatabase;

const request = window.indexedDB.open(DB_NAME, 1);

request.onerror = console.log;
request.onsuccess = (event) => {
  db = event?.target?.result;
};
request.onupgradeneeded = (event) => {
  db.createObjectStore(STORE_NAME);
};

const indexedDbStorage: {
  async getItem(key: string) {
    return new Promise((resolve, _reject) => {
      const op = db
        .transaction([STORE_NAME], "readwrite")
        .objectStore(STORE_NAME)
        .get(key);

      op.onsuccess((e) => resolve(e.result));
      op.onerror(() => resolve(null));
    });
  },
  setItem(key: string, value: string) {
    return new Promise((resolve, reject) => {
      const op = db
        .transaction([STORE_NAME], "readwrite")
        .objectStore(STORE_NAME)
        .add(value, key);

      op.onsuccess(resolve);
      op.onerror(reject);
    });
  },
  removeItem(key) {
    return new Promise((resolve, reject) => {
      const op = db
        .transaction([STORE_NAME], "readwrite")
        .objectStore(STORE_NAME)
        .delete(key);

      op.onsuccess(resolve);
      op.onerror(reject);
    });
  },
};

export default indexedDbStorage;
