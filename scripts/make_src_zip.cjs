// 重新打包 platinum-src.zip（工作树复制，忽略 robocopy 退出码）
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const repo = 'C:/Users/haoha/lobsterai/project/goink';
const zipPath = repo + '/platinum-src.zip';
const tmp2 = os.tmpdir() + '/srczip3_' + Date.now();
fs.mkdirSync(tmp2, { recursive: true });
try {
  execSync(`robocopy "${repo}" "${tmp2}" /E /XD build node_modules .git .cowork-temp /XF *.zip /NFL /NDL /NJH /NJS /NP`, { shell: 'cmd.exe', stdio: 'ignore' });
} catch (e) { /* robocopy exit 1 = copied, ok */ }
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${tmp2}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force"`, { stdio: 'ignore' });
console.log('打包完成 ->', zipPath, fs.statSync(zipPath).size, 'bytes');
fs.rmSync(tmp2, { recursive: true, force: true });
