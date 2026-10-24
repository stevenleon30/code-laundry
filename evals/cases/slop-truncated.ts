export class CartService {
  private items: Array<{ sku: string; qty: number }> = [];

  add(sku: string, qty: number): void {
    this.items.push({ sku, qty });
  }

  // ... rest of the methods remain the same
}
