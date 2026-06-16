export const meta = {
  name: 'upstream-swarm-driver',
  description: 'Unattended driver: loops swarm-control (fix→CI→gate→refute→merge) with agent fan-out',
  phases: [
    { title: 'Preflight' },
    { title: 'Select' },
    { title: 'Loop' },
    { title: 'Report' },
  ],
}

/*
 * Thin Workflow shell over the tested controller. ALL decisions live in
 * swarm-control / driver-core (unit-tested); this script only:
 *   - calls swarm-control subcommands via `ctl` (a shell agent → {stdout} → JSON.parse,
 *     the pattern validated live by the phase2b probes), and
 *   - fans out fix lanes + refute lenses as `agent(prompt)` (prompts come from the
 *     `plan` / `refute-bundle` subcommands).
 *
 * Sandbox notes: the Workflow body has no fs/shell and Date.now() is blocked.
 * We never pass --now; swarm-control's own node process stamps the time.
 *
 * args (Workflow `args`): {
 *   ledger, caps, date, dir, filter, gateLogDir?, unattended:boolean, dryRun?:boolean, maxTicks?:number
 * }
 *
 * v1 known limits (see SKILL "Unattended run"): per-issue timeout (fixStartedAt)
 * is not stamped, so the issue-timeout circuit-breaker is inert in v1 — the
 * `maxTicks` guard bounds the loop. Build out timeout stamping in a follow-up.
 */

const CONTROL = '.claude/skills/upstream-swarm/scripts/swarm-control.mjs'
const VERDICT_SCHEMA = {
  type: 'object',
  properties: { lens: { type: 'string' }, verdict: { type: 'string' }, confidence: { type: 'number' }, reason: { type: 'string' }, blocking: { type: 'boolean' } },
  required: ['lens', 'verdict'],
  additionalProperties: true,
}

// Fix-lane result. WHY a schema: the fix lane is a full upstream-fix subagent;
// without a schema, agent() returns its FINAL TEXT as a string — and that text
// is often prose ("PR #403 is open, all gates passed…"), not the requested
// JSON. The driver then reads res.outcome/res.prNumber off a string → always
// undefined → every successful lane is mis-recorded fix-failed ("lane did not
// open a PR"). Forcing this schema makes the runtime compel a StructuredOutput
// object regardless of prose, exactly like the ctl {stdout} pattern.
const FIX_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    issue: { type: 'integer' },
    outcome: { type: 'string', enum: ['pr-opened', 'fix-failed', 'blocked'] },
    prNumber: { type: ['integer', 'null'] },
    prUrl: { type: ['string', 'null'] },
    branch: { type: ['string', 'null'] },
    gatesPassed: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['outcome'],
  additionalProperties: true,
}

// Validated ctl pattern: the agent's only job is to run the command and place
// its COMPLETE stdout verbatim into `stdout`; the SCRIPT parses. Never give the
// agent a loose object schema (it invents shape / wraps under stdout anyway).
const ctl = async (argv, label) => {
  const r = await agent(
    `Run EXACTLY this command from the repo root using the Bash tool, then return its result.\n` +
    `Command:\nnode ${CONTROL} ${argv.map((a) => JSON.stringify(a)).join(' ')}\n\n` +
    `Put the command's COMPLETE stdout, verbatim and unmodified (it is JSON), into the "stdout" field. Do not parse, summarize, reformat, or add anything. If the command exits non-zero, still capture whatever it printed.`,
    { label: label ?? `ctl:${argv[0]}`, schema: { type: 'object', properties: { stdout: { type: 'string' } }, required: ['stdout'], additionalProperties: true } }
  )
  return JSON.parse(r.stdout)
}

// The Workflow runtime delivers `args` as a JSON string (not the object), so parse defensively.
const a = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const L = a.ledger
const CAPS = a.caps
const DIR = a.dir
const DATE = a.date
const GATELOG = a.gateLogDir ?? `${DIR}/${DATE}-gate-logs`
const dryRun = a.dryRun === true
// skipSelect: use the pre-seeded ledger at L and EXECUTE (preflight stays on,
// select is skipped). For the supervised single-issue first live run, where
// the default `select` would pull the WHOLE filtered backlog into the wave.
const skipSelect = a.skipSelect === true
// skipPreflight: skip the heavy baseline gate (full suite in a worktree). For a
// CONTINUATION run that resumes a pre-seeded ledger mid-flight (e.g. driving an
// already-open PR's CI→gate→refute→merge tail) where preflight already passed
// this session. Never use for a first dispatch — preflight guards clean main.
const skipPreflight = a.skipPreflight === true
const MAX = a.maxTicks ?? 500

// #6 pre-authorization: the gates (two signals + refute approve + severity
// routing) are the real authorization; this only asserts no human will click.
if (a.unattended !== true) {
  log('ABORT: unattended run requires args.unattended === true (no pre-authorization)')
  return { aborted: 'not-authorized' }
}
log('unattended run pre-authorized; gates remain the authorization (two signals + refute approve + severity routing)')

phase('Preflight')
if (dryRun || skipPreflight) {
  log(skipPreflight ? '[skip-preflight] resuming pre-seeded ledger; baseline gate skipped (continuation)' : '[dry-run] skipping preflight baseline gate')
} else {
  const pre = await ctl(['preflight', '--workdir', `${DIR}/.baseline`, '--log', `${DIR}/${DATE}-baseline.log`], 'preflight')
  if (!pre.ok) {
    log(`preflight failed — clean=${pre.clean} baseline=${pre.baseline?.pass}: ${pre.cleanMessage ?? ''} ${pre.baseline?.failTail ?? ''}`)
    return { aborted: 'preflight', pre }
  }
}

phase('Select')
if (dryRun) {
  log(`[dry-run] using pre-seeded ledger at ${L} (no select)`)
} else if (skipSelect) {
  log(`[skip-select] preflight ran; select skipped; executing against pre-seeded ledger at ${L}`)
} else {
  const sel = await ctl(['select', '--filter', JSON.stringify(a.filter ?? { label: 'type:cherry-pick-candidate' }), '--out', `${DIR}/${DATE}-selected.json`, '--ledger-out', L, '--date', DATE, '--max-wave-size', '3'], 'select')
  log(`selected: auto=${sel.totalAuto} human=${sel.totalHuman} needsTriage=${sel.totalNeedsTriage} waves=${sel.waveCount}`)
}

phase('Loop')
const merged = []
const quarantined = []
let tick = 0
while (tick++ < MAX) {
  // `plan` = tick (enriched) + driverPlan, in one controller call. No --now (controller stamps).
  const plan = await ctl(['plan', '--ledger', L, '--caps', CAPS, '--gate-log-dir', GATELOG], `tick:${tick}`)
  const counts = {
    fixes: plan.fixes?.length ?? 0, polls: plan.polls?.length ?? 0, gates: plan.gates?.length ?? 0,
    refutes: plan.refutes?.length ?? 0, merges: plan.merges?.length ?? 0, timeouts: plan.quarantineTimeouts?.length ?? 0,
  }
  const empty = Object.values(counts).every((n) => n === 0)
  log(`tick ${tick}: ${JSON.stringify(counts)}`)
  if (empty) { log('no actions — loop drained'); break }

  if (dryRun) { log('[dry-run] one tick inspected; not executing dispatches'); break }

  // 1. Quarantine stuck lanes (timeouts).
  for (const t of plan.quarantineTimeouts ?? []) {
    await ctl(['record', '--ledger', L, '--issue', String(t.issueNumber), '--state', 'quarantined', '--payload', JSON.stringify({ reason: t.reason })], `quarantine:${t.issueNumber}`)
    quarantined.push(t.issueNumber)
  }

  // 2. Fix lanes (fan out). Transition selected→planning→fixing first so the
  //    next tick won't re-dispatch, then run the lane; verify durable artifacts
  //    before recording fix-ok (never trust the agent's text).
  await parallel((plan.fixes ?? []).map((f) => async () => {
    await ctl(['record', '--ledger', L, '--issue', String(f.issueNumber), '--state', 'planning'], `plan:${f.issueNumber}`)
    await ctl(['record', '--ledger', L, '--issue', String(f.issueNumber), '--state', 'fixing'], `fixing:${f.issueNumber}`)
    const res = await agent(f.prompt, { label: `fix:${f.issueNumber}`, phase: 'Loop', schema: FIX_RESULT_SCHEMA })
    const pr = res?.prNumber
    const branch = res?.branch
    if (res?.outcome === 'pr-opened' && pr && branch) {
      const v = await ctl(['verify-fix', '--pr', String(pr), '--issue', String(f.issueNumber), '--branch', branch, '--targets', (f.targetFiles ?? []).join(',')], `verify:${f.issueNumber}`)
      if (v.ok) {
        await ctl(['record', '--ledger', L, '--issue', String(f.issueNumber), '--state', 'fix-ok', '--payload', JSON.stringify({ prNumber: pr, prUrl: res.prUrl ?? null })], `fix-ok:${f.issueNumber}`)
        await ctl(['record', '--ledger', L, '--issue', String(f.issueNumber), '--state', 'awaiting-ci'], `awaiting-ci:${f.issueNumber}`)
      } else {
        await ctl(['record', '--ledger', L, '--issue', String(f.issueNumber), '--state', 'fix-failed', '--payload', JSON.stringify({ reason: 'verify-fix: ' + (v.reasons ?? []).join('; ') })], `fix-failed:${f.issueNumber}`)
      }
    } else {
      // blocked / fix-failed → record fix-failed then classify (retry-or-quarantine).
      await ctl(['record', '--ledger', L, '--issue', String(f.issueNumber), '--state', 'fix-failed', '--payload', JSON.stringify({ reason: res?.notes ?? 'lane did not open a PR' })], `fix-failed:${f.issueNumber}`)
      const cl = await ctl(['classify', '--stage', 'fix', '--fail-tail', String(res?.notes ?? '')], `classify:${f.issueNumber}`)
      if (cl.category === 'transient') {
        await ctl(['retry', '--ledger', L, '--issue', String(f.issueNumber), '--reason', cl.reason], `retry:${f.issueNumber}`)
        await ctl(['record', '--ledger', L, '--issue', String(f.issueNumber), '--state', 'fixing'], `refix:${f.issueNumber}`)
      } else {
        await ctl(['record', '--ledger', L, '--issue', String(f.issueNumber), '--state', 'quarantined', '--payload', JSON.stringify({ reason: cl.reason })], `quarantine:${f.issueNumber}`)
        quarantined.push(f.issueNumber)
      }
    }
  }))

  // 3. CI polls (one HTTP poll each; controller already backed off).
  for (const p of plan.polls ?? []) {
    const r = await ctl(['poll', '--pr', String(p.prNumber)], `poll:${p.issueNumber}`)
    if (r.state === 'pass') await ctl(['record', '--ledger', L, '--issue', String(p.issueNumber), '--state', 'ci-green', '--payload', JSON.stringify({ pollNoChangeCount: 0 })], `ci-green:${p.issueNumber}`)
    else if (r.state === 'fail') await ctl(['record', '--ledger', L, '--issue', String(p.issueNumber), '--state', 'ci-red'], `ci-red:${p.issueNumber}`)
    // pending → leave state; next tick re-polls after backoff.
  }

  // 4. Local gates (heavy; the controller serializes the full suite).
  for (const g of plan.gates ?? []) {
    const r = await ctl(g.argv, `gate:${g.issueNumber}`)
    if (r.pass) await ctl(['record', '--ledger', L, '--issue', String(g.issueNumber), '--state', 'local-gate-pending', '--payload', JSON.stringify({ localGate: { pass: true, verdict: r.verdict } })], `gate-ok:${g.issueNumber}`)
    else { await ctl(['record', '--ledger', L, '--issue', String(g.issueNumber), '--state', 'local-gate-failed', '--payload', JSON.stringify({ reason: r.verdict + ': ' + (r.failTail ?? '') })], `gate-fail:${g.issueNumber}`); await ctl(['record', '--ledger', L, '--issue', String(g.issueNumber), '--state', 'quarantined', '--payload', JSON.stringify({ reason: 'local-gate ' + r.verdict })], `gate-q:${g.issueNumber}`); quarantined.push(g.issueNumber) }
  }

  // 5. Refute panels (per PR): build bundle → 4 lens agents → tally → record.
  for (const rf of plan.refutes ?? []) {
    await ctl(['record', '--ledger', L, '--issue', String(rf.issueNumber), '--state', 'refute-pending'], `refute-pending:${rf.issueNumber}`)
    const bundleOut = `${DIR}/${DATE}-refute-bundle-${rf.issueNumber}.json`
    const rb = await ctl(['refute-bundle', '--pr', String(rf.prNumber), '--issue', String(rf.issueNumber), '--sha', String(rf.sha), '--out', bundleOut], `bundle:${rf.issueNumber}`)
    const verdicts = await parallel((rb.lensPrompts ?? []).map((lp) => async () => agent(lp.prompt, { label: `lens:${rf.issueNumber}:${lp.lens}`, phase: 'Loop', schema: VERDICT_SCHEMA })))
    const tally = await ctl(['refute-tally', '--verdicts', JSON.stringify(verdicts.filter(Boolean))], `tally:${rf.issueNumber}`)
    if (tally.panelVerdict === 'approve') {
      await ctl(['record', '--ledger', L, '--issue', String(rf.issueNumber), '--state', 'approved', '--payload', JSON.stringify({ refute: { tally, verdicts } })], `approved:${rf.issueNumber}`)
    } else {
      await ctl(['record', '--ledger', L, '--issue', String(rf.issueNumber), '--state', 'refuted', '--payload', JSON.stringify({ refute: { tally, verdicts } })], `refuted:${rf.issueNumber}`)
      await ctl(['record', '--ledger', L, '--issue', String(rf.issueNumber), '--state', 'quarantined', '--payload', JSON.stringify({ reason: 'refute panel: ' + tally.reason })], `refute-q:${rf.issueNumber}`)
      quarantined.push(rf.issueNumber)
    }
  }

  // 6. Merges (verdict-gated inside the controller; defense-in-depth).
  for (const m of plan.merges ?? []) {
    const r = await ctl(m.argv, `merge:${m.issueNumber}`)
    if (r.merged) { await ctl(['record', '--ledger', L, '--issue', String(m.issueNumber), '--state', 'merged', '--payload', JSON.stringify({ mergeSha: r.sha })], `merged:${m.issueNumber}`); merged.push({ issue: m.issueNumber, sha: r.sha }) }
    else log(`merge ${m.issueNumber} blocked: ${r.blockedBy ?? ''} ${r.reason ?? ''}`)
  }
}

phase('Report')
if (!dryRun) {
  await ctl(['report', '--ledger', L, '--out', `${DIR}/${DATE}-report.md`], 'report')
  await ctl(['cleanup', '--ttl-hours', '24'], 'cleanup')
}
return { ok: true, dryRun, ticks: tick - 1, merged, quarantined }
