// plugins/hello/src/core/hello.ts
function greet(name) {
  const trimmed = name.trim();
  return `Hello, ${trimmed.length > 0 ? trimmed : "world"}!`;
}
var HELLO_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC";

// plugins/hello/src/omp.ts
function hello(pi) {
  pi.registerCommand("hello", {
    description: "Say hello (learning-plugins skeleton)",
    // eslint-disable-next-line @typescript-eslint/require-await -- omp requires a Promise-returning command callback.
    handler: async (args, ctx) => ctx.ui.notify(greet(args), "info")
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
          { type: "image", data: HELLO_PNG_BASE64, mimeType: "image/png" }
        ]
      };
    }
  });
}
export {
  hello as default
};
