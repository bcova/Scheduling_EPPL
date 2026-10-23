// Builds dev/preview.html: the real web app + the real Logic.gs + a fake server, so it runs in any browser.
//   node dev/build-preview.js   then open dev/preview.html?role=ys   (role = admin | as | ys | staff)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/Index.html'), 'utf8');
const logic = fs.readFileSync(path.join(root, 'src/Logic.gs'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, 'mock-server.js'), 'utf8');
if (!html.includes('<!--DEV_MOCK-->')) throw new Error('marker missing in Index.html');
fs.writeFileSync(path.join(__dirname, 'preview.html'), html.replace('<!--DEV_MOCK-->', '<script>\n' + logic + '\n' + mock + '\n</script>'));
console.log('Wrote dev/preview.html');
