import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { storageService } from '../lib/storage.js';
import { signSuperAdminToken } from '../shared/jwt.js';
import { quotationsService } from '../modules/quotations/quotations.service.js';
import { billingService } from '../modules/billing/billing.service.js';

export async function seedAll() {
  console.log('========================================');
  console.log('--- SEEDING DEALFLOW360 (INR / IST) ---');
  console.log('========================================\n');

  // 1. Clean Database
  await prisma.organization.deleteMany({});
  await prisma.user.deleteMany({});

  // 2. Super Admin Account
  const superAdminPassword = 'SuperAdminSecret123!';
  const superAdminHash = await bcrypt.hash(superAdminPassword, 10);
  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin@dealflow360.com',
      passwordHash: superAdminHash,
      name: 'Platform Super Admin',
      role: 'super_admin',
      status: 'active',
    },
  });

  signSuperAdminToken({
    sub: superAdmin.id,
    email: superAdmin.email,
    role: 'super_admin',
  });
  console.log('✔ Seeded Super Admin: superadmin@dealflow360.com');

  const defaultPasswordHash = await bcrypt.hash('Password123!', 10);
  const sampleLogoBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  // =========================================================================
  // 3. ORGANIZATION 1: DELL TECHNOLOGIES INDIA
  // =========================================================================
  console.log('\n--- Seeding Dell Technologies India ---');
  const dell = await prisma.organization.create({
    data: {
      name: 'Dell Technologies India',
      slug: 'dell',
      status: 'active',
      address: 'Dell Technologies Hall, Divyasree Greens, Inner Ring Road, Domlur, Bengaluru, Karnataka 560071',
      description: 'Premier enterprise computing, high-density server infrastructure, client solutions, and mission-critical support services.',
      contactEmail: 'enterprise-sales@dell.com',
      contactPhone: '+91 (80) 4000-8000',
      website: 'https://www.dell.com/en-in',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      onboardingCompleted: true,
      logoUrl: '/api/organization/logo?ext=png',
    },
  });

  await storageService.uploadTenantFile({
    orgId: dell.id,
    key: 'logo.png',
    buffer: sampleLogoBuffer,
    contentType: 'image/png',
  });

  // Dell Users (All 5 Roles)
  const dellUsers = [
    { email: 'admin@dell.com', name: 'Aarav Sharma (Admin)', role: 'org_admin' },
    { email: 'rep@dell.com', name: 'Rohan Mehta (Senior Enterprise Rep)', role: 'rep' },
    { email: 'manager@dell.com', name: 'Priya Sundaram (Sales Director)', role: 'manager' },
    { email: 'finance@dell.com', name: 'Vikram Singhania (VP Finance)', role: 'finance' },
    { email: 'ops@dell.com', name: 'Ananya Deshmukh (Supply Chain Lead)', role: 'ops' },
  ];
  const seededDellUsers: Record<string, any> = {};
  for (const u of dellUsers) {
    seededDellUsers[u.role] = await prisma.user.create({
      data: {
        email: u.email,
        passwordHash: defaultPasswordHash,
        name: u.name,
        organizationId: dell.id,
        role: u.role,
        status: 'active',
      },
    });
  }

  // Dell Approval Rules
  await prisma.approvalChainConfig.create({
    data: {
      organizationId: dell.id,
      managerThresholdPercent: 5.0,
      financeThresholdPercent: 15.0,
      requireFinanceAboveThreshold: true,
      autoApproveWithinCeilings: true,
    },
  });

  // Dell Shipping Rules
  await prisma.shippingRuleConfig.create({
    data: {
      organizationId: dell.id,
      allowSplitShipments: true,
      chargeForSplitShipments: false,
      deliveryExtensionDays: 3,
      notes: 'Standard pan-India enterprise delivery. Multi-hub split shipments absorbed by Dell.',
    },
  });

  // Dell Customer Tiers
  const dellTierSilver = await prisma.customerTier.create({
    data: { organizationId: dell.id, name: 'Silver Partner', code: 'silver', defaultDiscountPercent: 5.0 },
  });
  const dellTierGold = await prisma.customerTier.create({
    data: { organizationId: dell.id, name: 'Gold Tech Partner', code: 'gold', defaultDiscountPercent: 10.0 },
  });
  const dellTierPlatinum = await prisma.customerTier.create({
    data: { organizationId: dell.id, name: 'Enterprise Platinum', code: 'platinum', defaultDiscountPercent: 18.0 },
  });

  // Dell Product Categories
  const dellCatLaptops = await prisma.productCategory.create({
    data: { organizationId: dell.id, name: 'Laptops', code: 'laptops', description: 'Latitude & Precision enterprise laptops' },
  });
  const dellCatAIO = await prisma.productCategory.create({
    data: { organizationId: dell.id, name: 'All in One Desktop', code: 'all_in_one_desktop', description: 'OptiPlex commercial all-in-one workstations' },
  });
  const dellCatMonitors = await prisma.productCategory.create({
    data: { organizationId: dell.id, name: 'Monitors', code: 'monitors', description: 'UltraSharp USB-C Hub & PremierColor 4K displays' },
  });
  const dellCatServers = await prisma.productCategory.create({
    data: { organizationId: dell.id, name: 'Servers', code: 'servers', description: 'PowerEdge rack and dual-socket enterprise servers' },
  });
  const dellCatSub = await prisma.productCategory.create({
    data: { organizationId: dell.id, name: 'Server Maintenance Subscription', code: 'server_maintenance_subscription', description: '24/7 ProSupport Plus Mission Critical SLAs' },
  });
  const dellCatWarranty = await prisma.productCategory.create({
    data: { organizationId: dell.id, name: 'Extended Warranty', code: 'extended_warranty', description: 'Extended hardware coverage and accidental damage protection' },
  });

  // Dell Discount Ceilings
  await prisma.discountCeiling.createMany({
    data: [
      { organizationId: dell.id, tierId: dellTierPlatinum.id, categoryId: dellCatServers.id, maxDiscountPercent: 25.0 },
      { organizationId: dell.id, tierId: dellTierPlatinum.id, categoryId: dellCatLaptops.id, maxDiscountPercent: 20.0 },
      { organizationId: dell.id, tierId: dellTierPlatinum.id, categoryId: dellCatMonitors.id, maxDiscountPercent: 15.0 },
      { organizationId: dell.id, tierId: dellTierGold.id, categoryId: dellCatServers.id, maxDiscountPercent: 15.0 },
      { organizationId: dell.id, tierId: dellTierGold.id, categoryId: dellCatLaptops.id, maxDiscountPercent: 12.0 },
      { organizationId: dell.id, tierId: dellTierSilver.id, categoryId: dellCatServers.id, maxDiscountPercent: 8.0 },
    ],
  });

  // Dell Products
  const pDellLap1 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatLaptops.id,
      name: 'Dell Latitude 7440 Ultralight Laptop (i7, 32GB, 1TB SSD)',
      sku: 'DELL-LAT-7440',
      price: 145000.0,
      costPrice: 105000.0,
      billingFrequency: 'one_time',
      maxDiscountPercent: 20.0,
    },
  });
  const pDellLap2 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatLaptops.id,
      name: 'Dell Precision 5680 Mobile Workstation (RTX 4000 Ada, 64GB)',
      sku: 'DELL-PREC-5680',
      price: 285000.0,
      costPrice: 210000.0,
      billingFrequency: 'one_time',
      maxDiscountPercent: 22.0,
    },
  });
  const pDellAio1 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatAIO.id,
      name: 'Dell OptiPlex 7420 All-in-One 24" (i5, 16GB, 512GB SSD)',
      sku: 'DELL-OPT-7420',
      price: 98000.0,
      costPrice: 72000.0,
      billingFrequency: 'one_time',
    },
  });
  const pDellMon1 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatMonitors.id,
      name: 'Dell UltraSharp 32 4K USB-C Hub Monitor (U3223QE)',
      sku: 'DELL-MON-U3223',
      price: 76500.0,
      costPrice: 54000.0,
      billingFrequency: 'one_time',
    },
  });
  const pDellMon2 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatMonitors.id,
      name: 'Dell UltraSharp 27 4K PremierColor Monitor (U2723QE)',
      sku: 'DELL-MON-U2723',
      price: 52000.0,
      costPrice: 38000.0,
      billingFrequency: 'one_time',
    },
  });
  const pDellSrv1 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatServers.id,
      name: 'Dell PowerEdge R760 Rack Server (2x Xeon Gold, 256GB, 8x 3.84TB NVMe)',
      sku: 'DELL-SRV-R760',
      price: 850000.0,
      costPrice: 620000.0,
      billingFrequency: 'one_time',
      maxDiscountPercent: 25.0,
    },
  });
  const pDellSrv2 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatServers.id,
      name: 'Dell PowerEdge R660 Dual-Socket Dense Server (128GB, 4x 1.92TB SSD)',
      sku: 'DELL-SRV-R660',
      price: 620000.0,
      costPrice: 460000.0,
      billingFrequency: 'one_time',
      maxDiscountPercent: 20.0,
    },
  });
  const pDellSub1 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatSub.id,
      name: 'Dell PowerEdge 24/7 ProSupport Plus Mission Critical SLA',
      sku: 'DELL-SUB-PROSUPP',
      price: 45000.0,
      costPrice: 12000.0,
      billingFrequency: 'monthly',
    },
  });
  const pDellSub2 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatSub.id,
      name: 'Dell Enterprise Server Platinum Annual Maintenance (AMC)',
      sku: 'DELL-AMC-PLATINUM',
      price: 480000.0,
      costPrice: 150000.0,
      billingFrequency: 'annual',
    },
  });
  const pDellWar1 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatWarranty.id,
      name: 'Dell ProSupport 3-Year Extended Hardware Onsite Warranty',
      sku: 'DELL-EXT-WAR3Y',
      price: 24000.0,
      costPrice: 8000.0,
      billingFrequency: 'one_time',
    },
  });
  const pDellWar2 = await prisma.product.create({
    data: {
      organizationId: dell.id,
      categoryId: dellCatWarranty.id,
      name: 'Dell Accidental Damage Protection 3-Year Coverage',
      sku: 'DELL-ACC-DMG3Y',
      price: 12500.0,
      costPrice: 4000.0,
      billingFrequency: 'one_time',
    },
  });

  // Dell Product Affinities
  await prisma.productAffinity.createMany({
    data: [
      {
        organizationId: dell.id,
        productId: pDellSrv1.id,
        recommendedProductId: pDellSub1.id,
        coPurchaseCount: 68,
        affinityScore: 0.92,
        recommendationReason: 'Attached to 92% of PowerEdge enterprise deployments.',
      },
      {
        organizationId: dell.id,
        productId: pDellLap1.id,
        recommendedProductId: pDellMon2.id,
        coPurchaseCount: 54,
        affinityScore: 0.78,
        recommendationReason: 'Standard modern workstation dual-screen package.',
      },
      {
        organizationId: dell.id,
        productId: pDellLap1.id,
        recommendedProductId: pDellWar1.id,
        coPurchaseCount: 45,
        affinityScore: 0.81,
        recommendationReason: 'Frequently chosen by enterprise procurement for laptop fleets.',
      },
    ],
  });

  // Dell Multiple Warehouses
  const dellWhBlr = await prisma.warehouse.create({
    data: {
      organizationId: dell.id,
      name: 'Dell Bengaluru Central Depot',
      code: 'WH-DELL-BLR',
      city: 'Bengaluru',
      address: 'Domlur Industrial Area, Bengaluru, Karnataka 560071',
      isDefault: true,
    },
  });
  const dellWhBom = await prisma.warehouse.create({
    data: {
      organizationId: dell.id,
      name: 'Dell Navi Mumbai Distribution Center',
      code: 'WH-DELL-BOM',
      city: 'Navi Mumbai',
      address: 'Taloja MIDC Industrial Area, Navi Mumbai, Maharashtra 410208',
      isDefault: false,
    },
  });
  const dellWhMaa = await prisma.warehouse.create({
    data: {
      organizationId: dell.id,
      name: 'Dell Chennai Southern Hub',
      code: 'WH-DELL-MAA',
      city: 'Sriperumbudur',
      address: 'SIPCOT Industrial Park, Sriperumbudur, Tamil Nadu 602105',
      isDefault: false,
    },
  });

  // Dell Stock Levels
  await prisma.stockLevel.createMany({
    data: [
      { organizationId: dell.id, warehouseId: dellWhBlr.id, productId: pDellLap1.id, quantity: 45 },
      { organizationId: dell.id, warehouseId: dellWhBom.id, productId: pDellLap1.id, quantity: 25 },
      { organizationId: dell.id, warehouseId: dellWhMaa.id, productId: pDellLap1.id, quantity: 30 },

      { organizationId: dell.id, warehouseId: dellWhBlr.id, productId: pDellLap2.id, quantity: 18 },
      { organizationId: dell.id, warehouseId: dellWhBom.id, productId: pDellLap2.id, quantity: 12 },

      { organizationId: dell.id, warehouseId: dellWhBlr.id, productId: pDellAio1.id, quantity: 35 },
      { organizationId: dell.id, warehouseId: dellWhBom.id, productId: pDellAio1.id, quantity: 20 },

      { organizationId: dell.id, warehouseId: dellWhBlr.id, productId: pDellMon1.id, quantity: 40 },
      { organizationId: dell.id, warehouseId: dellWhBom.id, productId: pDellMon2.id, quantity: 60 },
      { organizationId: dell.id, warehouseId: dellWhMaa.id, productId: pDellMon2.id, quantity: 30 },

      // Strategic inventory split for servers
      { organizationId: dell.id, warehouseId: dellWhBlr.id, productId: pDellSrv1.id, quantity: 6 },
      { organizationId: dell.id, warehouseId: dellWhBom.id, productId: pDellSrv1.id, quantity: 4 },
      { organizationId: dell.id, warehouseId: dellWhMaa.id, productId: pDellSrv1.id, quantity: 2 },

      { organizationId: dell.id, warehouseId: dellWhBlr.id, productId: pDellSrv2.id, quantity: 10 },
      { organizationId: dell.id, warehouseId: dellWhBom.id, productId: pDellSrv2.id, quantity: 8 },
    ],
  });

  // Dell 10 Indian Customers
  const dellCustomersData = [
    { name: 'Infosys Technologies Ltd', email: 'procurement@infosys.com', company: 'Infosys Limited', phone: '+91 80 2852 0261', address: 'Electronics City, Hosur Road, Bengaluru, Karnataka 560100', tierId: dellTierPlatinum.id },
    { name: 'Tata Consultancy Services', email: 'it-purchasing@tcs.com', company: 'Tata Consultancy Services Ltd', phone: '+91 22 6778 9999', address: 'TCS House, Raveline Street, Fort, Mumbai, Maharashtra 400001', tierId: dellTierPlatinum.id },
    { name: 'Zerodha Broking Ltd', email: 'infra-procure@zerodha.com', company: 'Zerodha Broking Limited', phone: '+91 80 4718 1888', address: '153/154, 4th Cross, Dollars Colony, JP Nagar 4th Phase, Bengaluru 560078', tierId: dellTierGold.id },
    { name: 'Flipkart Internet Pvt Ltd', email: 'vendor-desk@flipkart.com', company: 'Flipkart Internet Private Limited', phone: '+91 80 6798 1111', address: 'Buildings Alyssa, Begonia & Clover, Embassy Tech Village, Outer Ring Road, Bengaluru 560103', tierId: dellTierPlatinum.id },
    { name: 'Swiggy Bundl Technologies', email: 'it-equip@swiggy.in', company: 'Bundl Technologies Pvt Ltd', phone: '+91 80 6746 6777', address: 'Tower D, IBC Knowledge Park, Bannerghatta Main Rd, Bengaluru 560029', tierId: dellTierGold.id },
    { name: 'HDFC Bank IT Infrastructure', email: 'itinfra.vendor@hdfcbank.com', company: 'HDFC Bank Limited', phone: '+91 22 6652 1000', address: 'HDFC Bank House, Senapati Bapat Marg, Lower Parel, Mumbai 400013', tierId: dellTierPlatinum.id },
    { name: 'Razorpay Software Pvt Ltd', email: 'devices@razorpay.com', company: 'Razorpay Software Private Limited', phone: '+91 80 4666 9555', address: '1st Floor, SJR Cyber, 22 Laskar-Hosur Road, Adugodi, Bengaluru 560030', tierId: dellTierGold.id },
    { name: 'Wipro Technologies', email: 'it-sourcing@wipro.com', company: 'Wipro Limited', phone: '+91 80 2844 0011', address: 'Doddakannelli, Sarjapur Road, Bengaluru 560035', tierId: dellTierSilver.id },
    { name: 'Freshworks Technologies', email: 'procurement@freshworks.com', company: 'Freshworks Technologies India', phone: '+91 44 6667 8000', address: 'Global Infocity Park, MGR Salai, Kandancavadi, Perungudi, Chennai 600096', tierId: dellTierGold.id },
    { name: 'Delhivery Logistics Ltd', email: 'supplychain-it@delhivery.com', company: 'Delhivery Limited', phone: '+91 124 6719 500', address: 'Plot 5, Sector 44, Gurugram, Haryana 122002', tierId: dellTierSilver.id },
  ];

  const seededDellCustomers: any[] = [];
  for (const c of dellCustomersData) {
    const cust = await prisma.customer.create({
      data: {
        organizationId: dell.id,
        tierId: c.tierId,
        name: c.name,
        email: c.email,
        company: c.company,
        phone: c.phone,
        address: c.address,
      },
    });
    seededDellCustomers.push(cust);
  }
  console.log(`✔ Seeded 10 Dell Customers across India`);

  // =========================================================================
  // 4. DELL TRANSACTIONS & WORKFLOWS
  // =========================================================================
  console.log('--- Seeding Dell Transactions & Invoices ---');

  // Transaction 1: Confirmed Enterprise Deal -> Split Fulfillment -> Invoiced -> Paid (Wire Transfer)
  const dellQ1 = await quotationsService.createQuotation(
    dell.id,
    seededDellUsers.rep.id,
    {
      customerId: seededDellCustomers[0].id, // Infosys
      orderDiscountPercent: 2.0,
      notes: 'Enterprise developer fleet refresh Q3 - Delivered to Bengaluru and Pune development centers.',
      lines: [
        { productId: pDellLap1.id, quantity: 15, lineDiscountPercent: 5.0 },
        { productId: pDellMon2.id, quantity: 15, lineDiscountPercent: 5.0 },
        { productId: pDellWar1.id, quantity: 15, lineDiscountPercent: 0.0 },
      ],
    }
  );
  if (!dellQ1) throw new Error('Failed to create dellQ1');

  await prisma.quotation.update({
    where: { id: dellQ1.id },
    data: { status: 'confirmed' },
  });

  const splitPlanQ1 = await prisma.fulfillmentPlan.create({
    data: {
      organizationId: dell.id,
      quotationId: dellQ1.id,
      status: 'accepted',
      shipmentCount: 2,
      deliveryExtendedDays: 2,
      acceptedById: seededDellUsers.ops.id,
      acceptedAt: new Date(),
    },
  });

  const q1Lines = await prisma.quotationLine.findMany({ where: { quotationId: dellQ1.id } });
  for (const ql of q1Lines) {
    if (ql.productId === pDellLap1.id) {
      await prisma.fulfillmentLine.create({
        data: { organizationId: dell.id, planId: splitPlanQ1.id, quotationLineId: ql.id, productId: pDellLap1.id, warehouseId: dellWhBlr.id, quantity: 10 },
      });
      await prisma.fulfillmentLine.create({
        data: { organizationId: dell.id, planId: splitPlanQ1.id, quotationLineId: ql.id, productId: pDellLap1.id, warehouseId: dellWhBom.id, quantity: 5 },
      });
    } else if (ql.productId === pDellMon2.id) {
      await prisma.fulfillmentLine.create({
        data: { organizationId: dell.id, planId: splitPlanQ1.id, quotationLineId: ql.id, productId: pDellMon2.id, warehouseId: dellWhBom.id, quantity: 15 },
      });
    }
  }

  // Invoice & Payment for Transaction 1
  const splitOrderRes1 = await billingService.confirmAndSplitOrder(dell.id, dellQ1.id);
  if (splitOrderRes1.oneTimeInvoice) {
    await prisma.invoice.update({
      where: { id: splitOrderRes1.oneTimeInvoice.id },
      data: { status: 'paid' },
    });
    await prisma.payment.create({
      data: {
        organizationId: dell.id,
        invoiceId: splitOrderRes1.oneTimeInvoice.id,
        amount: splitOrderRes1.oneTimeInvoice.totalAmount,
        currency: 'INR',
        paymentMethod: 'bank_wire',
        status: 'succeeded',
        transactionReference: 'NEFT-INFY-DELL-8829104',
      },
    });
  }

  // Transaction 2: Hybrid Hardware + 24/7 Subscription (TCS)
  const dellQ2 = await quotationsService.createQuotation(
    dell.id,
    seededDellUsers.rep.id,
    {
      customerId: seededDellCustomers[1].id, // TCS
      orderDiscountPercent: 0,
      notes: 'High-density banking private cloud expansion with 24/7 ProSupport Plus Mission Critical SLA.',
      lines: [
        { productId: pDellSrv1.id, quantity: 2, lineDiscountPercent: 8.0 },
        { productId: pDellSub1.id, quantity: 2, lineDiscountPercent: 0.0 }, // monthly recurring
      ],
    }
  );
  if (!dellQ2) throw new Error('Failed to create dellQ2');

  await prisma.quotation.update({
    where: { id: dellQ2.id },
    data: { status: 'confirmed' },
  });

  const splitOrderRes2 = await billingService.confirmAndSplitOrder(dell.id, dellQ2.id);
  if (splitOrderRes2.oneTimeInvoice) {
    await prisma.invoice.update({
      where: { id: splitOrderRes2.oneTimeInvoice.id },
      data: { status: 'paid' },
    });
    await prisma.payment.create({
      data: {
        organizationId: dell.id,
        invoiceId: splitOrderRes2.oneTimeInvoice.id,
        amount: splitOrderRes2.oneTimeInvoice.totalAmount,
        currency: 'INR',
        paymentMethod: 'credit_card',
        status: 'succeeded',
        transactionReference: 'CC-TCS-DELL-44129',
      },
    });
  }

  // Transaction 3: High Volume Deal with Backorders & Consolidation (Zerodha)
  // Requesting 15 PowerEdge R760s (only 12 in stock across BLR/BOM/MAA)
  const dellQ3 = await quotationsService.createQuotation(
    dell.id,
    seededDellUsers.rep.id,
    {
      customerId: seededDellCustomers[2].id, // Zerodha
      orderDiscountPercent: 0,
      notes: 'Colocation rack scaling at Netmagic Datacenter Mumbai.',
      lines: [
        { productId: pDellSrv1.id, quantity: 15, lineDiscountPercent: 10.0 },
      ],
    }
  );
  if (!dellQ3) throw new Error('Failed to create dellQ3');

  await prisma.quotation.update({
    where: { id: dellQ3.id },
    data: { status: 'approved' },
  });

  const planQ3 = await prisma.fulfillmentPlan.create({
    data: {
      organizationId: dell.id,
      quotationId: dellQ3.id,
      status: 'proposed',
      shipmentCount: 3,
      deliveryExtendedDays: 5,
    },
  });

  const q3Lines = await prisma.quotationLine.findMany({ where: { quotationId: dellQ3.id } });
  const srvLineQ3 = q3Lines[0];
  if (!srvLineQ3) throw new Error('Missing srvLineQ3');

  // Stock available: BLR (6), BOM (4), MAA (2) = 12 total. Shortfall = 3
  await prisma.fulfillmentLine.createMany({
    data: [
      { organizationId: dell.id, planId: planQ3.id, quotationLineId: srvLineQ3.id, productId: pDellSrv1.id, warehouseId: dellWhBlr.id, quantity: 6 },
      { organizationId: dell.id, planId: planQ3.id, quotationLineId: srvLineQ3.id, productId: pDellSrv1.id, warehouseId: dellWhBom.id, quantity: 4 },
      { organizationId: dell.id, planId: planQ3.id, quotationLineId: srvLineQ3.id, productId: pDellSrv1.id, warehouseId: dellWhMaa.id, quantity: 2 },
    ],
  });

  const boItemDell = await prisma.backorderItem.create({
    data: {
      organizationId: dell.id,
      quotationId: dellQ3.id,
      quotationLineId: srvLineQ3.id,
      productId: pDellSrv1.id,
      planId: planQ3.id,
      quantity: 3,
      status: 'pending',
      notes: 'Factory backorder placed with Dell Sriperumbudur manufacturing plant.',
    },
  });

  await prisma.consolidationPrompt.create({
    data: {
      organizationId: dell.id,
      quotationId: dellQ3.id,
      backorderItemId: boItemDell.id,
      warehouseId: dellWhBlr.id,
      productId: pDellSrv1.id,
      suggestedQty: 3,
      status: 'pending',
    },
  });

  // Transaction 4: High Discount Deal Under Escalated Approval (Flipkart)
  const dellQ4 = await quotationsService.createQuotation(
    dell.id,
    seededDellUsers.rep.id,
    {
      customerId: seededDellCustomers[3].id, // Flipkart
      orderDiscountPercent: 22.0, // Exceeds standard ceiling & manager threshold
      notes: 'Big Billion Day internal infrastructure upgrade quotation. Special partner discount requested.',
      lines: [
        { productId: pDellLap2.id, quantity: 10, lineDiscountPercent: 15.0 },
        { productId: pDellMon1.id, quantity: 10, lineDiscountPercent: 15.0 },
      ],
    }
  );
  if (!dellQ4) throw new Error('Failed to create dellQ4');

  await prisma.quotation.update({
    where: { id: dellQ4.id },
    data: {
      status: 'pending_approval',
      riskScore: 32.5,
      riskLevel: 'high',
      approvalRouting: 'manager_finance',
    },
  });

  await prisma.approvalRequest.create({
    data: {
      organizationId: dell.id,
      quotationId: dellQ4.id,
      stage: 'finance',
      status: 'pending',
      assignedRole: 'finance',
      requestedById: seededDellUsers.rep.id,
      reason: 'Total discount (22% order + 15% line) exceeds standard partner margin boundaries.',
    },
  });

  // Transaction 5: Active Customer Negotiation (HDFC Bank)
  const dellQ5 = await quotationsService.createQuotation(
    dell.id,
    seededDellUsers.rep.id,
    {
      customerId: seededDellCustomers[5].id, // HDFC
      orderDiscountPercent: 0,
      notes: 'Core banking terminal hardware replacement program.',
      lines: [
        { productId: pDellAio1.id, quantity: 20, lineDiscountPercent: 6.0 },
        { productId: pDellWar1.id, quantity: 20, lineDiscountPercent: 0.0 },
      ],
    }
  );
  if (!dellQ5) throw new Error('Failed to create dellQ5');

  await prisma.quotation.update({
    where: { id: dellQ5.id },
    data: { status: 'negotiating' },
  });

  await prisma.negotiationComment.createMany({
    data: [
      {
        organizationId: dell.id,
        quotationId: dellQ5.id,
        authorType: 'customer',
        authorName: 'Sunil Nair (HDFC Procurement)',
        authorEmail: 'itinfra.vendor@hdfcbank.com',
        body: 'Can Dell bundle the 3-Year Accidental Damage Protection at a 50% waiver if we increase quantity to 30 units?',
      },
      {
        organizationId: dell.id,
        quotationId: dellQ5.id,
        authorType: 'internal',
        authorId: seededDellUsers.rep.id,
        authorName: 'Rohan Mehta (Senior Enterprise Rep)',
        authorEmail: 'rep@dell.com',
        body: 'We are discussing with our regional leadership to offer an adjusted commercial terms package.',
      },
    ],
  });

  await prisma.counterProposal.create({
    data: {
      organizationId: dell.id,
      quotationId: dellQ5.id,
      proposedDiscountPercent: 12.0,
      note: 'Targeting a 12% total discount for bulk rollout across 30 regional branches.',
      status: 'open',
      proposedByType: 'customer',
      proposedByName: 'Sunil Nair',
      proposedByEmail: 'itinfra.vendor@hdfcbank.com',
    },
  });

  // Transaction 6: Sent Quote (Razorpay)
  await quotationsService.createQuotation(
    dell.id,
    seededDellUsers.rep.id,
    {
      customerId: seededDellCustomers[6].id, // Razorpay
      orderDiscountPercent: 0,
      notes: 'Product Engineering new joiner laptops setup batch.',
      lines: [
        { productId: pDellLap1.id, quantity: 8, lineDiscountPercent: 5.0 },
        { productId: pDellMon2.id, quantity: 8, lineDiscountPercent: 5.0 },
      ],
    }
  );

  console.log('✔ Finished seeding Dell Technologies India with 6 realistic transaction flows');


  // =========================================================================
  // 5. ORGANIZATION 2: JSW INDUSTRIAL SOLUTIONS
  // =========================================================================
  console.log('\n--- Seeding JSW Industrial Solutions ---');
  const jsw = await prisma.organization.create({
    data: {
      name: 'JSW Industrial Solutions',
      slug: 'jsw',
      status: 'active',
      address: 'JSW Centre, Bandra Kurla Complex, Bandra (East), Mumbai, Maharashtra 400051',
      description: 'Heavy industrial machinery, electric motors, high-pressure pumps, compressors, robotics, boilers, and plant automation solutions.',
      contactEmail: 'industrial-sales@jsw.in',
      contactPhone: '+91 (22) 4286-1000',
      website: 'https://www.jsw.in',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      onboardingCompleted: true,
      logoUrl: '/api/organization/logo?ext=png',
    },
  });

  await storageService.uploadTenantFile({
    orgId: jsw.id,
    key: 'logo.png',
    buffer: sampleLogoBuffer,
    contentType: 'image/png',
  });

  // JSW Users
  const jswUsers = [
    { email: 'admin@jsw.in', name: 'Rajeshwar Jindal (Managing Admin)', role: 'org_admin' },
    { email: 'rep@jsw.in', name: 'Kavita Iyer (Industrial Sales Manager)', role: 'rep' },
    { email: 'manager@jsw.in', name: 'Arunav Sengupta (Head of Industrial Sales)', role: 'manager' },
    { email: 'finance@jsw.in', name: 'Meenakshi Nambiar (Chief Financial Officer)', role: 'finance' },
    { email: 'ops@jsw.in', name: 'Devendra Patel (Plant Operations Director)', role: 'ops' },
  ];
  const seededJswUsers: Record<string, any> = {};
  for (const u of jswUsers) {
    seededJswUsers[u.role] = await prisma.user.create({
      data: {
        email: u.email,
        passwordHash: defaultPasswordHash,
        name: u.name,
        organizationId: jsw.id,
        role: u.role,
        status: 'active',
      },
    });
  }

  // JSW Approval Rules
  await prisma.approvalChainConfig.create({
    data: {
      organizationId: jsw.id,
      managerThresholdPercent: 8.0,
      financeThresholdPercent: 18.0,
      requireFinanceAboveThreshold: true,
      autoApproveWithinCeilings: true,
    },
  });

  // JSW Shipping Rules
  await prisma.shippingRuleConfig.create({
    data: {
      organizationId: jsw.id,
      allowSplitShipments: true,
      chargeForSplitShipments: false,
      deliveryExtensionDays: 5,
      notes: 'Heavy machinery flatbed dispatch across India. Multi-yard split shipment policy.',
    },
  });

  // JSW Customer Tiers
  const jswTierCommercial = await prisma.customerTier.create({
    data: { organizationId: jsw.id, name: 'Commercial Enterprise', code: 'commercial', defaultDiscountPercent: 5.0 },
  });
  const jswTierPSU = await prisma.customerTier.create({
    data: { organizationId: jsw.id, name: 'PSU Enterprise', code: 'psu', defaultDiscountPercent: 10.0 },
  });
  const jswTierMega = await prisma.customerTier.create({
    data: { organizationId: jsw.id, name: 'Tier 1 Mega Infrastructure', code: 'mega_infra', defaultDiscountPercent: 15.0 },
  });

  // JSW 15 Categories
  const jswCatMotors = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Motors', code: 'motors', description: '5HP, 10HP, 25HP heavy industrial motors' } });
  const jswCatPumps = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Pumps', code: 'pumps', description: 'Centrifugal slurry and high-pressure hydraulic pumps' } });
  const jswCatCompressors = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Compressors', code: 'compressors', description: 'Rotary screw air compressors and AMC services' } });
  const jswCatGenerators = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Generators', code: 'generators', description: 'Heavy diesel power generators 50KVA - 100KVA' } });
  const jswCatTransformers = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Transformers', code: 'transformers', description: 'Distribution and power substation transformers' } });
  const jswCatConveyors = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Conveyors', code: 'conveyors', description: 'Heavy mining belt and modular roller conveyors' } });
  const jswCatForklifts = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Forklifts', code: 'forklifts', description: 'Electric lithium and diesel warehouse forklifts' } });
  const jswCatCNC = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'CNC Machines', code: 'cnc_machines', description: '5-Axis CNC milling and heavy CNC lathes' } });
  const jswCatWelding = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Welding Equipment', code: 'welding_equipment', description: 'Industrial MIG & TIG precision welders' } });
  const jswCatRobots = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Industrial Robots', code: 'industrial_robots', description: '6-Axis robotic arms and pick-and-place robotics' } });
  const jswCatHVAC = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'HVAC', code: 'hvac', description: '150-Ton industrial chillers and cooling towers' } });
  const jswCatBoilers = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Boilers', code: 'boilers', description: 'Steam and biomass industrial boilers' } });
  const jswCatWater = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Water Treatment', code: 'water_treatment', description: '50K LPH RO and Zero Liquid Discharge ETP plants' } });
  const jswCatPackaging = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Packaging', code: 'packaging', description: 'Automatic rotary bottle filling & sealing machines' } });
  const jswCatSafety = await prisma.productCategory.create({ data: { organizationId: jsw.id, name: 'Safety Equipment', code: 'safety_equipment', description: 'Fire suppression systems and plant-wide sensor arrays' } });

  // JSW Products
  const pJswMot1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatMotors.id, name: 'JSW Ultra-Torque 5HP Industrial Induction Motor', sku: 'JSW-MOT-5HP', price: 38000.0, costPrice: 24000.0, billingFrequency: 'one_time' },
  });
  const pJswMot2 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatMotors.id, name: 'JSW 10HP Heavy Duty Cast-Iron Motor', sku: 'JSW-MOT-10HP', price: 72000.0, costPrice: 48000.0, billingFrequency: 'one_time' },
  });
  const pJswMot3 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatMotors.id, name: 'JSW 25HP High Efficiency 3-Phase Industrial Motor', sku: 'JSW-MOT-25HP', price: 165000.0, costPrice: 110000.0, billingFrequency: 'one_time' },
  });

  const pJswPmp1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatPumps.id, name: 'JSW Heavy-Duty Centrifugal Slurry Pump', sku: 'JSW-PMP-CENT', price: 185000.0, costPrice: 120000.0, billingFrequency: 'one_time' },
  });
  const pJswPmp2 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatPumps.id, name: 'JSW High-Pressure Hydraulic Piston Pump', sku: 'JSW-PMP-HYD', price: 240000.0, costPrice: 160000.0, billingFrequency: 'one_time' },
  });

  const pJswCmp1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatCompressors.id, name: 'JSW Rotary Screw Air Compressor 50HP', sku: 'JSW-CMP-SCREW50', price: 750000.0, costPrice: 520000.0, billingFrequency: 'one_time' },
  });
  const pJswCmpSub = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatCompressors.id, name: 'JSW Air Compressor Quarterly AMC & Filter Service', sku: 'JSW-AMC-CMP-Q', price: 35000.0, costPrice: 10000.0, billingFrequency: 'quarterly' },
  });

  const pJswGen1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatGenerators.id, name: 'JSW Silent Industrial Diesel Generator 50KVA', sku: 'JSW-GEN-50KVA', price: 650000.0, costPrice: 460000.0, billingFrequency: 'one_time' },
  });
  const pJswGen2 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatGenerators.id, name: 'JSW Heavy Power Plant Diesel Generator 100KVA', sku: 'JSW-GEN-100KVA', price: 1150000.0, costPrice: 820000.0, billingFrequency: 'one_time' },
  });

  const pJswTrf1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatTransformers.id, name: 'JSW 500KVA Industrial Distribution Transformer', sku: 'JSW-TRF-500KVA', price: 880000.0, costPrice: 620000.0, billingFrequency: 'one_time' },
  });
  const pJswTrf2 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatTransformers.id, name: 'JSW 2000KVA Power Substation Transformer', sku: 'JSW-TRF-2000KVA', price: 2800000.0, costPrice: 1950000.0, billingFrequency: 'one_time' },
  });

  const pJswCnv1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatConveyors.id, name: 'JSW Heavy Mining Belt Conveyor 50m System', sku: 'JSW-CNV-BELT50', price: 1200000.0, costPrice: 850000.0, billingFrequency: 'one_time' },
  });

  const pJswFrk1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatForklifts.id, name: 'JSW 3-Ton Electric Lithium Forklift', sku: 'JSW-FRK-ELEC3T', price: 1450000.0, costPrice: 1050000.0, billingFrequency: 'one_time' },
  });
  const pJswFrkSub = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatForklifts.id, name: 'JSW Forklift Fleet Annual Maintenance Contract (AMC)', sku: 'JSW-AMC-FRK-YR', price: 180000.0, costPrice: 60000.0, billingFrequency: 'annual' },
  });

  const pJswCnc1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatCNC.id, name: 'JSW Precision 5-Axis CNC Milling Center', sku: 'JSW-CNC-MILL5X', price: 4800000.0, costPrice: 3400000.0, billingFrequency: 'one_time' },
  });
  const pJswCnc2 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatCNC.id, name: 'JSW Heavy Duty CNC Lathe Machine', sku: 'JSW-CNC-LATHE', price: 2600000.0, costPrice: 1850000.0, billingFrequency: 'one_time' },
  });

  const pJswWld1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatWelding.id, name: 'JSW 400A Industrial MIG Welder Station', sku: 'JSW-WLD-MIG400', price: 145000.0, costPrice: 95000.0, billingFrequency: 'one_time' },
  });

  const pJswRob1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatRobots.id, name: 'JSW 6-Axis High-Payload Heavy Industrial Robotic Arm', sku: 'JSW-ROB-6AXIS', price: 3200000.0, costPrice: 2250000.0, billingFrequency: 'one_time' },
  });
  const pJswRobSub = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatRobots.id, name: 'JSW Robotic Cell Autonomous Software & Vision Suite', sku: 'JSW-SUB-ROB-MO', price: 60000.0, costPrice: 15000.0, billingFrequency: 'monthly' },
  });

  const pJswHvac1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatHVAC.id, name: 'JSW 150-Ton Industrial Water-Cooled Chiller', sku: 'JSW-HVAC-CHL150', price: 3600000.0, costPrice: 2500000.0, billingFrequency: 'one_time' },
  });
  const pJswBlr1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatBoilers.id, name: 'JSW 5-Ton High-Pressure Steam Boiler System', sku: 'JSW-BLR-STM5T', price: 4200000.0, costPrice: 2900000.0, billingFrequency: 'one_time' },
  });
  const pJswWtr1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatWater.id, name: 'JSW Zero Liquid Discharge Effluent Treatment Plant (ETP)', sku: 'JSW-WTR-ETP-ZLD', price: 5500000.0, costPrice: 3800000.0, billingFrequency: 'one_time' },
  });
  const pJswPkg1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatPackaging.id, name: 'JSW High-Speed Rotary Bottle Filling & Capping Machine', sku: 'JSW-PKG-BTL-ROT', price: 1850000.0, costPrice: 1250000.0, billingFrequency: 'one_time' },
  });
  const pJswSaf1 = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatSafety.id, name: 'JSW Automated Total Flooding Fire Suppression System', sku: 'JSW-SAF-FIRE-SYS', price: 850000.0, costPrice: 580000.0, billingFrequency: 'one_time' },
  });
  const pJswSafSub = await prisma.product.create({
    data: { organizationId: jsw.id, categoryId: jswCatSafety.id, name: 'JSW 24/7 Plant-Wide Safety & Toxic Gas Monitoring Suite', sku: 'JSW-SUB-SAF-MO', price: 25000.0, costPrice: 7000.0, billingFrequency: 'monthly' },
  });

  // JSW Affinities
  await prisma.productAffinity.createMany({
    data: [
      {
        organizationId: jsw.id,
        productId: pJswRob1.id,
        recommendedProductId: pJswRobSub.id,
        coPurchaseCount: 42,
        affinityScore: 0.94,
        recommendationReason: 'Essential automation software package for 6-Axis Robotic cells.',
      },
      {
        organizationId: jsw.id,
        productId: pJswCmp1.id,
        recommendedProductId: pJswCmpSub.id,
        coPurchaseCount: 38,
        affinityScore: 0.88,
        recommendationReason: 'Recommended maintenance contract for rotary air compressors.',
      },
      {
        organizationId: jsw.id,
        productId: pJswMot3.id,
        recommendedProductId: pJswPmp1.id,
        coPurchaseCount: 29,
        affinityScore: 0.76,
        recommendationReason: 'Frequently deployed together in mining and slurry operations.',
      },
    ],
  });

  // JSW Multiple Warehouses & Heavy Yards
  const jswWhVjy = await prisma.warehouse.create({
    data: {
      organizationId: jsw.id,
      name: 'JSW Bellary Central Yard',
      code: 'WH-JSW-VJY',
      city: 'Ballari',
      address: 'Toranagallu Industrial Complex, Ballari, Karnataka 583123',
      isDefault: true,
    },
  });
  const jswWhIxr = await prisma.warehouse.create({
    data: {
      organizationId: jsw.id,
      name: 'JSW Jamshedpur Heavy Plant Depot',
      code: 'WH-JSW-IXR',
      city: 'Jamshedpur',
      address: 'Adityapur Industrial Area, Jamshedpur, Jharkhand 831013',
      isDefault: false,
    },
  });
  const jswWhJnpt = await prisma.warehouse.create({
    data: {
      organizationId: jsw.id,
      name: 'JSW Navi Mumbai Port Logistics Hub',
      code: 'WH-JSW-JNPT',
      city: 'Navi Mumbai',
      address: 'Nhava Sheva Port Corridor, Navi Mumbai, Maharashtra 400707',
      isDefault: false,
    },
  });
  const jswWhPnq = await prisma.warehouse.create({
    data: {
      organizationId: jsw.id,
      name: 'JSW Pune Automotive & Machinery Depot',
      code: 'WH-JSW-PNQ',
      city: 'Pune',
      address: 'Chakan MIDC Phase 2, Pune, Maharashtra 410501',
      isDefault: false,
    },
  });

  // JSW Stock Levels
  await prisma.stockLevel.createMany({
    data: [
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswMot1.id, quantity: 80 },
      { organizationId: jsw.id, warehouseId: jswWhPnq.id, productId: pJswMot1.id, quantity: 40 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswMot2.id, quantity: 50 },
      { organizationId: jsw.id, warehouseId: jswWhIxr.id, productId: pJswMot3.id, quantity: 20 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswPmp1.id, quantity: 25 },
      { organizationId: jsw.id, warehouseId: jswWhJnpt.id, productId: pJswPmp1.id, quantity: 15 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswCmp1.id, quantity: 12 },
      { organizationId: jsw.id, warehouseId: jswWhPnq.id, productId: pJswCmp1.id, quantity: 8 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswGen1.id, quantity: 10 },
      { organizationId: jsw.id, warehouseId: jswWhJnpt.id, productId: pJswGen2.id, quantity: 5 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswTrf1.id, quantity: 6 },
      { organizationId: jsw.id, warehouseId: jswWhIxr.id, productId: pJswTrf2.id, quantity: 3 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswFrk1.id, quantity: 14 },
      { organizationId: jsw.id, warehouseId: jswWhPnq.id, productId: pJswFrk1.id, quantity: 8 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswCnc1.id, quantity: 4 },
      { organizationId: jsw.id, warehouseId: jswWhPnq.id, productId: pJswCnc2.id, quantity: 6 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswRob1.id, quantity: 8 },
      { organizationId: jsw.id, warehouseId: jswWhPnq.id, productId: pJswRob1.id, quantity: 5 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswHvac1.id, quantity: 3 },
      { organizationId: jsw.id, warehouseId: jswWhIxr.id, productId: pJswBlr1.id, quantity: 2 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswWtr1.id, quantity: 2 },
      { organizationId: jsw.id, warehouseId: jswWhPnq.id, productId: pJswPkg1.id, quantity: 6 },
      { organizationId: jsw.id, warehouseId: jswWhVjy.id, productId: pJswSaf1.id, quantity: 18 },
    ],
  });

  // JSW 10 Heavy Enterprise Customers
  const jswCustomersData = [
    { name: 'Larsen & Toubro Ltd (L&T Heavy Engineering)', email: 'machinery-procure@lnt.com', company: 'Larsen & Toubro Limited', phone: '+91 22 6752 5656', address: 'L&T House, Ballard Estate, Mumbai, Maharashtra 400001', tierId: jswTierMega.id },
    { name: 'Tata Projects Limited', email: 'plant.procurement@tataprojects.com', company: 'Tata Projects Limited', phone: '+91 40 6623 8800', address: 'Mithona Towers, Prenderghast Road, Secunderabad, Telangana 500003', tierId: jswTierMega.id },
    { name: 'Bharat Heavy Electricals Limited (BHEL)', email: 'tenders@bhel.in', company: 'Bharat Heavy Electricals Limited', phone: '+91 11 6633 7000', address: 'BHEL House, Siri Fort, New Delhi 110049', tierId: jswTierPSU.id },
    { name: 'Adani Ports & Special Economic Zone', email: 'port-infra@adani.com', company: 'Adani Ports & SEZ Limited', phone: '+91 79 2656 5555', address: 'Adani Corporate House, Shantigram, SG Highway, Ahmedabad, Gujarat 382421', tierId: jswTierMega.id },
    { name: 'Mahindra & Mahindra Manufacturing', email: 'auto-machinery@mahindra.com', company: 'Mahindra & Mahindra Limited', phone: '+91 22 2490 1441', address: 'Gateway Building, Apollo Bunder, Mumbai 400001', tierId: jswTierMega.id },
    { name: 'JSW Steels Vijaynagar Works', email: 'vijaynagar.procure@jsw.in', company: 'JSW Steel Limited', phone: '+91 8395 250120', address: 'PO Vidyanagar, Toranagallu, Ballari, Karnataka 583275', tierId: jswTierMega.id },
    { name: 'Godrej & Boyce Manufacturing Ltd', email: 'plant-sourcing@godrej.com', company: 'Godrej & Boyce Mfg Co Ltd', phone: '+91 22 6796 5656', address: 'Pirojshanagar, Vikhroli, Mumbai, Maharashtra 400079', tierId: jswTierCommercial.id },
    { name: 'Thermax Industrial Plant Solutions', email: 'sourcing@thermaxglobal.com', company: 'Thermax Limited', phone: '+91 20 6605 1200', address: 'D-13, MIDC Industrial Area, RD Aga Road, Chinchwad, Pune 411019', tierId: jswTierCommercial.id },
    { name: 'Reliance Infrastructure Ltd', email: 'infra-machinery@relianceada.com', company: 'Reliance Infrastructure Limited', phone: '+91 22 4303 1000', address: 'Reliance Centre, Santa Cruz East, Mumbai 400055', tierId: jswTierMega.id },
    { name: 'GMR Infrastructure Limited', email: 'airport-equip@gmrgroup.in', company: 'GMR Infrastructure Limited', phone: '+91 11 4719 7000', address: 'New Udaan Bhawan, Terminal 3, IGI Airport, New Delhi 110037', tierId: jswTierCommercial.id },
  ];

  const seededJswCustomers: any[] = [];
  for (const c of jswCustomersData) {
    const cust = await prisma.customer.create({
      data: {
        organizationId: jsw.id,
        tierId: c.tierId,
        name: c.name,
        email: c.email,
        company: c.company,
        phone: c.phone,
        address: c.address,
      },
    });
    seededJswCustomers.push(cust);
  }
  console.log(`✔ Seeded 10 JSW Heavy Enterprise Customers across India`);

  // =========================================================================
  // 6. JSW TRANSACTIONS & WORKFLOWS
  // =========================================================================
  console.log('--- Seeding JSW Transactions & Invoices ---');

  // Transaction 1: Mega Infra Turnkey Deal (L&T Heavy Engineering) - Confirmed & Paid
  const jswQ1 = await quotationsService.createQuotation(
    jsw.id,
    seededJswUsers.rep.id,
    {
      customerId: seededJswCustomers[0].id, // L&T
      orderDiscountPercent: 5.0,
      notes: 'Hazira plant heavy manufacturing line tooling order.',
      lines: [
        { productId: pJswCnc1.id, quantity: 1, lineDiscountPercent: 5.0 }, // 5-Axis CNC Milling
        { productId: pJswTrf1.id, quantity: 2, lineDiscountPercent: 5.0 }, // 500KVA Transformer
        { productId: pJswMot3.id, quantity: 4, lineDiscountPercent: 0.0 }, // 25HP Motor
      ],
    }
  );
  if (!jswQ1) throw new Error('Failed to create jswQ1');

  await prisma.quotation.update({
    where: { id: jswQ1.id },
    data: { status: 'confirmed' },
  });

  const jswPlanQ1 = await prisma.fulfillmentPlan.create({
    data: {
      organizationId: jsw.id,
      quotationId: jswQ1.id,
      status: 'accepted',
      shipmentCount: 2,
      deliveryExtendedDays: 4,
      acceptedById: seededJswUsers.ops.id,
      acceptedAt: new Date(),
    },
  });

  const jswQ1Lines = await prisma.quotationLine.findMany({ where: { quotationId: jswQ1.id } });
  for (const ql of jswQ1Lines) {
    if (ql.productId === pJswCnc1.id) {
      await prisma.fulfillmentLine.create({
        data: { organizationId: jsw.id, planId: jswPlanQ1.id, quotationLineId: ql.id, productId: pJswCnc1.id, warehouseId: jswWhVjy.id, quantity: 1 },
      });
    } else if (ql.productId === pJswTrf1.id) {
      await prisma.fulfillmentLine.create({
        data: { organizationId: jsw.id, planId: jswPlanQ1.id, quotationLineId: ql.id, productId: pJswTrf1.id, warehouseId: jswWhVjy.id, quantity: 2 },
      });
    } else if (ql.productId === pJswMot3.id) {
      await prisma.fulfillmentLine.create({
        data: { organizationId: jsw.id, planId: jswPlanQ1.id, quotationLineId: ql.id, productId: pJswMot3.id, warehouseId: jswWhIxr.id, quantity: 4 },
      });
    }
  }

  // Invoice & Payment
  const jswSplit1 = await billingService.confirmAndSplitOrder(jsw.id, jswQ1.id);
  if (jswSplit1.oneTimeInvoice) {
    await prisma.invoice.update({
      where: { id: jswSplit1.oneTimeInvoice.id },
      data: { status: 'paid' },
    });
    await prisma.payment.create({
      data: {
        organizationId: jsw.id,
        invoiceId: jswSplit1.oneTimeInvoice.id,
        amount: jswSplit1.oneTimeInvoice.totalAmount,
        currency: 'INR',
        paymentMethod: 'bank_wire',
        status: 'succeeded',
        transactionReference: 'RTGS-LT-JSW-9902381',
      },
    });
  }

  // Transaction 2: Automotive Robotics Automation Cell with Software Subscription (Mahindra)
  const jswQ2 = await quotationsService.createQuotation(
    jsw.id,
    seededJswUsers.rep.id,
    {
      customerId: seededJswCustomers[4].id, // Mahindra
      orderDiscountPercent: 2.0,
      notes: 'Chakan plant body-in-white welding line robotic cell automation.',
      lines: [
        { productId: pJswRob1.id, quantity: 2, lineDiscountPercent: 5.0 }, // 6-Axis Robot
        { productId: pJswRobSub.id, quantity: 2, lineDiscountPercent: 0.0 }, // Monthly software subscription
        { productId: pJswWld1.id, quantity: 2, lineDiscountPercent: 0.0 }, // MIG Welder
      ],
    }
  );
  if (!jswQ2) throw new Error('Failed to create jswQ2');

  await prisma.quotation.update({
    where: { id: jswQ2.id },
    data: { status: 'confirmed' },
  });

  const jswSplit2 = await billingService.confirmAndSplitOrder(jsw.id, jswQ2.id);
  if (jswSplit2.oneTimeInvoice) {
    await prisma.invoice.update({
      where: { id: jswSplit2.oneTimeInvoice.id },
      data: { status: 'paid' },
    });
    await prisma.payment.create({
      data: {
        organizationId: jsw.id,
        invoiceId: jswSplit2.oneTimeInvoice.id,
        amount: jswSplit2.oneTimeInvoice.totalAmount,
        currency: 'INR',
        paymentMethod: 'bank_wire',
        status: 'succeeded',
        transactionReference: 'RTGS-MANDM-JSW-7741',
      },
    });
  }

  // Transaction 3: High Demand Generators with Backorder Workflow (Tata Projects)
  // Requesting 8 Diesel Generators (50KVA) - only 6 available in primary yard
  const jswQ3 = await quotationsService.createQuotation(
    jsw.id,
    seededJswUsers.rep.id,
    {
      customerId: seededJswCustomers[1].id, // Tata Projects
      orderDiscountPercent: 0,
      notes: 'Noida International Airport construction site standby power setup.',
      lines: [
        { productId: pJswGen1.id, quantity: 12, lineDiscountPercent: 5.0 },
      ],
    }
  );
  if (!jswQ3) throw new Error('Failed to create jswQ3');

  await prisma.quotation.update({
    where: { id: jswQ3.id },
    data: { status: 'approved' },
  });

  const jswPlanQ3 = await prisma.fulfillmentPlan.create({
    data: {
      organizationId: jsw.id,
      quotationId: jswQ3.id,
      status: 'proposed',
      shipmentCount: 2,
      deliveryExtendedDays: 6,
    },
  });

  const jswQ3Lines = await prisma.quotationLine.findMany({ where: { quotationId: jswQ3.id } });
  const genLineQ3 = jswQ3Lines[0];
  if (!genLineQ3) throw new Error('Missing genLineQ3');

  await prisma.fulfillmentLine.create({
    data: { organizationId: jsw.id, planId: jswPlanQ3.id, quotationLineId: genLineQ3.id, productId: pJswGen1.id, warehouseId: jswWhVjy.id, quantity: 10 },
  });

  const boItemJsw = await prisma.backorderItem.create({
    data: {
      organizationId: jsw.id,
      quotationId: jswQ3.id,
      quotationLineId: genLineQ3.id,
      productId: pJswGen1.id,
      planId: jswPlanQ3.id,
      quantity: 2,
      status: 'pending',
      notes: 'Fabrication batch scheduled at JSW Heavy Assembly Plant Toranagallu.',
    },
  });

  await prisma.consolidationPrompt.create({
    data: {
      organizationId: jsw.id,
      quotationId: jswQ3.id,
      backorderItemId: boItemJsw.id,
      warehouseId: jswWhJnpt.id,
      productId: pJswGen1.id,
      suggestedQty: 2,
      status: 'pending',
    },
  });

  // Transaction 4: Escalated Approval High Value ETP Deal (Adani Ports)
  const jswQ4 = await quotationsService.createQuotation(
    jsw.id,
    seededJswUsers.rep.id,
    {
      customerId: seededJswCustomers[3].id, // Adani Ports
      orderDiscountPercent: 20.0, // High discount requiring Finance approval
      notes: 'Mundra Port chemical terminal Zero Liquid Discharge ETP and 150-Ton Chiller project.',
      lines: [
        { productId: pJswWtr1.id, quantity: 1, lineDiscountPercent: 10.0 }, // ETP
        { productId: pJswHvac1.id, quantity: 1, lineDiscountPercent: 10.0 }, // Chiller
      ],
    }
  );
  if (!jswQ4) throw new Error('Failed to create jswQ4');

  await prisma.quotation.update({
    where: { id: jswQ4.id },
    data: {
      status: 'pending_approval',
      riskScore: 28.0,
      riskLevel: 'high',
      approvalRouting: 'manager_finance',
    },
  });

  await prisma.approvalRequest.create({
    data: {
      organizationId: jsw.id,
      quotationId: jswQ4.id,
      stage: 'finance',
      status: 'pending',
      assignedRole: 'finance',
      requestedById: seededJswUsers.rep.id,
      reason: '20% order discount on turnkey infrastructure project exceeds standard authority limits.',
    },
  });

  // Transaction 5: Customer Negotiation on Forklifts & AMC (Godrej & Boyce)
  const jswQ5 = await quotationsService.createQuotation(
    jsw.id,
    seededJswUsers.rep.id,
    {
      customerId: seededJswCustomers[6].id, // Godrej
      orderDiscountPercent: 0,
      notes: 'Warehouse material handling fleet expansion.',
      lines: [
        { productId: pJswFrk1.id, quantity: 4, lineDiscountPercent: 5.0 },
        { productId: pJswFrkSub.id, quantity: 4, lineDiscountPercent: 0.0 },
      ],
    }
  );
  if (!jswQ5) throw new Error('Failed to create jswQ5');

  await prisma.quotation.update({
    where: { id: jswQ5.id },
    data: { status: 'negotiating' },
  });

  await prisma.negotiationComment.createMany({
    data: [
      {
        organizationId: jsw.id,
        quotationId: jswQ5.id,
        authorType: 'customer',
        authorName: 'Ramesh Kulkarni (Godrej Sourcing)',
        authorEmail: 'plant-sourcing@godrej.com',
        body: 'Can JSW include battery replacement insurance within the annual maintenance contract fee?',
      },
      {
        organizationId: jsw.id,
        quotationId: jswQ5.id,
        authorType: 'internal',
        authorId: seededJswUsers.rep.id,
        authorName: 'Kavita Iyer (Industrial Sales Manager)',
        authorEmail: 'rep@jsw.in',
        body: 'We can bundle cell health diagnostics and emergency loaner forklifts under the Gold AMC tier.',
      },
    ],
  });

  await prisma.counterProposal.create({
    data: {
      organizationId: jsw.id,
      quotationId: jswQ5.id,
      proposedDiscountPercent: 8.0,
      note: 'Requesting 8% discount on initial 4-unit fleet purchase.',
      status: 'open',
      proposedByType: 'customer',
      proposedByName: 'Ramesh Kulkarni',
      proposedByEmail: 'plant-sourcing@godrej.com',
    },
  });

  // Transaction 6: Boiler & Safety System Quote Sent (Thermax)
  await quotationsService.createQuotation(
    jsw.id,
    seededJswUsers.rep.id,
    {
      customerId: seededJswCustomers[7].id, // Thermax
      orderDiscountPercent: 0,
      notes: 'Industrial plant utilities expansion package.',
      lines: [
        { productId: pJswBlr1.id, quantity: 1, lineDiscountPercent: 0.0 },
        { productId: pJswSaf1.id, quantity: 2, lineDiscountPercent: 0.0 },
      ],
    }
  );

  console.log('✔ Finished seeding JSW Industrial Solutions with 6 realistic transaction flows');

  console.log('\n========================================');
  console.log('🎉 DATABASE SEEDING COMPLETED SUCCESSFULLY (INR / IST)');
  console.log('========================================\n');
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
