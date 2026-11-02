/* SSO_TOKEN_CATCH：接收工作台「切换系统」跳转携带的令牌，写入本地登录态 */
try { const _ssoTk = new URLSearchParams(location.search).get('tk'); if (_ssoTk) { localStorage.setItem('zb_token', _ssoTk); history.replaceState(null, '', location.pathname + (location.hash || '')); } } catch (_) {}
/* ============================================================
   教培机构 · 教师资格认证报名平台
   ------------------------------------------------------------
   后端：WorkBuddy 云服务（云数据库 + 服务端审批函数）
   - 报名记录写入 registrations 表，默认状态「待审核」
   - 机构在 admin.html 后台审核（通过 / 拒绝并填写原因）
   - 教师在首页凭姓名 + 手机号查询审核进度
   迁移说明：已迁移至机构自建 VPS 后端（同源部署，endpoint 为空，
   路由前缀 /api/jz，详见 sdk-adapter.js）。
   ============================================================ */

'use strict';

/* ---------------- 云端配置（自建 VPS 同源部署，endpoint 为空即可） ---------------- */
const CONFIG = {
  endpoint: '',
  app: 'jz',
  table: 'registrations',
  maxFiles: 3,
  maxFileSize: 10 * 1024 * 1024, // 原文件 10MB 上限
  maxPdfSize: 4 * 1024 * 1024,   // PDF 入库 4MB 上限
  acceptTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  imageMaxSide: 1600,
  imageQuality: 0.82,
};

const cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: CONFIG.endpoint,
  app: CONFIG.app,
});

/* ---------------- 认证级别（依据《教培教师资格证考核大纲》） ---------------- */
const STAGES = [
  {
    id: '初级教师资格证',
    num: '壹',
    name: '初级教师资格证',
    tag: '启蒙级 · 正姿与笔画',
    access: '机构全体在职教学教师均可申报',
    courses: ['正姿控笔启蒙班', '笔画入门启蒙班', '笔画进阶筑基班', '笔画精修强化班'],
    requirements: [
      '熟练书写数字与拼音',
      '熟练掌握正姿八课教学内容',
      '熟练书写启蒙阶段与基础阶段的全部笔画与例字',
      '熟练运用笔画分析法与独体字分析法',
    ],
  },
  {
    id: '中级教师资格证',
    num: '贰',
    name: '中级教师资格证',
    tag: '筑基级 · 独体字与偏旁',
    access: '机构全体在职教学教师均可申报',
    courses: ['正姿控笔启蒙班', '笔画入门启蒙班', '笔画进阶筑基班', '笔画精修强化班', '独体字结构精进班', '偏旁部首入门班'],
    requirements: [
      '熟练书写提高阶段及以下各阶段的笔画、偏旁与例字',
      '熟练运用田字格、作文格书写',
      '熟练运用笔画分析法、独体字分析法与左右结构分析法',
    ],
  },
  {
    id: '高级教师资格证',
    num: '叁',
    name: '高级教师资格证',
    tag: '精进级 · 复合字与字根',
    access: '机构全体在职教学教师均可申报',
    courses: ['正姿控笔启蒙班', '笔画入门启蒙班', '笔画进阶筑基班', '笔画精修强化班', '独体字结构精进班', '偏旁部首入门班', '偏旁部首强化班', '复合字结构入门班', '复合字结构精进班', '字根体系入门班', '字根体系强化班'],
    requirements: [
      '熟练书写进阶阶段及以下各阶段的笔画、偏旁与例字',
      '熟练运用田字格、作文格、横线格书写',
      '熟练运用笔画分析法、独体字分析法及全部复合字分析法',
    ],
  },
  {
    id: '特级教师资格证',
    num: '肆',
    name: '特级教师资格证',
    tag: '卓越级 · 楷书快写',
    access: '须持有教师资格证',
    courses: ['正姿控笔启蒙班', '笔画入门启蒙班', '笔画进阶筑基班', '笔画精修强化班', '独体字结构精进班', '偏旁部首入门班', '偏旁部首强化班', '复合字结构入门班', '复合字结构精进班', '字根体系入门班', '字根体系强化班', '楷书快写入门班', '楷书快写强化班', '语文同步书写提分班'],
    requirements: [
      '熟练书写全阶段笔画、偏旁与例字',
      '熟练运用田字格、作文格、横线格进行整篇书写',
      '熟练运用笔画分析法、独体字分析法及全部复合字分析法',
      '熟练运用楷书快写技巧',
    ],
  },
  {
    id: '特级·创作级（行楷与临古创作）',
    num: '伍',
    name: '特级·创作级',
    tag: '创作级 · 行楷与临古创作',
    access: '须持有国家教育部印发教师资格证，及省级及以上入展证书 3 张以上',
    courses: ['行楷与临古创作班'],
    requirements: ['能够进行小楷、行楷创作与临摹'],
  },
];

/* ---------------- 全局状态 ---------------- */
const state = {
  name: '',
  phone: '',
  stage: '',
  files: [],
};

/* ---------------- 工具 ---------------- */
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

function showError(inputId, msg) {
  const err = document.querySelector(`.field-error[data-for="${inputId}"]`);
  if (err) err.textContent = msg || '';
  const input = document.getElementById(inputId);
  if (input) input.closest('.field')?.classList.toggle('has-error', Boolean(msg));
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const validators = {
  name: (v) => (v.trim().length >= 2 ? '' : '请输入至少 2 个字的姓名'),
  phone: (v) => (/^1[3-9]\d{9}$/.test(v.trim()) ? '' : '请输入正确的 11 位手机号码'),
  bio: (v) => (v.trim().length >= 10 ? '' : '资历说明不少于 10 字'),
};

/* ---------------- 屏幕切换 ---------------- */
const STEP_OF = {
  'screen-login': 1,
  'screen-stage': 2,
  'screen-form': 3,
  'screen-success': 4,
};

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('is-show', s.id === id));
  const current = STEP_OF[id];
  $$('.step').forEach((s) => {
    const n = Number(s.dataset.step);
    s.classList.toggle('is-active', n === current);
    s.classList.toggle('is-done', n < current);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- 屏 1 · 姓名 + 手机登录 ---------------- */
$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#loginName').value;
  const phone = $('#loginPhone').value;

  const nameErr = validators.name(name);
  const phoneErr = validators.phone(phone);
  showError('loginName', nameErr);
  showError('loginPhone', phoneErr);
  if (nameErr || phoneErr) return;

  state.name = name.trim();
  state.phone = phone.trim();

  $('#helloName').textContent = `${state.name}老师`;
  $('#fName').value = state.name;
  $('#fPhone').value = state.phone;
  showScreen('screen-stage');
});

/* ---------------- 屏 1 · 报名进度查询 ---------------- */
$('#queryToggle').addEventListener('click', () => {
  $('#loginForm').classList.add('is-hidden');
  $('#queryForm').classList.remove('is-hidden');
});
$('#queryBack').addEventListener('click', () => {
  $('#queryForm').classList.add('is-hidden');
  $('#loginForm').classList.remove('is-hidden');
});

$('#queryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#queryName').value;
  const phone = $('#queryPhone').value;

  const nameErr = validators.name(name);
  const phoneErr = validators.phone(phone);
  showError('queryName', nameErr);
  showError('queryPhone', phoneErr);
  if (nameErr || phoneErr) return;

  const queryBtn = $('#queryBtn');
  queryBtn.disabled = true;
  queryBtn.textContent = '查询中…';

  try {
    const [regRes, scoreRes] = await Promise.all([
      cloud.database.rpc('check_registration_status', { p_name: name.trim(), p_phone: phone.trim() }),
      cloud.database.rpc('check_score', { p_name: name.trim(), p_phone: phone.trim() }),
    ]);
    if (regRes.error) throw new Error('查询失败，请稍后重试');

    const regs = Array.isArray(regRes.data) ? regRes.data : [];
    const scores = scoreRes.error ? [] : (Array.isArray(scoreRes.data) ? scoreRes.data : []);
    const box = $('#queryResult');
    box.classList.remove('is-hidden');

    if (!regs.length && !scores.length) {
      box.innerHTML = `<p class="query-empty">未查询到报名记录，请核对姓名与手机号是否与报名时一致。</p>`;
      return;
    }

    let html = '';

    // 报名审核进度
    if (regs.length) {
      const r = regs[0];
      const statusClass = r.status === '已通过' ? 'status-pass' : r.status === '已拒绝' ? 'status-reject' : 'status-pending';
      const noteHtml = r.status === '已拒绝' && r.review_note
        ? `<div><span>拒绝原因</span><b>${escapeHtml(r.review_note)}</b></div>`
        : '';
      html += `
        <p class="query-section-title">报名审核进度</p>
        <div class="success-meta">
          <div><span>报名编号</span><b>${escapeHtml(r.reg_no)}</b></div>
          <div><span>申报级别</span><b>${escapeHtml(r.stage)}</b></div>
          <div><span>审核状态</span><b class="${statusClass}">${escapeHtml(r.status)}</b></div>
          ${noteHtml}
        </div>
        <p class="form-note">${r.status === '待审核' ? '机构正在审核中，请耐心等待教务通知。' : r.status === '已通过' ? '恭喜您已通过报名审核，请留意考核安排通知。' : '如有疑问请联系机构教务老师核实后重新报名。'}</p>
      `;
    }

    // 考核成绩（一位教师可能有多段成绩，按级别逐条列出）
    html += `<p class="query-section-title">考核成绩</p>`;
    if (scores.length) {
      scores.forEach((s) => {
        const resultClass = s.result === '通过' ? 'status-pass' : s.result === '未通过' ? 'status-reject' : 'status-pending';
        html += `
          <div class="success-meta score-item">
            ${s.level ? `<div><span>考核级别</span><b>${escapeHtml(s.level)}</b></div>` : ''}
            ${s.score !== null && s.score !== undefined ? `<div><span>考核分数</span><b>${escapeHtml(s.score)}</b></div>` : ''}
            <div><span>考核结果</span><b class="${resultClass}">${escapeHtml(s.result)}</b></div>
            ${s.exam_batch ? `<div><span>考核批次</span><b>${escapeHtml(s.exam_batch)}</b></div>` : ''}
            ${s.remark ? `<div><span>备注</span><b>${escapeHtml(s.remark)}</b></div>` : ''}
          </div>
        `;
      });
      const allPassed = scores.every((s) => s.result === '通过');
      html += `<p class="form-note">${allPassed ? '恭喜您通过考核，机构将为您办理内部教师资格认证。' : '各阶段成绩以机构教务通知为准，如有疑问请联系教务老师。'}</p>`;
    } else {
      html += `<p class="query-empty">考核成绩暂未发布，请考核结束后再来查询。</p>`;
    }

    box.innerHTML = html;
  } catch (err) {
    toast(err.message || '网络异常，请稍后重试', true);
  } finally {
    queryBtn.disabled = false;
    queryBtn.textContent = '查询进度与成绩';
  }
});

/* ---------------- 屏 2 · 级别选择（按考核大纲渲染） ---------------- */
function renderStageGrid() {
  const grid = $('#stageGrid');
  grid.innerHTML = '';
  STAGES.forEach((s) => {
    const card = document.createElement('article');
    card.className = 'stage-card';
    card.dataset.stage = s.id;
    card.innerHTML = `
      <span class="stage-num">${s.num}</span>
      <h3>${s.name}</h3>
      <p class="stage-tag">${s.tag}</p>
      <div class="stage-divider"></div>
      <p class="stage-access"><b>准入条件</b>${s.access}</p>
      <p class="stage-courses">覆盖课程 ${s.courses.length} 门</p>
      <details class="stage-details">
        <summary>课程范围与考核要求</summary>
        <p class="stage-sub">覆盖课程</p>
        <ul>${s.courses.map((c) => `<li>${c}</li>`).join('')}</ul>
        <p class="stage-sub">考核要求</p>
        <ul>${s.requirements.map((r) => `<li>${r}</li>`).join('')}</ul>
      </details>
      <span class="stage-cta">选择此级别<span class="stage-arrow">→</span></span>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.stage-details')) return; // 展开详情不触发选择
      selectStage(s);
    });
    grid.appendChild(card);
  });
}

function selectStage(s) {
  state.stage = s.id;
  $('#chosenStage').textContent = `「${s.name}」`;
  $('#stageInfo').innerHTML = `
    <div class="stage-info-head">
      <b>${s.name}</b><span>${s.tag}</span>
    </div>
    <p><b>准入条件：</b>${s.access}</p>
    <p><b>覆盖课程（${s.courses.length} 门）：</b>${s.courses.join('、')}</p>
    <p><b>考核要求：</b>${s.requirements.join('；')}</p>
  `;
  showScreen('screen-form');
}

renderStageGrid();

$$('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

/* ---------------- 屏 3 · 文件选择 ---------------- */
const uploadBox = $('#uploadBox');
const fileInput = $('#fFiles');
const uploadList = $('#uploadList');
const uploadEmpty = $('#uploadEmpty');

uploadBox.addEventListener('click', () => fileInput.click());

['dragover', 'dragleave', 'drop'].forEach((evt) => {
  uploadBox.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadBox.classList.toggle('is-drag', evt === 'dragover');
    if (evt === 'drop') addFiles(e.dataTransfer.files);
  });
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

function addFiles(fileList) {
  showError('fFiles', '');
  for (const file of fileList) {
    if (state.files.length >= CONFIG.maxFiles) {
      showError('fFiles', `最多上传 ${CONFIG.maxFiles} 个文件`);
      break;
    }
    if (!CONFIG.acceptTypes.includes(file.type)) {
      showError('fFiles', `「${file.name}」格式不支持，仅接受 JPG / PNG / PDF`);
      continue;
    }
    if (file.size > CONFIG.maxFileSize) {
      showError('fFiles', `「${file.name}」超过 10MB，请压缩后再上传`);
      continue;
    }
    state.files.push(file);
  }
  renderFileList();
}

function renderFileList() {
  uploadEmpty.style.display = state.files.length ? 'none' : '';
  uploadList.innerHTML = '';
  state.files.forEach((file, idx) => {
    const li = document.createElement('li');
    const isPdf = file.type === 'application/pdf';
    li.innerHTML = `
      <span class="file-badge ${isPdf ? 'is-pdf' : ''}">${isPdf ? 'PDF' : '图片'}</span>
      <span class="file-name" title=""></span>
      <span class="file-size">${(file.size / 1024 / 1024).toFixed(2)} MB</span>
      <button type="button" class="file-remove" aria-label="移除文件">×</button>
    `;
    li.querySelector('.file-name').textContent = file.name;
    li.querySelector('.file-name').title = file.name;
    li.querySelector('.file-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      state.files.splice(idx, 1);
      renderFileList();
    });
    uploadList.appendChild(li);
  });
}

/* ---------------- 屏 3 · 资历字数统计 ---------------- */
$('#fBio').addEventListener('input', (e) => {
  $('#bioCount').textContent = e.target.value.trim().length;
});

/* ---------------- 附件处理：图片压缩 + Base64 编码 ---------------- */
function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = dataUrl;
  });
}

// 图片统一压缩为 JPEG（最长边 1600px），PDF 原样编码
async function encodeAttachment(file) {
  if (file.type === 'application/pdf') {
    if (file.size > CONFIG.maxPdfSize) {
      throw new Error(`PDF「${file.name}」超过 4MB，请压缩后再上传`);
    }
    return { name: file.name, type: file.type, dataUrl: await readAsDataURL(file) };
  }

  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, CONFIG.imageMaxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    name: file.name.replace(/\.(png)$/i, '.jpg'),
    type: 'image/jpeg',
    dataUrl: canvas.toDataURL('image/jpeg', CONFIG.imageQuality),
  };
}

/* ---------------- 屏 3 · 提交报名（默认进入待审核） ---------------- */
$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = $('#fName').value;
  const phone = $('#fPhone').value;
  const hasCert = document.querySelector('input[name="hasCert"]:checked')?.value || '';
  const bio = $('#fBio').value;

  const nameErr = validators.name(name);
  const phoneErr = validators.phone(phone);
  const bioErr = validators.bio(bio);
  showError('fName', nameErr);
  showError('fPhone', phoneErr);
  showError('fBio', bioErr);
  showError('certGroup', hasCert ? '' : '请选择是否已持有教师资格证');
  if (nameErr || phoneErr || bioErr || !hasCert) {
    toast('请完善表单中标红的必填项', true);
    return;
  }

  const submitBtn = $('#submitBtn');
  submitBtn.disabled = true;

  try {
    // 1. 处理附件（图片压缩、PDF 编码）
    const attachments = [];
    for (let i = 0; i < state.files.length; i += 1) {
      submitBtn.textContent = `正在处理附件 ${i + 1}/${state.files.length}…`;
      attachments.push(await encodeAttachment(state.files[i]));
    }

    // 2. 生成报名编号并写入云端报名记录（status 默认「待审核」）
    submitBtn.textContent = '正在提交报名…';
    const regNo = `ZX${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')}`;
    const { error } = await cloud.database
      .from(CONFIG.table)
      .insert({
        reg_no: regNo,
        name: name.trim(),
        phone: phone.trim(),
        stage: state.stage,
        has_cert: hasCert,
        bio: bio.trim(),
        attachments,
      });

    if (error) throw new Error(error.message || '报名提交失败，请稍后重试');

    // 3. 成功反馈
    $('#successName').textContent = `${name.trim()}老师`;
    $('#successStage').textContent = `「${state.stage}」`;
    $('#successNo').textContent = regNo;
    $('#successPhone').textContent = phone.trim();
    $('#successFiles').textContent = attachments.length ? `已上传 ${attachments.length} 个` : '未上传';
    showScreen('screen-success');
  } catch (err) {
    toast(err.message || '网络异常，请稍后重试', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '提交报名 <span class="btn-arrow">→</span>';
  }
});

/* ---------------- 屏 4 · 再报一位 ---------------- */
$('#againBtn').addEventListener('click', () => {
  state.name = '';
  state.phone = '';
  state.stage = '';
  state.files = [];
  renderFileList();
  $('#loginForm').reset();
  $('#signupForm').reset();
  $('#queryForm').reset();
  $('#queryResult').classList.add('is-hidden');
  $('#queryForm').classList.add('is-hidden');
  $('#loginForm').classList.remove('is-hidden');
  $('#bioCount').textContent = '0';
  showScreen('screen-login');
});
