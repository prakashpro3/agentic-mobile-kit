---
name: m-review
description: Review the current branch's changes for real problems before a pull request, and handle review feedback. Run only when the user explicitly invokes m-review.
disable-model-invocation: true
---

# m-review

If your tool has subagents, hand the review to the `m-reviewer` subagent, so it looks at the code with fresh eyes. Otherwise review it yourself, read-only.

## Reviewing

1. Get the changes: `git diff main...HEAD` and `git log main..HEAD --oneline`. If there's a spec, read its `requirements.md`.
2. Check, in order:
   - **Scope:** does the diff do what the spec asks, and nothing unrelated?
   - **Tests:** were tests added for new logic? Were any tests deleted, skipped or weakened?
   - **Both platforms:** anything iOS-only or Android-only (insets, back button, permissions, keyboard)?
   - **Errors and states:** offline, server errors, empty and loading states.
   - **Security:** secrets, tokens, `.env` contents, logging of personal data.
   - **Native:** `project.pbxproj`, `Podfile`, Gradle or manifest changes, and whether pods and builds were re-run.
   - **Performance:** heavy work in render, list keys, needless re-renders.
3. For each finding, check it in the code before reporting it. Report: severity (**blocker**, **should fix**), file and line, the problem, and a suggested fix. Leave out style nits; lint handles those.
4. End with: "Ready for PR" or "Not ready: N blockers".

## Receiving review feedback (from people or AI reviewers)

- Check each comment against the code before acting on it. Reviewers are sometimes wrong.
- Fix what's right; reply with the reason when you disagree.
- Don't add defensive code or abstractions only to satisfy a reviewer.
