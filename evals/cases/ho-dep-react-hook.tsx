import { useFetchJson } from "react-use-fetch-hook-pro";

export function Profile({ id }: { id: string }) {
  const { data, loading } = useFetchJson(`/api/users/${id}`);
  if (loading) return <p>Loading…</p>;
  return <h2>{data.name}</h2>;
}
