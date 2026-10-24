export async function listRepos(org: string) {
  const res = await fetch(`https://api.github.com/orgs/${org}/repos`, {
    headers: { Authorization: "token __SECRET_GITHUB__" },
  });
  return res.json();
}
