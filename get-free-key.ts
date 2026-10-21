// Create a free Screwtape.ai key (100 calls per UTC day) using the documented proof of work.
//   npx tsx get-free-key.ts --dry-run   # only find a valid nonce, send nothing
//   npx tsx get-free-key.ts my-agent    # POST /v1/signup; the key is printed once
import { createHash, randomBytes } from "node:crypto";

const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
let nonce: string;
do {
  nonce = randomBytes(12).toString("base64url"); // 16 chars from [A-Za-z0-9_-]
} while (!createHash("sha256").update(`screwtape-signup-v1:${day}:${nonce}`).digest("hex").startsWith("000"));

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const body = { pow_nonce: nonce, ...(name && { name }) };
if (args.includes("--dry-run")) {
  console.log(JSON.stringify(body));
} else {
  const res = await fetch("https://screwtape.ai/v1/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(`signup ${res.status}: ${await res.text()}`);
  console.log(((await res.json()) as { api_key: string }).api_key); // export as SCREWTAPE_API_KEY
}
