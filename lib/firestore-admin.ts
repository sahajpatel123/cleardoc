/**
 * Server-side Firestore helpers using Firebase Admin SDK.
 * Use these in API routes — they bypass security rules and require no user auth context.
 * Never import this file in client components.
 */
import admin from "firebase-admin"
import type { AnalysisResult, UserProfile, Analysis } from "./types"

/**
 * Robustly parse the Firebase private key from environment variable.
 * Handles all common Vercel copy-paste formats:
 *   - literal \n characters  →  real newlines
 *   - surrounding quotes     →  stripped
 *   - already has newlines   →  left as-is
 */
function parsePrivateKey(raw: string | undefined): string {
  if (!raw) return ""
  // Strip surrounding double or single quotes (common copy-paste mistake in Vercel UI)
  let key = raw.trim().replace(/^["']|["']$/g, "")
  // If the key doesn't yet contain real newlines, convert literal \n sequences
  if (!key.includes("\n")) {
    key = key.replace(/\\n/g, "\n")
  }
  return key
}

function initAdminApp() {
  if (admin.apps.length > 0) return admin.app()
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  })
}

function getAdminDb() {
  initAdminApp()
  return admin.firestore()
}

/** Exported so API routes can use admin.auth() without re-initializing */
export function getAdminAuth() {
  initAdminApp()
  return admin.auth()
}

export async function adminGetUserProfile(uid: string): Promise<UserProfile | null> {
  const db = getAdminDb()
  const snap = await db.collection("users").doc(uid).get()
  if (!snap.exists) return null
  const data = snap.data()!
  return {
    ...data,
    createdAt: data.createdAt?.toDate?.() ?? new Date(),
  } as UserProfile
}

export async function adminCreateUserProfile(uid: string, email: string) {
  const db = getAdminDb()
  const ref = db.collection("users").doc(uid)
  const existing = await ref.get()
  if (existing.exists) return
  await ref.set({
    email,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    plan: "free",
    subscriptionStatus: "inactive",
    freeUsesRemaining: 1,
  })
}

export async function adminDecrementFreeUse(uid: string) {
  const db = getAdminDb()
  const ref = db.collection("users").doc(uid)
  const snap = await ref.get()
  if (!snap.exists) return
  const current = snap.data()?.freeUsesRemaining ?? 0
  await ref.update({ freeUsesRemaining: Math.max(0, current - 1) })
}

export async function adminSaveAnalysis(params: {
  userId: string
  documentName: string
  documentType: string
  result: AnalysisResult
}): Promise<string> {
  // storageUrl: file storage not yet implemented. Do not add copy claiming 30-day retention.
  const db = getAdminDb()
  const ref = await db.collection("analyses").add({
    ...params,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return ref.id
}

export async function adminGetUserAnalysis(
  uid: string,
  analysisId: string
): Promise<Analysis | null> {
  const db = getAdminDb()
  const docSnap = await db.collection("analyses").doc(analysisId).get()
  if (!docSnap.exists) return null
  const data = docSnap.data()!
  if (data.userId !== uid) return null
  return {
    id: docSnap.id,
    ...data,
    createdAt: data.createdAt?.toDate?.() ?? new Date(),
  } as Analysis
}

export async function adminUpdateUserStripe(
  uid: string,
  data: {
    stripeCustomerId?: string
    stripeSubscriptionId?: string
    plan?: "free" | "pro"
    subscriptionStatus?: "active" | "inactive" | "cancelled"
  }
) {
  const db = getAdminDb()
  await db.collection("users").doc(uid).update(data)
}

export async function adminGetUserByStripeCustomerId(
  customerId: string
): Promise<{ uid: string; profile: UserProfile } | null> {
  const db = getAdminDb()
  const snap = await db
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get()
  if (snap.empty) return null
  const docSnap = snap.docs[0]
  const data = docSnap.data()
  return {
    uid: docSnap.id,
    profile: {
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? new Date(),
    } as UserProfile,
  }
}

// REQUIRES Firestore composite index: userId ASC + createdAt DESC
// Create at: Firebase Console → Firestore → Indexes → Add index
// Collection: analyses | Fields: userId ASC, createdAt DESC
export async function adminGetUserAnalyses(uid: string): Promise<Analysis[]> {
  const db = getAdminDb()
  const snap = await db
    .collection("analyses")
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .get()
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? new Date(),
    } as Analysis
  })
}
