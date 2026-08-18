// 删除 release 资产 + 上传新文件（删旧传新）
// 用法: node gh_replace.cjs <release_id> <asset_name> <file_path>
const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

const releaseId = process.argv[2];
const assetName = process.argv[3];
const filePath = process.argv[4];

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const line = out.split('\n').find(l => l.startsWith('password='));
  return line ? line.split('=').slice(1).join('=') : null;
}
const token = getToken();
const H = { 'Authorization': `token ${token}`, 'User-Agent': 'platinum-deploy', 'Accept': 'application/vnd.github+json' };

function apiReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ method, host: 'api.github.com', path, headers: H }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  // 1. 列出现有资产，找同名
  const list = await apiReq('GET', `/repos/jimsonhhs/platinum/releases/${releaseId}/assets`);
  const assets = JSON.parse(list.body);
  const target = assets.find(a => a.name === assetName);
  if (target) {
    console.log(`删除旧资产 ${assetName} (id=${target.id}, ${(target.size/1048576).toFixed(1)} MB)`);
    const del = await apiReq('DELETE', `/repos/jimsonhhs/platinum/releases/assets/${target.id}`);
    console.log('删除状态:', del.status);
  } else {
    console.log('无同名旧资产，直接上传');
  }

  // 2. 上传新文件（POST 到 uploads.github.com）
  const size = fs.statSync(filePath).size;
  const url = new URL(`https://uploads.github.com/repos/jimsonhhs/platinum/releases/${releaseId}/assets`);
  url.searchParams.set('name', assetName);
  console.log(`上传 ${assetName} (${(size/1048576).toFixed(1)} MB)...`);

  const up = await new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST', host: url.host, path: url.pathname + url.search,
      headers: { ...H, 'Content-Type': 'application/zip', 'Content-Length': size },
      timeout: 900000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    let sent = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', c => {
      sent += c.length;
      process.stdout.write(`\r  进度: ${(sent/size*100).toFixed(1)}% (${(sent/1048576).toFixed(1)}/${(size/1048576).toFixed(1)} MB)`);
    });
    stream.on('end', () => process.stdout.write('\n'));
    stream.pipe(req);
  });
  process.stdout.write('\n');
  if (up.status >= 200 && up.status < 300) {
    const a = JSON.parse(up.body);
    console.log(`✅ 上传成功: ${a.name} (${(a.size/1048576).toFixed(1)} MB)`);
  } else {
    console.log(`❌ 上传失败 ${up.status}: ${up.body.slice(0, 300)}`);
    process.exit(1);
  }
})();
