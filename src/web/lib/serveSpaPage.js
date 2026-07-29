'use strict';

const path = require('path');

// Serve um dos HTMLs buildados pelo Vite (web-client/dist/{page}.html).
function serveSpaPage(page) {
  const file = path.join(__dirname, '../../../web-client/dist', `${page}.html`);
  return (req, res) => res.sendFile(file);
}

module.exports = serveSpaPage;
