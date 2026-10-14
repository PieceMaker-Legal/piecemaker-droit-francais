export function runtimeEnvironment(runtime, environment = process.env) {
  if (!runtime.electronRunAsNode) return environment;
  return { ...environment, ELECTRON_RUN_AS_NODE: '1' };
}
