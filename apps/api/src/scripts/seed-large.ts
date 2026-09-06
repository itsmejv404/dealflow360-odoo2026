import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { storageService } from '../lib/storage.js';
import { quotationsService } from '../modules/quotations/quotations.service.js';
import { billingService } from '../modules/billing/billing.service.js';

/**
 * seed-large.ts — volume demo dataset (does NOT touch seed.ts)
 *
 * Targets:
 *  - 3 organizations (5 role users each + 2 extra reps)
 *  - 100+ products total (37 per org)
 *  - 100+ customers total (36 per org)
 *  - 200+ quotations total (70 per org) created through the REAL services:
 *      quotationsService.createQuotation   → numbering, pricing, risk scoring
 *      billingService.confirmAndSplitOrder → invoices, subscriptions, schedules
 *  - 10+ warehouses total (4/3/3) with stock levels
 *  - Approval requests, negotiation comments/counter-proposals
 *  - Fulfillment plans, backorders + consolidation prompts
 *  - Deal Health alerts across all 3 alert types
 *
 * Run:  npx tsx src/scripts/seed-large.ts
 */

const PASSWORD = 'Password123!';
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// Deterministic PRNG (LCG) so re-runs produce identical data
let rngState = 42;
function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}

interface OrgSpec {
  name: string;
  slug: string;
  address: string;
  description: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  userDomain: string;
  people: string[];
  categories: Array<{
    name: string;
    code: string;
    description: string;
    productCount: number;
    priceRange: [number, number];
  }>;
  warehouses: Array<{ name: string; code: string; city: string; address: string }>;
  customerPool: string[];
  subscriptionCategoryCode: string;
}

const ORG_SPECS: OrgSpec[] = [
  {
    name: 'Nimbus Computing Systems',
    slug: 'nimbus',
    address: 'Cyber Towers, HITEC City, Madhapur, Hyderabad, Telangana 500081',
    description: 'Hybrid cloud infrastructure, edge computing appliances and managed platform services.',
    contactEmail: 'sales@nimbus.example.com',
    contactPhone: '+91 40 4567 8900',
    website: 'https://nimbus.example.com',
    userDomain: 'nimbus.example.com',
    people: [
      'Karthik Raman (Admin)',
      'Divya Nair (Senior Rep)',
      'Suresh Babu (Sales Director)',
      'Meera Krishnan (VP Finance)',
      'Ravi Teja (Fulfillment Lead)',
    ],
    categories: [
      { name: 'Edge Servers', code: 'edge_servers', description: 'Ruggedized edge compute nodes', productCount: 8, priceRange: [350000, 900000] },
      { name: 'Workstations', code: 'workstations', description: 'Professional desktop workstations', productCount: 7, priceRange: [90000, 260000] },
      { name: 'Displays', code: 'displays', description: 'Professional and control-room displays', productCount: 6, priceRange: [35000, 120000] },
      { name: 'Managed Cloud Subscription', code: 'managed_cloud_subscription', description: 'Recurring managed platform services', productCount: 6, priceRange: [18000, 320000] },
      { name: 'Support & Warranty', code: 'support_warranty', description: 'Extended coverage packages', productCount: 5, priceRange: [8000, 60000] },
      { name: 'Networking', code: 'networking', description: 'Switches, firewalls and access points', productCount: 5, priceRange: [45000, 320000] },
    ],
    warehouses: [
      { name: 'Nimbus Hyderabad Central Hub', code: 'WH-NMB-HYD', city: 'Hyderabad', address: 'Survey 64, HITEC City, Madhapur, Hyderabad 500081' },
      { name: 'Nimbus Chennai Coastal Depot', code: 'WH-NMB-MAA', city: 'Chennai', address: 'Ambattur Industrial Estate, Chennai 600058' },
      { name: 'Nimbus Ahmedabad West Hub', code: 'WH-NMB-AMD', city: 'Ahmedabad', address: 'GIDC Vatva, Ahmedabad, Gujarat 382445' },
      { name: 'Nimbus Kolkata Eastern Depot', code: 'WH-NMB-CCU', city: 'Kolkata', address: 'Salt Lake Sector V, Kolkata 700091' },
    ],
    customerPool: [
      'Vodafone Idea', 'Axis Bank', 'Zoho Corp', 'InMobi', 'Cred', 'Zenoti', 'Rapido', 'Ather Energy',
      'Ola Electric', 'Porter', 'Lenskart', 'Nykaa', 'Titan Company', 'Ashok Leyland', 'TVS Motor',
      'Godrej Interio', 'Blue Dart', 'FedEx India', 'Manipal Hospitals', 'Narayana Health',
      'Max Healthcare', 'PVR INOX', 'Sula Vineyards', 'Havells India', 'Voltas', 'Crompton Greaves',
      'Bajaj Electricals', 'Dabur India', 'Marico Ltd', 'Britannia', 'ITC Infotech', 'Mindtree',
      'Mphasis', 'L&T Infotech', 'Persistent Systems', 'Coforge',
    ],
    subscriptionCategoryCode: 'managed_cloud_subscription',
  },
  {
    name: 'Vertex Industrial Automation',
    slug: 'vertex',
    address: 'Peenya Industrial Area, 2nd Stage, Bengaluru, Karnataka 560058',
    description: 'Factory automation, robotics, industrial IoT sensors and service contracts.',
    contactEmail: 'sales@vertex.example.com',
    contactPhone: '+91 80 2345 6780',
    website: 'https://vertex.example.com',
    userDomain: 'vertex.example.com',
    people: [
      'Anil Kulkarni (Admin)',
      'Farhan Sheikh (Senior Rep)',
      'Latha Rao (Sales Director)',
      'Joseph Mathew (VP Finance)',
      'Deepa Menon (Fulfillment Lead)',
    ],
    categories: [
      { name: 'Industrial Robots', code: 'industrial_robots', description: '6-axis and SCARA robots', productCount: 7, priceRange: [800000, 2600000] },
      { name: 'PLC & Controllers', code: 'plc_controllers', description: 'Programmable logic controllers', productCount: 7, priceRange: [60000, 450000] },
      { name: 'IIoT Sensors', code: 'iiot_sensors', description: 'Vibration, thermal and vision sensors', productCount: 8, priceRange: [12000, 95000] },
      { name: 'AMC Contracts', code: 'amc_contracts', description: 'Annual maintenance contracts', productCount: 5, priceRange: [50000, 400000] },
      { name: 'Safety Systems', code: 'safety_systems', description: 'Light curtains and emergency stops', productCount: 5, priceRange: [40000, 280000] },
      { name: 'Conveyors', code: 'conveyors', description: 'Modular conveyor systems', productCount: 5, priceRange: [150000, 900000] },
    ],
    warehouses: [
      { name: 'Vertex Bengaluru Plant Store', code: 'WH-VTX-BLR', city: 'Bengaluru', address: 'Peenya 2nd Stage, Bengaluru 560058' },
      { name: 'Vertex Pune Auto Cluster', code: 'WH-VTX-PNQ', city: 'Pune', address: 'MIDC Chinchwad, Pune 411019' },
      { name: 'Vertex Lucknow North Depot', code: 'WH-VTX-LKO', city: 'Lucknow', address: 'Transport Nagar, Lucknow 226012' },
    ],
    customerPool: [
      'Tata Motors', 'Mahindra & Mahindra', 'Bharat Forge', 'Kirloskar Group', 'Cummins India',
      'Suzlon Energy', 'Hero MotoCorp', 'Bajaj Auto', 'Eicher Motors', 'Royal Enfield',
      'Sona Comstar', 'Schaeffler India', 'Timken India', 'Escorts Kubota', 'SML Isuzu',
      'VE Commercial', 'Tafe Tractors', 'JCB India', 'Daimler India', 'Maruti Suzuki',
      'Hindalco', 'Vedanta Ltd', 'UltraTech Cement', 'Shree Cement', 'Bharat Petroleum',
      'Indian Oil', 'Reliance Industries', 'Adani Ports', 'Larsen & Toubro', 'Punjab Tractors',
      'Force Motors', 'Isuzu Motors', 'Ashok Leyland Foundry', 'Sundram Fasteners', 'Rane Group',
      'Wheels India',
    ],
    subscriptionCategoryCode: 'amc_contracts',
  },
  {
    name: 'Meridian Life Sciences',
    slug: 'meridian',
    address: 'Bollaram Industrial Park, Sangareddy District, Hyderabad, Telangana 502325',
    description: 'Laboratory instrumentation, diagnostics platforms and compliance service programs.',
    contactEmail: 'sales@meridian.example.com',
    contactPhone: '+91 40 2309 4500',
    website: 'https://meridian.example.com',
    userDomain: 'meridian.example.com',
    people: [
      'Nandini Iyer (Admin)',
      'Arjun Pillai (Senior Rep)',
      'Sanjay Gupta (Sales Director)',
      'Rekha Pillai (VP Finance)',
      'Imran Khan (Fulfillment Lead)',
    ],
    categories: [
      { name: 'Analytical Instruments', code: 'analytical_instruments', description: 'HPLC, GC and spectrometers', productCount: 7, priceRange: [600000, 3500000] },
      { name: 'Lab Consumables', code: 'lab_consumables', description: 'Pipettes, plates and reagents', productCount: 9, priceRange: [4000, 45000] },
      { name: 'Centrifuges & Separation', code: 'centrifuges', description: 'Benchtop and floor centrifuges', productCount: 6, priceRange: [120000, 800000] },
      { name: 'Compliance Programs', code: 'compliance_programs', description: 'IQ/OQ/PQ validation and calibration', productCount: 5, priceRange: [35000, 250000] },
      { name: 'Cold Chain Equipment', code: 'cold_chain', description: 'Ultra-low freezers and refrigerators', productCount: 5, priceRange: [180000, 700000] },
      { name: 'Incubators & Ovens', code: 'incubators', description: 'CO2 incubators and drying ovens', productCount: 5, priceRange: [90000, 400000] },
    ],
    warehouses: [
      { name: 'Meridian Hyderabad Life Hub', code: 'WH-MRD-HYD', city: 'Hyderabad', address: 'Bollaram Industrial Park, Sangareddy 502325' },
      { name: 'Meridian Mumbai Western Depot', code: 'WH-MRD-BOM', city: 'Mumbai', address: 'Andheri East, Mumbai 400093' },
      { name: 'Meridian Coimbatore South Hub', code: 'WH-MRD-CJB', city: 'Coimbatore', address: 'Avinashi Road, Coimbatore 641014' },
    ],
    customerPool: [
      'Sun Pharma', 'Dr Reddys Labs', 'Cipla Ltd', 'Lupin Ltd', 'Aurobindo Pharma',
      'Zydus Lifesciences', 'Torrent Pharma', 'Glenmark', 'Biocon Ltd', 'Syngene Intl',
      'Serum Institute', 'Bharat Biotech', 'Panacea Biotec', 'Sanofi India', 'Abbott India',
      'USV Pvt Ltd', 'Alkem Labs', 'Mankind Pharma', 'Intas Pharma', 'Emcure',
      'Natco Pharma', 'Hetero Drugs', 'MSN Labs', 'Divis Labs', 'Neuland Labs',
      'Piramal Pharma', 'Jubilant Pharmova', 'Strides Pharma', 'Ajanta Pharma', 'Alembic Pharma',
      'Gland Pharma', 'Caplin Point', 'Suven Pharma', 'Aarti Drugs', 'FDC Ltd',
      'Unichem Labs',
    ],
    subscriptionCategoryCode: 'compliance_programs',
  },
];

async function main() {
  console.log('========================================');
  console.log('--- SEEDING DEALFLOW360 VOLUME DATASET ---');
  console.log('========================================\n');

  // Clean database (same wipe as seed.ts)
  await prisma.organization.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const logoBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  // Super admin
  await prisma.user.create({
    data: {
      email: 'superadmin@dealflow360.com',
      passwordHash: await bcrypt.hash('SuperAdminSecret123!', 10),
      name: 'Platform Super Admin',
      role: 'super_admin',
      status: 'active',
    },
  });

  let totalProducts = 0;
  let totalCustomers = 0;
  let totalQuotes = 0;
  let totalWarehouses = 0;

  for (const spec of ORG_SPECS) {
    console.log(`\n=== Org: ${spec.name} ===`);

    // ---- Organization ----
    const org = await prisma.organization.create({
      data: {
        name: spec.name,
        slug: spec.slug,
        status: 'active',
        address: spec.address,
        description: spec.description,
        contactEmail: spec.contactEmail,
        contactPhone: spec.contactPhone,
        website: spec.website,
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        onboardingCompleted: true,
        logoUrl: '/api/organization/logo?ext=png',
      },
    });
    await storageService.uploadTenantFile({ orgId: org.id, key: 'logo.png', buffer: logoBuffer, contentType: 'image/png' });

    // ---- Users: 5 roles + 2 extra reps ----
    const roles = ['org_admin', 'rep', 'manager', 'finance', 'ops'];
    const users: Record<string, any> = {};
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i] as string;
      users[role] = await prisma.user.create({
        data: {
          email: `${role}@${spec.userDomain}`,
          passwordHash,
          name: spec.people[i] as string,
          organizationId: org.id,
          role,
          status: 'active',
        },
      });
    }
    users.rep2 = await prisma.user.create({
      data: {
        email: `rep2@${spec.userDomain}`,
        passwordHash,
        name: `${spec.people[1]!.split(' ')[0]} Junior (Rep)`,
        organizationId: org.id,
        role: 'rep',
        status: 'active',
      },
    });
    users.rep3 = await prisma.user.create({
      data: {
        email: `rep3@${spec.userDomain}`,
        passwordHash,
        name: `Field Rep ${spec.people[1]!.split(' ')[0]}`,
        organizationId: org.id,
        role: 'rep',
        status: 'active',
      },
    });
    const reps = [users.rep, users.rep2, users.rep3];

    // ---- Governance config (same shape as seed.ts) ----
    await prisma.approvalChainConfig.create({
      data: {
        organizationId: org.id,
        managerThresholdPercent: 5.0,
        financeThresholdPercent: 15.0,
        requireFinanceAboveThreshold: true,
        autoApproveWithinCeilings: true,
      },
    });
    await prisma.shippingRuleConfig.create({
      data: {
        organizationId: org.id,
        allowSplitShipments: true,
        chargeForSplitShipments: false,
        deliveryExtensionDays: 3,
        notes: `Standard regional delivery; split shipments absorbed by ${spec.name}.`,
      },
    });

    // ---- Customer tiers ----
    const tierSilver = await prisma.customerTier.create({
      data: { organizationId: org.id, name: 'Silver Partner', code: 'silver', defaultDiscountPercent: 5.0 },
    });
    const tierGold = await prisma.customerTier.create({
      data: { organizationId: org.id, name: 'Gold Partner', code: 'gold', defaultDiscountPercent: 10.0 },
    });
    const tierPlatinum = await prisma.customerTier.create({
      data: { organizationId: org.id, name: 'Enterprise Platinum', code: 'platinum', defaultDiscountPercent: 18.0 },
    });
    const tiers = [tierSilver, tierGold, tierPlatinum];

    // ---- Categories + products + discount ceilings ----
    const products: Array<any & { isSubscription: boolean }> = [];
    let modelIdx = 0;
    for (const cat of spec.categories) {
      const category = await prisma.productCategory.create({
        data: { organizationId: org.id, name: cat.name, code: cat.code, description: cat.description },
      });
      for (let i = 1; i <= cat.productCount; i++) {
        modelIdx++;
        const [minP, maxP] = cat.priceRange;
        const price = Math.round(minP + rand() * (maxP - minP));
        const isSubscription = cat.code === spec.subscriptionCategoryCode;
        const product = await prisma.product.create({
          data: {
            organizationId: org.id,
            categoryId: category.id,
            name: `${spec.name.split(' ')[0]} ${cat.name.replace(/s$/, '')} ${String(modelIdx).padStart(3, '0')}${isSubscription ? ` — ${pick(['Standard', 'Advanced', 'Premium'])} tier` : ''}`,
            sku: `${spec.slug.toUpperCase().slice(0, 4)}-${cat.code.toUpperCase().replace(/_/g, '').slice(0, 6)}-${String(i).padStart(3, '0')}`,
            price,
            costPrice: Math.round(price * (isSubscription ? 0.3 : 0.68 + rand() * 0.1)),
            billingFrequency: isSubscription ? pick(['monthly', 'annual']) : 'one_time',
          },
        });
        products.push({ ...product, isSubscription });
      }
      await prisma.discountCeiling.createMany({
        data: [
          { organizationId: org.id, tierId: tierPlatinum.id, categoryId: category.id, maxDiscountPercent: 25.0 },
          { organizationId: org.id, tierId: tierGold.id, categoryId: category.id, maxDiscountPercent: 15.0 },
          { organizationId: org.id, tierId: tierSilver.id, categoryId: category.id, maxDiscountPercent: 8.0 },
        ],
      });
    }
    totalProducts += products.length;
    console.log(`  Products: ${products.length}`);

    // ---- Product affinities (upsell engine) — unique pairs only ----
    const hardware = products.filter((p) => !p.isSubscription);
    const subs = products.filter((p) => p.isSubscription);
    const affinityPairs = new Set<string>();
    let affinityAttempts = 0;
    while (affinityPairs.size < 8 && affinityAttempts < 100) {
      affinityAttempts++;
      const from = pick(hardware);
      const candidates = affinityPairs.size % 2 === 0 && subs.length ? subs : hardware.filter((h) => h.id !== from.id);
      if (!candidates.length) continue;
      const to = pick(candidates);
      const key = `${from.id}::${to.id}`;
      if (affinityPairs.has(key)) continue;
      affinityPairs.add(key);
      await prisma.productAffinity.create({
        data: {
          organizationId: org.id,
          productId: from.id,
          recommendedProductId: to.id,
          coPurchaseCount: randInt(12, 90),
          affinityScore: Number((0.5 + rand() * 0.45).toFixed(2)),
          recommendationReason: 'Frequently co-purchased in ' + spec.name + ' deployments.',
        },
      });
    }

    // ---- Warehouses + stock ----
    const warehouses: any[] = [];
    for (let wi = 0; wi < spec.warehouses.length; wi++) {
      const w = spec.warehouses[wi]!;
      warehouses.push(
        await prisma.warehouse.create({
          data: { organizationId: org.id, name: w.name, code: w.code, city: w.city, address: w.address, isDefault: wi === 0 },
        }),
      );
    }
    totalWarehouses += warehouses.length;

    const stockRows: any[] = [];
    for (const p of hardware) {
      for (const w of warehouses) {
        if (rand() < 0.75) {
          stockRows.push({ organizationId: org.id, warehouseId: w.id, productId: p.id, quantity: randInt(2, 60) });
        }
      }
    }
    await prisma.stockLevel.createMany({ data: stockRows });

    // ---- Customers (36 per org) ----
    const customers: any[] = [];
    for (let ci = 0; ci < 36; ci++) {
      const base = spec.customerPool[ci % spec.customerPool.length]!.trim();
      const name = ci < spec.customerPool.length ? base : `${base} ${pick(['East', 'West', 'North', 'South'])} Division`;
      const tier = pick(tiers);
      const emailLocal = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').slice(0, 20);
      customers.push(
        await prisma.customer.create({
          data: {
            organizationId: org.id,
            tierId: tier.id,
            name,
            email: `procure.${emailLocal}.${ci}@${spec.userDomain}` as string,
            company: `${name} Limited`,
            phone: `+91 ${randInt(20, 99)} ${randInt(4000, 9999)} ${randInt(1000, 9999)}`,
            address: `${randInt(1, 200)}, ${pick(['Industrial Area', 'Tech Park', 'Business District', 'SEZ Zone'])}, ${pick(['Bengaluru', 'Mumbai', 'Delhi', 'Chennai', 'Hyderabad', 'Pune'])}`,
          },
        }),
      );
    }
    totalCustomers += customers.length;
    console.log(`  Customers: ${customers.length}`);

    // ---- Quotations: 70 per org via the REAL service ----
    const statusPlan: string[] = [
      ...Array(7).fill('draft'),
      ...Array(11).fill('pending_approval'),
      ...Array(7).fill('approved'),
      ...Array(14).fill('sent'),
      ...Array(10).fill('negotiating'),
      ...Array(17).fill('confirmed'),
      ...Array(4).fill('rejected'),
    ];

    const orgQuotes: Array<{ quote: any; customer: any; rep: any; status: string }> = [];
    const statusAt = (i: number): string => statusPlan[i % statusPlan.length] as string;
    for (let qi = 0; qi < 70; qi++) {
      const customer = pick(customers);
      const rep = pick(reps);
      const status = statusAt(qi);

      const lineCount = randInt(2, 4);
      const chosenHw = [...new Set(Array.from({ length: lineCount }, () => pick(hardware)))];
      const lines: Array<{ productId: string; quantity: number; lineDiscountPercent: number }> = chosenHw.map((p) => ({
        productId: p.id,
        quantity: p.price > 600000 ? randInt(1, 4) : randInt(2, 25),
        lineDiscountPercent: Number((rand() * 8).toFixed(1)),
      }));
      if (rand() < 0.4 && subs.length) {
        const sub = pick(subs);
        lines.push({ productId: sub.id, quantity: randInt(1, 6), lineDiscountPercent: 0 });
      }

      const orderDiscountPercent =
        rand() < 0.75
          ? 0
          : Number((rand() * (customer.tierId === tierPlatinum.id ? 20 : customer.tierId === tierGold.id ? 12 : 6)).toFixed(1));

      let quote: any = null;
      try {
        quote = await quotationsService.createQuotation(org.id, rep.id, {
          customerId: customer.id,
          orderDiscountPercent,
          notes: `Volume-seed deal #${qi + 1} for ${customer.name}.`,
          lines,
        });
      } catch (err: any) {
        console.warn(`    quote ${qi + 1} skipped: ${err.message}`);
        continue;
      }
      if (!quote) continue;

      const update: any = {};
      if (status !== 'draft') update.status = status;
      if (rand() < 0.3) {
        update.updatedAt = daysAgo(randInt(6, 20));
        update.createdAt = daysAgo(randInt(25, 60));
      }
      if (Object.keys(update).length) {
        await prisma.quotation.update({ where: { id: quote.id }, data: update });
      }

      orgQuotes.push({ quote, customer, rep, status });
    }
    totalQuotes += orgQuotes.length;
    console.log(`  Quotations: ${orgQuotes.length}`);

    // ---- Billing via the REAL confirmAndSplitOrder for confirmed quotes ----
    const confirmed = orgQuotes.filter((q) => q.status === 'confirmed');
    let billingCount = 0;
    for (const q of confirmed) {
      try {
        const res = await billingService.confirmAndSplitOrder(org.id, q.quote.id);
        if (res.oneTimeInvoice && rand() < 0.6) {
          await prisma.invoice.update({
            where: { id: res.oneTimeInvoice.id },
            data: { status: 'paid', paidAt: daysAgo(randInt(1, 15)) },
          });
          await prisma.payment.create({
            data: {
              organizationId: org.id,
              invoiceId: res.oneTimeInvoice.id,
              amount: res.oneTimeInvoice.totalAmount,
              currency: 'INR',
              paymentMethod: pick(['bank_wire', 'credit_card', 'upi', 'cheque']),
              status: 'succeeded',
              transactionReference: `VOL-${spec.slug.toUpperCase()}-${randInt(1000000, 9999999)}`,
            },
          });
        }
        billingCount++;
      } catch (err: any) {
        console.warn(`    billing skipped for ${q.quote.quotationNumber}: ${err.message}`);
      }
    }
    console.log(`  Billing splits: ${billingCount}`);

    // ---- Fulfillment plans, backorders, consolidation prompts ----
    let planCount = 0;
    const fulfillmentCandidates = orgQuotes.filter((x) => x.status === 'approved' || x.status === 'confirmed').slice(0, 10);
    for (const q of fulfillmentCandidates) {
      const quoteLines = await prisma.quotationLine.findMany({ where: { quotationId: q.quote.id } });
      if (!quoteLines.length) continue;
      const accepted = rand() < 0.5;
      const plan = await prisma.fulfillmentPlan.create({
        data: {
          organizationId: org.id,
          quotationId: q.quote.id,
          status: accepted ? 'accepted' : 'proposed',
          shipmentCount: randInt(1, 3),
          deliveryExtendedDays: randInt(0, 5),
          acceptedById: accepted ? users.ops.id : null,
          acceptedAt: accepted ? daysAgo(randInt(1, 10)) : null,
          proposedAt: daysAgo(randInt(0, 9)),
        },
      });
      planCount++;

      const firstLine = quoteLines[0]!;
      const splits = randInt(1, 3);
      let remaining = firstLine.quantity;
      for (let ai = 0; ai < splits && remaining > 0; ai++) {
        const w = warehouses[ai % warehouses.length];
        const qty = ai === splits - 1 ? remaining : Math.max(1, Math.floor(remaining / 2));
        await prisma.fulfillmentLine.create({
          data: {
            organizationId: org.id,
            planId: plan.id,
            quotationLineId: firstLine.id,
            productId: firstLine.productId,
            warehouseId: w.id,
            quantity: qty,
          },
        });
        remaining -= qty;
      }
      if (remaining > 0) {
        const bo = await prisma.backorderItem.create({
          data: {
            organizationId: org.id,
            quotationId: q.quote.id,
            quotationLineId: firstLine.id,
            productId: firstLine.productId,
            planId: plan.id,
            quantity: remaining,
            status: 'pending',
            notes: 'Volume-seed backorder awaiting stock arrival.',
          },
        });
        await prisma.consolidationPrompt.create({
          data: {
            organizationId: org.id,
            quotationId: q.quote.id,
            backorderItemId: bo.id,
            warehouseId: pick(warehouses).id,
            productId: firstLine.productId,
            suggestedQty: remaining,
            status: 'pending',
          },
        });
      }
    }
    console.log(`  Fulfillment plans: ${planCount}`);

    // ---- Approval requests for pending_approval quotes ----
    for (const q of orgQuotes.filter((x) => x.status === 'pending_approval')) {
      const stage = rand() < 0.6 ? 'manager' : 'finance';
      await prisma.approvalRequest.create({
        data: {
          organizationId: org.id,
          quotationId: q.quote.id,
          stage,
          status: 'pending',
          assignedRole: stage,
          requestedById: q.rep.id,
          reason: 'Order discount requires review under the standard approval chain.',
        },
      });
    }

    // ---- Negotiation comments + counter proposals ----
    for (const q of orgQuotes.filter((x) => x.status === 'negotiating').slice(0, 8)) {
      await prisma.negotiationComment.createMany({
        data: [
          {
            organizationId: org.id,
            quotationId: q.quote.id,
            authorType: 'customer',
            authorName: `Sourcing Team (${q.customer.name})`,
            authorEmail: q.customer.email,
            body: 'Please review the commercial terms — we are looking for improved volume pricing.',
          },
          {
            organizationId: org.id,
            quotationId: q.quote.id,
            authorType: 'internal',
            authorId: q.rep.id,
            authorName: q.rep.name,
            authorEmail: q.rep.email,
            body: 'Internal review scheduled — bundling options being evaluated.',
          },
        ],
      });
      await prisma.counterProposal.create({
        data: {
          organizationId: org.id,
          quotationId: q.quote.id,
          proposedDiscountPercent: Number((rand() * 10 + 2).toFixed(1)),
          note: 'Customer counter-proposal requesting revised discount.',
          status: 'open',
          proposedByType: 'customer',
          proposedByName: 'Sourcing Team',
          proposedByEmail: q.customer.email,
        },
      });
    }

    // ---- Deal Health alerts (all 3 types, varied statuses) ----
    for (const q of orgQuotes.filter((x) => ['sent', 'negotiating', 'draft', 'pending_approval'].includes(x.status)).slice(0, 3)) {
      await prisma.dealHealthAlert.create({
        data: {
          organizationId: org.id,
          quotationId: q.quote.id,
          repId: q.rep.id,
          alertType: 'stalled_quote',
          severity: rand() < 0.5 ? 'high' : 'medium',
          title: `Quotation ${q.quote.quotationNumber} stalled`,
          detail: `No activity detected for an extended period on this ${q.status} quote for ${q.customer.name}.`,
          status: pick(['open', 'nudged', 'escalated']),
          metadata: { source: 'seed-large' },
          createdAt: daysAgo(randInt(1, 5)),
        },
      });
    }
    for (const q of orgQuotes.filter((x) => x.status === 'pending_approval' && Number(x.quote.orderDiscountPercent) > 0).slice(0, 2)) {
      await prisma.dealHealthAlert.create({
        data: {
          organizationId: org.id,
          quotationId: q.quote.id,
          repId: q.rep.id,
          alertType: 'discount_anomaly',
          severity: 'high',
          title: `Discount anomaly on ${q.quote.quotationNumber}`,
          detail: `Discount of ${Number(q.quote.orderDiscountPercent).toFixed(1)}% is significantly above the rep's historical average.`,
          status: pick(['open', 'escalated']),
          metadata: { source: 'seed-large', currentDiscountPercent: Number(q.quote.orderDiscountPercent) },
          createdAt: daysAgo(randInt(1, 4)),
        },
      });
    }
    const slippedPlans = await prisma.fulfillmentPlan.findMany({
      where: { organizationId: org.id, status: 'proposed' },
      take: 2,
      orderBy: { proposedAt: 'asc' },
    });
    for (const plan of slippedPlans) {
      await prisma.dealHealthAlert.create({
        data: {
          organizationId: org.id,
          quotationId: plan.quotationId,
          alertType: 'delivery_slippage',
          severity: 'medium',
          title: 'Fulfillment plan pending Ops acceptance',
          detail: 'Unaccepted fulfillment split is delaying delivery.',
          status: 'open',
          metadata: { planId: plan.id, source: 'seed-large' },
          createdAt: daysAgo(randInt(1, 3)),
        },
      });
    }
    console.log('  Deal Health alerts: seeded');
  }

  console.log('\n========================================');
  console.log('🎉 VOLUME SEED COMPLETED');
  console.log(`   Orgs: ${ORG_SPECS.length} (target >= 3)`);
  console.log(`   Products: ${totalProducts} (target >= 100)`);
  console.log(`   Customers: ${totalCustomers} (target >= 100)`);
  console.log(`   Quotations: ${totalQuotes} (target >= 200)`);
  console.log(`   Warehouses: ${totalWarehouses} (target >= 10)`);
  console.log('========================================\n');
}

if (process.argv[1]?.endsWith('seed-large.ts')) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Volume seeding failed:', err);
      process.exit(1);
    });
}
