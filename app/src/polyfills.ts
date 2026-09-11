import { getRandomValues as expoCryptoGetRandomValues } from "expo-crypto";
import { Buffer } from "buffer";
import structuredClonePolyfill from "@ungap/structured-clone";

global.Buffer = Buffer;
// Hermes has no structuredClone; Anchor (and friends) call it.
if (typeof (global as any).structuredClone !== "function") (global as any).structuredClone = structuredClonePolyfill;

// getRandomValues polyfill
class Crypto {
  getRandomValues = expoCryptoGetRandomValues;
}

const webCrypto = typeof crypto !== "undefined" ? crypto : new Crypto();

(() => {
  if (typeof crypto === "undefined") {
    Object.defineProperty(window, "crypto", {
      configurable: true,
      enumerable: true,
      get: () => webCrypto,
    });
  }
})();
