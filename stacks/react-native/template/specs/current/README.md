# What the app does now

One file per area of the app (for example `login.md` or `tasks.md`) that describes how the app behaves today, requirement by requirement. AI tools read it before they change an area, so they don't have to work out the current behavior from the code.

It starts empty and grows one change at a time; there's no need to describe the whole app up front. Each feature's `specs/<id>/requirements.md` lists what it adds, changes and removes, and when the feature is done, `node scripts/ai/spec.js merge <id>` applies those changes here. People can edit these files too.

## Format

    # Login

    ## Requirements

    ### Requirement: Sign in with a one-time code
    The app SHALL sign the user in after they enter the 6-digit code sent to their email.

    Source: specs/LOGIN-12

    #### Scenario: Correct code
    - GIVEN a user who requested a code
    - WHEN they enter it within 10 minutes
    - THEN they land on the home screen

    #### Scenario: Rejects an expired code
    - GIVEN a code older than 10 minutes
    - WHEN the user enters it
    - THEN the app shows "This code has expired" and offers to send a new one

- **A requirement** is one behavior, stated with SHALL (or MUST) so that someone who can't see the code could check it. How it's built belongs in `design.md`, not here.
- **A scenario** is a concrete case that proves the requirement, with GIVEN, WHEN and THEN. Cover the cases where bugs live (empty input, errors, offline, a second tap), and name the case in the title. Each scenario becomes a step and a screenshot in the feature's Maestro flow, or a test.
- **Only what's true now:** no plans and no history. The `Source:` line points to the feature that last changed the requirement, whose folder keeps the history.

## How a feature changes it

A feature's `requirements.md` groups its requirements under these headings, where `<area>` is the file name here:

- `## ADDED Requirements: <area>`: new behavior. Merging appends it. The name must not exist yet.
- `## MODIFIED Requirements: <area>`: behavior that changes. Copy the current requirement, keep its name, and edit it. Merging replaces the old one.
- `## REMOVED Requirements: <area>`: behavior that goes away, with a line on why. Merging deletes it, and deletes the file when its last requirement goes.

`node scripts/ai/spec.js check` checks the format; the git pre-commit hook runs it on staged specs once their work has started. `node scripts/ai/spec.js status` lists every feature's state and task progress.
