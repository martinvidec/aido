const { fetch } = require('undici'); // oder import { fetch } from 'undici';

// Die JSON-RPC initialize Anfrage
const initializeRequest = {
  jsonrpc: "2.0",
  id: 123, // Eine beliebige ID für den Test
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {}, // Leere Capabilities für den Test
    clientInfo: {
      name: "check_proxy_script",
      version: "1.0.0"
    }
  }
};

(async () => {
  const targetUrl = 'http://localhost:3000/api/mcp/sse';
  console.log(`Attempting to POST to ${targetUrl} via proxy...`);

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(initializeRequest)
    });

    console.log('\n--- Response Received ---');
    console.log('Status:', response.status);

    console.log('\nResponse Headers:');
    for (const [key, value] of response.headers) {
      console.log(`  ${key}: ${value}`);
    }

    const responseBodyText = await response.text();
    console.log('\nResponse Body (Text):');
    console.log(responseBodyText);

    // Versuch, den Body als JSON zu parsen (optional, um den Fehler zu reproduzieren)
    try {
      const parsedJson = JSON.parse(responseBodyText);
      console.log('\nResponse Body (Parsed JSON):');
      console.log(JSON.stringify(parsedJson, null, 2));
    } catch (parseError) {
      console.error('\nError parsing response body as JSON:', parseError.message);
      if (responseBodyText.trim() === "") {
        console.error("The response body was empty or contained only whitespace.");
      }
    }

  } catch (error) {
    console.error('\nFetch error:', error);
  }
})();