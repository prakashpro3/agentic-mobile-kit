---
name: m-feature
description: Build a feature from a requirement (pasted text, a file, or a task link), from spec to pull request. Run only when the user explicitly invokes m-feature.
disable-model-invocation: true
---

# m-feature

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (the requirement text, a file path, or a task link plus pasted details).

With no input, don't guess what to build:
1. Run `node scripts/amk/specs.js status`. If a spec is in progress, say which one and where it stopped, and suggest `m-continue`. Start something new only if the user says so.
2. Otherwise offer the features marked planned in `docs/amk/product.md` as options to pick from (`AGENTS.md`), the next one first: the first in the list whose dependencies are built. Wait for the user to pick.
3. If nothing is planned, ask what to build, or suggest `m-explore` when the requirements aren't settled yet.

## 1. Always use the full flow

The user chose `m-feature`, so follow every step below, however small the change looks. Never skip the spec or the approval stops on your own judgment. (For a small change to behavior the app already has, suggest `m-change`. A change with nothing to record, such as fixing a typo, can just be asked for directly.)

If the input describes a bug rather than new behavior, suggest `m-bugfix` and stop. If it's still a vague problem ("the checkout feels slow") or an area you'd have to learn first, suggest `m-explore` first.

## 2. Requirements (then stop for approval)

1. Pick an ID: the task's ID if it has one, otherwise `YYYYMMDD-<slug>`. Copy `requirements.md`, `design.md`, `tasks.md` and `progress.md` from `specs/_templates/` to `specs/<id>/`. If `specs/<id>/` already has a draft from `m-explore` or `m-prototype`, keep it and copy only the missing files.
2. Read `specs/current/<area>.md` for each area this touches: it says what the app does now. In an area with no living spec yet, read the code that implements it.
3. **One intent.** The feature should be one thing you can say in a sentence. If it needs "and also", suggest splitting it into separate features, and ask.
4. Fill `requirements.md`: the goal; the user stories (who it's for and why, each naming its requirements) and use cases (the journey and what can go differently, each alternative flow and exception naming the scenario that tests it); the requirements under `## ADDED`, `## MODIFIED` and `## REMOVED Requirements: <area>` (the format is in `specs/current/README.md`), with one SHALL per requirement and scenarios for the cases that matter; every edge-case line (or "n/a"); out of scope; open questions. Use the app's words from `docs/amk/glossary.md`; a new word, or one used two ways, gets settled with the user and added there. Then run `node scripts/amk/specs.js check specs/<id>/requirements.md`.
5. If something is unclear, ask the user in rounds (`AGENTS.md`): every question you can ask now, each with the answer you recommend, as options to pick from where your tool has a question tool; the edge cases you'd add go in one multiple-choice question. Don't fill gaps with guesses.
6. Show the stories, use cases and requirements, with the answers worked in, and **stop until the user approves them**: a question of its own (Approve, or Change something), never part of a round, asked once no question is open. Give the user these questions to check them against:
   - Is this the problem you asked me to solve, with nothing extra in scope?
   - Could someone test each requirement without reading the code?
   - Does a scenario cover the case you care about most?

   Once approved, commit `specs/<id>/` on its own as `docs(spec): <id> approved`, and note its hash in the log in `progress.md`: it's the approved version. From then on, a requirement changes only through `## Changes after approval` (step 4).

## 3. Design and tasks (then stop for approval)

1. **Ask for the UI/UX level first, when the feature has screens**, in one round with any other open design question: which level its screens should have (a single choice, with a preview of each where your tool shows one): Simple (clean, minimal and functional), Mixed (simple, with modern touches) or Premium (polished, following current design trends; it takes longer). `specs/_templates/design.md` describes each. Offer as the default the level a prototype settled (under `## Decisions` in `requirements.md`), otherwise the one the app's other screens have (an earlier spec's `design.md`), otherwise Simple. Don't design until the user has answered. Write the answer and the date under "UI/UX level" in `design.md` (n/a for a feature without screens).
2. **Search the codebase before designing.** List the components, hooks, API clients and helpers you'll reuse in `design.md` under "Existing code to reuse". Read `docs/amk/structure.md` and `docs/amk/conventions.md`.
3. Fill `design.md`: approach, files to change, risks (native changes, pod install, migrations), and `## Tests`. For those, run `node scripts/amk/specs.js tests <id>`: give each scenario its check (a Jest test named after it, a flow block, or manual steps for what a flow can't do), say what happens to the tests of the requirements this modifies or removes, and take the regression command it prints, adding the flows no spec links to that this touches.
4. Fill `tasks.md`: small tasks (about an hour, under ~300 changed lines each), each a thin slice through every layer it needs (screen, state, API call, test) that works and can be checked on its own, rather than one layer at a time. Changes that make the feature easy to add (moving or renaming code that's there) come first, as their own task. Each task names the requirement it serves, the tasks it waits on (`after:`) and how it's checked, and its tests are written in the same task, not left for the end. The last task writes `.maestro/<id>.yaml` (`node scripts/amk/specs.js flow <id>` starts it from `specs/_templates/flow.yaml`, a block for each scenario): a Maestro flow with a `# Scenario <n>: <name>` comment above each scenario's steps, an assertion for its THEN and a screenshot, tapping elements by `testID` and scrolling to the ones further down a screen first (`scrollUntilVisible`): turned screens are short. A screen that loads data gets a scenario and a screenshot for its empty and error states too, where a flow can reach them (cleared data, or an account without any, for empty; `setAirplaneMode: enabled` for no network). When the feature adds screens, the task for its main screen comes first among them and ends with a look check: the start of `.maestro/<id>.yaml` opens that screen and takes its screenshot, run with `sh scripts/amk/verify.sh ios --flow .maestro/<id>.yaml --screens phone` (or `android`).
5. Show design and tasks and **stop until the user approves them**: a question of its own, asked once no question is open. Ask them to check that every task serves an approved requirement and nothing goes beyond the agreed scope.

From here the plan lives in files, so the building can also run in a fresh session or another tool with `m-continue <id>`.

## 4. Build, one task at a time

For each task, in order (a task with `after:` once those tasks are ticked; one without, as listed):
1. Implement only that task. Write tests first for logic (state, data, utils); UI can be tested after. Build screens to the UI/UX level in `design.md`, from the colours, type, spacing and controls in `docs/amk/design-system.md`, and to the screen rules in the React Native rules file `AGENTS.md` names (keyboard, system bars, scrolling, large text, announced messages), for every phone, tablet and orientation `AGENTS.md` lists: they're the bugs device checks and reviews find most.
2. Run `sh scripts/amk/verify.sh quick --related`: lint, typecheck, and the tests of the files this branch changed. Paste the real output. If something fails, fix it; after 2 failed attempts, stop and report.
3. Commit with a clear message ending in `Spec: specs/<id>`.
4. Tick the task in `tasks.md` and update the handoff block and log in `progress.md`.

After the main screen's task, show the user its screenshot and **stop until they OK the look**: a wrong look then costs one screen, not five.

If building shows the plan is wrong: when the intent is the same, update `design.md` or `tasks.md` and tell the user what changed. A requirement that changes gets an entry under `## Changes after approval` in `requirements.md` (before and after, why, and the stories, scenarios, tasks, tests and flows it changes), and you stop for its approval, a question of its own. When the intent itself changed, or the scope grew into different work, stop and suggest finishing this feature small and starting a new one.

## 5. Test it

When all tasks are done, run `m-test <id>`: the code checks, the device flows of the feature and of the areas it touches, and the test report, where each scenario gets a status. Fix what fails and run it again until the report says Ready (after two failed attempts at the same fix, stop and report). Where the code and the spec disagree, fix whichever is wrong, asking first if it's the spec: the spec must describe what ships. Off a Mac, record in `progress.md` that iOS still needs checking on a Mac, and say so in the PR.

Then **the design review**: give the screenshots `verify.sh` listed as changed (all of them, the first time) to the `m-design-reviewer` subagent, which sees only them, `docs/amk/design-system.md` and the UI/UX level in `design.md` (without subagents, check the same yourself). Fix what it finds, or tell the user why one stays. Once the user accepts the look, `sh scripts/amk/verify.sh approve --label <id>` makes these screenshots the approved ones.

## 6. Update the living spec and the docs

Run `node scripts/amk/specs.js merge <id>`. It applies the ADDED, MODIFIED and REMOVED requirements to `specs/current/` and notes the source of each. If it refuses, the reason is usually that a requirement listed as ADDED already exists, or one listed as MODIFIED doesn't. Fix `requirements.md` and run it again. Commit `specs/current/` with the feature, so reviewers see the change in behavior.

Then update the `docs/amk/` files the feature made untrue: a new key journey in `product.md` or, for a planned feature there, its rules replaced by one line without the planned mark, a new library or service in `tech.md`, a new folder or shared component in `structure.md`, a new pattern in `conventions.md`. Commit them with the feature too.

## 7. Review and pull request

1. Run `m-review` (or ask the `m-reviewer` subagent, if your tool has subagents). Fix real problems only; skip style nits.
2. Ask the user before pushing. Then push the feature branch (never `main`) and open a PR. Start the description with the requirements this adds, changes and removes, so reviewers read what should be true before the code. Then add the evidence: lint, typecheck and test output, and the screenshot for each scenario. Then the risk: whether it can be undone once a store build ships (native changes, data saved in a new format, and API changes that installed versions still rely on can't be; JavaScript can be fixed in the next release), and what else it could break. Use `.github/pull_request_template.md` if the repo has one.

Never claim a check passed without running it in this session.
