interface User {
  id: string;
  isAdmin: boolean;
}

async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  return (await res.json()) as User;
}

export async function requireAdmin(id: string): Promise<void> {
  const user = getUser(id);
  if (!user.isAdmin) throw new Error("forbidden");
}
