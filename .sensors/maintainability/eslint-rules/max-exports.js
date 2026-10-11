/** Counts the runtime values a module exports. Type-only exports and re-exports do not count. */
function declarationNames(declaration) {
  switch (declaration.type) {
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSEnumDeclaration":
      return [declaration.id ? declaration.id.name : "default"];
    case "VariableDeclaration":
      return declaration.declarations.map((d) => (d.id.type === "Identifier" ? d.id.name : "<destructured>"));
    default:
      return []; // interfaces, type aliases, overload signatures (TSDeclareFunction)
  }
}

function exportedValueNames(node) {
  if (node.type === "ExportDefaultDeclaration") return ["default"];
  if (node.type !== "ExportNamedDeclaration" || node.source || node.exportKind === "type") return [];
  if (node.declaration) return declarationNames(node.declaration);
  return node.specifiers.filter((s) => s.exportKind !== "type").map((s) => s.exported.name ?? s.exported.value);
}

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Limit the runtime values a module exports, to keep module interfaces narrow" },
    schema: [{ type: "object", properties: { max: { type: "integer", minimum: 1 } }, additionalProperties: false }],
    defaultOptions: [{ max: 7 }],
    messages: { tooMany: "Module exports {{count}} runtime values (max {{max}}): {{names}}." },
  },
  create(context) {
    const [{ max }] = context.options;
    return {
      "Program:exit"(program) {
        const exporting = program.body.filter((n) => exportedValueNames(n).length > 0);
        const names = exporting.flatMap(exportedValueNames);
        if (names.length <= max) return;
        context.report({ node: exporting[0], messageId: "tooMany", data: { count: names.length, max, names: names.join(", ") } });
      },
    };
  },
};
