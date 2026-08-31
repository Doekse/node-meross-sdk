# Review guidelines

Criteria for pull request review in this repository. CodeRabbit and human reviewers should apply these.

## Fit existing patterns

Match the approach already used nearby. Prefer extending an existing trait, transport, session, or test helper over introducing a parallel API, abstraction, or framework.

Public surface is Session, Endpoint, and traits. Transports, protocol codecs, and the device graph stay internal unless the PR deliberately expands exports in `src/index.ts`.

## Keep changes simple

Flag extra layers, speculative generality, premature abstractions, and refactors unrelated to the PR goal. Prefer the smallest change that fixes the problem and matches local style. Do not propose alternative architectures unless the current approach is clearly wrong.

## Fix the root cause

Do not accept workarounds. A workaround papers over a bug, API gap, or type issue instead of fixing it — for example type casts to silence errors, special-case branches for broken callee behavior, duplicated logic that belongs in one place, or temporary guards meant to be cleaned up later.

Require the fix that makes the workaround unnecessary.

## Tests

Use `node:test` (`describe` / `it`) and the built-in mock API (`t.mock.method`, `t.mock.fn`, `t.mock.timers`). Do not introduce sinon or other mock libraries.

Cover failure paths and edge behavior, not only the happy path. Avoid flaky timing and weak assertions.

## CI and GitHub

Keep workflows least-privilege. Prefer pinned third-party actions. Do not broaden secrets or write access without a clear need.
