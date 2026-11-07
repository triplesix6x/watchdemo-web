// Isolated browser transport. Production stores/components are not replaced.
const handlers = new Map();
const calls = { minimize: 0, close: 0 };
export async function listen(name, callback) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(callback);
  return () => handlers.get(name)?.delete(callback);
}
export async function emitQa(name, payload) {
  await Promise.all([...handlers.get(name) ?? []].map(callback => callback({ event: name, payload })));
}
export const nativeCalls = () => ({ ...calls });
export function getCurrentWindow() {
  return {
    setTitle: async () => {}, minimize: async () => { calls.minimize++; },
    close: async () => { calls.close++; },
  };
}
export const getVersion = async () => '0.8.5-qa';
export const isTauri = () => true;
export async function invoke(command) {
  if (command === 'crash_pending') return [];
  throw new Error(`Unexpected native command in isolated QA: ${command}`);
}
