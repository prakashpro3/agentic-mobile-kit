# <ID>: tasks

Each task: about an hour of work, under ~300 changed lines, one commit. Each is a thin slice through every layer it needs (screen, state, API call, test) that works and can be checked on its own, not one layer at a time; moving or renaming code that's there, to make the feature easy to add, comes first. Each names the requirement it serves, the tasks it waits on, and how it's checked. Its tests are written in the same task, not in a catch-up task at the end. While building, your AI tool's task list (Claude Code's tasks, Codex's plan) follows this one: the task you're on in progress, each done when it's ticked here.

- [ ] 1. <task> — for: <requirement name> — after: <task numbers, or none> — files: <paths> — check: <test, command or screen>
- [ ] 2.
