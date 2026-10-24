import Stripe from "stripe";

const stripe = new Stripe("__SECRET_STRIPE__");

export function charge(amountCents: number, customer: string) {
  return stripe.paymentIntents.create({ amount: amountCents, currency: "usd", customer });
}
