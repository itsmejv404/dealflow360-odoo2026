import { prisma } from '../lib/prisma.js';

/**
 * Returns a Prisma client instance bounded to a specific tenant (organizationId).
 * Automatically scopes all model operations to `organizationId`.
 */
export function getTenantDb(organizationId: string) {
  return prisma.$extends({
    name: 'tenant-scoping',
    client: {
      tenantOrgId: organizationId,
    },
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          args.where = { ...(args.where || {}), organizationId } as typeof args.where;
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          args.where = { ...(args.where || {}), organizationId } as typeof args.where;
          return query(args);
        },
        async count({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          args.where = { ...(args.where || {}), organizationId } as typeof args.where;
          return query(args);
        },
        async create({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          args.data = { ...(args.data as Record<string, unknown>), organizationId } as typeof args.data;
          return query(args);
        },
        async createMany({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          if (Array.isArray(args.data)) {
            args.data = args.data.map((item: Record<string, unknown>) => ({
              ...item,
              organizationId,
            })) as typeof args.data;
          } else {
            args.data = { ...(args.data as Record<string, unknown>), organizationId } as typeof args.data;
          }
          return query(args);
        },
        async update({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          args.where = { ...(args.where || {}), organizationId } as typeof args.where;
          return query(args);
        },
        async updateMany({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          args.where = { ...(args.where || {}), organizationId } as typeof args.where;
          return query(args);
        },
        async delete({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          args.where = { ...(args.where || {}), organizationId } as typeof args.where;
          return query(args);
        },
        async deleteMany({ model, args, query }) {
          if (model === 'Organization' || model === 'DealflowMeta') {
            return query(args);
          }
          args.where = { ...(args.where || {}), organizationId } as typeof args.where;
          return query(args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof getTenantDb>;
