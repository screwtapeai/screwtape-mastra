# Screwtape.ai for Mastra

An independent judge for your agents. Screwtape isn't tied to any agent framework or AI model provider, so its verdicts are never grading their own work. Every verdict comes with a signed receipt you can verify yourself, which gives you a record you can trust when it matters.

False-consensus check and pass/fail/retry verdicts for Mastra agents. This example adds a **judge step** that routes on the verdict (pass → accept, retry → redo with the judge's reasons, fail → stop) and, where several answers exist, a **consensus step** that flags agreement too thin to trust.

## What it does

1. Your Mastra agent drafts an answer from the evidence you give it.
2. The draft goes to `POST https://screwtape.ai/v1/judge` with the task, the evidence and the criteria.
3. The code routes on `verdict`. It prints `score`, `request_id` and the receipt id, so every decision is traceable.

## Files

- `index.ts`: `new Agent({ id, name, instructions, model: "openai/gpt-4o-mini" })`, a judge loop around `agent.generate()`, `--consensus` mode, and an optional `screwtapeJudge` tool made with `createTool`
- `screwtape.ts`, `get-free-key.ts`, `package.json`, `tsconfig.json`
- `.env.example`, `.gitignore`, `LICENSE` (MIT)

## Setup and run

```bash
npm install
cp .env.example .env   # then fill in the keys and load them, or export them
npx tsx index.ts
npm run check
```

## Routing

| Verdict | What the example does |
|---|---|
| `pass` | Return or accept the output |
| `retry` | Send the judge's `reasons` back to the worker and try again, up to a fixed cap |
| `fail` | Stop. Don't spend more calls on an answer the judge says is wrong |

The judge returns `verdict`, `score` (0 to 1), `reasons`, `engine` (`llm`, `deterministic` or `demo`), `request_id`, `retention` and, when signing is on, `receipt`. Consensus returns `consensus_answer`, `agreement_score`, `false_consensus_risk` (`low`, `medium` or `high`), `reasons`, `clusters`, `engine`, `request_id`, `retention` and `receipt`. The fields come from https://screwtape.ai/openapi.json.

## Signed verdict receipts

When receipt signing is on, every `/v1/judge` and `/v1/consensus` response also carries a `receipt` object. The fields are `receipt_id`, `issued_at`, `endpoint`, `request_sha256` (SHA-256 of the normalized request), `verdict`, `score`, `payment`, `alg` (`Ed25519`), `kid` and `signature`. For consensus, `verdict` is `false_consensus_risk` and `score` is `agreement_score`. `payment` shows the key prefix or the x402 transaction, never the key.

- Public keys: https://screwtape.ai/.well-known/screwtape-receipt-keys.json (JWKS-style Ed25519)
- Verify: `POST https://screwtape.ai/v1/receipts/verify` with the raw `receipt` object as the request body, exactly as returned (not wrapped in `{"receipt": ...}`). The response is `{"valid": true}` or `{"valid": false}`. No key is needed and the receipt isn't stored.

```ts
import { judge, verifyReceipt } from "./screwtape.js";

const v = await judge("State the crew size.", "The crew size was 4.", ["The crew size was 4."]);
if (v.receipt) console.log(v.receipt.receipt_id, await verifyReceipt(v.receipt));
```

Store the receipt next to the output it approved, so a reviewer can later check which request was judged, the verdict it got, and when.

## Get a free key (100 calls per UTC day)

- **In a browser:** https://screwtape.ai/signup/ (email and name are optional, no card). To try judge and consensus with no key first, use https://screwtape.ai/try/ (3 calls per token, about 30 minutes).
- **From code or an agent:** `POST https://screwtape.ai/v1/signup` with a proof of work. The SHA-256 of `screwtape-signup-v1:<UTC YYYY-MM-DD>:<nonce>` must start with 12 zero bits, and the nonce must match `^[A-Za-z0-9_-]{8,64}$`. `npx tsx get-free-key.ts my-agent` does this for you (`--dry-run` only finds the nonce).
- The key is shown **once**. Screwtape stores only its SHA-256 hash. Limits are 5 keys per IP per hour and 5 per UTC day.
- Copy `.env.example` to `.env` (git-ignored) or export `SCREWTAPE_API_KEY`. The code reads the key from the environment and never embeds it.

## x402 pay-per-call (no key)

Without a key, `/v1/judge` and `/v1/consensus` answer **HTTP 402 Payment Required** with x402 v2 terms: **$0.005 USDC per call on Base (`eip155:8453`) or Solana**. The terms are in the base64 `PAYMENT-REQUIRED` header. The JSON body has `x402Version`, `accepts` and `error` at the top level, plus `signup_url`, `pricing_url` and `pricing_json_url`. Auth and payment are checked before the body is validated, so even an empty body gets the 402. This example catches the 402 and prints a hint.

```bash
curl -s -D - -o /dev/null https://screwtape.ai/v1/judge -H "Content-Type: application/json" \
  -d '{"task":"State the crew size.","agent_output":"The crew size was 4."}' \
  | grep -i '^payment-required:' | cut -d' ' -f2 | tr -d '\r' | base64 -d | jq .accepts
```

To pay, an x402 client signs the terms and resends the request with a `PAYMENT-SIGNATURE` header. Payments are verified and settled through a facilitator. Keyless calls can't turn on `retain`. With `@x402/fetch` (`npm install @x402/fetch@2.28.0 @x402/evm@2.28.0 viem@2.57.7`; this snippet type-checks against those versions):

```ts
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`)) }],
});
const paid = await fetchWithPayment("https://screwtape.ai/v1/judge", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ task: "State the crew size.", agent_output: "The crew size was 4.", evidence: ["The crew size was 4."] }),
});
console.log((await paid.json()).verdict);
```

Use a dedicated wallet with a small balance, and keep its private key in your secret store, never in this repo. Prepaid packs (Starter $30 for 10,000 calls, Builder $100 for 50,000 calls) are on https://screwtape.ai/pricing/.

## Compatibility notes

- To let the agent self-check, add `tools: { screwtapeJudge }` to the `Agent`. Keep the hard gate in code too, because a model can skip a tool.
- Checked: `tsc --noEmit` passes against @mastra/core 1.78.0.

## Links

- Screwtape.ai: https://screwtape.ai/
- API reference: https://screwtape.ai/docs/ · OpenAPI: https://screwtape.ai/openapi.json · For agents: https://screwtape.ai/llms.txt
- MCP server: https://screwtape.ai/mcp (MCP Registry name `ai.screwtape/screwtape`)
- Pricing: https://screwtape.ai/pricing/ · Free key: https://screwtape.ai/signup/
- Source for this example: https://github.com/screwtapeai/screwtape-mastra
- Issues: https://github.com/screwtapeai/screwtape-mastra/issues

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 Screwtape.ai.

---
Screwtape.ai is an agent validation API, not the arXiv paper that is also named Screwtape. This example was checked against the live API on 2026-10-21.
