import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

type NotifyType = "info" | "warning" | "error";

export interface FakeOmp {
  /** The subset of omp's ExtensionAPI the plugins use: on, registerCommand, registerTool, appendEntry. */
  api: ExtensionAPI;
  /** Runs every handler registered for `event`, in registration order, awaiting each; returns their results. */
  emit(event: string, payload?: unknown, ctx?: ExtensionContext): Promise<unknown[]>;
  commands: Map<string, { description?: string; handler: RegisteredCommand["handler"] }>;
  /** The definitions exactly as registered; call `execute(id, params, undefined, undefined, fake.ctx)`. */
  tools: Map<string, ToolDefinition>;
  entries: { customType: string; data: unknown }[];
  notifications: { message: string; type?: NotifyType }[];
  /** One mutable context for commands, tools and events. Only the fields below exist. */
  ctx: ExtensionCommandContext;
}

export function createFakeOmp(options: { cwd?: string; hasUI?: boolean } = {}): FakeOmp {
  const handlers = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
  const commands: FakeOmp["commands"] = new Map();
  const tools: FakeOmp["tools"] = new Map();
  const entries: FakeOmp["entries"] = [];
  const notifications: FakeOmp["notifications"] = [];

  const ctx = {
    cwd: options.cwd ?? process.cwd(),
    hasUI: options.hasUI ?? true,
    mode: "tui",
    ui: {
      notify(message: string, type?: NotifyType) {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;

  const api = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand(name: string, command: { description?: string; handler: RegisteredCommand["handler"] }) {
      commands.set(name, { description: command.description, handler: command.handler });
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    // eslint-disable-next-line llm-core/no-unknown-parameters -- Fake host accepts arbitrary serialized extension entries.
    appendEntry(customType: string, data?: unknown) {
      entries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;

  return {
    api,
    async emit(event, payload, eventCtx = ctx) {
      const results: unknown[] = [];
      for (const handler of handlers.get(event) ?? []) results.push(await handler(payload, eventCtx));
      return results;
    },
    commands,
    tools,
    entries,
    notifications,
    ctx,
  };
}
