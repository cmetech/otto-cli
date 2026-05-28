/**
 * GSD2 Phase State — cross-extension coordination
 * Copyright (c) 2026 Jeremy McSpadden <jeremy@fluxlabs.net>
 *
 * Lightweight module-level state that auto-mode writes to and the
 * subagent tool reads from. Both extensions run in the same process so
 * a module variable is sufficient — no file I/O needed.
 */

import { buildAuditEnvelope, emitUokAuditEvent } from "../workflow/uok/audit.js";

let _active = false;
let _currentPhase: string | null = null;

export interface PhaseAuditContext {
	basePath: string;
	traceId: string;
	turnId?: string;
	causedBy?: string;
}

let _auditContext: PhaseAuditContext | null = null;

function emitPhaseChange(action: string, previousPhase: string | null, nextPhase: string | null): void {
	if (!_auditContext) return;
	emitUokAuditEvent(
		_auditContext.basePath,
		buildAuditEnvelope({
			traceId: _auditContext.traceId,
			turnId: _auditContext.turnId,
			causedBy: _auditContext.causedBy,
			category: "orchestration",
			type: "phase_changed",
			payload: {
				action,
				active: _active,
				previousPhase,
				nextPhase,
			},
		}),
	);
}

export function configureGSDPhaseAudit(context: PhaseAuditContext | null): void {
	_auditContext = context;
}

/** Mark auto-mode as active. */
export function activateGSD(context?: PhaseAuditContext): void {
	if (context) _auditContext = context;
	const previousPhase = _currentPhase;
	_active = true;
	emitPhaseChange("activate", previousPhase, _currentPhase);
}

/** Mark auto-mode as inactive and clear the current phase. */
export function deactivateGSD(): void {
	const previousPhase = _currentPhase;
	_active = false;
	_currentPhase = null;
	emitPhaseChange("deactivate", previousPhase, _currentPhase);
	_auditContext = null;
}

/** Set the currently dispatched workflow phase (e.g. "plan-milestone"). */
export function setCurrentPhase(phase: string, context?: PhaseAuditContext): boolean {
	if (context) _auditContext = context;
	if (!_active) {
		process.emitWarning(`Ignoring OTTO phase "${phase}" while auto-mode is inactive`, {
			code: "PHASE_INACTIVE",
		});
		return false;
	}
	const previousPhase = _currentPhase;
	_currentPhase = phase;
	emitPhaseChange("set", previousPhase, _currentPhase);
	return true;
}

/** Clear the current phase (unit completed or aborted). */
export function clearCurrentPhase(): void {
	const previousPhase = _currentPhase;
	_currentPhase = null;
	emitPhaseChange("clear", previousPhase, _currentPhase);
}

/** Returns true if auto-mode is currently active. */
export function isAgentActive(): boolean {
	return _active;
}

/** Returns the current workflow phase, or null if none is active. */
export function getCurrentPhase(): string | null {
	return _active ? _currentPhase : null;
}
