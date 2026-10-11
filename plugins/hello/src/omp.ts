import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { greet, HELLO_PNG_BASE64 } from "./core/hello.ts";

export default function hello(pi: ExtensionAPI): void {
  pi.registerCommand("hello", {
    description: "Say hello (learning-plugins skeleton)",
    // eslint-disable-next-line @typescript-eslint/require-await -- omp requires a Promise-returning command callback.
    handler: async (args, ctx) => ctx.ui.notify(greet(args), "info"),
  });
  pi.registerTool({
    name: "hello_image",
    label: "Hello image",
    description: "Returns a small solid-colour PNG image. Look at it and tell the user its colour.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    loadMode: "essential",
    // eslint-disable-next-line @typescript-eslint/require-await -- omp requires a Promise-returning tool callback.
    async execute() {
      return {
        content: [
          { type: "text", text: "A solid-colour square:" },
          { type: "image", data: HELLO_PNG_BASE64, mimeType: "image/png" },
        ],
      };
    },
  });
}
