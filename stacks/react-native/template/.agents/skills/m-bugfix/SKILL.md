---
name: m-bugfix
description: Fix a bug by finding its root cause, proving it with a failing test, and fixing it minimally. Run only when the user explicitly invokes m-bugfix.
disable-model-invocation: true
---

# m-bugfix

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (what's wrong, steps to reproduce, error text, screenshots, task link).

1. **Check `docs/amk/known-issues.md`** for a matching error. If there is one, apply its fix and verify.
2. **Make it fail on demand.** Before looking for the cause, build one check that shows the bug and that you can run again: a failing Jest test where the logic can be tested; for a bug that shows on the device, a Maestro flow `.maestro/<spec>-bug-<slug>.yaml`, where `<spec>` is the one the broken requirement's `Source:` line in `specs/current/` names, so that area's regression runs it (`bug-<slug>.yaml` without one; from `specs/_templates/flow.yaml`), that goes where the user did and asserts what should be there, run with `sh scripts/amk/verify.sh ios --flow <path>` or `android`. Run it and show that it fails the way the user described, not with some other error. If you can't make it fail, say what you tried and ask for what would help (the exact steps, a screen recording, logs, the device and OS version). Don't guess.
3. **Find the root cause before changing code.**
   - Find what should have caught it: what checks the broken requirement (`node scripts/amk/specs.js tests <spec>`). Say why it missed the bug: no scenario for this case, a check that asserts too little, or none at all.
   - Read the full error and stack trace, and trace the data back to where it goes wrong.
   - List three to five possible causes, most likely first, each with what it predicts ("if X is the cause, then changing Y fixes it"). Show the list to the user, who may know which one it is.
   - Test them in that order, one change at a time. Tag every log you add while debugging with `[amk-debug]`, and remove them all before committing: `git grep amk-debug` finds them.
   - Fix the cause, not the symptom: no try/catch that hides the error, no special case for the failing input.
4. **Make the smallest fix.** Don't refactor or touch unrelated code.
5. **Verify.** The check from step 2 passes now, and stays in the project so the bug can't come back unnoticed. Lint, typecheck and all tests pass too. Paste the output. For UI or native bugs, run `sh scripts/amk/verify.sh ios` and/or `android` and look at the screenshots; `--screens` limits it to the screens the bug is on (for example `--screens tablet-landscape`).
6. **Two attempts at most.** If two fixes didn't work, stop. Report what you tried, what you learned and what you suspect next.
7. **Record it.** If this kind of error could come back, add an entry to `docs/amk/known-issues.md` (error, cause, fix, prevention). If the fix changes what the app is meant to do, not just makes it work as specified, update that requirement in `specs/current/<area>.md` in the same format, and run `node scripts/amk/specs.js check`. A case the spec didn't cover becomes a scenario of its requirement there, and the check from step 2 is named after it: the Jest test's title, or a `# Scenario: <name>` block in the bug's flow.
8. **Commit** with a message that names the cause you confirmed, so the next person debugging learns from it. Ask the user before pushing, then open a PR with the evidence.
