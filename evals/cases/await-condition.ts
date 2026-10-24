async function isAdmin(userId: string): Promise<boolean> {
  const res = await fetch(`/api/users/${userId}/roles`);
  const roles: string[] = await res.json();
  return roles.includes("admin");
}

export function canDelete(userId: string): boolean {
  if (isAdmin(userId)) {
    return true;
  }
  return false;
}
