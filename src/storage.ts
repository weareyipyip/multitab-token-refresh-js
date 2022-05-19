"use strict";

const storage: { [key: string]: any } = {};

export default typeof window !== "undefined"
  ? window.localStorage
  : {
      getItem(key: string) {
        return storage[key];
      },
      setItem(key: string, value: string) {
        storage[key] = value;
      },
      removeItem(key: string) {
        delete storage.key;
      },
    };
