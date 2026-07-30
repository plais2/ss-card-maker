const http       = require('http');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const url        = require('url');
const os         = require('os');
const { chromium } = require('playwright-core');

const PORT          = 8765;
const DIR           = __dirname;
// โหลด local config (token ส่วนตัว ไม่ push git)
let localConfig = {};
try { localConfig = JSON.parse(fs.readFileSync(path.join(DIR, 'local.config.json'), 'utf8')); } catch(e) {}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || localConfig.anthropicKey || '';
const CHROME_PATH   = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GEM_URL       = 'https://gemini.google.com/gem/11cGCoI0D-vbDNYHy58C0ElLuek_E__yI';
// profile แยกสำหรับ Gem (login ครั้งแรก ใช้ซ้ำได้เรื่อยๆ)
const GEM_PROFILE   = path.join(DIR, 'gemini-profile');

// ── Gemini Gem Automation ──
async function openGeminiAndType(prompt) {
  if (!fs.existsSync(GEM_PROFILE)) fs.mkdirSync(GEM_PROFILE, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: ['--no-sandbox', '--window-size=1080,900'],
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(path.join(GEM_PROFILE, 'state.json'))
      ? path.join(GEM_PROFILE, 'state.json') : undefined,
    viewport: { width: 1080, height: 900 },
  });

  const page = await context.newPage();
  console.log('🌐 เปิด Gemini Gem…');
  await page.goto(GEM_URL, { waitUntil: 'networkidle', timeout: 60000 });

  // บันทึก session
  await context.storageState({ path: path.join(GEM_PROFILE, 'state.json') });

  // รอ input field
  const INPUT_SEL = 'rich-textarea div[contenteditable="true"], div[contenteditable="true"].ql-editor';
  await page.waitForSelector(INPUT_SEL, { timeout: 40000 });
  console.log('✅ Gem พร้อม — พิมพ์ prompt…');

  // คลิก พิมพ์ แล้วกด Enter
  await page.click(INPUT_SEL);
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(prompt, { delay: 18 });
  await page.keyboard.press('Enter');

  console.log('✅ ส่ง prompt แล้ว — หน้าต่าง Chrome เปิดอยู่');
  // ไม่ปิด browser — ให้ user เห็นและ interact ต่อได้
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// ── เรียก Claude API ──
function callClaude(text) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_KEY) { reject(new Error('No API key')); return; }

    const prompt = `จัดรูปแบบข้อความต่อไปนี้ให้เหมาะกับการ์ดโซเชียลมีเดีย:

"${text}"

กฎการจัดรูปแบบ:
- แบ่งเป็น 2 ส่วนโดยมีบรรทัดว่างคั่น
- ส่วนที่ 1 (หัวข้อ): 1-2 บรรทัด สั้น กระชับ ชัดเจน ดึงดูด ไม่เกิน 25 ตัวอักษรต่อบรรทัด
- ส่วนที่ 2 (รายละเอียด): 1-3 บรรทัด อธิบายเพิ่มเติม ไม่เกิน 35 ตัวอักษรต่อบรรทัด
- รักษาความหมายเดิมทั้งหมด ไม่ตัดข้อมูลออก
- ตอบเฉพาะข้อความที่จัดแล้วเท่านั้น ไม่ต้องอธิบายหรือใส่เครื่องหมายคำพูด`;

    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.content?.[0]?.text) resolve(json.content[0].text.trim());
          else reject(new Error(json.error?.message || 'Unknown error'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Claude สร้าง image prompt จากข้อความ ──
function callClaudeForBGPrompt(text) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_KEY) { reject(new Error('No API key')); return; }

    const prompt = `ข้อความนี้จะใช้บนการ์ดโซเชียลมีเดียสไตล์ราชการไทย:
"${text}"

สร้าง English image prompt สำหรับ AI วาด background ที่:
- สื่อถึงเนื้อหาด้วย symbolic scene (ไม่ใช่ object ลอยๆ) เช่น โต๊ะทำงาน ห้องประชุม ชั้นเอกสาร สถาปัตยกรรม
- สไตล์: official government style, institutional architecture, symmetrical formal composition, Thai neo-classical architecture, minimalist kanok motifs, gold and white tone, navy blue and gold, polished marble and brass
- ห้ามมีคน ใบหน้า สัตว์ นก ธง ตรา ตัวอักษร และห้ามใช้คำ flag/banner/sign/people/person/animal/bird/emblem/coat of arms ในคำตอบ

ตอบเฉพาะ English prompt ไม่เกิน 45 คำ`;

    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.content?.[0]?.text) resolve(json.content[0].text.trim());
          else reject(new Error(json.error?.message || 'Unknown error'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Rule-based fallback (ถ้าไม่มี API key) ──
function ruleBasedFormat(text) {
  const clean = text.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
  // หาจุดตัดธรรมชาติ
  const breaks = /([?!？！]|\s+(?:แต่|และ|หรือ|จาก|โดย|เพราะ|เนื่องจาก|ที่|ส่วน|อย่างไรก็|เมื่อ|เพื่อ|ด้วย|กับ|พร้อม)\s+)/g;
  const parts  = clean.split(breaks).map(p => p.trim()).filter(p => p && p.length > 2);

  if (parts.length <= 1) {
    // ตัดตรงกลางถ้ายาวเกิน
    if (clean.length > 30) {
      const mid = Math.floor(clean.length / 2);
      const sp  = clean.lastIndexOf(' ', mid);
      return clean.slice(0, sp) + '\n\n' + clean.slice(sp + 1);
    }
    return clean;
  }

  const big = parts.slice(0, 2).join(' ').trim();
  const sm  = parts.slice(2).join(' ').trim();
  return sm ? big + '\n\n' + sm : big;
}

// ── Server-side image generation (Pollinations, bypasses browser Turnstile) ──
function fetchPollinationsImage(prompt) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(prompt);
    const seed = Math.floor(Date.now() % 99999);
    const neg = encodeURIComponent('people, person, face, human, bird, birds, animal, animals, wildlife, creature, living beings, flag, flags, banner, emblem, emblems, coat of arms, crest, insignia, text, letters, watermark, logo, blurry, distorted, anime');
    const reqPath = `/prompt/${encoded}?width=832&height=1216&nologo=true&seed=${seed}&model=flux-realism&negative=${neg}`;
    const opts = {
      hostname: 'image.pollinations.ai', path: reqPath, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                 'Referer': 'https://pollinations.ai/', 'Accept': 'image/*' }
    };
    https.get(opts, r2 => {
      if (r2.statusCode !== 200) {
        let rb = ''; r2.on('data', c => rb += c);
        r2.on('end', () => reject(new Error(`Pollinations ${r2.statusCode}: ${rb.slice(0,100)}`)));
        return;
      }
      const chunks = [];
      r2.on('data', c => chunks.push(c));
      r2.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = r2.headers['content-type'] || 'image/jpeg';
        resolve(`data:${mime};base64,${buf.toString('base64')}`);
      });
    }).on('error', reject);
  });
}

// ── HTTP Server ──
http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204); res.end(); return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── POST /gen-bg-image — server-side image gen (no CORS, tries Pollinations then HF) ──
  if (req.method === 'POST' && parsed.pathname === '/gen-bg-image') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const { prompt } = JSON.parse(body || '{}');
      if (!prompt) { res.writeHead(400); res.end(JSON.stringify({ error: 'No prompt' })); return; }
      // Pollinations via server (bypasses browser Turnstile CAPTCHA)
      try {
        console.log('🎨 Pollinations…');
        const img = await fetchPollinationsImage(prompt);
        res.setHeader('Content-Type', 'application/json'); res.writeHead(200);
        res.end(JSON.stringify({ image: img, source: 'pollinations' })); return;
      } catch(e) { console.log('⚠️  Pollinations:', e.message); }
      res.writeHead(502); res.end(JSON.stringify({ error: 'ทุก service ล้มเหลว' }));
    });
    return;
  }

  // ── POST /gen-bg-prompt ──
  if (req.method === 'POST' && parsed.pathname === '/gen-bg-prompt') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { text } = JSON.parse(body || '{}');
      if (!text) { res.writeHead(400); res.end(JSON.stringify({ error: 'No text' })); return; }
      callClaudeForBGPrompt(text)
        .then(bgPrompt => {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ bgPrompt }));
        })
        .catch(e => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });
    });
    return;
  }

  // ── GET /local-config ──
  if (req.method === 'GET' && parsed.pathname === '/local-config') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ hfToken: localConfig.hfToken || '' }));
    return;
  }

  // ── POST /gen-gemini ──
  if (req.method === 'POST' && parsed.pathname === '/gen-gemini') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const { prompt } = JSON.parse(body || '{}');
      if (!prompt) { res.writeHead(400); res.end(JSON.stringify({ error: 'No prompt' })); return; }
      // ตอบทันที ไม่รอรูป
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      // เปิด Chrome ใน background
      openGeminiAndType(prompt).catch(e => console.error('Gemini error:', e.message));
    });
    return;
  }

  // ── POST /format ──
  if (req.method === 'POST' && parsed.pathname === '/format') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { text } = JSON.parse(body || '{}');
      if (!text) { res.writeHead(400); res.end(JSON.stringify({ error: 'No text' })); return; }

      callClaude(text)
        .then(formatted => {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ formatted, source: 'claude' }));
        })
        .catch(() => {
          const formatted = ruleBasedFormat(text);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ formatted, source: 'rules' }));
        });
    });
    return;
  }

  // ── GET /proxy ──
  if (parsed.pathname === '/proxy') {
    const target = parsed.query.url;
    if (!target) { res.writeHead(400); res.end('Missing url'); return; }
    https.get(target, proxyRes => {
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
      res.writeHead(proxyRes.statusCode);
      proxyRes.pipe(res);
    }).on('error', e => { res.writeHead(502); res.end('Proxy error: ' + e.message); });
    return;
  }

  // ── Static files ──
  const filePath = path.join(DIR, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.writeHead(200);
    res.end(data);
  });

}).listen(PORT, () => {
  const hasKey = !!ANTHROPIC_KEY;
  console.log(`✅ SS Card Maker → http://localhost:${PORT}`);
  console.log(hasKey
    ? `🤖 Claude API: พร้อมใช้งาน (จัดรูปแบบข้อความ)`
    : `⚠️  Claude API: ไม่มี ANTHROPIC_API_KEY — ใช้ rule-based แทน\n   ตั้งค่า: export ANTHROPIC_API_KEY=sk-ant-...`);
});
