import type { On, PluginOptions } from "claude-code";
import { greet } from "./core/greet.ts";

export function register(on: On, _options: PluginOptions): void {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "alpha", description: "Greets" });
    return next(e);
  });
  on("command.run", { command: "alpha" }, async (_$, e) => ({ text: greet(e.args) })).catch(() => ({ text: "alpha failed" }));
}
