export function getPage(href: string): number {
  const url = new URL(href);
  return Number(url.getParam("page") ?? 1);
}
