const http = require('http');

const port = 8080;

async function handler(req, res) {
  console.log(`API: Serving ${req.url}`);

  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
    return;
  }

  // API endpoints will be added here
  res.writeHead(404);
  res.end('Not Found');
}

const server = http.createServer(handler);
server.listen(port, () => {
  console.log(`API server running at http://localhost:${port}/`);
});