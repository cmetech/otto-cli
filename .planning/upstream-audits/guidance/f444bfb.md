verdict: do-not-port

# f444bfb — fix: ignore CLI auth sentinels in doctor routes

## Target file(s)
- none

## Divergence
Targets `src/resources/extensions/gsd/doctor-providers.ts` and its test. otto-cli has no gsd doctor-providers route; provider health diagnostics in otto live in other surfaces (e.g., pi-coding-agent model-registry-discovery, ollama discovery) and use their own sentinel-aware paths.

## Concrete edits
1. None.

## Verdict
GSD-extension doctor-route fix; no otto analog at the changed surface.
