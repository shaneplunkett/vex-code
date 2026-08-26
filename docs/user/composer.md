# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

On servers that support direct uploads, images upload as soon as you add them. The send button
becomes available after every upload finishes. Failed uploads can be retried or removed.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

A selected `$name` chip is an explicit skill invocation, not a textual hint. T3 Code keeps the
canonical `$name` in the timeline and translates it to the provider's native invocation when the
turn starts. If a provider cannot preserve the selected invocation, the turn fails with a visible
error instead of sending `$name` as inert prose.

The `/` menu is command-only. If a provider also reports one of its skills as a native slash command,
T3 Code hides that entry so explicit skill invocation stays under the canonical `$` picker.

Claude currently supports one explicit skill per message and cannot combine that invocation with an
image attachment. T3 Code rejects those combinations clearly; send multiple skills in separate turns,
or invoke the skill first and attach images in a follow-up. Skills marked
`disable-model-invocation: true` are still available to the `$` picker because the user is explicitly
invoking them. Skills switched off through Claude's `skillOverrides`, or marked
`user-invocable: false`, stay hidden.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.
