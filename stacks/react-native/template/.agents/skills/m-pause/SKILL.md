---
name: m-pause
description: Save the current state so the work can continue later in any AI tool or on another computer. Run only when the user explicitly invokes m-pause.
disable-model-invocation: true
---

# m-pause

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

1. **Update the handoff block** at the top of `specs/<id>/progress.md`: date and time, tool and model, branch, status (start the line with `not started`, `in progress — task N of M` or `done`, exactly), done, in progress (with file paths and what's half-done), the exact next step, decisions, open question, last check results, blockers, notes. Add a line to the log.
2. **Move decisions out of the chat.** Anything decided in this conversation goes into `requirements.md`, `design.md` or `docs/amk/decisions.md` now. Chat history doesn't travel to other tools.
3. **Commit the work in progress** on the feature branch (never `main`): message `wip: <id> <short summary>`, ending with `Spec: specs/<id>`.
   - Never use `--no-verify`. If a git hook blocks the commit, fix the problem if it's quick. Otherwise say so, record it in the handoff under "Blocked", and stop.
4. **Push the branch**: `git push -u origin <branch>`.
5. **Tell the user** the branch name, and that they can continue anywhere with `git pull`, then `m-continue <id>`.
