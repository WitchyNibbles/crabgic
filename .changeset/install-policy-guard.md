---
"crabgic": patch
---

`crabgic install` keeps an existing standing policy instead of clobbering it.

Adversarial review (the turn-budget round) found `bootstrapPolicy` had no
existing-file guard and the policy writer renames over the destination — so
an owner re-running `install`, for example to acquire a newly added policy
field, silently replaced their policy with a freshly derived one. That is
worse than it sounds: network, credential and remote-resource grants are
never derived, so they exist ONLY by hand, and re-install wiped exactly the
grants an owner had deliberately added.

`install` now checks the policy path first, before any derivation or
prompt. A valid existing policy is kept untouched and reported
(`kept-existing`), with the remedy stated: edit the file directly, or
delete it and re-run `install` to re-author. An existing-but-unloadable
policy is refused with the loader's own reason (`existing-invalid`) rather
than "repaired" by replacement — overwriting an invalid file loses the
owner's hand edits just the same. The `loadExisting` guard is a REQUIRED
member of the installer's policy bag, so no future caller can forget it.

Also records in `docs/security-posture.md` the review's adjacent latent
finding: `FALLBACK_MAX_TURNS = 20` in the engine adapter is the one turn
number the containment gate cannot see (bounded: read-only fallback
profile, no production caller reaches it today).
