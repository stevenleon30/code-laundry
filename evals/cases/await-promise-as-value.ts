export async function getTitle(url: string): Promise<string> {
  const res = fetch(url);
  const data = await res.json();
  return data.title;
}
