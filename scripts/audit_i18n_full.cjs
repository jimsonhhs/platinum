// i18n 审计增强版：全量扫描前端 t() 引用，自动检查键是否存在（zh+en）。
// 用法：node scripts/audit_i18n_full.cjs
// 检查项：
//   1. 所有 t('xxx.yyy') 引用键在 zh-CN.json 和 en.json 都存在（防"中文界面显示英文键名"）
//   2. 预设敏感键（保持原有检查）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'frontend', 'src');
const zh = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'locales', 'zh-CN.json'), 'utf-8'));
const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'locales', 'en.json'), 'utf-8'));

function hasKey(obj, k) {
  const parts = k.split('.');
  let o = obj;
  for (const p of parts) {
    if (!o || typeof o !== 'object' || o[p] === undefined) return false;
    o = o[p];
  }
  return true;
}

// 收集所有 t('...') 引用
const files = [];
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(f) && !f.endsWith('.test.tsx') && !f.endsWith('.test.ts')) files.push(p);
  }
}
walk(root);

const missingZh = new Map(); // key -> [files]
const missingEn = new Map();
const re = /\bt\('([^']+)'\)/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf-8');
  let m;
  while ((m = re.exec(src))) {
    const key = m[1];
    // 跳过动态键（模板字符串内联在 t() 里，如 t(`sidebar.${x}`)）
    if (key.includes('${') || key.includes('_desc')) continue;
    // 跳过误匹配：数组解构 t [x, setX] / 事件名 / CSS 选择器 / 特殊值
    if (key.includes(']') || key.startsWith('sandbox:') || key.startsWith('app:') || key.startsWith('platinum:')
      || /^[\/\\n-]$/.test(key) || key === '\\n' || ['mermaid', 'pre', 'code', 'mark', 'foreshadowing', 'delete', 'save', '/'].includes(key)) continue;
    if (!hasKey(zh, key)) {
      if (!missingZh.has(key)) missingZh.set(key, []);
      missingZh.get(key).push(path.relative(root, f));
    }
    if (!hasKey(en, key)) {
      if (!missingEn.has(key)) missingEn.set(key, []);
      missingEn.get(key).push(path.relative(root, f));
    }
  }
}

let err = 0;
if (missingZh.size) {
  err++;
  console.log('❌ zh-CN.json 缺失的引用键：');
  for (const [k, fs_] of missingZh) console.log(`  ${k}  ← ${fs_.join(', ')}`);
}
if (missingEn.size) {
  err++;
  console.log('❌ en.json 缺失的引用键：');
  for (const [k, fs_] of missingEn) console.log(`  ${k}  ← ${fs_.join(', ')}`);
}

// 原有预设检查
const checks = [
  ['trash', ['selectAll', 'selectNone', 'selectedCount', 'purgeSelected', 'purging', 'confirmPurgeSelected', 'globalSkill', 'noPreview']],
  ['settings', ['archiveInterval', 'archiveIntervalDesc', 'archiveIntervalUnit', 'saveDataDir', 'dataDirHint']],
  ['sidebar', ['maintainRemindTitle', 'maintainRemindBody', 'maintainNow', 'remindLater', 'maintainFiles', 'userOutline', 'novelSettings']],
  ['content', ['bodyOutline', 'userOutline', 'noUserOutline', 'reference']],
  ['shell', ['trash', 'archive', 'novelSettings']],
  ['archive', ['title', 'hint', 'createNow', 'creating', 'empty', 'restoreAll', 'restore', 'confirmRestoreFile', 'confirmRestoreAll', 'restoredCount', 'filesCount', 'loading', 'noFiles']],
  ['chat', ['writer', 'writing']],
];
for (const [sec, keys] of checks) {
  for (const k of keys) {
    if (!zh[sec] || zh[sec][k] === undefined) { err++; console.log(`❌ zh.${sec}.${k} 缺失`); }
    if (!en[sec] || en[sec][k] === undefined) { err++; console.log(`❌ en.${sec}.${k} 缺失`); }
  }
}

console.log(err ? `\n共 ${err} 类问题` : '✅ ALL PRESENT');
process.exit(err ? 1 : 0);
