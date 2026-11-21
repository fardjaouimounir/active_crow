// Stand-in for the backend's internal results route during local testing.
// Run with: npm run mock:callback   (listens on port 3000 by default)
// It prints each callback it receives. No keys are printed.
import http from 'node:http';

const port = Number(process.env.MOCK_CALLBACK_PORT || 3000);
const expected = process.env.AI_SERVICE_OUTBOUND_KEY;

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    const authOk = expected ? req.headers.authorization === `Bearer ${expected}` : null;
    console.log(`\n[callback] ${req.method} ${req.url} auth=${authOk === null ? 'not checked' : authOk ? 'valid' : 'INVALID'}`);
    console.log(JSON.stringify(body, null, 2));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`Mock FieldFlow callback listening on http://127.0.0.1:${port}/api/v1/internal/ai/results`);
});
