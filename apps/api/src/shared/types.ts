import type { Permission, Role } from "@billing/domain";

export type TenantContext = {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  userEmail: string;
  role: Role;
  permissions: Permission[];
};

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}
