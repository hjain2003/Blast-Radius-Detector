import { parse } from "@cdktf/hcl2json";

const referencePattern = /(?:\$\{\s*)?((?:data|module)\.[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)+|[A-Za-z_][\w-]*\.[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)(?:\s*\})?/g;

function blocksByLabel(parsed, kind) {
  const blocks = [];
  if (kind === "module") {
    for (const [name, definitions] of Object.entries(parsed.module || {})) {
      for (const definition of Array.isArray(definitions) ? definitions : [definitions]) {
        blocks.push({ type: "module", name, definition: definition || {} });
      }
    }
    return blocks;
  }

  for (const [type, namedBlocks] of Object.entries(parsed[kind] || {})) {
    for (const [name, definitions] of Object.entries(namedBlocks || {})) {
      for (const definition of Array.isArray(definitions) ? definitions : [definitions]) {
        blocks.push({ type, name, definition: definition || {} });
      }
    }
  }
  return blocks;
}

function getNameTag(definition) {
  const tags = definition.tags;
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return undefined;
  const name = tags.Name ?? tags.name;
  return typeof name === "string" ? name.replace(/^\$\{(.+)\}$/, "$1") : undefined;
}

function makeNode(kind, type, name, definition, file) {
  const address = kind === "module" ? `module.${name}` : `${kind === "data" ? "data." : ""}${type}.${name}`;
  return {
    id: address,
    address,
    kind,
    type: kind === "module" ? "module" : type,
    name,
    label: kind === "module" ? `module.${name}` : `${type}.${name}`,
    file,
    displayName: getNameTag(definition) || definition.name || undefined,
    moduleSource: kind === "module" ? definition.source : undefined,
    change: undefined,
    attributes: Object.fromEntries(
      Object.entries(definition).filter(([key, value]) =>
        !["depends_on", "lifecycle", "provisioner", "connection"].includes(key) &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      ),
    ),
  };
}

function visitStrings(value, path, visitor) {
  if (typeof value === "string") {
    visitor(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitStrings(item, `${path}[${index}]`, visitor));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => visitStrings(item, path ? `${path}.${key}` : key, visitor));
  }
}

function resolveReference(reference, addressMap) {
  const parts = reference.split(".");
  if (parts[0] === "data" && parts.length >= 3) return addressMap.get(`data.${parts[1]}.${parts[2]}`);
  if (parts[0] === "module" && parts.length >= 2) return addressMap.get(`module.${parts[1]}`);
  if (parts.length >= 2) return addressMap.get(`${parts[0]}.${parts[1]}`);
  return undefined;
}

function addEdge(edgeMap, source, target, type, evidence) {
  const key = `${source.id}->${target.id}:${type}`;
  const existing = edgeMap.get(key);
  if (existing) {
    if (!existing.evidence.some((item) => item.file === evidence.file && item.expression === evidence.expression && item.attribute === evidence.attribute)) {
      existing.evidence.push(evidence);
    }
    return;
  }
  edgeMap.set(key, {
    id: key,
    source: source.id,
    target: target.id,
    type,
    evidence: [evidence],
  });
}

export async function analyzeTerraformFiles(files) {
  const parsedFiles = await Promise.all(files.map(async (file) => {
    try {
      const parsed = file.path.toLowerCase().endsWith(".json")
        ? JSON.parse(file.contents)
        : await parse(file.path, file.contents);
      return { ...file, parsed };
    } catch (error) {
      error.file = file.path;
      throw error;
    }
  }));

  const nodes = new Map();
  const declarations = [];
  for (const file of parsedFiles) {
    for (const kind of ["resource", "data", "module"]) {
      for (const block of blocksByLabel(file.parsed, kind)) {
        const node = makeNode(kind, block.type, block.name, block.definition, file.path);
        if (!nodes.has(node.id)) nodes.set(node.id, node);
        declarations.push({ node: nodes.get(node.id), definition: block.definition, file: file.path });
      }
    }
  }

  const edgeMap = new Map();
  for (const declaration of declarations) {
    const { node, definition, file } = declaration;
    visitStrings(definition, "", (expression, attribute) => {
      referencePattern.lastIndex = 0;
      for (const match of expression.matchAll(referencePattern)) {
        const dependency = resolveReference(match[1], nodes);
        if (!dependency || dependency.id === node.id) continue;
        const type = attribute === "depends_on" || attribute.startsWith("depends_on[")
          ? "explicit_depends_on"
          : "attribute_reference";
        addEdge(edgeMap, dependency, node, type, { file, attribute, expression: match[0] });
      }
    });
  }

  for (const file of parsedFiles) {
    for (const change of file.parsed.resource_changes || []) {
      if (!change.address || !change.change) continue;
      const actions = change.change.actions || [];
      const node = nodes.get(change.address) || {
        id: change.address,
        address: change.address,
        kind: change.mode === "data" ? "data" : "resource",
        type: change.type || "resource",
        name: change.name || change.address.split(".").at(-1),
        label: change.address,
        file: file.path,
        change: undefined,
        attributes: {},
      };
      node.change = {
        actions,
        action: actions.includes("delete") && actions.includes("create")
          ? "replace"
          : actions.find((action) => action !== "no-op") || "no-op",
      };
      nodes.set(node.id, node);
    }
  }

  const plannedChanges = [...nodes.values()].filter((node) => node.change && node.change.action !== "no-op").length;

  return {
    nodes: [...nodes.values()],
    edges: [...edgeMap.values()],
    files: parsedFiles.map(({ path }) => path),
    summary: {
      resources: [...nodes.values()].filter((node) => node.kind === "resource").length,
      dataSources: [...nodes.values()].filter((node) => node.kind === "data").length,
      modules: [...nodes.values()].filter((node) => node.kind === "module").length,
      dependencies: edgeMap.size,
      plannedChanges,
    },
  };
}