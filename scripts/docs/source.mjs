// TypeScript AST readers for docs-check: what the code really sends, without regexes over code.

function parse(ts, source, fileName) {
  const kind = fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
}

/** Members of a union of object types, by their `type` literal, with their property names. */
export function extractUnionMembers(ts, source, typeName, fileName, referencedSources = []) {
  const members = new Map();
  const aliases = new Map();
  for (const input of [{ source, fileName }, ...referencedSources]) {
    const visit = (node) => {
      if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node.type);
      ts.forEachChild(node, visit);
    };
    visit(parse(ts, input.source, input.fileName));
  }
  const seen = new Set();
  const collect = (node) => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = node.typeName.text;
      const alias = aliases.get(name);
      if (alias && !seen.has(name)) {
        seen.add(name);
        collect(alias);
      }
      return;
    }
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(collect);
      return;
    }
    if (ts.isParenthesizedTypeNode(node)) {
      collect(node.type);
      return;
    }
    if (!ts.isTypeLiteralNode(node)) return;
    let type;
    const fields = new Set();
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
      fields.add(member.name.text);
      if (
        member.name.text === "type" &&
        member.type &&
        ts.isLiteralTypeNode(member.type) &&
        ts.isStringLiteral(member.type.literal)
      ) {
        type = member.type.literal.text;
      }
    }
    if (type !== undefined) members.set(type, fields);
  };
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
      collect(node.type);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(ts, source, fileName));
  return members;
}

/** Members of a union of string literals, for example `type ErrorCode = "a" | "b"`. */
export function extractStringUnion(ts, source, typeName, fileName) {
  const out = new Set();
  const collect = (node) => {
    if (ts.isUnionTypeNode(node)) node.types.forEach(collect);
    else if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      out.add(node.literal.text);
    }
  };
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
      collect(node.type);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(ts, source, fileName));
  return [...out];
}

/**
 * String values of `key` in object literals of a file, for example every `type: "status"` the
 * sidecar writes. With `callee`, only object literals inside the arguments of that function.
 */
export function objectLiteralStrings(ts, source, fileName, key, callee) {
  const out = new Set();
  // `code: locked ? "a" : "b"` names both values.
  const strings = (node) => {
    if (ts.isStringLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node))
      return [...strings(node.whenTrue), ...strings(node.whenFalse)];
    return [];
  };
  const take = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === key
        ) {
          for (const text of strings(property.initializer)) out.add(text);
        }
      }
    }
    ts.forEachChild(node, take);
  };
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === callee
    ) {
      node.arguments.forEach(take);
      return;
    }
    ts.forEachChild(node, visit);
  };
  const file = parse(ts, source, fileName);
  if (callee === undefined) take(file);
  else visit(file);
  return [...out];
}
