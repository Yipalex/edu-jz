/* ============================================================
   教培机构 · 教师资格认证报名审核后台
   ------------------------------------------------------------
   管理密码校验在服务端函数内完成，密码不出现在本文件中。
   ============================================================ */

'use strict';

const CONFIG = {
  endpoint: '',
  app: 'jz',
};

const cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: CONFIG.endpoint,
  app: CONFIG.app,
});

/* 预设拒绝原因 */
const REJECT_REASONS = ['资料不符合要求', '不符合该级别申报条件', '材料不清晰，请重新上传', '其他（教务电话说明）'];

/* ---------------- ZXShell 骨架 ---------------- */
const ZX_SYSTEMS = [
  { id: 'yj',   name: '业绩登记系统', domain: 'yj.example.com',   color: 'var(--zx-sys-yj)',   url: 'https://yj.example.com/' },
  { id: 'quan', name: '券类管理系统', domain: 'quan.example.com', color: 'var(--zx-sys-quan)', url: 'https://quan.example.com/' },
  { id: 'jz',   name: '教资报名系统', domain: 'jz.example.com',   color: 'var(--zx-sys-jz)',   url: 'https://jz.example.com/' },
  { id: 'sf',   name: '评测报告系统', domain: 'sf.example.com',   color: 'var(--zx-sys-sf)',   url: 'https://sf.example.com/' },
  { id: 'wms',  name: '仓库管理系统', domain: 'wms.example.com',  color: 'var(--zx-sys-wms)',  url: 'https://wms.example.com/' },
  { id: 'zc',   name: '固定资产管理', domain: 'zc.example.com',   color: 'var(--zx-sys-zc)',   url: 'https://zc.example.com/' },
];

const JZ_NAV = [
  { group: '教务审核', items: [
    { id: 'review', icon: 'audit', label: '报名审核', badge: '0' },
    { id: 'scores', icon: 'report', label: '成绩录入' },
  ]},
];

let zxShellReady = false;
function ensureShell() {
  if (zxShellReady) return;
  zxShellReady = true;
  document.body.classList.add('zx-shell-on');
  ZXShell.init({
    brand: { name: '教培机构', logo: 'assets/img/logo.jpeg' },
    systems: ZX_SYSTEMS,
    currentSystem: 'jz',
    nav: JZ_NAV,
    tabbar: ['review', 'scores'],
    user: { name: '教务管理', role: '机构教务', roleType: 'admin' },
    activeNav: 'review',
    onNavigate: (id) => { showPanel(id); return false; },
    onLogout: () => { adminPwd = ''; location.reload(); },
  });
  ZXShell.setBadge('review', ''); // 数据加载前先隐藏占位角标
}

/* 面板切换（由骨架导航驱动） */
function showPanel(id) {
  $$('.admin-panel').forEach((p) => p.classList.toggle('is-show', p.id === `panel-${id}`));
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('is-active', a.getAttribute('data-nav') === id);
  });
  if (id === 'scores') loadScores();
}

let adminPwd = '';
let registrations = [];
let currentFilter = 'all';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('is-error', isError);
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-show'), 3200);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------- 登录 ---------------- */
$('#adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = $('#adminPwd').value;
  const errEl = document.querySelector('.field-error[data-for="adminPwd"]');
  errEl.textContent = '';
  if (!pwd) {
    errEl.textContent = '请输入管理密码';
    return;
  }

  const btn = $('#adminLoginBtn');
  btn.disabled = true;
  btn.textContent = '验证中…';

  try {
    const { error } = await cloud.database.rpc('admin_list_registrations', { pwd });
    if (error) throw new Error(error.message || '验证失败');
    adminPwd = pwd;
    ensureShell();
    $('#screen-admin-login').classList.remove('is-show');
    $('#screen-admin-list').classList.add('is-show');
    showPanel('review');
    await loadList();
  } catch (err) {
    errEl.textContent = '密码错误或网络异常，请重试';
  } finally {
    btn.disabled = false;
    btn.textContent = '进入后台';
  }
});

/* ---------------- 加载列表 ---------------- */
async function loadList() {
  const { data, error } = await cloud.database.rpc('admin_list_registrations', { pwd: adminPwd });
  if (error) {
    toast('加载失败，请刷新重试', true);
    return;
  }
  registrations = Array.isArray(data) ? data : [];
  renderStats();
  renderList();
}

$('#refreshBtn').addEventListener('click', loadList);

/* ---------------- 统计与筛选 ---------------- */
function renderStats() {
  const total = registrations.length;
  const pending = registrations.filter((r) => r.status === '待审核').length;
  const passed = registrations.filter((r) => r.status === '已通过').length;
  const rejected = registrations.filter((r) => r.status === '已拒绝').length;
  $('#adminStats').innerHTML = `
    <span>共 <b>${total}</b> 条</span>
    <span class="status-pending">待审核 <b>${pending}</b></span>
    <span class="status-pass">已通过 <b>${passed}</b></span>
    <span class="status-reject">已拒绝 <b>${rejected}</b></span>
  `;
  if (zxShellReady) ZXShell.setBadge('review', pending || '');
}

$('#adminFilters').addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  currentFilter = chip.dataset.filter;
  $$('.filter-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
  renderList();
});

/* ---------------- 渲染列表 ---------------- */
function statusClass(status) {
  if (status === '已通过') return 'status-pass';
  if (status === '已拒绝') return 'status-reject';
  return 'status-pending';
}

function renderList() {
  const list = registrations.filter((r) => currentFilter === 'all' || r.status === currentFilter);
  $('#emptyTip').classList.toggle('is-hidden', list.length > 0);

  $('#adminList').innerHTML = list.map((r) => `
    <article class="admin-item card" data-id="${r.id}">
      <div class="admin-item-head">
        <div class="admin-item-title">
          <b>${escapeHtml(r.name)}</b>
          <span class="admin-reg-no">${escapeHtml(r.reg_no || '—')}</span>
          <span class="admin-status ${statusClass(r.status)}">${escapeHtml(r.status)}</span>
        </div>
        <span class="admin-time">${fmtTime(r.created_at)}</span>
      </div>
      <div class="admin-item-body">
        <div><span>申报级别</span><b>${escapeHtml(r.stage)}</b></div>
        <div><span>手机号码</span><b>${escapeHtml(r.phone)}</b></div>
        <div><span>持证情况</span><b>${escapeHtml(r.has_cert)}</b></div>
        <div class="admin-bio"><span>资历说明</span><b>${escapeHtml(r.bio)}</b></div>
        ${r.review_note ? `<div><span>审核备注</span><b>${escapeHtml(r.review_note)}</b></div>` : ''}
      </div>
      <div class="admin-item-actions">
        <button type="button" class="btn btn-mini btn-view" data-act="attach" data-id="${r.id}" ${r.attachment_count ? '' : 'disabled'}>
          查看材料（${r.attachment_count || 0}）
        </button>
        <span class="admin-actions-right">
          <button type="button" class="btn btn-mini btn-pass" data-act="pass" data-id="${r.id}">✓ 通过</button>
          <button type="button" class="btn btn-mini btn-reject" data-act="reject" data-id="${r.id}">✕ 拒绝</button>
        </span>
      </div>
    </article>
  `).join('');
}

/* ---------------- 审核操作 ---------------- */
$('#adminList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const id = Number(btn.dataset.id);
  const act = btn.dataset.act;

  if (act === 'attach') {
    await showAttachments(id);
    return;
  }

  if (act === 'pass') {
    if (!confirm('确认通过该教师的报名申请？')) return;
    await review(id, '已通过', null);
    return;
  }

  if (act === 'reject') {
    const options = REJECT_REASONS.map((r, i) => `${i + 1}. ${r}`).join('\n');
    const input = prompt(`请选择或输入拒绝原因（将展示给教师）：\n${options}`, '1');
    if (input === null) return;
    let reason = input.trim();
    const idx = Number(reason);
    if (Number.isInteger(idx) && idx >= 1 && idx <= REJECT_REASONS.length) {
      reason = REJECT_REASONS[idx - 1];
    }
    if (!reason) {
      toast('拒绝原因不能为空', true);
      return;
    }
    await review(id, '已拒绝', reason);
  }
});

async function review(id, status, note) {
  try {
    const { error } = await cloud.database.rpc('admin_review_registration', {
      pwd: adminPwd,
      reg_id: id,
      new_status: status,
      note,
    });
    if (error) throw new Error(error.message);
    toast(status === '已通过' ? '已通过该报名申请' : '已拒绝该报名申请');
    await loadList();
  } catch (err) {
    toast(err.message || '操作失败，请重试', true);
  }
}

/* ---------------- 附件查看 ---------------- */
async function showAttachments(id) {
  try {
    const { data, error } = await cloud.database.rpc('admin_get_attachments', { pwd: adminPwd, reg_id: id });
    if (error) throw new Error(error.message);

    const files = Array.isArray(data) ? data : [];
    const body = $('#attachBody');
    if (!files.length) {
      body.innerHTML = '<p class="query-empty">该报名未上传材料</p>';
    } else {
      body.innerHTML = files.map((f, i) => {
        const isPdf = f.type === 'application/pdf';
        if (isPdf) {
          return `<div class="attach-item"><span class="file-badge is-pdf">PDF</span><span class="file-name">${escapeHtml(f.name)}</span><button type="button" class="btn btn-mini btn-view" data-idx="${i}">打开</button></div>`;
        }
        return `<div class="attach-item attach-img"><img src="${f.dataUrl}" alt="${escapeHtml(f.name)}" /><span class="file-name">${escapeHtml(f.name)}</span></div>`;
      }).join('');

      body.querySelectorAll('[data-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const f = files[Number(btn.dataset.idx)];
          const win = window.open();
          if (win) {
            win.document.write(`<title>${escapeHtml(f.name)}</title><embed src="${f.dataUrl}" type="application/pdf" width="100%" height="100%" style="position:fixed;inset:0">`);
          }
        });
      });
    }
    $('#attachModal').classList.remove('is-hidden');
  } catch (err) {
    toast(err.message || '材料加载失败', true);
  }
}

$('#attachClose').addEventListener('click', () => $('#attachModal').classList.add('is-hidden'));
$('#attachModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('is-hidden');
});

/* ============================================================
   成绩批量录入
   ============================================================ */

let parsedScores = [];

/* 解析粘贴的成绩数据：姓名，手机号，级别，分数，结果，备注 */
$('#parseBtn').addEventListener('click', () => {
  const raw = $('#scoreInput').value.trim();
  const preview = $('#scorePreview');

  if (!raw) {
    toast('请先粘贴成绩数据', true);
    return;
  }

  parsedScores = [];
  const errors = [];

  raw.split(/\n+/).forEach((line, i) => {
    const lineNo = i + 1;
    const parts = line.split(/[,，\t]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    // 兼容单个空格分隔（级别含空格场景不适用，级别建议用大纲标准名称）
    if (parts.length < 4) {
      // 尝试按单空格兜底（姓名 手机 级别 分数 [结果] [备注]）
      const bySpace = line.trim().split(/\s+/);
      if (bySpace.length >= 4) {
        parts.length = 0;
        parts.push(...bySpace);
      }
    }
    if (parts.length < 4) {
      errors.push(`第 ${lineNo} 行字段不足（至少：姓名、手机号、级别、分数）`);
      return;
    }
    const [name, phone, level, score, result, ...rest] = parts;
    if (name.length < 2) { errors.push(`第 ${lineNo} 行姓名无效：${name}`); return; }
    if (!/^1[3-9]\d{9}$/.test(phone)) { errors.push(`第 ${lineNo} 行手机号无效：${phone}`); return; }
    if (Number.isNaN(Number(score))) { errors.push(`第 ${lineNo} 行分数无效：${score}`); return; }
    const validResults = ['通过', '未通过', '待定'];
    parsedScores.push({
      name,
      phone,
      level,
      score,
      result: validResults.includes(result) ? result : (result || '待定'),
      remark: rest.join('，') || '',
    });
  });

  const batch = $('#examBatch').value.trim();
  if (batch) parsedScores.forEach((s) => { s.batch = batch; });

  if (!parsedScores.length && errors.length) {
    preview.classList.remove('is-hidden');
    preview.innerHTML = `<p class="score-error">${errors.join('<br />')}</p>`;
    $('#submitScoresBtn').disabled = true;
    return;
  }

  preview.classList.remove('is-hidden');
  preview.innerHTML = `
    ${errors.length ? `<p class="score-error">${errors.join('<br />')}</p>` : ''}
    <table class="score-table">
      <thead><tr><th>姓名</th><th>手机号</th><th>级别</th><th>分数</th><th>结果</th><th>备注</th></tr></thead>
      <tbody>
        ${parsedScores.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.phone)}</td><td>${escapeHtml(s.level)}</td><td>${escapeHtml(s.score)}</td><td>${escapeHtml(s.result)}</td><td>${escapeHtml(s.remark)}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="form-note">共解析 <b>${parsedScores.length}</b> 条，确认无误后点击「确认入库」</p>
  `;
  $('#submitScoresBtn').disabled = parsedScores.length === 0;
});

/* 提交入库 */
$('#submitScoresBtn').addEventListener('click', async () => {
  if (!parsedScores.length) return;
  const btn = $('#submitScoresBtn');
  btn.disabled = true;
  btn.textContent = '入库中…';

  try {
    const { data, error } = await cloud.database.rpc('admin_add_scores', {
      pwd: adminPwd,
      rows: parsedScores,
    });
    if (error) throw new Error(error.message);
    toast(`已成功录入 ${data?.inserted ?? parsedScores.length} 条成绩`);
    $('#scoreInput').value = '';
    $('#scorePreview').classList.add('is-hidden');
    parsedScores = [];
    await loadScores();
  } catch (err) {
    toast(err.message || '录入失败，请重试', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '确认入库';
  }
});

/* 成绩列表 */
async function loadScores() {
  const { data, error } = await cloud.database.rpc('admin_list_scores', { pwd: adminPwd });
  if (error) {
    toast('成绩加载失败，请刷新重试', true);
    return;
  }
  const scores = Array.isArray(data) ? data : [];
  const passed = scores.filter((s) => s.result === '通过').length;
  $('#scoreStats').innerHTML = `<span>共 <b>${scores.length}</b> 条成绩</span><span class="status-pass">通过 <b>${passed}</b></span><span class="status-reject">未通过 <b>${scores.filter((s) => s.result === '未通过').length}</b></span>`;

  $('#scoreEmptyTip').classList.toggle('is-hidden', scores.length > 0);
  $('#scoreList').innerHTML = scores.map((s) => `
    <article class="admin-item card">
      <div class="admin-item-head">
        <div class="admin-item-title">
          <b>${escapeHtml(s.name)}</b>
          <span class="admin-reg-no">${escapeHtml(s.phone)}</span>
          <span class="admin-status ${s.result === '通过' ? 'status-pass' : s.result === '未通过' ? 'status-reject' : 'status-pending'}">${escapeHtml(s.result)}</span>
        </div>
        <span class="admin-time">${fmtTime(s.created_at)}</span>
      </div>
      <div class="admin-item-body">
        <div><span>考核级别</span><b>${escapeHtml(s.level || '—')}</b></div>
        <div><span>考核分数</span><b>${s.score ?? '—'}</b></div>
        <div><span>考核批次</span><b>${escapeHtml(s.exam_batch || '—')}</b></div>
        <div><span>备注</span><b>${escapeHtml(s.remark || '—')}</b></div>
      </div>
      <div class="admin-item-actions">
        <span></span>
        <span class="admin-actions-right">
          <button type="button" class="btn btn-mini btn-reject" data-score-del="${s.id}">删除</button>
        </span>
      </div>
    </article>
  `).join('');
}

$('#refreshScoresBtn').addEventListener('click', loadScores);

$('#scoreList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-score-del]');
  if (!btn) return;
  if (!confirm('确认删除这条成绩记录？删除后教师将无法查询到。')) return;
  try {
    const { error } = await cloud.database.rpc('admin_delete_score', { pwd: adminPwd, score_id: Number(btn.dataset.scoreDel) });
    if (error) throw new Error(error.message);
    toast('已删除');
    await loadScores();
  } catch (err) {
    toast(err.message || '删除失败', true);
  }
});
