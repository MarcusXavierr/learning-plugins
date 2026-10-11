// eslint-disable-next-line llm-core/no-unsafe-dictionary-type -- host payloads and tool inputs are untrusted; readers typeof-check every field.
export type Payload = Record<string, unknown>;

/** A host payload or tool input as an object to read fields from; undefined for anything else. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes untrusted host payloads and tool inputs.
export function asRecord(value: unknown): Payload | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Payload) : undefined;
}

/** A payload field as text; "" for anything that is not a string. */
// eslint-disable-next-line llm-core/no-unknown-parameters -- decodes untrusted host payloads and tool inputs.
export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
