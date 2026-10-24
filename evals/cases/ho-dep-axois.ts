import axios from "axois";

export async function getJson(url: string): Promise<unknown> {
  const res = await axios.get(url);
  return res.data;
}
