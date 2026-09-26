const http = require('node:http');

function startHealthServer() {
  const port = process.env.PORT || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('BØPE bot online');
    })
    .listen(port, () => console.log(`Health check ouvindo na porta ${port}`));
}

module.exports = { startHealthServer };
