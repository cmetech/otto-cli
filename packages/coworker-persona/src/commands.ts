// /persona slash-command handlers. Spec §2.5 + §5.2.
// Pure functions over a PersonaRegistry — UI adapters live in otto-cli.
import { PersonaRegistry } from './registry.js';

export async function handleList(registry: PersonaRegistry, workspaceRoot: string): Promise<string[]> {
  const installed = await registry.list();
  const active = await registry.activeInWorkspace(workspaceRoot);
  return installed.map(p => `${p.name === active.name ? '*' : ' '} ${p.name} — ${p.display_name} (v${p.version})`);
}

export async function handleCurrent(registry: PersonaRegistry, workspaceRoot: string): Promise<string[]> {
  const active = await registry.activeInWorkspace(workspaceRoot);
  return [
    `Active persona: ${active.name}`,
    `Display name:   ${active.display_name}`,
    `Version:        ${active.version}`,
    `Description:    ${active.description}`,
    `Author:         ${active.author}`,
  ];
}

export async function handleSwitch(registry: PersonaRegistry, workspaceRoot: string, name: string): Promise<string[]> {
  const persona = await registry.get(name);
  if (!persona) throw new Error(`persona "${name}" is not installed; run /persona list to see installed personas`);
  await registry.activateInWorkspace(workspaceRoot, name);
  return [`Switched to persona: ${name} (${persona.display_name})`];
}

export async function handleReset(registry: PersonaRegistry, workspaceRoot: string): Promise<string[]> {
  await registry.activateInWorkspace(workspaceRoot, 'default');
  return ['Persona reset to default'];
}

export async function handleInstall(registry: PersonaRegistry, source: string): Promise<string[]> {
  // For Phase 0 we only support local-path install. Npm + git install come in Phase 6.
  const manifest = await registry.installFromPath(source);
  return [`Installed persona: ${manifest.name} (${manifest.display_name})`];
}

export async function handleUninstall(
  registry: PersonaRegistry,
  name: string,
  trackedWorkspaces: string[],
): Promise<string[]> {
  await registry.uninstall(name, { trackedWorkspaces });
  return [`Uninstalled persona: ${name}`];
}
