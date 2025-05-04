console.log("Testing Node.js setup");
const http = require('http');
console.log("HTTP module loaded");

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Hello World\n');
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});