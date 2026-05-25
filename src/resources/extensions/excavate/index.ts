import type { ExtensionAPI } from "@loop24/pi-coding-agent";
import registerExcavate from "./command.js";

export default function excavate(pi: ExtensionAPI) {
  registerExcavate(pi);
}
