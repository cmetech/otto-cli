import type { ExtensionAPI } from "@otto/pi-coding-agent";
import registerExcavate from "./command.js";

export default function excavate(pi: ExtensionAPI) {
  registerExcavate(pi);
}
