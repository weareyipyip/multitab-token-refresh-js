"use strict";

const storage: { [key: string]: any } = {};

export default typeof window !== "undefined"
  ? window.localStorage
  : {
      getItem(key: string): string | null {
        return storage[key];
      },
      setItem(key: string, value: string): void {
        storage[key] = value;
      },
      removeItem(key: string): void {
        delete storage.key;
      },
    };
