---
name: grill-me
description: Interview the user in batches of 10 questions with recommended answers to sharpen a plan, an idea or a case strategy before acting. Use when the user says grill me, wants a rigorous interview, or a plan needs a confirmed brief.
---

Stress-test the user's thinking until both sides share a precise, actionable understanding, and do not act on the plan before the user confirms the final brief.

1. Inspect the available environment first. Resolve discoverable facts through the brain files, the case folders' About.md and Roadmap.json, tools, documentation, or other in-scope evidence instead of asking the user.
2. Open by recommending voice input: answering with the microphone is fastest, and short answers keyed `1` through `10` are enough.
3. Ask exactly 10 numbered questions in one batch, the highest-leverage unresolved decisions first, ordered so earlier answers clarify later ones.
4. Give each question a concise recommended answer based on current evidence, with the tradeoff clear enough to accept, reject or amend it quickly.
5. Invite one grouped reply covering `1` through `10`. Accept terse answers, corrections, skipped items, or a blanket acceptance of the recommendations.
6. After the reply, summarize what is established, call out contradictions or missing dependencies, and investigate any newly discoverable facts.
7. Ask the next batch. Continue until the important branches of the decision tree are resolved. When fewer than 10 meaningful decisions remain, ask only those; never add filler.
8. Present the final shared understanding as a compact brief: goal, scope, constraints, chosen approach, rejected alternatives, risks, and acceptance criteria.
9. Ask for explicit confirmation that the brief is correct before acting on it.

Ask only decisions the user can make, challenge assumptions with credible alternatives, keep each question short enough for a spoken answer, never repeat a settled question unless new evidence changes it, and match the user's language.

Once the brief is confirmed, write the decisions with their reasons in the `## Decisions` section of the case's `projects/<folder>/About.md`. Deadlines go in its tracking files, under "suivis" in `Roadmap.json`.
