---
name: upstream-cherry-pick
description: >
  Audit OTTO's two upstream forks (pi-dev at ../pi, gsd-pi at ../gsd-pi)
  for fixes and features worth porting. Classifies each commit by
  applicability and severity, scores conflict risk against
  docs/UPSTREAM-SYNC.md, files GitHub issues for actionable candidates,
  and writes a triage report. Use when checking what's new upstream,
  building the cherry-pick backlog, or before a release. Safe to run in
  background mode — produces durable artifacts (issues + report file).
---

# Upstream Cherry-Pick Audit

(Body will be written in Task 17; for now this is just the registry stub.)
