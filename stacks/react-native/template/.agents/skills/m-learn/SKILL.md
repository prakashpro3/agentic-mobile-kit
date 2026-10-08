---
name: m-learn
description: Turn a mistake or a correction into the smallest lasting fix (a check, a docs line or a skill step) so no tool repeats it, and remove guidance that is no longer true. Run only when the user explicitly invokes m-learn.
disable-model-invocation: true
---

# m-learn

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (what went wrong or what the user had to correct; the error text, PR comment or session transcript if there is one).

1. **State the lesson in one sentence:** what happened, what should have happened, and why. The usual causes are missing context, an ignored rule, the wrong command, or a gap in the rules. Quote the evidence, and don't guess what an earlier session did. If the cause isn't clear, ask.
2. **Check whether it's already covered.** Search `AGENTS.md`, `docs/ai/` and `.agents/skills/`. If a rule exists and was ignored, writing it again won't help; enforce it instead (step 3.1).
3. **Pick the strongest small fix**, in this order:
   1. A check that runs without anyone remembering it: a lint rule, a test, a git hook, a CI step, a pattern in `scripts/ai/guard.js`, or a rule in `scripts/ai/release-check.js`.
   2. A known error: add the error text, cause, fix and prevention to `docs/ai/known-issues.md`.
   3. Project knowledge: one line in the right `docs/ai/` file. Use `conventions.md`, `react-native.md` or `tech.md`, or `decisions.md` with the date and the reason.
   4. A workflow step: edit the skill that should have caught it.
   5. `AGENTS.md`: only for a rule every task needs, and keep the file under 150 lines.

   Make one fix in one place. Don't copy the same rule into several files.
4. **Remove what's no longer true** in the file you touched: old versions, renamed scripts, bugs that are fixed. Check versions and paths against the repo before trusting a line.
5. **Show that it works.**
   - For a check: show it failing on the old mistake and passing on the fixed code.
   - For docs or a skill: show the diff, and name the task that would have gone differently.
6. **This project or every project?** If the lesson applies to any React Native app, say so and draft an issue for the agentic-mobile-kit repo, so every project gets the fix. Ask before opening it.
7. **Commit** with a message that starts with `chore(learn):` and ends with `Assisted-by: <tool>/<model>`. That prefix keeps it out of the changelog and easy to find with `git log --grep 'chore(learn)'` in the monthly review. Ask before pushing.
