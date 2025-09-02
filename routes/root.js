const path = require('path');

function register(app) {
  app.get('/', (req, res) => {
    const rootDir = path.join(__dirname, '..');
    res.sendFile(path.join(rootDir, 'public', 'index.html'));
  });
}

module.exports = { register };

