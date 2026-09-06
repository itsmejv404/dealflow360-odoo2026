<script setup lang="ts">
import { RouterLink } from 'vue-router';

const features = [
  {
    title: 'Discount Governance',
    description:
      'A blended risk score checks every line against its own category ceiling — not one blanket limit. Slightly-over lines and aggregate creep both get caught and routed automatically.',
    tag: 'Auto-routing',
  },
  {
    title: 'Smart Fulfillment',
    description:
      'Live stock levels propose an optimal multi-warehouse split to minimize shipments and cost. Backorders consolidate automatically the moment stock arrives.',
    tag: 'Live inventory',
  },
  {
    title: 'Mixed Billing',
    description:
      'One order, one-time hardware and recurring subscriptions billed correctly. Proration, partial refunds and credit notes handled mid-cycle, automatically.',
    tag: 'Recurring + one-time',
  },
  {
    title: 'Customer Negotiation Portal',
    description:
      'A real, separate portal where customers comment line-by-line, request changes and counter discounts. Confirmed terms that cross thresholds re-enter approval — no silent acceptance.',
    tag: 'Living documents',
  },
  {
    title: 'Deal Health Monitoring',
    description:
      'An always-on observer flags stalled quotes, discount anomalies versus a rep\u2019s own history, and delivery slippage — with nudges and escalations one click away.',
    tag: 'Real-time alerts',
  },
  {
    title: 'Full Audit Trail',
    description:
      'Every approval, rejection and edit is logged with user, timestamp and reason. Pricing discipline you can prove, not just enforce.',
    tag: 'Compliance-ready',
  },
];

const stages = [
  {
    n: '01',
    title: 'Setup',
    who: 'Admin',
    text: 'Products, price lists, per-tier discount ceilings, approval chains, warehouses and subscription plans — the rulebook everything downstream obeys.',
  },
  {
    n: '02',
    title: 'Quotation Building',
    who: 'Sales Rep',
    text: 'Build quotes across hardware, services and subscriptions with live margin indicators and ranked upsell/cross-sell suggestions with margin deltas.',
  },
  {
    n: '03',
    title: 'Discount Governance',
    who: 'Automatic → Manager → Finance',
    text: 'The blended risk score routes quotes through the right approval chain, with every decision logged along the way.',
  },
  {
    n: '04',
    title: 'Fulfillment',
    who: 'Automatic → Ops',
    text: 'The system proposes the warehouse split; Ops accepts or overrides. Backorders consolidate automatically when stock lands.',
  },
  {
    n: '05',
    title: 'Billing',
    who: 'Automatic',
    text: 'One-time lines charge directly, recurring lines generate a billing schedule, and mid-cycle changes trigger proration and credit notes.',
  },
  {
    n: '06',
    title: 'Customer Negotiation',
    who: 'Customer',
    text: 'Customers counter inside their portal. If confirmed terms exceed approval thresholds, the quote loops back to Stage 3 — by design.',
  },
];

const reasons = [
  'Multi-level discount approvals routed automatically, not chased over chat',
  'Partial stock spread across warehouses optimized for shipment cost',
  'Bundled subscriptions reconciled with one-time hardware on a single order',
  'Customers negotiating in a portal instead of over email attachments',
  'Managers alerted the moment a deal stalls — not after it\u2019s lost',
];
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Nav -->
    <header class="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
      <nav class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#" class="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">DF</span>
          DealFlow<span class="text-primary">360</span>
        </a>
        <div class="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#features" class="transition-colors hover:text-foreground">Product</a>
          <a href="#workflow" class="transition-colors hover:text-foreground">Workflow</a>
          <a href="#why" class="transition-colors hover:text-foreground">Why DealFlow360</a>
        </div>
        <RouterLink
          to="/login"
          class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Sign in
        </RouterLink>
      </nav>
    </header>

    <!-- Hero -->
    <section class="relative overflow-hidden">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,--theme(--color-primary/10%),transparent)]" aria-hidden="true" />
      <div class="relative mx-auto max-w-6xl px-4 py-24 text-center sm:px-6 sm:py-32">
        <span class="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          Quote-to-Cash Platform
        </span>
        <h1 class="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Beyond quote-to-invoice: a
          <span class="text-primary">self-governing deal engine</span>
        </h1>
        <p class="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          DealFlow360 enforces pricing discipline, reacts to inventory reality in real time, keeps
          subscriptions and one-time sales reconciled on a single order, and gives reps and customers
          a living, negotiable document — not a static PDF.
        </p>
        <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <RouterLink
            to="/login"
            class="rounded-lg bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Sign in to Workspace
          </RouterLink>
          <a
            href="#workflow"
            class="rounded-lg border border-border px-6 py-3 text-base font-semibold transition-colors hover:bg-muted"
          >
            See the workflow
          </a>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section id="features" class="border-t border-border py-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="mx-auto max-w-2xl text-center">
          <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">Built for messy, real-world B2B sales</h2>
          <p class="mt-4 text-lg text-muted-foreground">
            Six capabilities that simple sales tools skip — working together as one engine.
          </p>
        </div>
        <div class="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="f in features"
            :key="f.title"
            class="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
          >
            <span class="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {{ f.tag }}
            </span>
            <h3 class="mt-4 text-lg font-semibold">{{ f.title }}</h3>
            <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ f.description }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- Workflow -->
    <section id="workflow" class="border-t border-border bg-muted/40 py-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="mx-auto max-w-2xl text-center">
          <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">One deal, six stages, two feedback loops</h2>
          <p class="mt-4 text-lg text-muted-foreground">
            A linear happy path — build, approve, fulfill, bill — with negotiation and stock arrival
            looping work back automatically, and deal health watching everything from the side.
          </p>
        </div>
        <ol class="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="s in stages"
            :key="s.n"
            class="relative rounded-xl border border-border bg-card p-6"
          >
            <span class="text-3xl font-bold text-primary/30">{{ s.n }}</span>
            <h3 class="mt-2 text-lg font-semibold">{{ s.title }}</h3>
            <p class="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ s.who }}</p>
            <p class="mt-3 text-sm leading-relaxed text-muted-foreground">{{ s.text }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- Why -->
    <section id="why" class="border-t border-border py-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">Why DealFlow360?</h2>
            <p class="mt-4 text-lg text-muted-foreground">
              Most simple sales tools handle the basics well: create a quote, confirm an order,
              invoice it. Real B2B sales teams operate in messier conditions.
            </p>
            <p class="mt-4 text-lg text-muted-foreground">
              DealFlow360 is the platform built for those conditions — pricing discipline enforced by
              design, not by memory.
            </p>
          </div>
          <ul class="space-y-4">
            <li
              v-for="r in reasons"
              :key="r"
              class="flex items-start gap-3 rounded-lg border border-border bg-card p-4"
            >
              <span class="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">✓</span>
              <span class="text-sm leading-relaxed">{{ r }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="border-t border-border bg-muted/40 py-20">
      <div class="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 class="text-3xl font-bold tracking-tight">Ready to let deals govern themselves?</h2>
        <p class="mt-4 text-lg text-muted-foreground">
          Sign in to the Sales Workspace and take a deal from build to bill.
        </p>
        <RouterLink
          to="/login"
          class="mt-8 inline-block rounded-lg bg-primary px-8 py-3 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Sign in
        </RouterLink>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-border py-8">
      <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <p>© {{ new Date().getFullYear() }} DealFlow360. All rights reserved.</p>
        <div class="flex items-center gap-6">
          <a href="#features" class="transition-colors hover:text-foreground">Product</a>
          <a href="#workflow" class="transition-colors hover:text-foreground">Workflow</a>
          <RouterLink to="/login" class="transition-colors hover:text-foreground">Sign in</RouterLink>
        </div>
      </div>
    </footer>
  </div>
</template>
