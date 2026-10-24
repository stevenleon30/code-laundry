export async function chargeCard(token: string, amount: number): Promise<void> {
  try {
    const res = await fetch("/api/charge", { method: "POST", body: JSON.stringify({ token, amount }) });
    if (!res.ok) throw new Error(`charge failed: ${res.status}`);
  } catch (error) {
    console.error("Payment error:", error);
  }
}
