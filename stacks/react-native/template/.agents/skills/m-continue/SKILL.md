---
name: m-continue
description: Resume work that was started earlier, possibly in another AI tool or on another computer, from the files in specs/. Run only when the user explicitly invokes m-continue.
disable-model-invocation: true
---

# m-continue

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (a spec ID, or empty).

1. **Check git first.** Run `git fetch` and `git status`.
   - If the branch is behind its remote, say so and ask before pulling.
   - If there are uncommitted changes, list them; they may be half-done work.
2. **Find the spec.** Use the given ID; otherwise the `specs/*/progress.md` (not `_templates`) updated most recently. If unsure, ask.
3. **Read** `requirements.md`, `design.md`, `tasks.md` and `progress.md` in that spec folder, plus `git log --oneline -15`.
4. **Report back, in this order:**
   1. any open question or blocker from the handoff;
   2. the status (task N of M) and what's done;
   3. the exact next step.

   Use only what the files and git say. If something isn't recorded, say it's unknown. Never fill gaps with guesses.
5. **Wait for the user to confirm**, then continue with the next unchecked task, following step 4 of `m-feature` (one task at a time, real check output, commit, update `progress.md`).
