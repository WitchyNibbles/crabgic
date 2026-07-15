# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

The private disclosure route for this repository is **GitHub's private
vulnerability reporting**: open the repository's **Security** tab and select
**"Report a vulnerability"**. This creates a private advisory visible only to
the repository owner and maintainers, and lets us coordinate a fix and a
disclosure timeline with you before any public details are shared.

If, for some reason, private reporting is unavailable to you, contact the
repository owner directly through their GitHub profile (the account listed
as the owner/maintainer of this repository) and ask for a secure channel to
share details. Do not include vulnerability details in that initial contact
message — wait for a secure channel to be established.

> **Deviation note (Phase 01):** this repository does not yet have a GitHub
> remote configured (see `docs/evidence/phase-01/README.md`). Until a remote
> exists, "the Security tab" above is a statement of the intended route once
> one is configured, not yet a clickable, live feature. No specific contact
> email is published here; none should be invented in its place.

## Supported versions

This project has not yet reached a `v1.0.0` release (see
`docs/release-notes-prep.md` and `roadmap/23-release-hardening.md`). Until
the first tagged release, only the `main` branch is supported, and security
fixes land there directly.

| Version | Supported |
| ------- | --------- |
| `main`  | ✅        |

## What to expect

- We will acknowledge new reports as soon as practical.
- We will work with you to understand impact and severity before any public
  disclosure.
- Once a fix is available, we will coordinate a disclosure timeline with
  you, crediting reporters who wish to be credited.

## Scope

At this phase (Phase 01 — repository bootstrap), the repository contains no
runtime code, network-facing surface, or credential handling: every
workspace package (`packages/*`) is an empty, compiling stub. The first
substantive security review is scheduled for phase 02 (threat model) and
phase 14 (enforced security gates), re-verified live at phase 23 (release
hardening). Reports against the toolchain itself (CI configuration, linting,
dependency pinning) are still welcome.
