---
name: m-prototype
description: Turn a rough requirement into something to demo before it's built - two or three concepts as clickable HTML mocks when how it should work is still open, then real screens with mock data on a throwaway branch, with screenshots and a video - and into requirements ready for m-feature. Run only when the user explicitly invokes m-prototype.
disable-model-invocation: true
---

# m-prototype

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (the rough requirement, notes from `m-explore`, or a task link plus pasted details).

A prototype answers questions before the real build: what the client wants, how it should work and how it should look. It's thrown away afterwards, and `m-feature` builds the real thing from the requirements it settled.

## 1. Understand

1. Read the requirement, `docs/amk/product.md`, `structure.md` and `conventions.md`, the living spec for the area in `specs/current/`, and the screens around where this would live: their components, theme and navigation.
2. Ask who the demo is for (the client or the team) and what it must show, one question at a time.
3. Pick an ID: the task's ID if it has one, otherwise `YYYYMMDD-<slug>`. Create the branch `prototype/<id>` from the main branch; this workflow commits everything there.
4. Write `specs/<id>/requirements.md` from `specs/_templates/requirements.md`: the goal, what's known so far, and the open questions the prototype should answer. Add a `## Decisions` section for what gets settled along the way.
5. Decide which case this is:
   - **What to show is clear** (the screens and the flow are known): go to step 3.
   - **How it should work or look is still open:** go to step 2.

## 2. Concepts

1. Work out two or three genuinely different ways it could work: different flows or layouts, not colour variants. For each, note the user flow step by step, the key screens, and the trade-offs: effort, iOS and Android differences, native or backend work.
2. Make one HTML file per concept in `specs/<id>/concepts/`: the key screens as phone-sized frames side by side, with the app's colours, fonts and spacing taken from its theme, real texts where they're known, and links between the frames so it can be clicked through. Each is a single file of plain HTML and CSS, with nothing to install or build and nothing loaded from the internet, so it opens in any browser.
3. Show the concepts with your recommendation. **Stop until the user picks one or combines them.** Write the choice and why under `## Decisions`, and commit.

## 3. Build the prototype in the app

1. Build the screens with the app's own components, theme and navigation, so it looks and feels like the app. Keep the mock data in one file next to the screens.
2. No API calls, no native files and no new dependencies. If one seems unavoidable, ask.
3. Make it easy to reach in a demo: a temporary entry where the feature would live, or the app's first screen when that's simpler.
4. Skip tests: the prototype is thrown away. It only has to build and run.
5. Commit on `prototype/<id>`. This branch is never merged.

## 4. Make the demo material

1. Write `.maestro/<id>-prototype.yaml` from `specs/_templates/flow.yaml`: walk through the prototype the way the demo would, with a `takeScreenshot` on every screen, and `startRecording: <id>-prototype` after the launch and `stopRecording` at the end for a video.
2. Run `sh scripts/amk/verify.sh all --flow .maestro/<id>-prototype.yaml --label <id>-prototype`. Off a Mac it covers Android only.
3. Open every screenshot and check that it shows what the demo needs. Give the user the folder `.amk/evidence/<id>-prototype/`, which has the screenshots and a video per platform, and the concept files if there are any. For a live demo, run the app from this branch on a phone or simulator.

## 5. Take in the feedback

After the demo, write what was settled into `requirements.md`: answered questions become requirements and scenarios, and the choices go under `## Decisions`. If the client asked for changes, change the prototype and run step 4 again. Repeat until the user approves the requirements: **stop and ask for that approval**, and record it under `## Decisions` with the date. Step 6 doesn't start without it.

## 6. Hand off to m-feature

1. Create the feature branch from the main branch and bring the spec over: `git checkout prototype/<id> -- specs/<id>`. Leave the prototype code behind.
2. Add the decisions from `## Decisions` to `docs/amk/decisions.md`, with the date. Run `node scripts/amk/specs.js check specs/<id>/requirements.md`, and commit.
3. If the prototype covered more than one feature, such as an app's first version, also write every feature with its rules in `docs/amk/product.md`, in the order to build them, each marked planned, and tell the user the path. `decisions.md` logs choices and their reasons; it isn't the requirements document.
4. Suggest `m-feature specs/<id>/requirements.md`, or one `m-feature` per feature when there are several. In `design.md` it names the `prototype/<id>` branch as the agreed flow and look, and it builds the real screens properly: real data, error, loading and empty states, and tests, on both platforms.
5. Delete the `prototype/<id>` branch once the feature has shipped.
