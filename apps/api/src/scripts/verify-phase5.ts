import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { createApp } from '../app.js';
import { verifyJwt, type InternalJwtPayload } from '../shared/jwt.js';

export async function verifyPhase5() {
  console.log('\n========================================');
  console.log('--- STARTING PHASE 5 VERIFICATION TEST ---');
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

    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Create Acme Org
    const acme = await prisma.organization.create({
      data: {
        name: 'Acme Corp',
        slug: 'acme',
        status: 'active',
        currency: 'USD',
        timezone: 'America/New_York',
        onboardingCompleted: true,
      },
    });

    // Create Globex Org
    const globex = await prisma.organization.create({
      data: {
        name: 'Globex Corporation',
        slug: 'globex',
        status: 'active',
        currency: 'EUR',
        timezone: 'Europe/Berlin',
        onboardingCompleted: true,
      },
    });

    // Seed 5 roles for Acme
    const acmeUsers = {
      admin: await prisma.user.create({
        data: { email: 'admin@acme.com', name: 'Alice Admin', passwordHash, role: 'org_admin', organizationId: acme.id, status: 'active' },
      }),
      rep: await prisma.user.create({
        data: { email: 'rep@acme.com', name: 'Robert Rep', passwordHash, role: 'rep', organizationId: acme.id, status: 'active' },
      }),
      manager: await prisma.user.create({
        data: { email: 'manager@acme.com', name: 'Marcus Manager', passwordHash, role: 'manager', organizationId: acme.id, status: 'active' },
      }),
      finance: await prisma.user.create({
        data: { email: 'finance@acme.com', name: 'Fiona Finance', passwordHash, role: 'finance', organizationId: acme.id, status: 'active' },
      }),
      ops: await prisma.user.create({
        data: { email: 'ops@acme.com', name: 'Oliver Ops', passwordHash, role: 'ops', organizationId: acme.id, status: 'active' },
      }),
      suspended: await prisma.user.create({
        data: { email: 'suspended@acme.com', name: 'Sam Suspended', passwordHash, role: 'rep', organizationId: acme.id, status: 'suspended' },
      }),
    };

    // Seed Globex Admin & Rep
    const globexUsers = {
      admin: await prisma.user.create({
        data: { email: 'admin@globex.com', name: 'Gerd Admin', passwordHash, role: 'org_admin', organizationId: globex.id, status: 'active' },
      }),
      rep: await prisma.user.create({
        data: { email: 'rep@globex.com', name: 'Rachel Rep', passwordHash, role: 'rep', organizationId: globex.id, status: 'active' },
      }),
    };

    // 1. Test Login & JWT Scope for All 5 Roles in Acme
    console.log('[STEP 1] Login & JWT Scope Verification for All 5 Internal Roles');
    const roles: (keyof typeof acmeUsers)[] = ['admin', 'rep', 'manager', 'finance', 'ops'];
    const tokens: Record<string, string> = {};

    for (const r of roles) {
      const u = acmeUsers[r];
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: 'Password123!' }),
      });
      assert.equal(res.status, 200, `Login for ${u.email} should return 200`);
      const body = (await res.json()) as { data: { token: string; user: { role: string }; organization: { id: string } } };
      tokens[r] = body.data.token;

      // Verify JWT Claims
      const decoded = verifyJwt<InternalJwtPayload>(body.data.token);
      assert.equal(decoded.sub, u.id);
      assert.equal(decoded.email, u.email);
      assert.equal(decoded.org_id, acme.id);
      assert.equal(decoded.role, u.role);
      console.log(`  ✔ Role '${u.role}' (${u.email}) authenticated with verified tenant claim org_id=${decoded.org_id}`);
    }
    console.log('✅ STEP 1 PASSED: All 5 roles successfully log in with strictly scoped JWT tokens.');

    // 2. Test RBAC Route Guards on User Management API
    console.log('\n[STEP 2] RBAC Route Guards on User Management API');
    // Admin accesses /api/users -> 200 OK
    const adminUsersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${tokens.admin}` },
    });
    assert.equal(adminUsersRes.status, 200, 'Org Admin must have access to /api/users');
    const adminUsersBody = (await adminUsersRes.json()) as { data: { users: unknown[] } };
    assert.ok(adminUsersBody.data.users.length >= 5, 'Org Admin should see all org users');
    console.log('  ✔ Org Admin authorized to read user list.');

    // Rep, Manager, Finance, Ops trying to access /api/users -> 403 Forbidden
    for (const nonAdminRole of ['rep', 'manager', 'finance', 'ops']) {
      const nonAdminRes = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${tokens[nonAdminRole]}` },
      });
      assert.equal(nonAdminRes.status, 403, `Role '${nonAdminRole}' must receive 403 Forbidden on /api/users`);
      console.log(`  ✔ Role '${nonAdminRole}' blocked from user management with 403 Forbidden.`);
    }
    console.log('✅ STEP 2 PASSED: RBAC guards strictly restrict user management to org_admin.');

    // 3. Test Team Member Invitation & Activation Flow
    console.log('\n[STEP 3] Team Member Invitation & Role Activation Flow');
    const inviteRes = await fetch(`${baseUrl}/api/users/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.admin}`,
      },
      body: JSON.stringify({
        email: 'newhire@acme.com',
        role: 'finance',
        name: 'New Finance Analyst',
      }),
    });
    assert.equal(inviteRes.status, 201, 'Invite creation must return 201');
    const inviteBody = (await inviteRes.json()) as { data: { token: string; email: string; role: string } };
    assert.equal(inviteBody.data.email, 'newhire@acme.com');
    assert.equal(inviteBody.data.role, 'finance');
    const inviteToken = inviteBody.data.token;
    console.log(`  ✔ Invited new user with token: ${inviteToken}`);

    // Activate the invited user
    const activateRes = await fetch(`${baseUrl}/api/onboarding/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: inviteToken,
        password: 'NewUserPassword123!',
        name: 'New Finance Analyst',
      }),
    });
    assert.equal(activateRes.status, 201, 'Account activation must return 201');
    const activateBody = (await activateRes.json()) as { data: { user: { role: string; email: string } } };
    assert.equal(activateBody.data.user.role, 'finance');

    // Verify the newly activated user can log in
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'newhire@acme.com', password: 'NewUserPassword123!' }),
    });
    assert.equal(newLoginRes.status, 200);
    console.log('✅ STEP 3 PASSED: Team member invite & activation flow completed successfully.');

    // 4. Test User Deactivation & Immediate Revocation
    console.log('\n[STEP 4] User Status Toggle & Active Session Revocation');
    // Deactivate Acme Rep
    const deactivateRes = await fetch(`${baseUrl}/api/users/${acmeUsers.rep.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.admin}`,
      },
      body: JSON.stringify({ status: 'suspended' }),
    });
    assert.equal(deactivateRes.status, 200);

    // 4a. Login attempt by suspended user must fail with 403
    const repLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rep@acme.com', password: 'Password123!' }),
    });
    assert.equal(repLoginRes.status, 403, 'Suspended user login must be rejected with 403');
    console.log('  ✔ Suspended user login rejected with 403.');

    // 4b. Replaying existing token for deactivated user on authenticated route must fail with 403
    const repMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.rep}` },
    });
    assert.equal(repMeRes.status, 403, 'Deactivated user token must be rejected with 403 on middleware check');
    console.log('  ✔ In-flight token for suspended user rejected with 403.');

    // Reactivate Acme Rep
    await fetch(`${baseUrl}/api/users/${acmeUsers.rep.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.admin}`,
      },
      body: JSON.stringify({ status: 'active' }),
    });
    console.log('✅ STEP 4 PASSED: User suspension and active session validation verified.');

    // 5. Test Self-Deactivation Prevention
    console.log('\n[STEP 5] Self-Deactivation Protection');
    const selfDeactivateRes = await fetch(`${baseUrl}/api/users/${acmeUsers.admin.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.admin}`,
      },
      body: JSON.stringify({ status: 'suspended' }),
    });
    assert.equal(selfDeactivateRes.status, 400, 'Self deactivation must return 400');
    console.log('✅ STEP 5 PASSED: Org Admin cannot deactivate their own account.');

    // 6. Test Cross-Tenant User Management Isolation
    console.log('\n[STEP 6] Cross-Tenant User Management Isolation');
    // Acme Admin attempting to modify Globex user status -> 404 (not in org)
    const crossStatusRes = await fetch(`${baseUrl}/api/users/${globexUsers.rep.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.admin}`,
      },
      body: JSON.stringify({ status: 'suspended' }),
    });
    assert.equal(crossStatusRes.status, 404, 'Modifying user from another org must return 404 Not Found');

    // Globex Admin logs in and verifies their user list only has Globex users
    const globexLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@globex.com', password: 'Password123!' }),
    });
    assert.equal(globexLoginRes.status, 200);
    const globexToken = ((await globexLoginRes.json()) as { data: { token: string } }).data.token;

    const globexUsersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${globexToken}` },
    });
    const globexUsersList = (await globexUsersRes.json()) as { data: { users: { email: string }[] } };
    assert.ok(globexUsersList.data.users.every((u) => u.email.endsWith('@globex.com')), 'Globex admin must only see Globex users');
    console.log('✅ STEP 6 PASSED: Cross-tenant user management isolation strictly enforced.');

    // 7. Test Organization-Level Suspension
    console.log('\n[STEP 7] Organization Suspension Blocks All Tenant Access');
    await prisma.organization.update({
      where: { id: acme.id },
      data: { status: 'suspended' },
    });

    const suspendedOrgLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@acme.com', password: 'Password123!' }),
    });
    assert.equal(suspendedOrgLoginRes.status, 403, 'Login to suspended org must return 403');

    const suspendedOrgTokenRes = await fetch(`${baseUrl}/api/organization/profile`, {
      headers: { Authorization: `Bearer ${tokens.admin}` },
    });
    assert.equal(suspendedOrgTokenRes.status, 403, 'Token request against suspended org must return 403');

    // Verify Globex is unaffected
    const unnaffectedRes = await fetch(`${baseUrl}/api/organization/profile`, {
      headers: { Authorization: `Bearer ${globexToken}` },
    });
    assert.equal(unnaffectedRes.status, 200, 'Active org Globex must remain operational');
    console.log('✅ STEP 7 PASSED: Org suspension locks out all users while other tenants remain fully operational.');

  } finally {
    server.close();
  }

  console.log('\n========================================');
  console.log('🎉 ALL PHASE 5 VERIFICATION CHECKS PASSED!');
  console.log('========================================\n');
}

if (process.argv[1]?.endsWith('verify-phase5.ts')) {
  verifyPhase5()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Phase 5 verification failed:', err);
      process.exit(1);
    });
}
