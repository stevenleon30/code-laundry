interface Profile {
  id: string;
  bio: string;
}

export async function getProfile(id: string): Promise<Profile | null> {
  try {
    const res = await fetch(`/api/profiles/${id}`);
    return (await res.json()) as Profile;
  } catch (err) {
    return null;
  }
}
