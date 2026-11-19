import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getOrCreateUser } from '../db/users.ts';
import type { UserRow } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: UserRow;
}

export async function verifyBearerToken(token: string): Promise<DecodedIdToken> {
  return await adminAuth.verifyIdToken(token);
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'احراز هویت الزامی است. لطفاً وارد حساب کاربری خود شوید.',
      code: 'AUTH_MISSING_TOKEN',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({
      error: 'توکن احراز هویت نامعتبر است.',
      code: 'AUTH_EMPTY_TOKEN',
    });
    return;
  }

  try {
    const decodedToken = await verifyBearerToken(token);
    req.user = decodedToken;

    const email = decodedToken.email || `${decodedToken.uid}@studio.local`;
    const dbUser = await getOrCreateUser(
      decodedToken.uid,
      email,
      decodedToken.name || undefined,
      decodedToken.picture || undefined
    );
    req.dbUser = dbUser;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({
      error: 'نشست کاربری منقضی شده یا نامعتبر است. دوباره وارد شوید.',
      code: 'AUTH_INVALID_TOKEN',
    });
  }
};
