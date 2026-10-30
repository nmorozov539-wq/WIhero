// OpenAI-compatible mock model. Logs every request body to e2e/log/NNN.json and replies "Mock reply N".
import http from 'node:http';
import fs from 'node:fs';

const LOG = new URL('./log/', import.meta.url).pathname;
const PORT = Number(process.env.MOCK_PORT || 5001);
fs.rmSync(LOG, { recursive: true, force: true });
fs.mkdirSync(LOG, { recursive: true });

let n = 0;
http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url.endsWith('/models')) {
            return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock', object: 'model' }] }));
        }
        const id = ++n;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* logged as is */ }
        fs.writeFileSync(`${LOG}${String(id).padStart(3, '0')}.json`, JSON.stringify({ url: req.url, body: parsed }, null, 2));
        res.end(JSON.stringify({
            id: `x${id}`, object: 'chat.completion', model: 'mock',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: `Mock reply ${id}` } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
    });
}).listen(PORT, '127.0.0.1', () => console.log(`mock on ${PORT}`));
