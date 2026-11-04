import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
let S3Client = null, PutObjectCommand = null, GetObjectCommand = null, ListObjectsV2Command = null, getSignedUrl = null;
try {
  const s3 = await import('@aws-sdk/client-s3');
  const signer = await import('@aws-sdk/s3-request-presigner');
  S3Client = s3.S3Client;
  PutObjectCommand = s3.PutObjectCommand;
  GetObjectCommand = s3.GetObjectCommand;
  ListObjectsV2Command = s3.ListObjectsV2Command;
  getSignedUrl = signer.getSignedUrl;
} catch (e) {
  console.log('[Server] Note: AWS SDK not installed. Running in 100% standalone offline local mode.');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'artifacts/energya-photobooth/dist/public');
const devPublicDir = path.join(root, 'artifacts/energya-photobooth/public');
const photoDir = path.join(root, 'photos');
await fs.mkdir(photoDir, { recursive: true });

// Load environment variables from .env if present
try {
  const envContent = await fs.readFile(path.join(root, '.env'), 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {}

const port = Number(process.env.PORT || 3000);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf',
};

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
};

// Auto-detect reachable IPv4 address on the kiosk
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (/wi-?fi|wlan|hotspot|wireless|local area connection/i.test(name)) {
      const match = addrs.find(a => a.family === 'IPv4' && !a.internal);
      if (match) return match.address;
    }
  }
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!/vethernet|vmnet|virtual|docker|pseudo/i.test(name)) {
      const match = addrs.find(a => a.family === 'IPv4' && !a.internal);
      if (match) return match.address;
    }
  }
  for (const addrs of Object.values(interfaces)) {
    const match = addrs.find(a => a.family === 'IPv4' && !a.internal);
    if (match) return match.address;
  }
  return '127.0.0.1';
}

// Config management
async function loadConfig() {
  const accountId = process.env.R2_ACCOUNT_ID || '6689d1626b5ab6e9f9e69e886af37e97';
  const defaultConfig = {
    camera: { width: 1080, height: 1920 },
    countdownSeconds: Number(process.env.COUNTDOWN_SECONDS || 3),
    idleTimeoutSeconds: Number(process.env.IDLE_TIMEOUT_SECONDS || 45),
    paperSize: process.env.PAPER_SIZE || '4x6',
    printEnabled: process.env.PRINT_ENABLED !== 'false',
    soundEnabled: true,
    storageMode: process.env.STORAGE_MODE || 'both', // 'r2' | 'local' | 'both'
    mirrorPhoto: process.env.MIRROR_PHOTO === 'true', // true = mirrored, false = normal
    baseUrl: process.env.BASE_URL || '',
    r2: {
      accountId: accountId,
      bucket: process.env.R2_BUCKET || 'energya',
      accessKeyId: process.env.R2_ACCESS_KEY_ID || 'f70845223a670a720b673a7c2d7f9ed6',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '4502e1038bcccc4f1dd7788ca88acc4d9d9625fcdc6ca7c3fca3ec4f0d04d3a5',
      endpoint: process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : 'https://6689d1626b5ab6e9f9e69e886af37e97.r2.cloudflarestorage.com'),
      publicUrl: process.env.R2_PUBLIC_URL || '',
    },
    local: {
      host: '',
      port: Number(process.env.PORT || 3000),
    },
    languageOrder: ['en'],
  };

  try {
    const raw = await fs.readFile(path.join(publicDir, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...defaultConfig,
      ...parsed,
      r2: {
        ...defaultConfig.r2,
        ...(parsed.r2 || {}),
        accessKeyId: process.env.R2_ACCESS_KEY_ID || parsed.r2?.accessKeyId || defaultConfig.r2.accessKeyId,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || parsed.r2?.secretAccessKey || defaultConfig.r2.secretAccessKey,
        accountId: process.env.R2_ACCOUNT_ID || parsed.r2?.accountId || defaultConfig.r2.accountId,
        endpoint: process.env.R2_ENDPOINT || parsed.r2?.endpoint || defaultConfig.r2.endpoint,
        bucket: process.env.R2_BUCKET || parsed.r2?.bucket || defaultConfig.r2.bucket,
      },
    };
  } catch {
    try {
      const raw = await fs.readFile(path.join(devPublicDir, 'config.json'), 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...defaultConfig,
        ...parsed,
        r2: {
          ...defaultConfig.r2,
          ...(parsed.r2 || {}),
          accessKeyId: process.env.R2_ACCESS_KEY_ID || parsed.r2?.accessKeyId || defaultConfig.r2.accessKeyId,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || parsed.r2?.secretAccessKey || defaultConfig.r2.secretAccessKey,
          accountId: process.env.R2_ACCOUNT_ID || parsed.r2?.accountId || defaultConfig.r2.accountId,
          endpoint: process.env.R2_ENDPOINT || parsed.r2?.endpoint || defaultConfig.r2.endpoint,
          bucket: process.env.R2_BUCKET || parsed.r2?.bucket || defaultConfig.r2.bucket,
        },
      };
    } catch {
      return defaultConfig;
    }
  }
}

let activeConfig = await loadConfig();

function createR2Client(cfg) {
  if (!S3Client) {
    return {
      send: async () => { throw new Error('Cloudflare R2 SDK not installed.'); }
    };
  }
  const r2 = cfg.r2 || {};
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || r2.accessKeyId;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || r2.secretAccessKey;
  const accountId = process.env.R2_ACCOUNT_ID || r2.accountId;
  const endpoint = process.env.R2_ENDPOINT || r2.endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

  if (!accessKeyId || !secretAccessKey) {
    return {
      send: async () => { throw new Error('Cloudflare R2 credentials missing. Please set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env'); }
    };
  }

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

let s3Client = createR2Client(activeConfig);

async function saveConfig(newConfig) {
  activeConfig = {
    ...activeConfig,
    ...newConfig,
    r2: {
      ...activeConfig.r2,
      ...(newConfig.r2 || {}),
      accessKeyId: process.env.R2_ACCESS_KEY_ID || newConfig.r2?.accessKeyId || activeConfig.r2?.accessKeyId || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || newConfig.r2?.secretAccessKey || activeConfig.r2?.secretAccessKey || '',
    },
  };
  s3Client = createR2Client(activeConfig);
  // Persist non-secret configuration to config.json
  const toSave = {
    ...activeConfig,
    r2: {
      accountId: activeConfig.r2?.accountId || '',
      bucket: activeConfig.r2?.bucket || 'energya',
      accessKeyId: '',
      secretAccessKey: '',
      endpoint: activeConfig.r2?.endpoint || '',
      publicUrl: activeConfig.r2?.publicUrl || '',
    },
  };
  const data = JSON.stringify(toSave, null, 2);
  try {
    await fs.writeFile(path.join(publicDir, 'config.json'), data, 'utf8');
  } catch {}
  try {
    await fs.writeFile(path.join(devPublicDir, 'config.json'), data, 'utf8');
  } catch {}
  return activeConfig;
}

const photoFile = async id => {
  const files = await fs.readdir(photoDir);
  const file = files.find(name => name.startsWith(`${id}.`));
  return file ? path.join(photoDir, file) : null;
};

// Branded mobile download page HTML template
function generateDownloadPageHtml(imageUrl) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Energya Industries — Your Framed Photo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 50% 30%, #0d3870 0%, #071f45 50%, #030e20 100%);
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      text-align: center;
      padding: 24px 16px;
    }
    .card {
      max-width: 480px;
      width: 100%;
      padding: 30px 22px;
      border-radius: 28px;
      background: linear-gradient(165deg, rgba(14, 65, 140, 0.9) 0%, rgba(6, 28, 64, 0.96) 100%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      box-shadow: 0 25px 70px rgba(0, 0, 0, 0.6), 0 0 40px rgba(13, 70, 143, 0.3);
      backdrop-filter: blur(14px);
    }
    .logo-wrap {
      display: inline-block;
      padding: 10px 22px;
      background: #ffffff;
      border-radius: 16px;
      margin-bottom: 20px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    }
    .logo {
      width: 180px;
      height: auto;
      display: block;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }
    p {
      color: rgba(255, 255, 255, 0.75);
      font-size: 15px;
      margin-bottom: 20px;
      line-height: 1.4;
    }
    .photo-frame {
      position: relative;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.5);
      margin-bottom: 24px;
      background: #020b18;
    }
    .photo {
      display: block;
      width: 100%;
      height: auto;
      object-fit: contain;
    }
    .download-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      min-height: 60px;
      padding: 16px 24px;
      border-radius: 18px;
      background: linear-gradient(135deg, #ffffff 0%, #fff2eb 100%);
      color: #071b3c;
      text-decoration: none;
      font-size: 18px;
      font-weight: 800;
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35), 0 0 20px rgba(255, 118, 84, 0.3);
      transition: transform 0.15s ease;
    }
    .download-btn:active {
      transform: scale(0.97);
    }
    .download-icon {
      font-size: 20px;
      color: #e8532b;
    }
    .ios-note {
      margin-top: 14px;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
    }
    .footer-badge {
      margin-top: 22px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 14px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 11px;
      letter-spacing: 0.12em;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.65);
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo-wrap">
      <img class="logo" src="/new_design/logo.svg" alt="Energya Industries" onerror="this.style.display='none'">
    </div>
    <h1>Your Energya Moment</h1>
    <p>Captured & framed at Energya Industries Photobooth</p>
    
    <div class="photo-frame">
      <img class="photo" src="${imageUrl}" alt="Your framed photo">
    </div>
    
    <a class="download-btn" href="${imageUrl}" download="energya-photo.jpg">
      <span class="download-icon">⬇</span>
      <span>Save Photo to Phone</span>
    </a>
    <div class="ios-note">Tip: On iPhone, you can also press & hold the photo to "Save to Photos".</div>
    <div class="footer-badge">Energya Industries · Cairo</div>
  </main>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // Preflight CORS
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    // 1. GET /api/config: returns config + detected local IP
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const detectedIp = getLocalIp();
      const files = await fs.readdir(photoDir);
      const photoCount = files.filter(f => f.endsWith('.jpeg') || f.endsWith('.jpg') || f.endsWith('.png')).length;
      const cfgWithNet = {
        ...activeConfig,
        detectedIp,
        activeLocalIp: activeConfig.local?.host || detectedIp,
        savedPhotosCount: photoCount,
        r2: {
          ...activeConfig.r2,
          secretAccessKey: activeConfig.r2?.secretAccessKey ? '••••••••' : '',
        },
      };
      return send(res, 200, JSON.stringify(cfgWithNet), 'application/json');
    }

    // 2. POST /api/config: update config
    if (req.method === 'POST' && url.pathname === '/api/config') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const saved = await saveConfig(body);
      return send(res, 200, JSON.stringify(saved), 'application/json');
    }

    // 3. GET /api/r2/test: test connection to Cloudflare R2
    if (req.method === 'GET' && url.pathname === '/api/r2/test') {
      try {
        const bucket = activeConfig.r2?.bucket || 'energya';
        const result = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
        return send(
          res,
          200,
          JSON.stringify({
            ok: true,
            bucket,
            keyCount: result.KeyCount ?? 0,
            message: `Connected successfully to R2 bucket "${bucket}"`,
          }),
          'application/json'
        );
      } catch (err) {
        return send(
          res,
          200,
          JSON.stringify({
            ok: false,
            error: err.message || 'Connection failed',
            offline: err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT',
          }),
          'application/json'
        );
      }
    }

    // 4. POST /api/photos/sync-r2: bulk sync local offline photos to Cloudflare R2
    if (req.method === 'POST' && url.pathname === '/api/photos/sync-r2') {
      try {
        const files = await fs.readdir(photoDir);
        const imageFiles = files.filter(f => f.endsWith('.jpeg') || f.endsWith('.jpg') || f.endsWith('.png'));
        let synced = 0;
        const bucket = activeConfig.r2?.bucket || 'energya';
        for (const file of imageFiles) {
          const buffer = await fs.readFile(path.join(photoDir, file));
          await s3Client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: `photos/${file}`,
              Body: buffer,
              ContentType: file.endsWith('.png') ? 'image/png' : 'image/jpeg',
            })
          );
          synced++;
        }
        return send(res, 200, JSON.stringify({ ok: true, synced, total: imageFiles.length }), 'application/json');
      } catch (err) {
        return send(res, 500, JSON.stringify({ ok: false, error: err.message }), 'application/json');
      }
    }

    // 5. POST /api/photos/open-folder: open local photos folder in Windows Explorer
    if (req.method === 'POST' && url.pathname === '/api/photos/open-folder') {
      exec(`explorer.exe "${photoDir}"`);
      return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
    }

    // 6. POST /api/photos: save photo locally and/or upload to Cloudflare R2
    if (req.method === 'POST' && url.pathname === '/api/photos') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const match = String(body.image || '').match(/^data:image\/(png|jpeg);base64,(.+)$/);
      if (!match) return send(res, 400, JSON.stringify({ error: 'Invalid image' }), 'application/json');

      const ext = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const id = crypto.randomUUID();

      // ALWAYS save local backup to PC disk
      await fs.writeFile(path.join(photoDir, `${id}.${ext}`), buffer);

      const storageMode = activeConfig.storageMode || 'both';
      let r2Url = null;
      let r2Error = null;

      // Upload to Cloudflare R2 if mode is 'r2' or 'both'
      if (storageMode === 'r2' || storageMode === 'both') {
        try {
          const bucket = activeConfig.r2?.bucket || 'energya';
          const imageKey = `photos/${id}.${ext}`;
          const htmlKey = `photos/${id}.html`;

          // 1. Upload high-res photo to R2
          await s3Client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: imageKey,
              Body: buffer,
              ContentType: ext === 'png' ? 'image/png' : 'image/jpeg',
            })
          );

          // 2. Generate presigned direct image URL (valid for 7 days)
          const imgDownloadUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({
              Bucket: bucket,
              Key: imageKey,
              ResponseContentDisposition: 'attachment; filename="energya-photo.jpg"',
            }),
            { expiresIn: 604800 }
          );

          // 3. Upload branded HTML download page to R2
          const pageHtml = generateDownloadPageHtml(imgDownloadUrl);
          await s3Client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: htmlKey,
              Body: pageHtml,
              ContentType: 'text/html; charset=utf-8',
            })
          );

          // 4. Presign the HTML page URL for the QR code!
          r2Url = await getSignedUrl(
            s3Client,
            new GetObjectCommand({
              Bucket: bucket,
              Key: htmlKey,
              ResponseContentType: 'text/html; charset=utf-8',
            }),
            { expiresIn: 604800 }
          );
        } catch (err) {
          console.error('R2 upload failed (will use local fallback):', err.message);
          r2Error = err.message;
        }
      }

      // Local network URL
      const host = activeConfig.local?.host || getLocalIp() || '127.0.0.1';
      const localUrl = `http://${host}:${port}/photo/${id}`;

      // SINGLE QR URL: If R2 is enabled and active, use R2 for 1-scan mobile download!
      // If R2 failed or storageMode is local, use localUrl!
      const activeUrl = r2Url || localUrl;

      return send(
        res,
        201,
        JSON.stringify({
          id,
          storageMode,
          localUrl,
          r2Url,
          activeUrl,
          isCloud: Boolean(r2Url),
          r2Error,
        }),
        'application/json'
      );
    }

    // 7. Local photo download page
    const pageMatch = url.pathname.match(/^\/photo\/([a-f0-9-]+)$/i);
    const imageMatch = url.pathname.match(/^\/photo\/([a-f0-9-]+)\/image$/i);

    if (pageMatch) {
      const file = await photoFile(pageMatch[1]);
      if (!file) return send(res, 404, 'Photo not found');
      return send(res, 200, generateDownloadPageHtml(`/photo/${pageMatch[1]}/image`), 'text/html; charset=utf-8');
    }

    if (imageMatch) {
      const file = await photoFile(imageMatch[1]);
      if (!file) return send(res, 404, 'Photo not found');
      const data = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg',
        'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment; filename="energya-photo.jpg"',
      });
      return res.end(data);
    }

    // 8. Static frontend assets
    let filePath = path.join(publicDir, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filePath.startsWith(publicDir)) return send(res, 403, 'Forbidden');
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
      const data = await fs.readFile(filePath);
      return send(res, 200, data, mime[path.extname(filePath)] || 'application/octet-stream');
    } catch {
      const data = await fs.readFile(path.join(publicDir, 'index.html'));
      return send(res, 200, data, mime['.html']);
    }
  } catch (error) {
    console.error(error);
    send(res, 500, 'Server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`=======================================================`);
  console.log(` Energya Photobooth Server Running!`);
  console.log(` Localhost:  http://localhost:${port}`);
  console.log(` Local LAN:  http://${localIp}:${port}`);
  console.log(` R2 Bucket:  ${activeConfig.r2?.bucket || 'energya'}`);
  console.log(` Storage:    Mode "${activeConfig.storageMode || 'both'}"`);
  console.log(`=======================================================`);
});
