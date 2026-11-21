---
name: setup-brain
description: Set up or complete the PieceMaker brain, the folder where the central agent keeps the user's profile (AGENTS.md) and one About.md and Roadmap.json per case folder, after a short interview. Use when the user wants to set up or initialize the brain, or starts from zero.
argument-hint: "[nothing: the brain is the folder this session runs in]"
---

Set up the brain the central agent runs in, so any future session can read one file and know who the user is, how they work and where each case stands. Talk to the user in their language, one short question at a time, with no jargon. Write every brain file in the user's language.

1. **Folder.** The brain is the folder this session runs in. Overwrite nothing: read `AGENTS.md` and every `projects/*/About.md`, tell the user what you found, skip the questions it already answers, and only add what is missing.
2. **Interview.** Say in one line why you ask, then ask, one per message, and wait for each answer. Give the choices or an example with every question. Accept short answers and move on if they skip one.
   1. Your name, your practice (firm, areas of law) and the city you work from?
   2. How should the agent work? "Do everything and only ask what truly needs me", or "Show me the plan and I approve each step".
   3. In which language should it answer, and how: short and direct, or detailed?
   4. Your writing conventions: citation style, tone of letters and submissions, templates you always use?
   5. Which tools do you use every day (mail, calendar, practice management software, research databases)?
   6. Is there anything the agent must never do without asking you first? For example send an email, file a document, contact a client.
   7. Which case folders should the central agent follow? They are chosen in the central agent's settings; name the ones that matter most.
3. **Check.** Sum it up in 5 short lines and ask if it is right. Fix what they correct before writing anything.
4. **AGENTS.md.** Write the profile in `AGENTS.md` (200 lines max): who the user is, how the agent works (`## Output style`), writing conventions, tools, never rules. `AGENTS.md` may be a link to the user's general instructions file shared with every case folder: edit it in place, never replace the link. `CLAUDE.md` only imports `@AGENTS.md`: never write anything else in it.
5. **Cases.** For each case folder the user named, complete `projects/<folder name>/About.md` (200 lines max: status, what the case is, strategy, `## Decisions` with their reasons). Its `Roadmap.json` holds the deadlines and is filled by the case's own work and checked by Le Hérisson: leave it as it is. Parties stay in the case base: do not list them. Write only what the user told you and leave "To fill" rather than guess a fact, date or name. Never copy documents from a case folder into the brain.
6. **Skills.** Check that `.agents/skills/` holds `grill-me`, `connect-tool`, `skill-manager` and `setup-brain`, and that `.claude/skills` is a link to it. They are for the brain only: never install them elsewhere.

Finish with three lines: where the brain is, that the central agent keeps each case's About.md and Roadmap.json up to date, and one thing to try now.
