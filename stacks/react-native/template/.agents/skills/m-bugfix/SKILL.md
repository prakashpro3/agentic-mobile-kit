---
name: m-bugfix
description: Fix a bug by finding its root cause, proving it with a failing test, and fixing it minimally. Run only when the user explicitly invokes m-bugfix.
disable-model-invocation: true
---

# m-bugfix

Input: $ARGUMENTS (what's wrong, steps to reproduce, error text, screenshots, task link).

1. **Check `docs/ai/known-issues.md`** for a matching error. If there is one, apply its fix and verify.
2. **Reproduce.** Write down the exact steps and the actual vs expected result. If you can't reproduce it, say so and ask for more details. Don't guess.
3. **Write a failing test** that shows the bug, if it can be tested with Jest. Run it and show that it fails. (Native or device-only bugs: write the manual steps instead.)
4. **Find the root cause before changing code.**
   - Read the full error and stack trace.
   - Trace the data back to where it goes wrong.
   - Form one hypothesis, test it, and confirm or reject it. One at a time.
   - Fix the cause, not the symptom: no try/catch that hides the error, no special case for the failing input.
5. **Make the smallest fix.** Don't refactor or touch unrelated code.
6. **Verify.** The new test passes, and lint, typecheck and all tests pass. Paste the output. For UI or native bugs, rebuild and check the affected platform(s).
7. **Two attempts at most.** If two fixes didn't work, stop. Report what you tried, what you learned and what you suspect next.
8. **Record it.** If this kind of error could come back, add an entry to `docs/ai/known-issues.md` (error, cause, fix, prevention).
9. **Commit** with a message ending in `Assisted-by: <tool>/<model>`. Ask the user before pushing, then open a PR with the evidence.
