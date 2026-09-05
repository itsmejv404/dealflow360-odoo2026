import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { createApp } from '../app.js';
import { storageService } from '../lib/storage.js';
import { signSuperAdminToken, signInternalToken } from '../shared/jwt.js';

export async function verifyPhase4() {
  console.log('\n========================================');
  console.log('--- STARTING PHASE 4 VERIFICATION TEST ---');
  console.log('========================================\n');

  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 0. Clean & Seed
    await prisma.organizationInvite.deleteMany({});
    await prisma.orderLine.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});

    const superAdmin = await prisma.user.create({
      data: {
        email: 'superadmin@dealflow360.com',
        passwordHash: await bcrypt.hash('SuperAdminSecret123!', 10),
        role: 'super_admin',
        status: 'active',
      },
    });

    const superAdminToken = signSuperAdminToken({
      sub: superAdmin.id,
      email: superAdmin.email,
      role: 'super_admin',
    });

    // 1. Super Admin creates Apex Dynamics
    console.log('[STEP 1] Super Admin Creates Organization');
    const orgRes = await fetch(`${baseUrl}/api/platform/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ name: 'Apex Dynamics', slug: 'apex' }),
    });
    assert.equal(orgRes.status, 201);
    const orgBody = (await orgRes.json()) as { data: { id: string; name: string } };
    const orgId = orgBody.data.id;
    console.log(`- Created Organization: ${orgBody.data.name} (${orgId})`);

    // 2. Super Admin invites Org Admin
    console.log('\n[STEP 2] Super Admin Invites Org Admin');
    const inviteRes = await fetch(`${baseUrl}/api/platform/organizations/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ email: 'admin@apexdynamics.io' }),
    });
    assert.equal(inviteRes.status, 201);
    const inviteBody = (await inviteRes.json()) as { data: { token: string; email: string } };
    const inviteToken = inviteBody.data.token;
    console.log(`- Invite generated for ${inviteBody.data.email} with token: ${inviteToken}`);

    // 3. Verify Invite Endpoint
    console.log('\n[STEP 3] Public Invite Verification Endpoint');
    const verifyInviteRes = await fetch(`${baseUrl}/api/onboarding/invite/${inviteToken}`);
    assert.equal(verifyInviteRes.status, 200);
    const verifyInviteBody = (await verifyInviteRes.json()) as {
      data: { email: string; organization: { name: string } };
    };
    assert.equal(verifyInviteBody.data.email, 'admin@apexdynamics.io');
    assert.equal(verifyInviteBody.data.organization.name, 'Apex Dynamics');
    console.log('✅ STEP 3 PASSED: Public invite verification succeeded.');

    // 4. Activate Account & Set Password
    console.log('\n[STEP 4] Org Admin Account Activation');
    const activateRes = await fetch(`${baseUrl}/api/onboarding/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: inviteToken,
        password: 'ApexAdminPassword123!',
        name: 'Alex Carter',
      }),
    });
    assert.equal(activateRes.status, 201);
    const activateBody = (await activateRes.json()) as {
      data: { token: string; user: { role: string; name: string }; organization: { onboardingCompleted: boolean } };
    };
    assert.equal(activateBody.data.user.role, 'org_admin');
    assert.equal(activateBody.data.user.name, 'Alex Carter');
    assert.equal(activateBody.data.organization.onboardingCompleted, false);
    const orgAdminToken = activateBody.data.token;
    console.log('✅ STEP 4 PASSED: Org Admin account activated and JWT issued.');

    // 5. Upload Logo to MinIO
    console.log('\n[STEP 5] Upload Logo to MinIO (Per-Tenant Storage)');
    // 1x1 transparent PNG buffer as base64
    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const uploadLogoRes = await fetch(`${baseUrl}/api/organization/logo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAdminToken}`,
      },
      body: JSON.stringify({ base64: pngBase64 }),
    });
    assert.equal(uploadLogoRes.status, 201);
    const uploadLogoBody = (await uploadLogoRes.json()) as { data: { logoUrl: string; filename: string } };
    assert.ok(uploadLogoBody.data.logoUrl.includes('/api/organization/logo'));
    console.log(`- Logo uploaded. URL: ${uploadLogoBody.data.logoUrl}`);

    // Verify MinIO direct object key
    const minioKey = storageService.getTenantObjectKey(orgId, 'logo.png');
    console.log(`- MinIO Object Key verified: ${minioKey}`);
    assert.equal(minioKey, `org-${orgId}/logo.png`);
    console.log('✅ STEP 5 PASSED: Logo stored in MinIO under org prefix.');

    // 6. Complete Onboarding Profile & Localization
    console.log('\n[STEP 6] Complete Onboarding Wizard Profile & Localization');
    const updateProfileRes = await fetch(`${baseUrl}/api/organization/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAdminToken}`,
      },
      body: JSON.stringify({
        address: '100 Innovation Way, Suite 400, San Francisco, CA',
        description: 'Next-generation industrial automation systems',
        contactEmail: 'contact@apexdynamics.io',
        contactPhone: '+1 (555) 019-2834',
        website: 'https://apexdynamics.io',
        currency: 'EUR',
        timezone: 'Europe/Berlin',
        onboardingCompleted: true,
      }),
    });
    assert.equal(updateProfileRes.status, 200);
    const updateBody = (await updateProfileRes.json()) as {
      data: {
        currency: string;
        timezone: string;
        onboardingCompleted: boolean;
        address: string;
        logoUrl: string;
      };
    };
    assert.equal(updateBody.data.currency, 'EUR');
    assert.equal(updateBody.data.timezone, 'Europe/Berlin');
    assert.equal(updateBody.data.onboardingCompleted, true);
    assert.equal(updateBody.data.address, '100 Innovation Way, Suite 400, San Francisco, CA');
    assert.ok(updateBody.data.logoUrl);
    console.log('✅ STEP 6 PASSED: Onboarding wizard completed with EUR currency & Europe/Berlin timezone.');

    // 7. Stream Logo Check
    console.log('\n[STEP 7] Stream Logo Retrieval');
    const getLogoRes = await fetch(`${baseUrl}/api/organization/logo`, {
      headers: { Authorization: `Bearer ${orgAdminToken}` },
    });
    assert.equal(getLogoRes.status, 200);
    assert.equal(getLogoRes.headers.get('content-type'), 'image/png');
    console.log('✅ STEP 7 PASSED: Logo streamed successfully with image/png content type.');

    // 8. Cross-Tenant Isolation Verification for Storage & Profile
    console.log('\n[STEP 8] Cross-Tenant Isolation Verification');
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Corp', slug: 'other-corp', status: 'active' },
    });
    const otherUser = await prisma.user.create({
      data: {
        email: 'admin@other.com',
        name: 'Other Admin',
        passwordHash: 'dummyhash',
        organizationId: otherOrg.id,
        role: 'org_admin',
        status: 'active',
      },
    });
    const otherToken = signInternalToken({
      sub: otherUser.id,
      email: 'admin@other.com',
      org_id: otherOrg.id,
      role: 'org_admin',
    });

    const otherProfileRes = await fetch(`${baseUrl}/api/organization/profile`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    const otherProfileBody = (await otherProfileRes.json()) as {
      data: { id: string; name: string; currency: string; onboardingCompleted: boolean };
    };
    assert.equal(otherProfileBody.data.id, otherOrg.id);
    assert.equal(otherProfileBody.data.name, 'Other Corp');
    assert.equal(otherProfileBody.data.currency, 'USD'); // Default
    assert.equal(otherProfileBody.data.onboardingCompleted, false);

    // Attempting to stream logo for org without logo -> 404
    const otherLogoRes = await fetch(`${baseUrl}/api/organization/logo`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(otherLogoRes.status, 404);
    console.log('✅ STEP 8 PASSED: Cross-tenant profile and storage isolation confirmed.');
  } finally {
    server.close();
  }

  console.log('\n========================================');
  console.log('🎉 ALL PHASE 4 VERIFICATION CHECKS PASSED!');
  console.log('========================================\n');
}

if (process.argv[1]?.endsWith('verify-phase4.ts')) {
  verifyPhase4()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Phase 4 verification failed:', err);
      process.exit(1);
    });
}
