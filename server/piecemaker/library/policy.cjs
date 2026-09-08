const fs = require('node:fs');
const path = require('node:path');

function libraryIsCentralized(userHome) {
  const home = process.env.PIECEMAKER_HOME || path.join(userHome, '.piecemaker');
  return fs.existsSync(path.join(home, 'library-backend', 'centralized.json'));
}

module.exports = { libraryIsCentralized };
