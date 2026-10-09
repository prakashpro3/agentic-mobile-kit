---
name: m-onboard
description: Describe the app for AI agents - read the whole project, draft docs/amk/product.md, tech.md, structure.md and conventions.md, ask only what the code can't show, and write them once the user approves. Run it after installing the kit, and again after big changes. Run only when the user explicitly invokes m-onboard.
disable-model-invocation: true
---

# m-onboard

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (optional: which files to work on, for example `tech structure`; all four by default).

Every agent reads these four files before it works on this app, so they must be true, short and specific: facts with the files they come from, not advice. Write only what you found in the project or what the user told you.

## 1. See what's there

Read `AGENTS.md` and the four files in `docs/amk/`. A file that holds only its heading and the `<!-- … -->` outline is empty: you'll draft it. A file with content is the team's: you'll suggest changes to it, never rewrite it.

## 2. Read the project

Change nothing in this step. List the project's files with `git ls-files` (it leaves out `node_modules`, Pods and build output), then read in this order:

- **What the app is:** the README, `package.json` (name, scripts, dependencies), `app.json` or `app.config.*` in Expo apps, the display name and bundle IDs, and store texts if there are any (`fastlane/metadata/`, `release-notes/`).
- **Screens and journeys:** the entry point (`index.js`, `App.tsx`, or the `app/` folder with Expo Router), the navigation setup and the list of screens. The key user journeys come from these: sign-in, the main flows, payments, settings.
- **Tech:** for each dependency that matters, what the app uses it for and where it's set up: state, navigation, the API client, storage, forms, i18n, analytics, push, crash reporting, payments, maps. Also the backend APIs and where their contracts live, and the environments: config files, `.env.example`, build flavors and schemes. Never open `.env` files, keystores or signing files.
- **Structure:** the folder map, two or three levels into the app's code; where shared components, the theme and helpers live; custom native code under `ios/` and `android/` (native modules, extensions, widgets), or config plugins and local modules in Expo apps.
- **Conventions:** a few files from each layer (a screen, a component, a hook, an API call, a test) and what they have in common: naming, file layout, styling, error, loading and empty states, how tests mock the API. Also the lint and formatter configs, and `git log --oneline -30` for the style of commit messages and branch names. A convention is a pattern you saw in several files; a single file is an example, not a rule.

In a large app, sample: a few files per layer are enough. Keep a note of the files each finding comes from.

## 3. Draft

Draft each file you're working on from its outline, and keep it short: `product.md` under 40 lines, the others under about 60.

- `product.md`: what the app does in two sentences, who uses it, the 3 to 5 key journeys, and what must never break.
- `tech.md`: what the app uses today, one line each with the library and where it's set up; the backend APIs and their contracts; the environments and how the app switches between them; third-party services. Describe what's there; don't recommend new tools.
- `structure.md`: the folder map, one line per folder; where shared UI, the theme and helpers live, so agents reuse them instead of writing new ones; custom native code.
- `conventions.md`: the patterns you found, each with a file that shows it.

Use the app's own names for screens, modules and services. Where the project doesn't answer something, write down a question for step 4 instead of guessing.

For a file that's already filled in, compare it with what you found and list what's missing, out of date or wrong, with the file that shows it. Leave what's still true alone.

## 4. Ask what the code can't show

Ask the user in one message, usually five questions or fewer, about what you couldn't find:
- who uses the app (customers, staff, a market or age group);
- what must never break (payments, data sync, sign-in, …);
- whether the key journeys you found are right and complete;
- which of two conflicting things is current: two API clients, two styling approaches, two state libraries.

## 5. Show, then write

Show the drafts, and the suggested changes for files that are already filled in. **Stop until the user approves them.** Then write only what they approved. A decision the user made in their answers, such as which of two libraries is current, also gets a dated line in `docs/amk/decisions.md`. Change nothing else: no code, no `AGENTS.md`, no other docs.

## 6. Commit

On the main branch, suggest a new branch first. Commit the files with a message that starts with `docs(amk):`, which keeps it out of the changelog. Ask before pushing.

Suggest running `m-onboard` again after big changes: a new module, a new state or navigation library, a new backend. In a new app that's still close to its template, also suggest settling the stack choices the team hasn't made yet with `m-explore` before the first feature, for example `m-explore which navigation and state libraries should we use`.
