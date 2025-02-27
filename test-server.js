import { spawn } from 'child_process';

// Start the server process
const serverProcess = spawn('node', ['build/index.js']);

// Log server's stderr (for debugging)
serverProcess.stderr.on('data', (data) => {
  console.error(`Server log: ${data.toString().trim()}`);
});

// Test requests to run
const requests = [
  // List available tools
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'mcp.listTools',
    params: {}
  },
  
  // Test the ping tool
  {
    jsonrpc: '2.0',
    id: 2,
    method: 'mcp.callTool',
    params: {
      name: 'ping',
      arguments: {}
    }
  },
  
  // Test the search tool
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'mcp.callTool',
    params: {
      name: 'search',
      arguments: {
        query: 'What is blockchain?'
      }
    }
  },
  
  // Test the agent tool
  {
    jsonrpc: '2.0',
    id: 4,
    method: 'mcp.callTool',
    params: {
      name: 'agent',
      arguments: {
        prompt: 'Tell me about Ethereum'
      }
    }
  },
  
  // List available resources (should show cached searches)
  {
    jsonrpc: '2.0',
    id: 5,
    method: 'mcp.listResources',
    params: {}
  }
];

// Send each request with a delay between them
let requestIndex = 0;

function sendNextRequest() {
  if (requestIndex < requests.length) {
    const request = requests[requestIndex];
    console.log(`\n\nSending request ${requestIndex + 1}:`, JSON.stringify(request, null, 2));
    
    // Write the request to the server's stdin
    serverProcess.stdin.write(JSON.stringify(request) + '\n');
    requestIndex++;
  } else {
    // Clean up when all requests are processed
    console.log("\n\nAll tests complete!");
    setTimeout(() => {
      serverProcess.kill();
      process.exit(0);
    }, 1000);
  }
}

// Buffer for collecting partial responses
let responseBuffer = '';

// Listen for responses from the server
serverProcess.stdout.on('data', (data) => {
  try {
    // Add new data to buffer
    responseBuffer += data.toString();
    
    // Try to parse as JSON
    try {
      const response = JSON.parse(responseBuffer);
      console.log("Received response:", JSON.stringify(response, null, 2));
      
      // Clear buffer for next response
      responseBuffer = '';
      
      // Send the next request after a delay
      setTimeout(sendNextRequest, 2000);
    } catch (e) {
      // If it's not valid JSON yet, wait for more data
      // This handles partial data reads
    }
  } catch (e) {
    console.error("Error handling response:", e);
    console.error("Raw response:", data.toString());
  }
});

// Start sending requests
console.log("Starting MCP server tests...");
sendNextRequest();

// Handle process termination
process.on('SIGINT', () => {
  console.log('Interrupting test...');
  serverProcess.kill();
  process.exit(0);
});