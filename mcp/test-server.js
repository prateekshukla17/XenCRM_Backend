#!/usr/bin/env node

/**
 * Simple test script for XenCRM MCP Server
 * This script tests the server's basic functionality
 */

const { spawn } = require('child_process');
const path = require('path');

// Test messages to send to MCP server
const testMessages = [
  // List tools
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  },
  
  // Test add_customer tool
  {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'add_customer',
      arguments: {
        name: 'Test User',
        email: 'test@xencrm.com',
        total_spend: 1000,
        total_visits: 2
      }
    }
  }
];

async function testMCPServer() {
  console.log('🧪 Testing XenCRM MCP Server...\n');
  
  // Start the MCP server
  const serverPath = path.join(__dirname, 'build', 'index.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let responseCount = 0;
  
  // Handle server output
  server.stdout.on('data', (data) => {
    try {
      const response = JSON.parse(data.toString());
      console.log(`📥 Response ${response.id}:`, JSON.stringify(response, null, 2));
      responseCount++;
      
      if (responseCount >= testMessages.length) {
        console.log('\n✅ All tests completed successfully!');
        server.kill();
        process.exit(0);
      }
    } catch (e) {
      console.log('📄 Server output:', data.toString());
    }
  });
  
  // Handle server errors
  server.stderr.on('data', (data) => {
    console.log('⚠️  Server error:', data.toString());
  });
  
  // Handle server exit
  server.on('close', (code) => {
    console.log(`🛑 Server exited with code ${code}`);
    process.exit(code);
  });
  
  // Wait a moment for server to start
  setTimeout(() => {
    console.log('📤 Sending test messages...\n');
    
    // Send test messages
    testMessages.forEach((message, index) => {
      setTimeout(() => {
        console.log(`📤 Sending message ${message.id}:`, JSON.stringify(message, null, 2));
        server.stdin.write(JSON.stringify(message) + '\n');
      }, index * 1000);
    });
  }, 2000);
  
  // Timeout after 30 seconds
  setTimeout(() => {
    console.log('⏰ Test timeout reached');
    server.kill();
    process.exit(1);
  }, 30000);
}

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
  process.exit(1);
});

// Run the test
if (require.main === module) {
  testMCPServer();
}