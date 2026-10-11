import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { greet } from "./core/greet.ts";

export default function alpha(pi: ExtensionAPI): void {
  pi.registerCommand("alpha", {
    description: "Greets",
    handler: async (args, ctx) => ctx.ui.notify(greet(args)),
  });
}
