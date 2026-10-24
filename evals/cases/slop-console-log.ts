export function applyCoupon(total: number, code: string): number {
  console.log("applying coupon", code);
  const discount = code === "SAVE10" ? 0.1 : 0;
  console.log("discount is", discount);
  return total * (1 - discount);
}
