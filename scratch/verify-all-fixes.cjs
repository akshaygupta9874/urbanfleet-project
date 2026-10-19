const { authenticator } = require('otplib');
const http = require('http');

async function makeRequest(options, bodyData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function run() {
  console.log('--- 1. Testing Live 2FA Setup & Login Flow via Kong (http://localhost:3001) ---');
  
  // 1. Login with Admin credentials
  const loginRes = await makeRequest({
    hostname: 'localhost',
    port: 3001,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    email: 'admin@urbanfleet.com',
    password: 'Password@123',
  });

  console.log('Admin Login response status:', loginRes.status);
  console.log('Admin Login data:', JSON.stringify(loginRes.body.data || loginRes.body, null, 2));

  if (loginRes.body.data?.requiresTwoFactorSetup) {
    console.log('✓ Admin correctly requires 2FA setup!');
    const userId = loginRes.body.data.userId;
    const otpauthUri = loginRes.body.data.otpauthUri;
    console.log('OTP Auth URI received:', otpauthUri);

    // Extract secret from otpauthUri: otpauth://totp/UrbanFleet:admin@urbanfleet.com?secret=XXXXX
    const url = new URL(otpauthUri);
    const secret = url.searchParams.get('secret');
    console.log('Extracted TOTP secret for setup test:', secret ? '(Secret Present)' : 'MISSING');

    const totpCode = authenticator.generate(secret);
    console.log('Generated TOTP verification code:', totpCode);

    // 2. Submit OTP to /verify-otp with userId
    const verifyRes = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, {
      userId,
      code: totpCode,
    });

    console.log('Verify OTP response status:', verifyRes.status);
    console.log('Verify OTP response body:', JSON.stringify(verifyRes.body, null, 2));

    if (verifyRes.status === 200 && (verifyRes.body.accessToken || verifyRes.body.data?.accessToken)) {
      console.log('✓ Successfully activated 2FA and obtained access token!');
    } else {
      console.error('✗ 2FA Setup verification failed!');
    }

    // 3. Try logging in again - should now require 2FA challenge
    console.log('\n--- Testing Subsequent 2FA Challenge Flow ---');
    const challengeLoginRes = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, {
      email: 'admin@urbanfleet.com',
      password: 'Password@123',
    });

    console.log('Challenge Login status:', challengeLoginRes.status);
    console.log('Challenge Login data:', JSON.stringify(challengeLoginRes.body.data || challengeLoginRes.body, null, 2));

    if (challengeLoginRes.body.data?.requiresTwoFactor && challengeLoginRes.body.data?.challengeToken) {
      console.log('✓ Correctly issued 2FA challenge with challengeToken!');
      const challengeToken = challengeLoginRes.body.data.challengeToken;
      const nextCode = authenticator.generate(secret);

      const verifyChallengeRes = await makeRequest({
        hostname: 'localhost',
        port: 3001,
        path: '/api/auth/verify-otp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, {
        challengeToken,
        code: nextCode,
      });

      console.log('Challenge verify status:', verifyChallengeRes.status);
      console.log('Challenge verify body:', JSON.stringify(verifyChallengeRes.body, null, 2));
      if (verifyChallengeRes.status === 200 && (verifyChallengeRes.body.accessToken || verifyChallengeRes.body.data?.accessToken)) {
        console.log('✓ Successfully verified challengeToken and completed 2FA login!');
      } else {
        console.error('✗ Challenge verification failed!');
      }
    }
  } else if (loginRes.body.data?.requiresTwoFactor && loginRes.body.data?.challengeToken) {
    console.log('✓ 2FA already enabled, challengeToken received!');
  } else {
    console.log('Login result:', loginRes.body);
  }
}

run().catch(console.error);
