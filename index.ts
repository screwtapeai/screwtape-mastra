// Mastra + Screwtape.ai: a judge gate (pass / retry / fail) around agent.generate(),
// a judge tool the agent can call on its own drafts, and an optional consensus step.
//   npm install
//   export OPENAI_API_KEY=... SCREWTAPE_API_KEY=...
//   npx tsx index.ts              # judge loop
//   npx tsx index.ts --consensus  # 3 samples -> consensus -> judge
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { consensus, judge } from "./screwtape.js";

const TASK = "State the crew size and launch site of the mission.";
const EVIDENCE = ["The mission launched on 2024-03-01 from Cape Canaveral.", "The crew size was 4."];
const CRITERIA = ["crew size", "Cape Canaveral"];
const MAX_ATTEMPTS = 3;

// Optional: let the agent check its own draft before answering.
export const screwtapeJudge = createTool({
  id: "screwtape-judge",
  description:
    "Independent pass/fail/retry verdict on one draft answer, checked against the evidence you pass. Call it before returning a final answer. It does not search the web. Returns verdict, a 0-1 score and reasons. Costs 1 Screwtape call (free key: 100 per UTC day).",
  inputSchema: z.object({
    task: z.string(),
    agent_output: z.string(),
    evidence: z.array(z.string()).optional(),
    criteria: z.array(z.string()).optional(),
  }),
  execute: async ({ task, agent_output, evidence, criteria }) => judge(task, agent_output, evidence, criteria),
});

const worker = new Agent({
  id: "worker",
  name: "Worker",
  instructions: "Answer only from the evidence you are given. Be brief.",
  model: "openai/gpt-4o-mini",
});

async function ask(feedback?: string[]): Promise<string> {
  let prompt = `Task: ${TASK}\nEvidence:\n- ${EVIDENCE.join("\n- ")}`;
  if (feedback) prompt += `\nA reviewer rejected your last answer because:\n- ${feedback.join("\n- ")}`;
  const result = await worker.generate(prompt);
  return result.text;
}

export async function judgedAnswer(): Promise<string | null> {
  let feedback: string[] | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const output = await ask(feedback);
    const v = await judge(TASK, output, EVIDENCE, CRITERIA);
    console.log(`attempt ${attempt}: ${v.verdict} score=${v.score} engine=${v.engine} id=${v.request_id} receipt=${v.receipt?.receipt_id ?? "-"}`);
    if (v.verdict === "pass") return output;
    if (v.verdict === "fail") return null;
    feedback = v.reasons;
  }
  return null;
}

export async function consensusThenJudge(n = 3): Promise<string | null> {
  const outputs = await Promise.all(Array.from({ length: n }, () => ask()));
  const c = await consensus(TASK, outputs.map((output, i) => ({ agent_id: `sample-${i}`, output })));
  console.log(`agreement=${c.agreement_score} risk=${c.false_consensus_risk}`);
  const v = await judge(TASK, c.consensus_answer, EVIDENCE, CRITERIA);
  return v.verdict === "pass" ? c.consensus_answer : null;
}

const answer = process.argv.includes("--consensus") ? await consensusThenJudge() : await judgedAnswer();
console.log("ANSWER:", answer ?? "(rejected)");
