/*
 * Global outbound-fetch safety guard.
 * It protects both fetch() headers and response body consumption.
 * This is intentionally installed before app.js loads the investigation modules.
 */
'use strict';

const DEFAULT_TIMEOUT_MS = Number(process.env.GLOBAL_FETCH_TIMEOUT_MS || 60000);
const INSTALL_KEY = Symbol.for('governmentWorkInvestigation.fetchTimeoutGuard');

if (!globalThis[INSTALL_KEY] && typeof globalThis.fetch === 'function') {
  const nativeFetch = globalThis.fetch.bind(globalThis);

  const guardedFetch = async (input, init = {}) => {
    const timeoutMs = Number(init.__timeoutMs || DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const originalSignal = init.signal;
    const signal = originalSignal && AbortSignal.any
      ? AbortSignal.any([originalSignal, controller.signal])
      : controller.signal;

    const requestInit = { ...init, signal };
    delete requestInit.__timeoutMs;

    const timer = setTimeout(() => {
      controller.abort(new Error(`Global outbound fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const response = await nativeFetch(input, requestInit);
    const bodyMethods = ['arrayBuffer', 'blob', 'formData', 'json', 'text'];
    let bodyConsumed = false;

    const finish = () => {
      if (!bodyConsumed) {
        bodyConsumed = true;
        clearTimeout(timer);
      }
    };

    return new Proxy(response, {
      get(target, property, receiver) {
        if (bodyMethods.includes(property)) {
          return async (...args) => {
            try {
              return await Promise.race([
                Reflect.get(target, property, receiver).apply(target, args),
                new Promise((_, reject) => {
                  const remaining = setTimeout(() => reject(new Error(`Response body timed out after ${timeoutMs}ms`)), timeoutMs);
                  signal.addEventListener('abort', () => {
                    clearTimeout(remaining);
                    reject(signal.reason || new Error('Response body aborted'));
                  }, { once: true });
                })
              ]);
            } finally {
              finish();
            }
          };
        }
        return Reflect.get(target, property, receiver);
      }
    });
  };

  globalThis.fetch = guardedFetch;
  globalThis[INSTALL_KEY] = true;
}

module.exports = { timeoutMs: DEFAULT_TIMEOUT_MS };
