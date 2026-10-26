---
name: m-review
description: Review the current branch's changes for real problems before a pull request, and handle review feedback. Run only when the user explicitly invokes m-review.
disable-model-invocation: true
---

# m-review

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

If your tool has subagents, hand the review to the `m-reviewer` subagent, so it looks at the code with fresh eyes. Otherwise review it yourself, read-only.

## Reviewing

1. Get the changes since the base branch the kit's checks use: `node scripts/amk/baseline.js base` prints it, then `git diff <base>...HEAD` and `git log <base>..HEAD --oneline`. If there's a spec, read its `requirements.md`. Run `node scripts/amk/rn-check.js`: what it reports in the changed lines is a finding, and each `// amk-ok: <reason>` it lists needs a reason that holds.
2. Check, in order:
   - **Against the spec**, when there is one:
     - *Complete:* every task is ticked, every requirement is implemented, and every scenario has evidence (a test or a screenshot).
     - *Correct:* the code does what each requirement says, edge cases included, and nothing outside the agreed scope.
     - *Coherent:* the decisions in `design.md` show up in the code, its UI/UX level in the screens, and `specs/current/` was updated (`node scripts/amk/specs.js merge <id>`) if behavior changed.
   - **No spec:** does the diff do what was asked, and nothing unrelated?
   - **Tests:** were tests added for new logic? Were any tests deleted, skipped or weakened? Do they check behavior through the public interface, mock only what the app doesn't own, and take expected values from the spec rather than recompute them (the React Native rules file)?
   - **TypeScript:** any new `any`, `@ts-ignore` or non-null `!` to get past a check, or a loosened `tsconfig.json`?
   - **Both platforms:** anything iOS-only or Android-only (insets, back button, permissions, keyboard)?
   - **Screens:** with the keyboard open, do the field and its button stay visible? Does anything sit under the status bar, home indicator or gesture bar? Do lists that grow with the user's data scroll? Does text wrap at the largest text size?
   - **Design system:** new screens use the colours, type, spacing and controls in `docs/amk/design-system.md`; nothing new (a hex colour, a one-off button style) that it doesn't have.
   - **Forms and buttons:** a visible label on every field, not the placeholder; the right keyboard and autofill; errors under their field; a request that can't be sent twice; no success message when nothing was saved; a destructive action that asks first.
   - **Nothing invented:** no made-up figures, ratings, reviews or placeholder names on a screen; a missing text is a placeholder the PR lists.
   - **Tablets and landscape** (the screens `AGENTS.md` lists): does each layout adapt to the window width (`useWindowDimensions`), rather than stretching or centering the phone layout? Do turned screens scroll, with the left and right insets handled? Are sizes done the app's existing way?
   - **Accessibility:** does every new button or other touchable have an `accessibilityLabel` and an `accessibilityRole`, and checkboxes, switches and tabs their `accessibilityState`? Are messages that appear after an action, such as form errors, announced to screen readers? Text contrast 4.5:1 in both themes, nothing under 11 points, swipe and long-press actions reachable another way?
   - **Platform guidelines:** tap areas of at least 44×44 pt (48×48 dp on Android); swipe back and the Android back button still work, and every `Modal` closes with back; permissions asked when the user starts the feature, with a way to Settings once blocked; native controls; dark mode from the theme; Reduce Motion respected.
   - **Store review:** a new sign-up path needs account deletion in the app; a new social login needs Sign in with Apple; digital goods use in-app purchase; a new permission has a text that says why, and Google Play's restricted ones (photos, all packages, exact alarms, background location) a reason the feature can't do without. `node scripts/amk/release-check.js` finds some of these.
   - **Current APIs:** nothing React Native removed or deprecated, no `react-native/Libraries/…` imports, and React 19's ways (`ref` as a prop, `<Context value>`), as the React Native rules list them.
   - **Errors and states:** offline, server errors, empty and loading states; an error boundary around the app; no empty `catch`; an action that fails shows it and can be retried.
   - **Effects:** timers, listeners and subscriptions are cleaned up, and async work that ends after the screen closes doesn't update it.
   - **Security:** secrets, tokens in plain storage instead of the Keychain/Keystore (or `expo-secure-store`), secret keys in the JavaScript bundle, `.env` contents, logging of personal data, session replay that records typed text.
   - **Native:** `project.pbxproj`, `Podfile`, Gradle or manifest changes, and whether pods and builds were re-run.
   - **Performance:** heavy work in render, list keys (from IDs, not the index), needless re-renders, base64 images in code.
3. For each finding, check it in the code before reporting it. Report: severity (**blocker**, **should fix**), file and line, the problem, and a suggested fix. Leave out style nits; lint handles those.
4. End with: "Ready for PR" or "Not ready: N blockers".

## Receiving review feedback (from people or AI reviewers)

- Check each comment against the code before acting on it. Reviewers are sometimes wrong.
- Fix what's right; reply with the reason when you disagree.
- Don't add defensive code or abstractions only to satisfy a reviewer.
