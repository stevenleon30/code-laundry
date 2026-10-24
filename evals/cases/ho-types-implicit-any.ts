export function mergeSettings(defaults, overrides) {
  return { ...defaults, ...overrides };
}
