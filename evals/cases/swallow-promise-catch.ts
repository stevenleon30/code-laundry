export function trackEvent(name: string): void {
  fetch("/analytics", { method: "POST", body: name }).catch(() => {});
}
