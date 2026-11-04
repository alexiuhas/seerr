// Checks faked Radarr/Sonarr/Prowlarr traffic against their published API
// contracts, so tests can't agree with code on a shape the real apps reject.
// Refresh the contracts with `node server/test/arrContracts/update.mts`.
import { createRequire } from 'node:module';
import prowlarr from './prowlarr.json';
import radarr from './radarr.json';
import sonarr from './sonarr.json';

// The slice of Ajv's API used here; its own types aren't reachable from the
// repo root.
interface ValidateFunction {
  (data: unknown): boolean;
  errors?: unknown[] | null;
}
interface AjvInstance {
  compile(schema: object): ValidateFunction;
  addSchema(schema: object, key: string): void;
  addFormat(
    name: string,
    format: { type: 'number'; validate: (n: number) => boolean }
  ): void;
  errorsText(
    errors: unknown[] | null | undefined,
    options: { dataVar: string; separator: string }
  ): string;
}

// Ajv ships with express-openapi-validator. Loading it from there keeps
// package.json and the lockfile, upstream files, untouched (ADR-0001).
const requireFromValidator = createRequire(
  require.resolve('express-openapi-validator')
);
const Ajv: new (options: object) => AjvInstance = requireFromValidator('ajv');
const addFormats: (ajv: AjvInstance) => void =
  requireFromValidator('ajv-formats');

interface Parameter {
  name: string;
  in: string;
  schema?: { type?: string; items?: { type?: string } };
}
interface Operation {
  parameters?: Parameter[];
  requestBody?: { content: Record<string, { schema: object }> };
  responses: Record<
    string,
    { description?: string; content?: Record<string, { schema: object }> }
  >;
}
interface Contract {
  paths: Record<string, Record<string, Operation>>;
}

// OpenAPI 3.0 allows `nullable` beside a bare `$ref`/`allOf`; JSON Schema
// spells that "this or null".
function nullableToAnyOf(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(nullableToAnyOf);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }
  const { nullable, ...rest } = node as Record<string, unknown>;
  const converted = Object.fromEntries(
    Object.entries(rest).map(([k, v]) => [k, nullableToAnyOf(v)])
  );
  if (nullable === true && !('type' in rest)) {
    return { anyOf: [converted, { type: 'null' }] };
  }
  return nullable === undefined ? converted : { ...converted, nullable };
}

const CONTRACTS = Object.fromEntries(
  Object.entries({ radarr, sonarr, prowlarr }).map(([app, contract]) => [
    app,
    nullableToAnyOf(contract) as Contract,
  ])
);

const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
addFormats(ajv);
ajv.addFormat('int32', {
  type: 'number',
  validate: (n: number) =>
    Number.isInteger(n) && n >= -(2 ** 31) && n < 2 ** 31,
});
ajv.addFormat('int64', { type: 'number', validate: Number.isInteger });
ajv.addFormat('double', { type: 'number', validate: () => true });
ajv.addFormat('float', { type: 'number', validate: () => true });
for (const [app, contract] of Object.entries(CONTRACTS)) {
  ajv.addSchema(contract, app);
}

const validators = new Map<string, ValidateFunction>();
function check(app: string, schema: object, data: unknown, what: string) {
  const key = `${app}:${JSON.stringify(schema)}`;
  let validate = validators.get(key);
  if (!validate) {
    try {
      // Rebase the contract's local refs onto the schema registered as `app`.
      validate = ajv.compile(
        JSON.parse(JSON.stringify(schema).replace(/"#\//g, `"${app}#/`))
      );
    } catch (e) {
      // Reported, never thrown: a throw would look like the app failing.
      return [`${what}: contract could not be compiled: ${e}`];
    }
    validators.set(key, validate);
  }
  return validate(data)
    ? []
    : [ajv.errorsText(validate.errors, { dataVar: what, separator: '; ' })];
}

const jsonSchema = (content?: Record<string, { schema: object }>) =>
  content?.['application/json']?.schema;

export interface ContractRequest {
  uri: string;
  method?: string;
  body?: unknown;
}

/**
 * What in a faked request, and the response a test gave it, the real app
 * would refuse or never send. The app is picked from the hostname (radarr…,
 * sonarr…, prowlarr…). Empty when everything matches.
 */
export function contractViolations(
  req: ContractRequest,
  response?: unknown
): string[] {
  const url = new URL(req.uri);
  const method = (req.method ?? 'get').toLowerCase();
  const label = `${method.toUpperCase()} ${url.host}${url.pathname}`;
  const app = /^(radarr|sonarr|prowlarr)/.exec(url.hostname)?.[1];
  if (!app) {
    return [`${label}: no API contract for this host`];
  }
  const contract = CONTRACTS[app];
  const path = Object.keys(contract.paths).find((p) =>
    url.pathname.endsWith(p)
  );
  const operation = path && contract.paths[path][method];
  if (!operation) {
    return [`${label}: not an operation in ${app}'s API contract`];
  }

  const violations: string[] = [];
  for (const [name, value] of url.searchParams) {
    const param = operation.parameters?.find(
      (p) => p.in === 'query' && p.name === name
    );
    const type =
      param?.schema?.type === 'array'
        ? param.schema.items?.type
        : param?.schema?.type;
    if (!param) {
      violations.push(`query parameter "${name}" is not in the contract`);
    } else if (type === 'integer' && !/^-?\d+$/.test(value)) {
      violations.push(`query parameter "${name}" must be an integer`);
    }
  }

  const bodySchema = jsonSchema(operation.requestBody?.content);
  if (bodySchema && req.body !== undefined) {
    violations.push(...check(app, bodySchema, req.body, 'body'));
  } else if (!bodySchema && req.body !== undefined) {
    violations.push('sends a body the contract does not take');
  }

  const responseSchema = jsonSchema(operation.responses['200']?.content);
  if (responseSchema && response !== undefined) {
    violations.push(...check(app, responseSchema, response, 'response'));
  }

  return violations.map((v) => `${label}: ${v}`);
}
