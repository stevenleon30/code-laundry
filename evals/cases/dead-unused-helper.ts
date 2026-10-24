function legacyFormat(d: Date): string {
  return d.toISOString();
}

export function formatDate(d: Date): string {
  const tz = "UTC";
  return d.toLocaleDateString("en-US");
}
