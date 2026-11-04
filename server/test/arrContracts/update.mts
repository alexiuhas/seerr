// Refreshes the vendored Radarr/Sonarr/Prowlarr API contracts from each
// project's published OpenAPI spec, trimmed to the operations Manual Search
// calls and the schemas they reference.
//
//   node server/test/arrContracts/update.mts
//
// Run it when a Radarr/Sonarr/Prowlarr release changes an API Manual Search
// uses, then run the tests to see what moved.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Json = Record<string, unknown>;

const SOURCES: Record<
  string,
  { url: string; operations: [path: string, method: string][] }
> = {
  radarr: {
    url: 'https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json',
    operations: [['/api/v3/release/push', 'post']],
  },
  sonarr: {
    url: 'https://raw.githubusercontent.com/Sonarr/Sonarr/main/src/Sonarr.Api.V3/openapi.json',
    operations: [['/api/v3/release/push', 'post']],
  },
  prowlarr: {
    url: 'https://raw.githubusercontent.com/Prowlarr/Prowlarr/develop/src/Prowlarr.Api.V1/openapi.json',
    operations: [
      ['/api/v1/search', 'get'],
      ['/api/v1/search', 'post'],
      ['/api/v1/downloadclient', 'get'],
    ],
  },
};

const SCHEMA_REF = '#/components/schemas/';

function collectRefs(node: unknown, found: Set<string>) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectRefs(item, found));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        found.add(value.slice(SCHEMA_REF.length));
      } else {
        collectRefs(value, found);
      }
    }
  }
}

function trim(spec: Json, operations: [string, string][], url: string) {
  const paths: Record<string, Json> = {};
  for (const [path, method] of operations) {
    const operation = (spec.paths as Record<string, Json>)[path]?.[method];
    if (!operation) {
      throw new Error(`${url} no longer has ${method.toUpperCase()} ${path}`);
    }
    paths[path] = { ...paths[path], [method]: operation };
  }

  const all = (spec.components as { schemas: Record<string, Json> }).schemas;
  const keep = new Set<string>();
  const pending = new Set<string>();
  collectRefs(paths, pending);
  while (pending.size) {
    const [name] = pending;
    pending.delete(name);
    if (keep.has(name)) continue;
    keep.add(name);
    collectRefs(all[name], pending);
  }

  return {
    openapi: spec.openapi,
    info: { ...(spec.info as Json), 'x-source': url },
    paths,
    components: {
      schemas: Object.fromEntries([...keep].sort().map((n) => [n, all[n]])),
    },
  };
}

for (const [app, { url, operations }] of Object.entries(SOURCES)) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  const contract = trim((await res.json()) as Json, operations, url);
  const file = join(import.meta.dirname, `${app}.json`);
  await writeFile(file, JSON.stringify(contract, null, 2) + '\n');
  console.log(
    `${app}: ${operations.length} operations, ${Object.keys(contract.components.schemas).length} schemas`
  );
}
