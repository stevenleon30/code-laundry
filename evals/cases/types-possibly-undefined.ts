interface User {
  id: number;
  name: string;
}

export function nameOf(users: User[], id: number): string {
  return users.find((u) => u.id === id).name;
}
