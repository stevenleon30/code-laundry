export interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

export async function getTodo(id: number): Promise<Todo> {
  const res = await fetch(`https://jsonplaceholder.typicode.com/todos/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to load todo ${id}: HTTP ${res.status}`);
  }
  return (await res.json()) as Todo;
}
