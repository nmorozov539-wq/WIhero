// OpenAI-compatible mock model (chat and text completion). Logs every request body to e2e/log/NNN.json and replies "Mock reply N".
// POST /next with a text queues it as the next reply's last lines (trackers' checks, n9).
import http from 'node:http';
import fs from 'node:fs';

const LOG = new URL('./log/', import.meta.url).pathname;
const PORT = Number(process.env.MOCK_PORT || 5001);
const keepLog = process.env.MOCK_KEEP_LOG === '1';
if (!keepLog) fs.rmSync(LOG, { recursive: true, force: true });
fs.mkdirSync(LOG, { recursive: true });

let n = keepLog ? Math.max(0, ...fs.readdirSync(LOG).filter(f => /^\d+\.json$/.test(f)).map(f => Number(f.slice(0, -5)))) : 0;
const queue = [];
http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url.endsWith('/next')) { queue.push(body); return res.end('{}'); }
        if (req.url.endsWith('/models')) {
            return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock', object: 'model' }] }));
        }
        const id = ++n;
        const tail = queue.shift();
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* logged as is */ }
        fs.writeFileSync(`${LOG}${String(id).padStart(3, '0')}.json`, JSON.stringify({ url: req.url, body: parsed }, null, 2));
        const content = `Mock reply ${id}${tail ? `\n${tail}` : ''}`;
        // A text-completion request (a prompt, no messages) gets a text-completion answer (n9-text).
        const text = typeof parsed.prompt === 'string' && !Array.isArray(parsed.messages);
        res.end(JSON.stringify({
            id: `x${id}`, object: text ? 'text_completion' : 'chat.completion', model: 'mock',
            choices: [text ? { index: 0, finish_reason: 'stop', text: content } : { index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
    });
}).listen(PORT, '127.0.0.1', () => console.log(`mock on ${PORT}`));
