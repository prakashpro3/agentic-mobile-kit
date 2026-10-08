# What the app does now

One file per area of the app (for example `login.md` or `tasks.md`) that describes how the app behaves today, requirement by requirement. AI tools read it before they change an area, so they don't have to work out the current behavior from the code.

`m-feature` adds to it when a feature is done, and `m-bugfix` corrects it when a fix changes what the app should do. People can edit it too. It starts empty and grows one change at a time; there's no need to describe the whole app up front.

## Format

    # <Area>

    ## <Short requirement title>
    WHEN <situation> THE APP SHALL <behavior>.
    Source: specs/<id>

- Write only what's true now: no plans, and no history. The task folders in `specs/` keep the history.
- When a change alters a requirement, rewrite it in place and update its source. When a change removes one, delete it.
