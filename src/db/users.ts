import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { activityLogs, users, type UserRow } from './schema.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string,
  avatarUrl?: string
): Promise<UserRow> {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName || email.split('@')[0] || 'Studio User',
        avatarUrl: avatarUrl || '',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          ...(displayName ? { displayName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to upsert user in PostgreSQL:', error);
    throw new Error('User synchronization failed.', { cause: error });
  }
}

export async function getUserByUid(uid: string): Promise<UserRow | null> {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to query user by UID:', error);
    throw new Error('Failed to load user profile.', { cause: error });
  }
}

export async function updateUserPreferences(
  userId: number,
  prefs: { preferredLocale?: string; preferredTheme?: string }
): Promise<UserRow> {
  try {
    const updated = await db
      .update(users)
      .set({
        ...(prefs.preferredLocale ? { preferredLocale: prefs.preferredLocale } : {}),
        ...(prefs.preferredTheme ? { preferredTheme: prefs.preferredTheme } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return updated[0];
  } catch (error) {
    console.error('Failed to update user preferences:', error);
    throw new Error('Failed to update user preferences.', { cause: error });
  }
}

export async function logActivity(
  userId: number,
  action: string,
  summary: string,
  projectId?: number | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      userId,
      projectId: projectId ?? null,
      action,
      summary,
      details,
    });
  } catch (error) {
    console.error('Failed to write activity log:', error);
  }
}
