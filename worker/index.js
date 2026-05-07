/**
 * Deal & Reel — Article Publishing API Gateway
 * Cloudflare Worker that securely proxies to GitHub API
 *
 * Endpoints:
 *   POST   /api/publish        — Create new article
 *   PUT    /api/publish        — Update existing article
 *   GET    /api/articles       — List all articles
 *   DELETE /api/articles/:slug — Delete an article
 *
 * Auth: X-API-Key header
 * Secrets (Cloudflare): GITHUB_PAT, PUBLISH_API_KEY
 */

const GITHUB_OWNER = 'dealreeleditorial';
const GITHUB_REPO = 'dealandreel-site';
const ARTICLES_PATH = 'src/content/articles';
const RATE_LIMIT_MAX = 10; // per minute

// Simple in-memory rate limiter (resets on cold start)
const rateLimitMap = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only handle /api/* routes; everything else → static assets
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Auth
    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey || apiKey !== env.PUBLISH_API_KEY) {
      return json({ error: 'Unauthorized. Provide a valid X-API-Key header.' }, 401);
    }

    // Rate limit
    const now = Date.now();
    let timestamps = rateLimitMap.get('global') || [];
    timestamps = timestamps.filter(t => t > now - 60000);
    if (timestamps.length >= RATE_LIMIT_MAX) {
      return json({ error: 'Rate limit exceeded. Max 10 requests per minute.' }, 429);
    }
    timestamps.push(now);
    rateLimitMap.set('global', timestamps);

    // Routing
    try {
      if (url.pathname === '/api/publish' && request.method === 'POST') {
        return await handlePublish(request, env);
      }
      if (url.pathname === '/api/publish' && request.method === 'PUT') {
        return await handleUpdate(request, env);
      }
      if (url.pathname === '/api/articles' && request.method === 'GET') {
        return await handleList(env);
      }
      if (url.pathname.startsWith('/api/articles/')) {
        const slug = decodeURIComponent(url.pathname.slice('/api/articles/'.length));
        if (request.method === 'GET') return await handleRead(slug, env);
        if (request.method === 'DELETE') return await handleDelete(slug, env);
      }
      return json({ error: 'Not found', endpoints: [
        'POST   /api/publish',
        'PUT    /api/publish',
        'GET    /api/articles',
        'GET    /api/articles/:slug',
        'DELETE /api/articles/:slug',
      ]}, 404);
    } catch (err) {
      return json({ error: 'Internal server error', detail: err.message }, 500);
    }
  }
};

// ─── Handlers ────────────────────────────────────────────

async function handlePublish(request, env) {
  const body = await request.json();
  const { slug, content, message } = body;

  if (!slug || !content) {
    return json({ error: 'Missing required fields: slug, content' }, 400);
  }

  // Sanitize slug: only allow lowercase, digits, hyphens
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return json({ error: 'Invalid slug. Use lowercase letters, digits, and hyphens only.' }, 400);
  }

  const validation = validateFrontmatter(content);
  if (!validation.valid) {
    return json({ error: 'Invalid frontmatter', details: validation.errors }, 400);
  }

  const filePath = `${ARTICLES_PATH}/${slug}.md`;
  const existing = await ghGet(filePath, env);
  if (existing) {
    return json({ error: `Article "${slug}" already exists. Use PUT /api/publish to update.` }, 409);
  }

  const result = await ghPut(filePath, content, null, message || `publish: ${slug}`, env);
  return json({
    success: true,
    slug,
    url: `https://dealandreel.com/articles/${slug}`,
    commit: result.commit.sha,
    deployed_in: '~60 seconds',
  }, 201);
}

async function handleUpdate(request, env) {
  const body = await request.json();
  const { slug, content, message } = body;

  if (!slug || !content) {
    return json({ error: 'Missing required fields: slug, content' }, 400);
  }

  const validation = validateFrontmatter(content);
  if (!validation.valid) {
    return json({ error: 'Invalid frontmatter', details: validation.errors }, 400);
  }

  const filePath = `${ARTICLES_PATH}/${slug}.md`;
  const existing = await ghGet(filePath, env);
  if (!existing) {
    return json({ error: `Article "${slug}" not found. Use POST /api/publish to create.` }, 404);
  }

  const result = await ghPut(filePath, content, existing.sha, message || `update: ${slug}`, env);
  return json({
    success: true,
    slug,
    url: `https://dealandreel.com/articles/${slug}`,
    commit: result.commit.sha,
    deployed_in: '~60 seconds',
  });
}

async function handleList(env) {
  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ARTICLES_PATH}?ref=main`,
    { headers: ghHeaders(env) }
  );

  if (!resp.ok) {
    return json({ error: 'Failed to list articles from GitHub' }, 502);
  }

  const files = await resp.json();
  const articles = files
    .filter(f => f.name.endsWith('.md'))
    .map(f => ({
      slug: f.name.replace('.md', ''),
      filename: f.name,
      size_bytes: f.size,
      url: `https://dealandreel.com/articles/${f.name.replace('.md', '')}`,
    }));

  return json({ count: articles.length, articles });
}

async function handleRead(slug, env) {
  if (!slug) {
    return json({ error: 'Missing slug in URL' }, 400);
  }

  const filePath = `${ARTICLES_PATH}/${slug}.md`;
  const existing = await ghGet(filePath, env);
  if (!existing) {
    return json({ error: `Article "${slug}" not found` }, 404);
  }

  const rawContent = base64ToUtf8(existing.content);
  
  return json({
    success: true,
    slug,
    content: rawContent,
    sha: existing.sha
  });
}

async function handleDelete(slug, env) {
  if (!slug) {
    return json({ error: 'Missing slug in URL' }, 400);
  }

  const filePath = `${ARTICLES_PATH}/${slug}.md`;
  const existing = await ghGet(filePath, env);
  if (!existing) {
    return json({ error: `Article "${slug}" not found` }, 404);
  }

  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: 'DELETE',
      headers: ghHeaders(env),
      body: JSON.stringify({
        message: `delete: ${slug}`,
        sha: existing.sha,
        branch: 'main',
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.json();
    return json({ error: 'GitHub delete failed', detail: err.message }, 502);
  }

  const result = await resp.json();
  return json({
    success: true,
    slug,
    commit: result.commit.sha,
    deployed_in: '~60 seconds',
  });
}

// ─── GitHub API Helpers ──────────────────────────────────

function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'DealAndReel-Publisher/1.0',
  };
}

async function ghGet(path, env) {
  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=main`,
    { headers: ghHeaders(env) }
  );
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GitHub API error: ${resp.status}`);
  return await resp.json();
}

async function ghPut(path, content, sha, message, env) {
  const payload = {
    message,
    content: utf8ToBase64(content),
    branch: 'main',
  };
  if (sha) payload.sha = sha;

  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: ghHeaders(env),
      body: JSON.stringify(payload),
    }
  );
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(`GitHub PUT failed: ${err.message}`);
  }
  return await resp.json();
}

// ─── Validation ──────────────────────────────────────────

function validateFrontmatter(content) {
  const errors = [];
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);

  if (!match) {
    return { valid: false, errors: ['Missing YAML frontmatter (--- block at top of file)'] };
  }

  const fm = match[1];
  const required = ['id', 'title', 'category', 'date', 'slug', 'tags'];

  for (const field of required) {
    if (!new RegExp(`^${field}:\\s*\\S`, 'm').test(fm)) {
      errors.push(`Missing required frontmatter field: ${field}`);
    }
  }

  // Validate date format
  const dateMatch = fm.match(/^date:\s*(.+)$/m);
  if (dateMatch) {
    const d = new Date(dateMatch[1].trim());
    if (isNaN(d.getTime())) {
      errors.push('Invalid date format. Use YYYY-MM-DD');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Utilities ───────────────────────────────────────────

function utf8ToBase64(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUtf8(str) {
  const cleanStr = str.replace(/\n/g, '');
  const binary = atob(cleanStr);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  };
}
