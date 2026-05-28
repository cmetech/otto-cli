export type GatewayHealth = "checking" | "healthy" | "unhealthy";
export type GatewayMode = "gateway" | "fallback";

export interface GatewayStatus {
	mode: GatewayMode;
	health: GatewayHealth;
	url?: string;
	reason?: string;
}

export interface GatewayFooterStatus {
	label: string;
	color: "success" | "warning" | "error" | "dim";
}

export function normalizeGatewayUrl(url: string): string {
	let normalized = url.trim().replace(/\/+$/, "");
	if (normalized.endsWith("/v1")) normalized = normalized.slice(0, -3);
	return normalized.replace(/\/+$/, "");
}

export async function probeGatewayHealth(url: string, timeoutMs = 1500): Promise<GatewayStatus> {
	const normalized = normalizeGatewayUrl(url);
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const res = await fetch(`${normalized}/health`, { signal: ctl.signal });
		if (res.ok) return { mode: "gateway", health: "healthy", url: normalized };
		return { mode: "gateway", health: "unhealthy", url: normalized, reason: `${res.status} ${res.statusText}` };
	} catch (error) {
		const err = error as Error & { name?: string };
		return {
			mode: "gateway",
			health: "unhealthy",
			url: normalized,
			reason: err.name === "AbortError" ? `timed out after ${timeoutMs}ms` : err.message,
		};
	} finally {
		clearTimeout(timer);
	}
}

export function formatGatewayFooterStatus(
	status: GatewayStatus | null,
	options: { routed?: boolean } = {},
): GatewayFooterStatus | null {
	// Color = gateway health (green up / red down / dim checking).
	// Label = routing relationship (routed / bypass / fallback / down).
	if (!status) return null;
	if (status.mode === "fallback") return { label: "GW fallback", color: "error" };
	if (status.health === "checking") return { label: "GW ...", color: "dim" };
	if (status.health === "unhealthy") return { label: "GW down", color: "error" };
	return options.routed
		? { label: "GW routed", color: "success" }
		: { label: "GW bypass", color: "success" };
}

export interface GatewayHealthMonitorOptions {
	getActiveProviderReady: () => boolean;
	onStateChange?: (state: GatewayStatus | null) => void;
	intervalMs?: number;
	timeoutMs?: number;
	setTimer?: typeof setTimeout;
	clearTimer?: typeof clearTimeout;
}

export class GatewayHealthMonitor {
	private state: GatewayStatus | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;
	private failureCount = 0;

	constructor(private readonly options: GatewayHealthMonitorOptions) {}

	getState(): GatewayStatus | null {
		return this.state;
	}

	start(): void {
		if (this.stopped) return;
		void this.checkNow();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			(this.options.clearTimer ?? clearTimeout)(this.timer);
			this.timer = undefined;
		}
	}

	async checkNow(): Promise<GatewayStatus | null> {
		if (process.env.OTTO_GATEWAY_DISABLED?.trim() === "1") {
			this.setState(null);
			this.clearFallback();
			this.clearHealthEnv();
			return null;
		}

		const rawUrl = process.env.OTTO_GATEWAY_URL?.trim();
		if (!rawUrl) {
			this.setState(null);
			this.clearFallback();
			this.clearHealthEnv();
			return null;
		}

		this.setState({ mode: "gateway", health: "checking", url: normalizeGatewayUrl(rawUrl) });
		const probed = await probeGatewayHealth(rawUrl, this.options.timeoutMs ?? 1500);
		if (probed.health === "healthy") {
			this.failureCount = 0;
			this.clearFallback();
			this.setHealthEnv("healthy");
			this.setState(probed);
		} else {
			this.failureCount += 1;
			this.setHealthEnv("unhealthy");
			if (this.options.getActiveProviderReady()) {
				process.env.OTTO_GATEWAY_FORCE_DIRECT = "1";
				this.setState({ ...probed, mode: "fallback" });
			} else {
				this.clearFallback();
				this.setState(probed);
			}
		}

		this.scheduleNext();
		return this.state;
	}

	private scheduleNext(): void {
		if (this.stopped) return;
		const setTimer = this.options.setTimer ?? setTimeout;
		const base = this.options.intervalMs ?? 10_000;
		const delay = this.state?.health === "unhealthy"
			? Math.min(30_000, base * 2 ** Math.max(0, this.failureCount - 1))
			: base;
		if (this.timer) (this.options.clearTimer ?? clearTimeout)(this.timer);
		this.timer = setTimer(() => {
			this.timer = undefined;
			void this.checkNow();
		}, delay);
	}

	private setState(next: GatewayStatus | null): void {
		const prev = JSON.stringify(this.state);
		const curr = JSON.stringify(next);
		this.state = next;
		if (prev !== curr) this.options.onStateChange?.(next);
	}

	private clearFallback(): void {
		delete process.env.OTTO_GATEWAY_FORCE_DIRECT;
	}

	private setHealthEnv(health: "healthy" | "unhealthy"): void {
		process.env.OTTO_GATEWAY_HEALTH = health;
	}

	private clearHealthEnv(): void {
		delete process.env.OTTO_GATEWAY_HEALTH;
	}
}
