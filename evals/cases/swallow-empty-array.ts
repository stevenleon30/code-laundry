export async function fetchOrders(customerId: string): Promise<unknown[]> {
  try {
    const res = await fetch(`/api/customers/${customerId}/orders`);
    return (await res.json()) as unknown[];
  } catch (e) {
    console.error(e);
    return [];
  }
}
