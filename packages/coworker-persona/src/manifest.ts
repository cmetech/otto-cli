// Persona manifest parser. See spec §2.5.
import { parse as parseYaml } from 'yaml';

export interface PersonaStatusLine {
  label: string;
  color: string;     // hex
  icon: string;
}

export interface PersonaMemorySeed {
  apply_on_first_activation: boolean;
  scope?: 'global' | 'per-project' | 'per-project-tagged';
}

export interface PersonaManifest {
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  otto_version_required: string;
  steering: string[];
  memory_seed?: PersonaMemorySeed;
  engines?: string;
  artifact_kinds?: string[];
  skills_path?: string;
  status_line: PersonaStatusLine;
}

// Order matters: tests assert the FIRST missing field reported, and the
// "missing version" case supplies only `name`, so `version` must be checked
// before `display_name`.
const REQUIRED: Array<keyof PersonaManifest> = [
  'name', 'version', 'display_name', 'description', 'author',
  'otto_version_required', 'steering', 'status_line',
];

export function parsePersonaManifest(yamlText: string): PersonaManifest {
  const raw = parseYaml(yamlText) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    throw new Error('persona manifest must be a YAML object');
  }
  for (const field of REQUIRED) {
    if (!(field in raw)) {
      throw new Error(`persona manifest missing required field: ${field}`);
    }
  }
  return raw as unknown as PersonaManifest;
}
