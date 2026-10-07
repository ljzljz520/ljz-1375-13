'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const store = require('./store');
const G = require('./graph');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-admin-key';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const json = (res, status, body) => {
  const buf = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(buf);
};
const fail = (res, status, code, message, extra = {}) => json(res, status, { error: code, message, ...extra });

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) reject(new Error('too large')); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

// ---------- 公共视图组装 ----------
function decorateView(db, tutorial, view) {
  const media = (view.media || []).map(ref => {
    const m = db.media.find(x => x.id === ref.mediaId);
    let state = 'usable', captionText = null;
    if (!m) state = 'missing';
    else if (m.licenseRevoked) state = 'revoked';
    else if (!m.available) state = 'unavailable';
    else {
      const cap = m.captions.find(c => c.version === ref.captionVersion);
      if (!cap || cap.withdrawn) state = 'caption_withdrawn';
      else captionText = cap.text;
    }
    return {
      mediaId: ref.mediaId,
      title: m ? m.title : '(媒体已移除)',
      state,
      captionVersion: ref.captionVersion,
      captionText,
      altText: ref.altText || null
    };
  });
  return {
    id: view.id, order: view.order, title: view.title, content: view.content,
    prerequisites: view.prerequisites || [], branches: view.branches || [],
    branchGroup: view.branchGroup || null, join: view.join || { type: 'none', sources: [] },
    materials: (view.requiredMaterials || []).map(mid => {
      const m = db.materials.find(x => x.id === mid);
      return { id: mid, name: m ? m.name : mid,
        state: !m || m.deletedAt ? 'deleted' : m.approved ? 'approved' : 'pending' };
    }),
    media,
    annotations: db.annotations
      .filter(a => a.stepId === view.id && a.approved)
      .map(a => ({ id: a.id, text: a.text }))
  };
}

function publicTutorial(db, tutorial, { learnerId, releaseId } = {}) {
  if (!tutorial.currentReleaseId || !tutorial.introApproved || !tutorial.riskApproved) return null;
  let release = tutorial.releases.find(r => r.id === tutorial.currentReleaseId);
  let historical = false;
  if (tutorial.publishMode === 'frozen') {
    const l = learnerId && db.learners.find(x => x.id === learnerId);
    const bound = l?.progress?.[tutorial.id]?.frozen?.releaseId;
    const rid = releaseId || bound;
    if (rid) { const r = tutorial.releases.find(x => x.id === rid); if (r) { release = r; historical = rid !== tutorial.currentReleaseId; } }
  }
  let views = G.viewsFromRelease(tutorial, release);

  // 历史链接不得绕过后来撤销的素材授权
  const revoked = [];
  for (const v of views) for (const ref of v.media || []) {
    const m = db.media.find(x => x.id === ref.mediaId);
    if (m && m.licenseRevoked) revoked.push({ stepId: v.id, mediaId: m.id, title: m.title });
  }
  return {
    id: tutorial.id, title: tutorial.title,
    intro: tutorial.intro, riskNotice: tutorial.riskNotice,
    mode: tutorial.publishMode,
    releaseId: release.id, releaseLabel: release.label, historical,
    currentReleaseId: tutorial.currentReleaseId,
    hasNewRelease: tutorial.publishMode === 'frozen' && release.id !== tutorial.currentReleaseId,
    revokedMedia: revoked,
    steps: views.map(v => decorateView(db, tutorial, v))
  };
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const isAdmin = req.headers['x-admin-key'] === ADMIN_KEY;
  try {
    // 静态资源：管理/阅读端在 craft/public；文化站旧页面由站点根目录提供
    if (req.method === 'GET' && (p === '/' || p === '/admin' || p.startsWith('/js/') || p === '/craft.css')) {
      let file = p === '/' ? '/reader.html' : p === '/admin' ? '/admin.html' : p;
      const fp = path.join(PUBLIC_DIR, file);
      if (!fp.startsWith(PUBLIC_DIR) || !fs.existsSync(fp)) return fail(res, 404, 'NOT_FOUND', file);
      const ext = path.extname(fp);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      return fs.createReadStream(fp).pipe(res);
    }

    // 文化站旧静态页（手艺专题通过这些页面的导航入口进入）
    if (req.method === 'GET') {
      const legacy = { '/index.html': 1, '/activities.html': 1, '/travel.html': 1,
        '/css/style.css': 1, '/js/main.js': 1 };
      const imgMatch = p.match(/^\/images\/[\w.\-]+$/);
      if (legacy[p] || imgMatch) {
        const fp = path.join(__dirname, '..', '..', p);
        if (fs.existsSync(fp)) {
          const ext = path.extname(fp);
          const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
          res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
          return fs.createReadStream(fp).pipe(res);
        }
      }
    }

    // ---------- 公共：教程列表（仅经审核且已发布） ----------
    if (req.method === 'GET' && p === '/api/tutorials') {
      const db = store.read();
      const list = db.tutorials
        .filter(t => t.currentReleaseId && t.introApproved && t.riskApproved)
        .map(t => ({ id: t.id, title: t.title, mode: t.publishMode, releaseLabel: t.releases.find(r => r.id === t.currentReleaseId)?.label }));
      return json(res, 200, { tutorials: list });
    }

    // ---------- 公共：教程阅读 ----------
    let m;
    if (req.method === 'GET' && (m = p.match(/^\/api\/tutorials\/([\w-]+)\/releases\/([\w-]+)$/))) {
      const db = store.read();
      const t = db.tutorials.find(x => x.id === m[1]);
      if (!t) return fail(res, 404, 'NOT_FOUND', '教程不存在');
      if (t.publishMode !== 'frozen') return fail(res, 403, 'NOT_FROZEN', '逐步骤升级教程不提供固定旧版链接');
      const release = t.releases.find(r => r.id === m[2]);
      if (!release) return fail(res, 404, 'NOT_FOUND', '版本不存在');
      const views = G.viewsFromRelease(t, release);
      const revoked = [];
      for (const v of views) for (const ref of v.media || []) {
        const md = db.media.find(x => x.id === ref.mediaId);
        if (md && md.licenseRevoked) revoked.push({ stepId: v.id, mediaId: md.id });
      }
      if (revoked.length) return fail(res, 410, 'MEDIA_LICENSE_REVOKED',
        '该历史版本引用的素材授权后来已被撤销，按合规要求不再提供该冻结链接', { revoked });
      const body = publicTutorial(db, t, { releaseId: release.id });
      return json(res, 200, body);
    }

    if (req.method === 'GET' && (m = p.match(/^\/api\/tutorials\/([\w-]+)$/))) {
      const db = store.read();
      const t = db.tutorials.find(x => x.id === m[1]);
      if (!t) return fail(res, 404, 'NOT_FOUND', '教程不存在');
      const body = publicTutorial(db, t, { learnerId: url.searchParams.get('learnerId') });
      if (!body) return fail(res, 404, 'NOT_PUBLISHED', '教程尚未发布或内容未通过审核');
      if (body.revokedMedia.length) {
        // 当前版本也不展示被撤销授权的媒体（历史链接同样禁止）
      }
      const learnerId = url.searchParams.get('learnerId');
      if (learnerId) {
        const l = db.learners.find(x => x.id === learnerId);
        body.progress = l?.progress?.[t.id] || null;
      }
      return json(res, 200, body);
    }

    // ---------- 学习者 ----------
    if (req.method === 'POST' && p === '/api/learners') {
      const body = await readBody(req);
      const l = await store.tx(db => {
        const id = store.nextId('lrn');
        const learner = { id, name: String(body.name || '匿名访客').slice(0, 40), createdAt: new Date().toISOString(), progress: {} };
        db.learners.push(learner);
        return learner;
      });
      return json(res, 201, l);
    }

    if (req.method === 'GET' && (m = p.match(/^\/api\/learners\/([\w-]+)\/progress$/))) {
      const db = store.read();
      const l = db.learners.find(x => x.id === m[1]);
      if (!l) return fail(res, 404, 'NOT_FOUND', '学习者不存在');
      return json(res, 200, { progress: l.progress });
    }

    if (req.method === 'POST' && (m = p.match(/^\/api\/learners\/([\w-]+)\/progress\/([\w-]+)\/start$/))) {
      const db0 = store.read();
      const t = db0.tutorials.find(x => x.id === m[2]);
      if (!t) return fail(res, 404, 'NOT_FOUND', '教程不存在');
      const result = await store.tx(db => {
        let l = db.learners.find(x => x.id === m[1]);
        if (!l) { l = { id: m[1], name: '访客', createdAt: new Date().toISOString(), progress: {} }; db.learners.push(l); }
        l.progress[t.id] = l.progress[t.id] || { mode: t.publishMode, frozen: null, confirmations: {} };
        // 冻结教程：开始学习即绑定当前发布版本（整个教程冻结）
        if (t.publishMode === 'frozen' && !l.progress[t.id].frozen) {
          l.progress[t.id].frozen = { releaseId: t.currentReleaseId, at: new Date().toISOString() };
        }
        return l.progress[t.id];
      });
      return json(res, 200, result);
    }

    // 阅读确认（访客在手机上确认进度；离线迟到的确认在此被服务端裁决）
    if (req.method === 'POST' && (m = p.match(/^\/api\/learners\/([\w-]+)\/progress\/([\w-]+)\/confirm$/))) {
      const body = await readBody(req);
      const result = await store.tx(db => {
        const l = db.learners.find(x => x.id === m[1]);
        if (!l) return { http: 404, body: { error: 'NOT_FOUND', message: '学习者不存在' } };
        const t = db.tutorials.find(x => x.id === m[2]);
        if (!t) return { http: 404, body: { error: 'NOT_FOUND', message: '教程不存在' } };
        l.progress[t.id] = l.progress[t.id] || { mode: t.publishMode, frozen: null, confirmations: {} };
        const lt = l.progress[t.id];
        if (t.publishMode === 'frozen' && !lt.frozen) {
          lt.frozen = { releaseId: t.currentReleaseId, at: new Date().toISOString() };
        }
        const chk = G.checkConfirm(db, t, lt, body.stepId, body.stepVersion ?? null);
        if (!chk.ok) return { http: chk.status, body: { error: chk.code, message: chk.message, ...(chk.conflictWith ? { conflictWith: chk.conflictWith } : {}), ...(chk.expectedVersion ? { expectedVersion: chk.expectedVersion } : {}) } };

        const existing = lt.confirmations[body.stepId];
        if (existing && existing.stepVersion === chk.version) {
          return { http: 200, body: { idempotent: true, confirmation: existing } }; // 离线重复提交安全
        }
        const confirmation = {
          stepVersion: chk.version,
          at: new Date().toISOString(),
          clientAt: body.clientAt || null,
          releaseId: chk.release.id
        };
        lt.confirmations[body.stepId] = confirmation;
        return { http: 200, body: { confirmation, note: '阅读确认仅表示已阅读，不代表获得实际操作资格' } };
      });
      return json(res, result.http, result.body);
    }

    // 回滚某一步勾选（例如选错互斥分支后撤销）；有后续依赖时拒绝
    if (req.method === 'POST' && (m = p.match(/^\/api\/learners\/([\w-]+)\/progress\/([\w-]+)\/rollback$/))) {
      const body = await readBody(req);
      const result = await store.tx(db => {
        const l = db.learners.find(x => x.id === m[1]);
        const t = db.tutorials.find(x => x.id === m[2]);
        if (!l || !t) return { http: 404, body: { error: 'NOT_FOUND', message: '不存在' } };
        const lt = l.progress[t.id];
        if (!lt?.confirmations?.[body.stepId]) return { http: 404, body: { error: 'NOT_CONFIRMED', message: '该步骤尚未确认' } };
        const { release } = G.expectedPin(t, lt);
        const views = G.viewsFromRelease(t, release);
        const dependents = views.filter(v =>
          (v.prerequisites || []).some(pr => pr.stepId === body.stepId) &&
          lt.confirmations[v.id]);
        if (dependents.length) {
          return { http: 409, body: { error: 'HAS_DEPENDENTS', message: `已有后续步骤确认，需先回滚：${dependents.map(d => d.title).join('、')}` } };
        }
        delete lt.confirmations[body.stepId];
        return { http: 200, body: { rolledBack: body.stepId } };
      });
      return json(res, result.http, result.body);
    }

    // 冻结教程：迁移到新整体版本
    if (req.method === 'POST' && (m = p.match(/^\/api\/learners\/([\w-]+)\/progress\/([\w-]+)\/migrate$/))) {
      const result = await store.tx(db => {
        const l = db.learners.find(x => x.id === m[1]);
        const t = db.tutorials.find(x => x.id === m[2]);
        if (!l || !t) return { http: 404, body: { error: 'NOT_FOUND', message: '不存在' } };
        const lt = l.progress[t.id];
        if (!lt?.frozen) return { http: 409, body: { error: 'NOT_STARTED', message: '尚未开始该冻结教程' } };
        const oldRel = t.releases.find(r => r.id === lt.frozen.releaseId);
        const newRel = t.releases.find(r => r.id === t.currentReleaseId);
        if (oldRel.id === newRel.id) return { http: 200, body: { idempotent: true, preview: { rows: [], removed: [] } } };
        const preview = G.migrationPreview(t, oldRel, newRel);
        const carried = {};
        for (const row of preview.rows) {
          const old = lt.confirmations[row.stepId];
          if (row.carry && old) carried[row.stepId] = { stepVersion: row.version, at: new Date().toISOString(), releaseId: newRel.id, carriedFrom: old.stepVersion };
        }
        lt.frozen = { releaseId: newRel.id, at: new Date().toISOString(), migratedFrom: oldRel.id };
        lt.confirmations = carried; // 不能携带的勾选一律清除，要求按新版重新阅读确认
        return { http: 200, body: { migratedTo: newRel.id, preview, carried: Object.keys(carried) } };
      });
      return json(res, result.http, result.body);
    }

    // 迁移预览
    if (req.method === 'GET' && (m = p.match(/^\/api\/tutorials\/([\w-]+)\/migration-preview$/))) {
      const db = store.read();
      const t = db.tutorials.find(x => x.id === m[1]);
      const learnerId = url.searchParams.get('learnerId');
      const l = db.learners.find(x => x.id === learnerId);
      const fromId = l?.progress?.[t.id]?.frozen?.releaseId;
      const from = t.releases.find(r => r.id === fromId) || t.releases[0];
      const to = t.releases.find(r => r.id === t.currentReleaseId);
      return json(res, 200, G.migrationPreview(t, from, to));
    }

    // 媒体当前状态（公共播放器探测；撤销=410，不可用=503，由前端走文字替代）
    if (req.method === 'GET' && (m = p.match(/^\/api\/media\/([\w-]+)$/))) {
      const db = store.read();
      const md = db.media.find(x => x.id === m[1]);
      if (!md) return fail(res, 404, 'NOT_FOUND', '媒体不存在');
      if (md.licenseRevoked) return fail(res, 410, 'MEDIA_LICENSE_REVOKED', '素材授权已撤销，禁止播放（历史链接同样禁止）');
      if (!md.available) return fail(res, 503, 'MEDIA_UNAVAILABLE', '视频当前不可用，请使用文字替代', { alt: '页面内文字替代始终可用' });
      return json(res, 200, { id: md.id, title: md.title, captions: md.captions.filter(c => !c.withdrawn) });
    }

    // ================= 管理端 =================
    if (p.startsWith('/api/admin') || /\/(draft|publish|rollback-fork|annotations|approve|media-pin)/.test(p)) {
      if (!isAdmin) return fail(res, 401, 'UNAUTHORIZED', '需要管理密钥 X-Admin-Key');
    }

    if (req.method === 'GET' && p === '/api/admin/tutorials') {
      const db = store.read();
      return json(res, 200, { tutorials: db.tutorials.map(t => ({
        id: t.id, title: t.title, mode: t.publishMode,
        introApproved: t.introApproved, riskApproved: t.riskApproved,
        releaseId: t.currentReleaseId,
        drafts: t.steps.filter(s => s.draft).map(s => s.id)
      })) });
    }

    if (req.method === 'GET' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)$/))) {
      const db = store.read();
      const t = db.tutorials.find(x => x.id === m[1]);
      if (!t) return fail(res, 404, 'NOT_FOUND', '教程不存在');
      const views = G.viewsFromDraft(t);
      const check = G.validateGraph(db, views);
      return json(res, 200, { tutorial: t, graphCheck: check });
    }

    if (req.method === 'POST' && p === '/api/admin/tutorials') {
      const body = await readBody(req);
      if (!body.title) return fail(res, 400, 'BAD_REQUEST', '缺标题');
      const mode = body.mode === 'frozen' ? 'frozen' : 'stepwise';
      const t = await store.tx(db => {
        const id = store.nextId('tu');
        const tutorial = {
          id, title: String(body.title).slice(0, 80),
          intro: '', riskNotice: '', introApproved: false, riskApproved: false,
          publishMode: mode, currentReleaseId: null, createdAt: new Date().toISOString(),
          releases: [], steps: []
        };
        db.tutorials.push(tutorial);
        return tutorial;
      });
      return json(res, 201, t);
    }

    if (req.method === 'PUT' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/intro$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        if (!t) return { http: 404, body: { error: 'NOT_FOUND', message: '教程不存在' } };
        if (typeof body.intro === 'string') { t.intro = body.intro; t.introApproved = false; }
        if (typeof body.riskNotice === 'string') { t.riskNotice = body.riskNotice; t.riskApproved = false; }
        // 原有风险提示为必填：清空风险提示将阻止发布
        return { http: 200, body: { id: t.id, introApproved: t.introApproved, riskApproved: t.riskApproved } };
      });
      return json(res, r.http, r.body);
    }

    if (req.method === 'POST' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/approve$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        if (!t) return { http: 404, body: { error: 'NOT_FOUND', message: '教程不存在' } };
        if (body.field === 'intro') {
          if (!t.intro.trim()) return { http: 409, body: { error: 'EMPTY_INTRO', message: '工艺介绍为空，无法审核' } };
          t.introApproved = !!body.approved;
        } else if (body.field === 'risk') {
          if (!t.riskNotice.trim()) return { http: 409, body: { error: 'EMPTY_RISK', message: '风险提示为必填且必须保留原文' } };
          t.riskApproved = !!body.approved;
        } else return { http: 400, body: { error: 'BAD_REQUEST', message: 'field 必须为 intro|risk' } };
        return { http: 200, body: { introApproved: t.introApproved, riskApproved: t.riskApproved } };
      });
      return json(res, r.http, r.body);
    }

    // 拖动排序：只改展示顺序，不改依赖（依赖在草稿中显式编辑）
    if (req.method === 'PUT' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/steps\/order$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        if (!t) return { http: 404, body: { error: 'NOT_FOUND', message: '教程不存在' } };
        for (const o of body.orders || []) {
          const s = t.steps.find(x => x.id === o.id);
          if (s && Number.isInteger(o.order)) s.order = o.order;
        }
        t.steps.sort((a, b) => a.order - b.order);
        return { http: 200, body: { orders: t.steps.map(s => ({ id: s.id, order: s.order })), note: '排序仅影响展示，依赖关系未变' } };
      });
      return json(res, r.http, r.body);
    }

    const DRAFT_FIELDS = ['title', 'content', 'requiredMaterials', 'prerequisites', 'branches', 'branchGroup', 'join', 'media', 'changeType', 'derivedFrom', 'retireSources'];
    function pickDraft(body) {
      const d = {};
      for (const f of DRAFT_FIELDS) if (body[f] !== undefined) d[f] = body[f];
      return d;
    }

    if (req.method === 'POST' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/steps$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        if (!t) return { http: 404, body: { error: 'NOT_FOUND', message: '教程不存在' } };
        const id = store.nextId('stp');
        const order = (body.order ?? (Math.max(0, ...t.steps.map(s => s.order)) + 1));
        const step = {
          id, order, retired: false,
          draft: Object.assign({
            title: body.title || '新步骤', content: body.content || '',
            requiredMaterials: body.requiredMaterials || [],
            prerequisites: body.prerequisites || [], branches: body.branches || [],
            branchGroup: body.branchGroup || null,
            join: body.join || { type: 'none', sources: [] },
            media: body.media || []
          }, pickDraft(body)),
          versions: []
        };
        t.steps.push(step);
        t.steps.sort((a, b) => a.order - b.order);
        return { http: 201, body: { id, draft: step.draft, graphCheck: G.validateGraph(db, G.viewsFromDraft(t)) } };
      });
      return json(res, r.http, r.body);
    }

    if (req.method === 'PUT' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/steps\/([\w-]+)\/draft$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        const s = t?.steps.find(x => x.id === m[2]);
        if (!s) return { http: 404, body: { error: 'NOT_FOUND', message: '步骤不存在' } };
        const base = s.draft || (s.versions.length ? { ...G.latestVersion(t, s.id) } : null)
          || { title: '', content: '', requiredMaterials: [], prerequisites: [], branches: [], branchGroup: null, join: { type: 'none', sources: [] }, media: [] };
        s.draft = Object.assign({}, base, pickDraft(body));
        return { http: 200, body: { id: s.id, draft: s.draft, graphCheck: G.validateGraph(db, G.viewsFromDraft(t)) } };
      });
      return json(res, r.http, r.body);
    }

    if (req.method === 'PUT' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/steps\/([\w-]+)\/media-pin$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        const s = t?.steps.find(x => x.id === m[2]);
        if (!s) return { http: 404, body: { error: 'NOT_FOUND', message: '步骤不存在' } };
        const base = s.draft || { ...G.latestVersion(t, s.id) };
        const media = (base.media || []).filter(x => x.mediaId !== body.mediaId);
        media.push({ mediaId: body.mediaId, captionVersion: body.captionVersion, altText: body.altText || '' });
        base.media = media;
        s.draft = base;
        return { http: 200, body: { graphCheck: G.validateGraph(db, G.viewsFromDraft(t)) } };
      });
      return json(res, r.http, r.body);
    }

    // 步骤分叉后回滚：放弃所有草稿，编辑线回到当前发布线
    if (req.method === 'POST' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/rollback-fork$/))) {
      const body = await readBody(req).catch(() => ({}));
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        if (!t) return { http: 404, body: { error: 'NOT_FOUND', message: '教程不存在' } };
        let targets = body.stepIds || t.steps.filter(s => s.draft).map(s => s.id);
        let rolledBack = [];
        for (const id of targets) {
          const s = t.steps.find(x => x.id === id);
          if (s?.draft) { s.draft = null; rolledBack.push(id); }
        }
        return { http: 200, body: { rolledBack, note: '草稿分叉已丢弃，恢复为已发布版本，已确认进度不受影响' } };
      });
      return json(res, r.http, r.body);
    }

    // 发布：校验整个依赖图 → 固化为步骤新版本（stepwise）或新整体快照（frozen）
    if (req.method === 'POST' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/publish$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        if (!t) return { http: 404, body: { error: 'NOT_FOUND', message: '教程不存在' } };
        if (!t.intro.trim() || !t.riskNotice.trim())
          return { http: 409, body: { error: 'CONTENT_REQUIRED', message: '必须包含经审核的工艺介绍与原有风险提示' } };
        if (!t.introApproved || !t.riskApproved)
          return { http: 409, body: { error: 'NOT_APPROVED', message: '工艺介绍或风险提示尚未通过审核' } };

        const draftViews = G.viewsFromDraft(t);
        const live = draftViews.filter(v => !v.retired);
        const check = G.validateGraph(db, live);
        if (!check.ok) return { http: 409, body: { error: 'GRAPH_INVALID', message: '依赖图校验未通过，已拒绝发布', issues: check.issues } };

        const relId = store.nextId('rel');
        const pins = [];
        for (const s of t.steps) {
          if (s.retired) continue;
          const latest = G.latestVersion(t, s.id);
          if (s.draft) {
            const nv = (latest ? latest.version : 0) + 1;
            const v = Object.assign({}, s.draft, { version: nv, publishedIn: relId });
            s.versions.push(v);
            pins.push({ stepId: s.id, version: nv });
            // 合并来源步骤按编辑者声明退役
            for (const rid0 of s.draft.retireSources || []) {
              const src = t.steps.find(x => x.id === rid0);
              if (src && src.id !== s.id) src.retired = true;
            }
            s.draft = null;
          } else if (latest) {
            pins.push({ stepId: s.id, version: latest.version });
          }
        }
        t.steps.sort((a, b) => a.order - b.order);
        const release = {
          id: relId, createdAt: new Date().toISOString(),
          mode: t.publishMode, label: body.label || `发布于 ${new Date().toISOString().slice(0, 10)}`,
          steps: pins
        };
        t.releases.push(release);
        t.currentReleaseId = relId;
        return { http: 200, body: { release, mode: t.publishMode } };
      });
      return json(res, r.http, r.body);
    }

    // ---------- 材料 ----------
    if (req.method === 'GET' && p === '/api/admin/materials') {
      return json(res, 200, { materials: store.read().materials });
    }
    if (req.method === 'POST' && p === '/api/admin/materials') {
      const body = await readBody(req);
      if (!body.name) return fail(res, 400, 'BAD_REQUEST', '缺材料名');
      const mat = await store.tx(db => {
        const m = { id: store.nextId('mat'), name: String(body.name).slice(0, 60), approved: false, createdAt: new Date().toISOString(), deletedAt: null };
        db.materials.push(m);
        return m;
      });
      return json(res, 201, mat);
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/admin\/materials\/([\w-]+)\/approve$/))) {
      const r = await store.tx(db => {
        const mat = db.materials.find(x => x.id === m[1]);
        if (!mat) return { http: 404, body: { error: 'NOT_FOUND', message: '材料不存在' } };
        mat.approved = true;
        return { http: 200, body: mat };
      });
      return json(res, r.http, r.body);
    }
    // 并发删除被引用材料：引用检查与删除在同一串行事务内
    if (req.method === 'DELETE' && (m = p.match(/^\/api\/admin\/materials\/([\w-]+)$/))) {
      const r = await store.tx(db => {
        const mat = db.materials.find(x => x.id === m[1]);
        if (!mat || mat.deletedAt) return { http: 404, body: { error: 'NOT_FOUND', message: '材料不存在' } };
        const refs = [];
        for (const t of db.tutorials) {
          for (const s of t.steps) {
            for (const v of s.versions) {
              if ((v.requiredMaterials || []).includes(mat.id))
                refs.push({ tutorialId: t.id, stepId: s.id, version: v.version });
            }
            if (s.draft && (s.draft.requiredMaterials || []).includes(mat.id))
              refs.push({ tutorialId: t.id, stepId: s.id, draft: true });
          }
        }
        if (refs.length) return { http: 409, body: { error: 'MATERIAL_IN_USE', message: '材料被步骤版本引用，拒绝删除；请先改工序再删材料', refs } };
        mat.deletedAt = new Date().toISOString();
        return { http: 200, body: { deleted: mat.id } };
      });
      return json(res, r.http, r.body);
    }

    // ---------- 媒体管理 ----------
    if (req.method === 'GET' && p === '/api/admin/media') {
      return json(res, 200, { media: store.read().media });
    }
    if (req.method === 'POST' && p === '/api/admin/media') {
      const body = await readBody(req);
      const md = await store.tx(db => {
        const m = { id: store.nextId('vid'), type: 'video', title: body.title || '未命名媒体',
          available: body.available !== false, licenseRevoked: false,
          captions: [{ version: 1, text: body.captionText || '（无字幕）', withdrawn: false }] };
        db.media.push(m);
        return m;
      });
      return json(res, 201, md);
    }
    if (req.method === 'PATCH' && (m = p.match(/^\/api\/admin\/media\/([\w-]+)$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const md = db.media.find(x => x.id === m[1]);
        if (!md) return { http: 404, body: { error: 'NOT_FOUND', message: '媒体不存在' } };
        if (typeof body.available === 'boolean') md.available = body.available;
        if (typeof body.licenseRevoked === 'boolean') md.licenseRevoked = body.licenseRevoked;
        return { http: 200, body: md };
      });
      return json(res, r.http, r.body);
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/admin\/media\/([\w-]+)\/captions$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const md = db.media.find(x => x.id === m[1]);
        if (!md) return { http: 404, body: { error: 'NOT_FOUND', message: '媒体不存在' } };
        const nv = Math.max(0, ...md.captions.map(c => c.version)) + 1;
        md.captions.push({ version: nv, text: body.text || '', withdrawn: false });
        return { http: 200, body: { version: nv } };
      });
      return json(res, r.http, r.body);
    }
    // 字幕撤版
    if (req.method === 'PATCH' && (m = p.match(/^\/api\/admin\/media\/([\w-]+)\/captions\/(\d+)$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const md = db.media.find(x => x.id === m[1]);
        const cap = md?.captions.find(c => c.version === Number(m[2]));
        if (!cap) return { http: 404, body: { error: 'NOT_FOUND', message: '字幕版本不存在' } };
        cap.withdrawn = body.withdrawn !== false;
        return { http: 200, body: cap };
      });
      return json(res, r.http, r.body);
    }

    // ---------- 注释 ----------
    if (req.method === 'GET' && (m = p.match(/^\/api\/admin\/tutorials\/([\w-]+)\/annotations$/))) {
      const db = store.read();
      return json(res, 200, { annotations: db.annotations.filter(a => {
        const t = db.tutorials.find(x => x.id === m[1]);
        return t.steps.some(s => s.id === a.stepId);
      }) });
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/tutorials\/([\w-]+)\/annotations$/))) {
      if (!isAdmin) return fail(res, 401, 'UNAUTHORIZED', '需要管理密钥');
      const body = await readBody(req);
      const r = await store.tx(db => {
        const t = db.tutorials.find(x => x.id === m[1]);
        if (!t || !t.steps.some(s => s.id === body.stepId))
          return { http: 404, body: { error: 'NOT_FOUND', message: '步骤不存在' } };
        const a = { id: store.nextId('ann'), stepId: body.stepId, text: String(body.text || '').slice(0, 500), approved: false, createdAt: new Date().toISOString() };
        db.annotations.push(a);
        return { http: 201, body: a };
      });
      return json(res, r.http, r.body);
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/admin\/annotations\/([\w-]+)\/approve$/))) {
      const body = await readBody(req);
      const r = await store.tx(db => {
        const a = db.annotations.find(x => x.id === m[1]);
        if (!a) return { http: 404, body: { error: 'NOT_FOUND', message: '注释不存在' } };
        a.approved = body.approved !== false;
        return { http: 200, body: a };
      });
      return json(res, r.http, r.body);
    }

    return fail(res, 404, 'NOT_FOUND', `无此路由: ${p}`);
  } catch (e) {
    if (e.message === 'bad json') return fail(res, 400, 'BAD_JSON', '请求体不是合法 JSON');
    console.error(e);
    return fail(res, 500, 'INTERNAL', e.message);
  }
});

server.listen(PORT, () => console.log(`craft server on http://localhost:${PORT}`));
module.exports = server;
