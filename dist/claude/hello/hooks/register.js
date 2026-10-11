// plugins/hello/src/core/hello.ts
function greet(name) {
  const trimmed = name.trim();
  return `Hello, ${trimmed.length > 0 ? trimmed : "world"}!`;
}
var HELLO_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC";

// plugins/hello/src/claude.ts
function register(on, _options) {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "hello", description: "Say hello (learning-plugins skeleton)", argumentHint: "[name]", immediate: true });
    await $.command.register({ name: "hello-probe", description: "Write $.session.messages() to ./hello-probe.json", immediate: true });
    await $.tool.register({
      name: "hello_image",
      description: "Returns a small solid-colour PNG image. Look at it and tell the user its colour.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
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
      { type: "image", source: { type: "base64", media_type: "image/png", data: HELLO_PNG_BASE64 } }
    ]
  })).catch((_$, _e, next) => ({ result: `hello_image failed: ${next.error.message ?? next.error.kind}`, isError: true }));
}
export {
  register
};
