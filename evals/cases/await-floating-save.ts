interface User {
  id: string;
  name: string;
}

async function saveUser(user: User): Promise<void> {
  await fetch("/api/users", { method: "POST", body: JSON.stringify(user) });
}

export async function register(name: string): Promise<User> {
  const user = { id: crypto.randomUUID(), name };
  saveUser(user);
  return user;
}
