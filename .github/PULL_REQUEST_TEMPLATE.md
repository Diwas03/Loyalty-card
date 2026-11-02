## Behavior and scope

Describe the final change, compatibility and policy decisions.

## Evidence

- [ ] Typecheck/build and applicable isolated API/database/browser suites passed
- [ ] SQL packaging regression retained
- [ ] Representative migration and private-schema restore rehearsed
- [ ] Complete diff reviewed; no secrets or generated private artifacts
- [ ] Real-device checklist completed or explicit outstanding tasks listed

## Release gate

- [ ] Preview DB and provider isolation verified **before push**
- [ ] No production settings/data/deployment changed by this PR
- [ ] Production backup and authorized recovery evidence reviewed before release
- [ ] Migration-first ordering, compatibility and rollback limitations reviewed
- [ ] Another person approved; required checks pass; comments resolved

Do not merge or deploy from this feature-work authorization.
