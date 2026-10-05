const fs = require('fs');

async function testConcurrency() {
  const url = 'https://ai-advisor-olive.vercel.app/api/me';
  console.log(`Sending 10 concurrent requests to ${url}...`);

  const requests = Array.from({ length: 10 }).map((_, i) => 
    fetch(url).then(r => r.json()).then(data => ({ id: i, data }))
  );

  const results = await Promise.all(requests);
  
  // Since we aren't sending cookies, we expect "not authenticated" for all of them.
  // But we want to ensure the server doesn't crash or return 500s under parallel load.
  const successCount = results.filter(r => r.data && r.data.error === 'not authenticated').length;
  
  console.log(`Results: ${successCount}/10 requests returned expected 401 Not Authenticated gracefully without crashing.`);
  
  if (successCount === 10) {
    console.log('✅ Server handles concurrent requests flawlessly.');
  } else {
    console.log('❌ Some requests failed or returned unexpected results:', results);
  }
}

testConcurrency().catch(console.error);
