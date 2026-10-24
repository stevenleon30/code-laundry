export function total(items: any): any {
  let sum: any = 0;
  for (const item of items) sum += item.price * item.qty;
  return sum;
}
