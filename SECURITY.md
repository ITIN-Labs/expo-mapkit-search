# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: on this repository's Security tab, choose "Report a vulnerability". Don't open a public issue. You'll get a reply within a week, and we'll keep you posted until it's fixed.

## Supported versions

Only the latest 0.x minor release gets security fixes.

## Scope

In scope: anything that sends Apple more than the package documents, input that crashes or hangs the app, and the usual problems in the package itself (vulnerable dependencies, code execution, unexpected file or network access).

Out of scope: how Apple Maps handles the requests it receives, and problems in Expo or React Native themselves, which should go to those projects.

The threat model is in [docs/security.md](docs/security.md).
