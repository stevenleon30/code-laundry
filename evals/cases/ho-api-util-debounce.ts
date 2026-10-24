import { debounce } from "node:util";

export const onResize = debounce(() => {
  globalThis.dispatchEvent(new Event("layout"));
}, 100);
