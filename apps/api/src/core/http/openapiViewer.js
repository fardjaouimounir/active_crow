const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function openApiViewer(spec) {
  const operations = Object.entries(spec.paths)
    .map(([path, methods]) =>
      Object.entries(methods)
        .map(
          ([method, operation]) =>
            `<details><summary><code>${escape(method.toUpperCase())} ${escape(path)}</code> — ${escape(operation.summary)}</summary><pre>${escape(JSON.stringify(operation, null, 2))}</pre></details>`,
        )
        .join(''),
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FieldFlow API</title></head><body><main><h1>FieldFlow API</h1><p><a href="/api/docs/openapi.json">Download OpenAPI JSON</a></p>${operations}</main></body></html>`;
}
