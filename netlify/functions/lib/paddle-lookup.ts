import { Environment, Paddle } from "@paddle/paddle-node-sdk";

/** More than this many transactions for one address is not a household; stop reading. */
const MAX_TRANSACTIONS = 50;

/**
 * The ids of the completed Paddle transactions of the customer(s) with this address, as
 * license-resend-key.ts finds them: Paddle holds the address (this server stores none), so it
 * is asked, and the ids are matched to licences by `licenses.paddle_txn_id`.
 */
export async function paddleCompletedTransactionIds(apiKey: string | undefined, email: string): Promise<string[]> {
  if (!apiKey) throw new Error("missing PADDLE_API_KEY");
  const paddle = new Paddle(apiKey, { environment: Environment.production });
  const ids: string[] = [];
  // Paddle matches the address exactly; try it as typed and lower-cased.
  const variants = [...new Set([email, email.toLowerCase()])];
  for await (const customer of paddle.customers.list({ email: variants })) {
    const transactions = paddle.transactions.list({ customerId: [customer.id], status: ["completed"] });
    for await (const txn of transactions) {
      ids.push(txn.id);
      if (ids.length >= MAX_TRANSACTIONS) return ids;
    }
  }
  return ids;
}
