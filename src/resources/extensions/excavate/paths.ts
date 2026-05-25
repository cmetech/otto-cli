import { homedir } from "node:os";
import { join } from "node:path";

export const EXCAVATE_SKILLS = [
  "excavate-source-analysis",
  "excavate-synthesis",
  "excavate-spec-writing",
  "excavate-provenance",
  "excavate-validation",
] as const;

export type ExcavateSkill = (typeof EXCAVATE_SKILLS)[number];
export type SkillPaths = Record<ExcavateSkill, string>;

/** The synced ecosystem skills dir (industry-standard skills.sh location). */
export function defaultSkillsRoot(): string {
  return join(homedir(), ".agents", "skills");
}

/** Map each excavate skill to its SKILL.md absolute path under `root`. */
export function resolveSkillPaths(root: string = defaultSkillsRoot()): SkillPaths {
  const out = {} as SkillPaths;
  for (const name of EXCAVATE_SKILLS) out[name] = join(root, name, "SKILL.md");
  return out;
}
