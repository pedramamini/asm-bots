const http = require('http');
const fs = require('fs').promises;
const path = require('path');

const port = 8000;

async function handler(req, res) {
  console.log(`Serving ${req.url}`);

  try {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    // Serve index.html
    if (req.url === '/' || req.url === '/index.html') {
      const html = await fs.readFile('/app/src/web/index.html', 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(html);
      return;
    }

    // Serve app.js
    if (req.url === '/app.js') {
      const js = await fs.readFile('/app/src/web/app.js', 'utf8');
      res.setHeader('Content-Type', 'application/javascript');
      res.writeHead(200);
      res.end(js);
      return;
    }

    // 404 for everything else
    res.writeHead(404);
    res.end('Not Found');
  } catch (error) {
    console.error('Error handling request:', error);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
}

const server = http.createServer(handler);
server.listen(port, () => {
  console.log(`HTTP webserver running at http://localhost:${port}/`);
});