---
name: m-review
description: Review the current branch's changes for real problems before a pull request, and handle review feedback. Run only when the user explicitly invokes m-review.
disable-model-invocation: true
---

# m-review

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

If your tool has subagents, hand the review to the `m-reviewer` subagent, so it looks at the code with fresh eyes. Otherwise review it yourself, read-only.

## Reviewing

1. Get the changes: `git diff main...HEAD` and `git log main..HEAD --oneline`. If there's a spec, read its `requirements.md`.
2. Check, in order:
   - **Against the spec**, when there is one:
     - *Complete:* every task is ticked, every requirement is implemented, and every scenario has evidence (a test or a screenshot).
     - *Correct:* the code does what each requirement says, edge cases included, and nothing outside the agreed scope.
     - *Coherent:* the decisions in `design.md` show up in the code, and `specs/current/` was updated (`node scripts/amk/specs.js merge <id>`) if behavior changed.
   - **No spec:** does the diff do what was asked, and nothing unrelated?
   - **Tests:** were tests added for new logic? Were any tests deleted, skipped or weakened?
   - **TypeScript:** any new `any`, `@ts-ignore` or non-null `!` to get past a check, or a loosened `tsconfig.json`?
   - **Both platforms:** anything iOS-only or Android-only (insets, back button, permissions, keyboard)?
   - **Screens:** with the keyboard open, do the field and its button stay visible? Does anything sit under the status bar, home indicator or gesture bar? Do lists that grow with the user's data scroll? Does text wrap at the largest text size?
   - **Tablets and landscape** (the screens `AGENTS.md` lists): does each layout adapt to the window width (`useWindowDimensions`), rather than stretching or centering the phone layout? Do turned screens scroll, with the left and right insets handled? Are sizes done the app's existing way?
   - **Accessibility:** does every new button or other touchable have an `accessibilityLabel` and an `accessibilityRole`? Are messages that appear after an action, such as form errors, announced to screen readers?
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
