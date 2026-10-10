import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;
const env = { NODE_ENV: 'phone', DATA_DIR: '/data', SCHEDULER_ENABLED: 'false', PORT: '0', TRUST_NETWORK_CHECKS: 'false', RESCAN_DEBOUNCE_MS: '1500', ALLOW_SIGNUP: 'true' };
globalThis.process = globalThis.process || { env, platform: 'browser', versions: {}, argv: [], cwd: () => '/', nextTick: (f, ...a) => queueMicrotask(() => f(...a)), emitWarning() {}, on() {}, hrtime: () => [0, 0] };
Object.assign(globalThis.process.env, env);
try { if (localStorage.getItem('kj.debug')) globalThis.process.env.DEBUG_RESUME = '1'; } catch (_) { /* storage unavailable */ }
export { Buffer };
