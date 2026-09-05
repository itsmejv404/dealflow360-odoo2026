-- CreateTable
CREATE TABLE "negotiation_comments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "line_id" TEXT,
    "author_type" TEXT NOT NULL DEFAULT 'customer',
    "author_id" TEXT,
    "author_name" TEXT NOT NULL,
    "author_email" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "line_id" TEXT,
    "request_type" TEXT NOT NULL,
    "proposed_quantity" INTEGER,
    "proposed_discount_percent" DECIMAL(5,2),
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "requested_by_type" TEXT NOT NULL DEFAULT 'customer',
    "requested_by_name" TEXT NOT NULL,
    "requested_by_email" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "line_id" TEXT,
    "proposed_discount_percent" DECIMAL(5,2) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "proposed_by_type" TEXT NOT NULL DEFAULT 'customer',
    "proposed_by_name" TEXT NOT NULL,
    "proposed_by_email" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counter_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "negotiation_comments_organization_id_idx" ON "negotiation_comments"("organization_id");

-- CreateIndex
CREATE INDEX "negotiation_comments_organization_id_quotation_id_created_a_idx" ON "negotiation_comments"("organization_id", "quotation_id", "created_at");

-- CreateIndex
CREATE INDEX "negotiation_comments_organization_id_line_id_idx" ON "negotiation_comments"("organization_id", "line_id");

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_comments_organization_id_id_key" ON "negotiation_comments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "change_requests_organization_id_idx" ON "change_requests"("organization_id");

-- CreateIndex
CREATE INDEX "change_requests_organization_id_quotation_id_status_idx" ON "change_requests"("organization_id", "quotation_id", "status");

-- CreateIndex
CREATE INDEX "change_requests_organization_id_line_id_idx" ON "change_requests"("organization_id", "line_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_organization_id_id_key" ON "change_requests"("organization_id", "id");

-- CreateIndex
CREATE INDEX "counter_proposals_organization_id_idx" ON "counter_proposals"("organization_id");

-- CreateIndex
CREATE INDEX "counter_proposals_organization_id_quotation_id_status_idx" ON "counter_proposals"("organization_id", "quotation_id", "status");

-- CreateIndex
CREATE INDEX "counter_proposals_organization_id_line_id_idx" ON "counter_proposals"("organization_id", "line_id");

-- CreateIndex
CREATE UNIQUE INDEX "counter_proposals_organization_id_id_key" ON "counter_proposals"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "negotiation_comments" ADD CONSTRAINT "negotiation_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_comments" ADD CONSTRAINT "negotiation_comments_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_comments" ADD CONSTRAINT "negotiation_comments_organization_id_line_id_fkey" FOREIGN KEY ("organization_id", "line_id") REFERENCES "quotation_lines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_comments" ADD CONSTRAINT "negotiation_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_organization_id_line_id_fkey" FOREIGN KEY ("organization_id", "line_id") REFERENCES "quotation_lines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_proposals" ADD CONSTRAINT "counter_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_proposals" ADD CONSTRAINT "counter_proposals_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_proposals" ADD CONSTRAINT "counter_proposals_organization_id_line_id_fkey" FOREIGN KEY ("organization_id", "line_id") REFERENCES "quotation_lines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_proposals" ADD CONSTRAINT "counter_proposals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
