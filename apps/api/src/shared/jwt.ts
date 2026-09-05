import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export type UserRole = 'super_admin' | 'org_admin' | 'rep' | 'manager' | 'finance' | 'ops';

export interface InternalJwtPayload {
  sub: string;
  email: string;
  org_id: string;
  role: Exclude<UserRole, 'super_admin'>;
}

export interface SuperAdminJwtPayload {
  sub: string;
  email: string;
  role: 'super_admin';
}

export interface CustomerJwtPayload {
  sub: string;
  email: string;
  org_id: string;
  quotation_ids: string[];
}

export type AppJwtPayload = InternalJwtPayload | SuperAdminJwtPayload | CustomerJwtPayload;

export function signInternalToken(
  payload: Omit<InternalJwtPayload, 'iat' | 'exp'>,
  expiresIn: SignOptions['expiresIn'] = '1d',
): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

export function signSuperAdminToken(
  payload: Omit<SuperAdminJwtPayload, 'iat' | 'exp'>,
  expiresIn: SignOptions['expiresIn'] = '1d',
): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

export function signCustomerToken(
  payload: Omit<CustomerJwtPayload, 'iat' | 'exp'>,
  expiresIn: SignOptions['expiresIn'] = '7d',
): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

export function verifyJwt<T extends AppJwtPayload = AppJwtPayload>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET) as T;
}
