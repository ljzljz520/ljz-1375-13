const api = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || '请求失败'), { data, status: response.status });
  return data;
};
const $ = (selector) => document.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const queueKey = (progressId) => `craft-offline-${progressId}`;

function showMessage(text, type = 'notice') {
  const el = $('#message');
  if (!el) return;
  el.hidden = !text;
  el.className = type;
  el.textContent = text || '';
}

async function renderCraftList() {
  const holder = $('#crafts');
  try {
    const { crafts } = await api('/api/crafts');
    holder.innerHTML = crafts.map((craft) => `<article class="craft-card">
      <h2>${esc(craft.title)}</h2><p>${esc(craft.summary)}</p>
      <p class="meta">最新版本 ${esc(craft.latestVersion)} · ${craft.mode === 'stepwise' ? '按步骤升级' : '整个教程冻结'} · ${new Date(craft.publishedAt).toLocaleString('zh-CN')}</p>
      <a class="button" href="craft.html?craftId=${encodeURIComponent(craft.id)}">手机阅读并确认进度</a>
    </article>`).join('');
  } catch (error) {
    holder.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  }
}

async function initCraft() {
  const params = new URLSearchParams(location.search);
  const craftId = params.get('craftId');
  if (!craftId) { showMessage('缺少 craftId。', 'notice error'); return; }
  let progressId = params.get('progressId') || localStorage.getItem(`craft-progress-${craftId}`);
  try {
    if (!progressId) {
      const started = await api('/api/progress/start', { method: 'POST', body: { craftId, versionId: params.get('versionId') || null } });
      progressId = started.progress.progressId;
      localStorage.setItem(`craft-progress-${craftId}`, progressId);
      history.replaceState(null, '', `?craftId=${encodeURIComponent(craftId)}&progressId=${encodeURIComponent(progressId)}`);
    }
    await syncOffline(progressId);
    await loadProgress(progressId);
  } catch (error) {
    showMessage(error.message, 'notice error');
  }
}

async function syncOffline(progressId) {
  const raw = localStorage.getItem(queueKey(progressId));
  if (!raw) return;
  const queue = JSON.parse(raw);
  const failed = [];
  for (const item of queue) {
    try {
      await api(`/api/progress/${encodeURIComponent(progressId)}/confirm`, { method: 'POST', body: { ...item, offline: true } });
    } catch (error) {
      if (error.status === 409) {
        showMessage(error.message + ' 已停止重放该离线确认。', 'notice error');
        continue;
      }
      failed.push(item);
    }
  }
  localStorage.setItem(queueKey(progressId), JSON.stringify(failed));
}

async function loadProgress(progressId) {
  const data = await api(`/api/progress/${encodeURIComponent(progressId)}`);
  const version = await api(`/api/crafts/${encodeURIComponent(data.progress.craftId)}?versionId=${encodeURIComponent(data.progress.versionId)}`);
  window.currentProgress = data.progress;
  window.currentVersion = version.version;
  renderVersion(data.progress, version.version, version.versions);
  renderSteps(version.version, data.progress);
}

function renderVersion(progress, version, versions) {
  $('#craft-title').textContent = version.title;
  $('#craft-summary').textContent = `${version.summary} ｜ 当前阅读版本 ${version.version}（${version.mode === 'stepwise' ? '按步骤升级' : '整个教程冻结'}）`;
  $('#riskText').innerHTML = `<p>${esc(version.riskNotice?.text || '')}</p>
    <div class="step-actions"><button ${progress.riskAcknowledged ? 'disabled' : ''} onclick="acknowledgeRisk()">${progress.riskAcknowledged ? '已确认当前版本风险提示' : '我已阅读并理解当前版本风险提示'}</button><span class="meta">此确认只表示阅读风险提示，不代表获得实际操作资格。</span></div>` +
    version.annotations.map((a) => `<p class="meta">${esc(a.body)}</p>`).join('');
  const policy = progress.updateAvailable
    ? `<div class="notice"><strong>学习途中出现新版本 ${esc(progress.latestVersion)}</strong><p>${progress.latestMode === 'stepwise' ? '按步骤升级：仅内容完全未变且依赖仍成立的步骤自动迁移；合并步骤不会凭旧勾选认定新要求。' : '整个教程冻结：升级后新版所有步骤重新阅读确认。'}</p><div class="step-actions"><button class="secondary" onclick="continueOldVersion()">继续阅读当前旧版</button><button onclick="migrateProgress('upgrade')">迁移并查看新版</button></div></div>`
    : '<span class="badge ok">当前为最新发布版本</span>';
  $('#versionBar').innerHTML = policy + versions.map((v) => `<a class="badge ${v.versionId === progress.versionId ? 'ok' : 'muted'}" href="craft.html?craftId=${encodeURIComponent(version.craftId)}${v.versionId === progress.versionId ? '&progressId=' + encodeURIComponent(progress.progressId) : '&versionId=' + encodeURIComponent(v.versionId)}">${esc(v.version)}</a>`).join('');
}

function renderMedia(step) {
  const m = step.mediaSnapshot;
  if (!m) return `<div class="media-box"><h4>明确文字替代方案</h4><div class="transcript">${esc(step.alternativeText)}</div></div>`;
  if (m.playable === false) {
    return `<div class="media-box unavailable"><h4>媒体当前不可用：${esc(m.unavailableReason)}</h4><p class="badge danger">历史链接不绕过授权撤销</p><div class="transcript"><strong>完整文字仍可用：</strong>${esc(m.textAlternative)}</div></div>`;
  }
  const isImage = m.type === 'image';
  const mediaTag = isImage
    ? `<img src="${esc(m.url)}" alt="${esc(m.altText)}">`
    : `<${m.type} controls preload="none" ${m.poster ? `poster="${esc(m.poster)}"` : ''} src="${esc(m.url)}"></${m.type}>`;
  return `<div class="media-box"><h4>${esc(m.title)}</h4>${mediaTag}
    ${m.caption ? `<details open><summary>锁定字幕/口播（版本 ${esc(m.caption.version)}）</summary><div class="transcript">${esc(m.caption.text)}</div></details>` : ''}
    <details ${isImage ? '' : 'open'}><summary>完整文字替代</summary><div class="transcript">${esc(m.textAlternative)}</div></details></div>`;
}

function renderSteps(version, progress) {
  const state = new Map(progress.steps.map((s) => [s.stepKey, s]));
  $('#steps').innerHTML = `<h2 class="section-title">工序步骤</h2>${version.steps.map((step) => {
    const s = state.get(step.key);
    const classes = ['step-card'];
    if (s.completed) classes.push('completed');
    if (!s.available) classes.push('locked');
    return `<article class="${classes.join(' ')}" id="step-${esc(step.key)}" aria-labelledby="title-${esc(step.key)}">
      <h3 id="title-${esc(step.key)}"><span aria-hidden="true">${step.order + 1}. </span>${esc(step.title)}</h3>
      <p>${step.optional ? '<span class="badge warn">可选分支</span>' : '<span class="badge muted">必需步骤</span>'}<span class="badge muted">${esc(step.stepVersionId)}</span>${s.completed ? '<span class="badge ok">已阅读确认</span>' : ''}</p>
      <p>${esc(step.text)}</p><p class="meta">${esc(step.instructions)}</p>
      ${step.merge ? `<p class="badge warn">汇合条件：${step.merge.operator === 'and' ? '全部分支' : '至少一个分支'} — ${esc(step.merge.policyText || '以后续发布说明为准')}</p>` : ''}
      ${step.prerequisites.length ? `<p class="meta">必需前置：${step.prerequisites.map((p) => esc(p.stepKey)).join('、')}（拖动展示顺序不会改变此依赖）</p>` : ''}
      <ul class="requirements">${step.materials.map((m) => `<li>${m.required ? '必需材料' : '参考材料'}：${esc(version.materialIndex[m.materialId] || m.materialId)}</li>`).join('')}</ul>
      ${renderMedia(step)}
      ${step.annotations.map((a) => `<p class="meta">注释：${esc(a.body)}</p>`).join('')}
      <div class="step-actions">
        <button ${s.available && !s.completed ? '' : 'disabled'} onclick="confirmStep('${esc(step.key)}','${esc(step.variantHash)}')">${s.completed ? '已确认' : '我已阅读本步骤'}</button>
        ${!s.available && !s.completed ? `<span class="meta">${esc(s.reason)}</span>` : ''}
      </div>
    </article>`;
  }).join('')}`;
}

async function confirmStep(stepKey, variantHash) {
  const progress = window.currentProgress;
  const payload = { stepKey, clientVersionId: progress.versionId, variantHash, clientTime: new Date().toISOString() };
  try {
    await api(`/api/progress/${encodeURIComponent(progress.progressId)}/confirm`, { method: 'POST', body: payload });
    const queue = JSON.parse(localStorage.getItem(queueKey(progress.progressId)) || '[]').filter((x) => x.stepKey !== stepKey);
    localStorage.setItem(queueKey(progress.progressId), JSON.stringify(queue));
    showMessage('阅读确认已在服务端保存。', 'notice success');
    await loadProgress(progress.progressId);
  } catch (error) {
    if (error.status === 409) {
      showMessage(error.message, 'notice error');
      return;
    }
    const queue = JSON.parse(localStorage.getItem(queueKey(progress.progressId)) || '[]');
    if (!queue.some((x) => x.stepKey === stepKey && x.clientVersionId === progress.versionId)) {
      queue.push(payload);
      localStorage.setItem(queueKey(progress.progressId), JSON.stringify(queue));
    }
    showMessage('当前网络不可用，阅读确认已暂存在本机；恢复网络后会提交，若期间版本变更将由服务端拒绝并提示迁移。');
  }
}

window.acknowledgeRisk = async () => {
  const progress = window.currentProgress;
  try {
    await api(`/api/progress/${encodeURIComponent(progress.progressId)}/acknowledge-risk`, { method: 'POST', body: { versionId: progress.versionId } });
    showMessage('已确认当前版本风险提示；这不是操作资格。', 'notice success');
    await loadProgress(progress.progressId);
  } catch (error) { showMessage(error.message, 'notice error'); }
};
window.continueOldVersion = () => showMessage('已保留在当前版本。你可以完成旧版后，再通过版本说明查看新版。');
window.migrateProgress = async () => {
  const progress = window.currentProgress;
  const result = await api('/api/progress/migrate', { method: 'POST', body: { progressId: progress.progressId, strategy: 'upgrade' } });
  showMessage(result.policy + ` 已迁移：${result.carried.length} 步；需重读：${result.reset.length} 步。`, 'notice success');
  await loadProgress(progress.progressId);
};
window.renderCraftList = renderCraftList;
window.confirmStep = confirmStep;
if (location.pathname.endsWith('/craft.html')) initCraft();
