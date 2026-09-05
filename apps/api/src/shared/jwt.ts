import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export type UserRole = 'super_admin' | 'org_admin' | 'rep' | 'manager' | 'finance' | 'ops';

export type JwtTyp = 'internal' | 'super_admin' | 'customer';

export interface InternalJwtPayload {
  sub: string;
  email: string;
  org_id: string;
  role: Exclude<UserRole, 'super_admin'>;
  typ: 'internal';
}

export interface SuperAdminJwtPayload {
  sub: string;
  email: string;
  role: 'super_admin';
  typ: 'super_admin';
}

export interface CustomerJwtPayload {
  sub: string;
  email: string;
  org_id: string;
  quotation_ids: string[];
  typ: 'customer';
}

export type AppJwtPayload = InternalJwtPayload | SuperAdminJwtPayload | CustomerJwtPayload;

export function signInternalToken(
  payload: Omit<InternalJwtPayload, 'iat' | 'exp' | 'typ'>,
  expiresIn: SignOptions['expiresIn'] = '1d',
): string {
  return jwt.sign({ ...payload, typ: 'internal' }, env.JWT_SECRET, { expiresIn });
}

export function signSuperAdminToken(
  payload: Omit<SuperAdminJwtPayload, 'iat' | 'exp' | 'typ'>,
  expiresIn: SignOptions['expiresIn'] = '1d',
): string {
  return jwt.sign({ ...payload, typ: 'super_admin' }, env.JWT_SECRET, { expiresIn });
}

export function signCustomerToken(
  payload: Omit<CustomerJwtPayload, 'iat' | 'exp' | 'typ'>,
  expiresIn: SignOptions['expiresIn'] = '7d',
): string {
  return jwt.sign({ ...payload, typ: 'customer' }, env.JWT_SECRET, { expiresIn });
}

export function verifyJwt<T extends AppJwtPayload = AppJwtPayload>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET) as T;
}
