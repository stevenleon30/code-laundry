export function showFragment(): void {
  const out = document.getElementById("out");
  if (out) out.innerHTML = decodeURIComponent(location.hash.slice(1));
}
