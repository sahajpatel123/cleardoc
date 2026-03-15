import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore"
import { db } from "./firebase"
import type { UserProfile, Analysis, AnalysisResult } from "./types"

// ── User helpers ──────────────────────────────────────────────────────────────

export async function createUserProfile(uid: string, email: string) {
  const ref = doc(db, "users", uid)
  const existing = await getDoc(ref)
  if (existing.exists()) return

  const profile: Omit<UserProfile, "createdAt"> & { createdAt: unknown } = {
    email,
    createdAt: serverTimestamp(),
    plan: "free",
    subscriptionStatus: "inactive",
    freeUsesRemaining: 1,
  }
  await setDoc(ref, profile)
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "users", uid))
  if (!snap.exists()) return null
  const data = snap.data()
  return {
    ...data,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate()
        : new Date(),
  } as UserProfile
}

export async function decrementFreeUse(uid: string) {
  const ref = doc(db, "users", uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const current = snap.data().freeUsesRemaining ?? 0
  await updateDoc(ref, { freeUsesRemaining: Math.max(0, current - 1) })
}

export async function updateUserStripe(
  uid: string,
  data: {
    stripeCustomerId?: string
    stripeSubscriptionId?: string
    plan?: "free" | "pro"
    subscriptionStatus?: "active" | "inactive" | "cancelled"
  }
) {
  await updateDoc(doc(db, "users", uid), data)
}

export async function getUserByStripeCustomerId(
  customerId: string
): Promise<{ uid: string; profile: UserProfile } | null> {
  const q = query(
    collection(db, "users"),
    where("stripeCustomerId", "==", customerId)
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  const docSnap = snap.docs[0]
  const data = docSnap.data()
  return {
    uid: docSnap.id,
    profile: {
      ...data,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : new Date(),
    } as UserProfile,
  }
}

// ── Analysis helpers ──────────────────────────────────────────────────────────

export async function saveAnalysis(params: {
  userId: string
  documentName: string
  documentType: string
  storageUrl: string
  result: AnalysisResult
}): Promise<string> {
  const ref = await addDoc(collection(db, "analyses"), {
    ...params,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function getAnalysis(id: string): Promise<Analysis | null> {
  const snap = await getDoc(doc(db, "analyses", id))
  if (!snap.exists()) return null
  const data = snap.data()
  return {
    id: snap.id,
    ...data,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate()
        : new Date(),
  } as Analysis
}

export async function getUserAnalyses(uid: string): Promise<Analysis[]> {
  const q = query(
    collection(db, "analyses"),
    where("userId", "==", uid),
    orderBy("createdAt", "desc")
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      ...data,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : new Date(),
    } as Analysis
  })
}
