const API_KEY = "YOUR_API_KEY_HERE";

export async function weather(city: string): Promise<unknown> {
  const res = await fetch(`https://api.weather.example/v1?q=${city}&key=${API_KEY}`);
  return res.json();
}
