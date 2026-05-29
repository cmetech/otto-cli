/**
 * Stub for the `skill` tool that Claude-style skills sometimes invoke
 * (`Skill(name="foo")` in the skill body) to chain into another skill.
 *
 * OTTO does not support model-invoked skill execution — skills are user-
 * initiated via `/skill:<name>` from the chat input. Rather than have those
 * tool calls fail with "no such tool," we register a stub that returns a
 * clear, actionable message. The model sees the response and can either
 * fall back to acting on the skill content itself or surface the message
 * to the user.
 *
 * Registered in src/resources/extensions/subagent/index.ts.
 */

export interface SkillToolStubInput {
	name?: string;
}

export function buildSkillToolStubResponse(input: SkillToolStubInput): string {
	const skillRef = typeof input.name === "string" && input.name.trim().length > 0
		? `/skill:${input.name.trim()}`
		: "the desired /skill:<name>";
	return [
		"OTTO does not support invoking skills as a tool from inside an agent turn.",
		`To use this skill, ask the user to run \`${skillRef}\` from the chat input — that's how OTTO surfaces skills.`,
		"If you have access to the skill's body (it was loaded as a system prompt), follow its instructions inline instead.",
	].join("\n\n");
}
