import type { On, PluginOptions } from "claude-code";
import { greet, HELLO_PNG_BASE64 } from "./core/hello.ts";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- CC register contract supplies options even when this adapter needs none.
export function register(on: On, _options: PluginOptions): void {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "hello", description: "Say hello (learning-plugins skeleton)", argumentHint: "[name]", immediate: true });
    await $.command.register({ name: "hello-probe", description: "Write $.session.messages() to ./hello-probe.json", immediate: true });
    await $.tool.register({
      name: "hello_image",
      description: "Returns a small solid-colour PNG image. Look at it and tell the user its colour.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    });
    return next(e);
  });

  on("command.run", { command: "hello" }, (_$, e) => ({ text: greet(e.args) })).catch(() => ({ text: "hello failed" }));

  on("command.run", { command: "hello-probe" }, async ($) => {
    await $.fs.write("hello-probe.json", JSON.stringify(await $.session.messages(), null, 2) + "\n");
    return { text: "wrote hello-probe.json" };
  }).catch((_$, _e, next) => ({ text: `hello-probe failed: ${next.error.message ?? next.error.kind}` }));

  on("tool.call", { tool: "mcp__hello__hello_image" }, () => ({
    result: [
      { type: "text", text: "A solid-colour square:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: HELLO_PNG_BASE64 } },
    ],
  })).catch((_$, _e, next) => ({ result: `hello_image failed: ${next.error.message ?? next.error.kind}`, isError: true }));
}
