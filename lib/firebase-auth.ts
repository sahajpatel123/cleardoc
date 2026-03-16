import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from "firebase/auth"
import { auth } from "./firebase"
import { createUserProfile } from "./firestore"

const googleProvider = new GoogleAuthProvider()

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider)
  // createUserProfile failure must not break the auth flow — user is already signed in
  try { await createUserProfile(result.user.uid, result.user.email ?? "") } catch {}
  return result.user
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password)
  return result.user
}

export async function signUpWithEmail(
  email: string,
  password: string
): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password)
  await createUserProfile(result.user.uid, email)
  return result.user
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
}

export { onAuthStateChanged, auth }
export type { User }
