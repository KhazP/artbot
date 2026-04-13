# Adapter Authoring

## Required contract
- Every adapter must expose `capabilities.version = "1"`.
- Capabilities must declare access modes, browser support, sale modes, evidence requirements, and preferred discovery style.
- Adapters should keep deterministic extraction first and browser escalation second.

## Testing
- Add or update fixture HTML under `data/fixtures/adapters/<adapter>/`.
- Keep adapter-specific tests.
- Run the shared fixture contract harness to ensure the fixture still yields a meaningful acceptance outcome.
- Add the source to `artbot canaries run` if it is part of the priority surface.

## Debug workflow
1. Capture or reuse a failing raw snapshot.
2. Replay it with `artbot replay attempt`.
3. Repair parser logic or selector assumptions.
4. Re-run the adapter tests and canaries before touching live traffic.
