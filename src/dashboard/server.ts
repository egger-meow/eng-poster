import http from 'node:http';
import { URL } from 'node:url';
import { MarketingRepository } from '../db/repository.js';
import type { Platform } from '../types.js';

export interface DashboardServerOptions {
  port?: number;
  host?: string;
  repo?: MarketingRepository;
}

export function createWinnerDashboardServer(repo = new MarketingRepository()): http.Server {
  return http.createServer(async (req, res) => {
    // Local-only security assertion
    const remoteIp = req.socket.remoteAddress;
    if (remoteIp && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteIp)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Dashboard is local-only (127.0.0.1)');
      return;
    }

    const hostHeader = req.headers.host ?? '127.0.0.1';
    const parsedUrl = new URL(req.url ?? '/', `http://${hostHeader}`);

    // GET /: Dashboard HTML UI
    if (req.method === 'GET' && parsedUrl.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDashboardHtml());
      return;
    }

    // GET /api/posts: List published posts with feedback
    if (req.method === 'GET' && parsedUrl.pathname === '/api/posts') {
      try {
        const platformParam = parsedUrl.searchParams.get('platform');
        const winnersOnly = parsedUrl.searchParams.get('winnersOnly') === 'true';
        const platform =
          platformParam === 'threads' || platformParam === 'facebook' || platformParam === 'instagram'
            ? (platformParam as Platform)
            : undefined;

        const posts = await repo.getPublishedPostsWithFeedback({
          platform,
          winnersOnly,
          limit: 100,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ posts }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message ?? 'Internal server error' }));
      }
      return;
    }

    // POST /api/feedback: Save winner feedback and observed metrics
    if (req.method === 'POST' && parsedUrl.pathname === '/api/feedback') {
      try {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body must be a JSON object' }));
          return;
        }

        const { postId, isWinner, observedViews, observedLikes, observedComments, observedShares, operatorNote } =
          body as any;

        if (typeof postId !== 'string' || !postId.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'postId is required' }));
          return;
        }

        if (typeof isWinner !== 'boolean') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'isWinner boolean is required' }));
          return;
        }

        const parseMetric = (val: any, name: string): number | null | undefined => {
          if (val === undefined) return undefined;
          if (val === null || val === '') return null;
          const num = Number(val);
          if (!Number.isFinite(num) || !Number.isInteger(num)) {
            throw new Error(`${name} must be an integer or null`);
          }
          if (num < 0) {
            throw new Error(`${name} cannot be negative`);
          }
          return num;
        };

        const views = parseMetric(observedViews, 'observedViews');
        const likes = parseMetric(observedLikes, 'observedLikes');
        const comments = parseMetric(observedComments, 'observedComments');
        const shares = parseMetric(observedShares, 'observedShares');

        const feedback = await repo.upsertPostFeedback({
          postId,
          isWinner,
          observedViews: views,
          observedLikes: likes,
          observedComments: comments,
          observedShares: shares,
          operatorNote: typeof operatorNote === 'string' ? operatorNote.trim() : operatorNote,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, feedback }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message ?? 'Invalid request' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
}

export async function startWinnerDashboard(options: DashboardServerOptions = {}): Promise<{
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}> {
  const host = '127.0.0.1';
  if (options.host && options.host !== host) {
    throw new Error('Winner Dashboard must bind only to 127.0.0.1');
  }

  const port = options.port ?? 3333;
  const repo = options.repo ?? new MarketingRepository();
  const server = createWinnerDashboardServer(repo);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve();
    });
  });

  const url = `http://${host}:${port}`;
  console.log(`\n🔥 Paper English Winner Dashboard running at:\n   ${url}\n`);
  console.log(`Bound strictly to ${host} (local only). Press Ctrl+C to stop.\n`);

  return {
    server,
    port,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Paper English — Winner Posts Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --heading: #f0f6fc;
      --primary: #58a6ff;
      --winner-gold: #f0883e;
      --winner-bg: rgba(240, 136, 62, 0.12);
      --winner-border: rgba(240, 136, 62, 0.35);
      --success: #3fb950;
      --error: #f85149;
      --badge-threads: #79c0ff;
      --badge-fb: #1f6feb;
      --badge-ig: #d2a8ff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif;
      line-height: 1.5;
      padding: 24px 16px;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    h1 {
      font-size: 24px;
      color: var(--heading);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 14px;
      margin-top: 4px;
    }
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 20px;
      padding: 12px 16px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .btn-group {
      display: flex;
      background: #21262d;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .btn-filter {
      background: transparent;
      border: none;
      color: var(--text);
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .btn-filter:hover { background: #30363d; }
    .btn-filter.active {
      background: var(--primary);
      color: #0d1117;
      font-weight: 600;
    }
    .status-summary {
      margin-left: auto;
      color: var(--text-muted);
      font-size: 13px;
    }
    .post-list { display: flex; flex-direction: column; gap: 16px; }
    .post-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      transition: border-color 0.2s, background 0.2s;
    }
    .post-card.is-winner {
      background: var(--winner-bg);
      border-color: var(--winner-border);
    }
    .card-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }
    .winner-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      color: var(--winner-gold);
      cursor: pointer;
      user-select: none;
      background: rgba(240, 136, 62, 0.15);
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(240, 136, 62, 0.3);
    }
    .winner-label input {
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: var(--winner-gold);
    }
    .badge {
      font-size: 12px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: capitalize;
    }
    .badge-threads { background: rgba(121, 192, 255, 0.15); color: var(--badge-threads); }
    .badge-facebook { background: rgba(31, 111, 235, 0.15); color: #58a6ff; }
    .badge-instagram { background: rgba(210, 168, 255, 0.15); color: var(--badge-ig); }
    .badge-meta { background: #21262d; color: var(--text-muted); }
    .pub-time {
      color: var(--text-muted);
      font-size: 13px;
      margin-left: auto;
    }
    .btn-open {
      color: var(--primary);
      text-decoration: none;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(88, 166, 255, 0.1);
    }
    .btn-open:hover { text-decoration: underline; background: rgba(88, 166, 255, 0.2); }
    .copy-preview {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      font-size: 14px;
      color: var(--heading);
      white-space: pre-wrap;
      word-break: break-word;
      margin-bottom: 12px;
      max-height: 220px;
      overflow-y: auto;
    }
    .metrics-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .metric-input {
      background: #0d1117;
      border: 1px solid var(--border);
      color: var(--heading);
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 13px;
      width: 100%;
    }
    .metric-input:focus {
      outline: none;
      border-color: var(--primary);
    }
    .note-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .note-input {
      flex: 1;
      background: #0d1117;
      border: 1px solid var(--border);
      color: var(--heading);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 13px;
    }
    .note-input:focus { outline: none; border-color: var(--primary); }
    .btn-save {
      background: #238636;
      color: #ffffff;
      border: none;
      border-radius: 4px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      white-space: nowrap;
    }
    .btn-save:hover { background: #2ea043; }
    .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
    .save-msg {
      font-size: 12px;
      margin-left: 8px;
      font-weight: 500;
    }
    .save-msg.success { color: var(--success); }
    .save-msg.error { color: var(--error); }
    .empty-state {
      text-align: center;
      padding: 48px 16px;
      color: var(--text-muted);
      background: var(--card-bg);
      border: 1px dashed var(--border);
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔥 Paper English — Winner Posts Feedback</h1>
      <div class="subtitle">
        Local operator feedback interface. Mark high-performing published posts as learning evidence for the scheduler.
      </div>
    </header>

    <div class="filter-bar">
      <div class="btn-group" id="status-filters">
        <button class="btn-filter active" data-filter="all">All Published</button>
        <button class="btn-filter" data-filter="winners">🔥 Winners Only</button>
      </div>

      <div class="btn-group" id="platform-filters">
        <button class="btn-filter active" data-platform="all">All</button>
        <button class="btn-filter" data-platform="threads">Threads</button>
        <button class="btn-filter" data-platform="facebook">Facebook</button>
        <button class="btn-filter" data-platform="instagram">Instagram</button>
      </div>

      <div class="status-summary" id="status-summary">Loading...</div>
    </div>

    <div class="post-list" id="post-list">
      <div class="empty-state">Loading published posts...</div>
    </div>
  </div>

  <script>
    let state = {
      posts: [],
      filterStatus: 'all',
      filterPlatform: 'all'
    };

    async function loadPosts() {
      const summary = document.getElementById('status-summary');
      const list = document.getElementById('post-list');
      summary.textContent = 'Refreshing...';

      const params = new URLSearchParams();
      if (state.filterStatus === 'winners') params.set('winnersOnly', 'true');
      if (state.filterPlatform !== 'all') params.set('platform', state.filterPlatform);

      try {
        const res = await fetch('/api/posts?' + params.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch posts');
        state.posts = data.posts || [];
        renderPosts();
      } catch (err) {
        list.innerHTML = '<div class="empty-state" style="color: var(--error);">Error loading posts: ' + escapeHtml(err.message) + '</div>';
        summary.textContent = 'Error';
      }
    }

    function renderPosts() {
      const list = document.getElementById('post-list');
      const summary = document.getElementById('status-summary');
      const winnersCount = state.posts.filter(p => p.feedback && p.feedback.isWinner).length;

      summary.textContent = 'Showing ' + state.posts.length + ' posts (' + winnersCount + ' marked winner)';

      if (state.posts.length === 0) {
        list.innerHTML = '<div class="empty-state">No published posts found matching current filters.</div>';
        return;
      }

      list.innerHTML = state.posts.map(post => {
        const fb = post.feedback || {};
        const isWinner = Boolean(fb.isWinner);
        const pubDate = post.publishedAt ? new Date(post.publishedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : (post.scheduledFor ? new Date(post.scheduledFor).toLocaleDateString() : '');

        return \`
          <div class="post-card \${isWinner ? 'is-winner' : ''}" id="card-\${post.id}">
            <div class="card-header">
              <label class="winner-label">
                <input type="checkbox" id="winner-\${post.id}" \${isWinner ? 'checked' : ''} onchange="onToggleWinner('\${post.id}')" />
                🔥 Winner
              </label>

              <span class="badge badge-\${post.platform}">\${post.platform}</span>
              <span class="badge badge-meta">\${post.copyLengthMode || 'unknown'}</span>
              \${post.archetype ? '<span class="badge badge-meta">' + escapeHtml(post.archetype) + '</span>' : ''}
              \${post.visualConcept ? '<span class="badge badge-meta">🖼 ' + escapeHtml(post.visualConcept) + '</span>' : ''}

              <div class="pub-time">\${pubDate}</div>

              \${post.platformPostUrl ? '<a href="' + escapeHtml(post.platformPostUrl) + '" target="_blank" rel="noopener" class="btn-open">Open post ↗</a>' : ''}
            </div>

            <div class="copy-preview">\${escapeHtml(post.copyText)}</div>

            <div class="metrics-bar">
              <input type="number" min="0" class="metric-input" id="views-\${post.id}" placeholder="👁 Views" value="\${fb.observedViews ?? ''}" />
              <input type="number" min="0" class="metric-input" id="likes-\${post.id}" placeholder="❤️ Likes" value="\${fb.observedLikes ?? ''}" />
              <input type="number" min="0" class="metric-input" id="comments-\${post.id}" placeholder="💬 Comments" value="\${fb.observedComments ?? ''}" />
              <input type="number" min="0" class="metric-input" id="shares-\${post.id}" placeholder="↗ Shares" value="\${fb.observedShares ?? ''}" />
            </div>

            <div class="note-row">
              <input type="text" class="note-input" id="note-\${post.id}" placeholder="Optional operator note: what made this work? (e.g. bold hook, parent anxiety, specific number)" value="\${escapeHtml(fb.operatorNote ?? '')}" />
              <button class="btn-save" id="btn-save-\${post.id}" onclick="onSave('\${post.id}')">Save</button>
              <span class="save-msg" id="msg-\${post.id}"></span>
            </div>
          </div>
        \`;
      }).join('');
    }

    async function onToggleWinner(postId) {
      const checkbox = document.getElementById('winner-' + postId);
      const isWinner = checkbox.checked;
      const card = document.getElementById('card-' + postId);
      if (isWinner) card.classList.add('is-winner');
      else card.classList.remove('is-winner');

      // Auto-save winner toggle immediately
      await saveFeedback(postId, isWinner, false);
    }

    async function onSave(postId) {
      const checkbox = document.getElementById('winner-' + postId);
      const isWinner = checkbox.checked;
      await saveFeedback(postId, isWinner, true);
    }

    async function saveFeedback(postId, isWinner, showSuccessText) {
      const viewsInput = document.getElementById('views-' + postId);
      const likesInput = document.getElementById('likes-' + postId);
      const commentsInput = document.getElementById('comments-' + postId);
      const sharesInput = document.getElementById('shares-' + postId);
      const noteInput = document.getElementById('note-' + postId);
      const msg = document.getElementById('msg-' + postId);
      const btn = document.getElementById('btn-save-' + postId);

      const payload = {
        postId,
        isWinner,
        observedViews: viewsInput && viewsInput.value !== '' ? parseInt(viewsInput.value, 10) : null,
        observedLikes: likesInput && likesInput.value !== '' ? parseInt(likesInput.value, 10) : null,
        observedComments: commentsInput && commentsInput.value !== '' ? parseInt(commentsInput.value, 10) : null,
        observedShares: sharesInput && sharesInput.value !== '' ? parseInt(sharesInput.value, 10) : null,
        operatorNote: noteInput ? noteInput.value : null
      };

      btn.disabled = true;
      msg.textContent = 'Saving...';
      msg.className = 'save-msg';

      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save');

        msg.textContent = 'Saved ✓';
        msg.className = 'save-msg success';
        setTimeout(() => { if (msg.textContent === 'Saved ✓') msg.textContent = ''; }, 3000);

        // Update local post item
        const post = state.posts.find(p => p.id === postId);
        if (post) {
          post.feedback = data.feedback;
        }
      } catch (err) {
        msg.textContent = 'Error: ' + err.message;
        msg.className = 'save-msg error';
      } finally {
        btn.disabled = false;
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Filter event listeners
    document.querySelectorAll('#status-filters .btn-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#status-filters .btn-filter').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        state.filterStatus = e.target.dataset.filter;
        loadPosts();
      });
    });

    document.querySelectorAll('#platform-filters .btn-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#platform-filters .btn-filter').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        state.filterPlatform = e.target.dataset.platform;
        loadPosts();
      });
    });

    // Initial load
    loadPosts();
  </script>
</body>
</html>`;
}
