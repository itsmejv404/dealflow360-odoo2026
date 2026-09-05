-- Drop the tier rank concept; display ordering now uses creation order (S.No in UI).
ALTER TABLE "customer_tiers" DROP COLUMN "rank";
