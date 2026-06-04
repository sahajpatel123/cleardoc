/**
 * Pending upload handoff: in-memory for fast SPA navigation + IndexedDB
 * so refresh/login redirects do not lose the file.
 *
 * FAILURE INJECTION SWARM NOTES (high-risk surface):
 * - Rapid multi-tab / navigation: last setPending wins in IDB (shared origin store).
 * - take() is destructive (clears both memory + IDB) — double-take or concurrent
 *   takes from React effects are a real footgun (see /analyze/session/page.tsx).
 * - All IDB errors are surfaced via captureException — silent data loss was
 *   the previous failure mode; see the comment block in setPendingAnalysis.
 * - No AbortSignal propagation from the eventual /api/analyze fetch in runAnalysis
 *   → client disconnect mid-vision/AI still burns full NVIDIA call on server.
 * - parentAnalysisId for Pro case-linking must survive the roundtrip intact.
 * Any change here requires re-running the mental cases documented in AUDIT.md §7
 * and the injected comments in free-quota.test.ts / validate-analysis.test.ts.
 */
import { captureException } from "@/lib/observability"

export type PendingAnalysisPayload = {
  file: File
  context: string
  parentAnalysisId?: string
}

const DB_NAME = "cleardoc-pending"
const STORE = "pending"
const KEY = "current"

let memory: PendingAnalysisPayload | null = null
let _dbPromise: Promise<IDBDatabase> | null = null

type StoredRecord = {
  blob: Blob
  fileName: string
  fileType: string
  context: string
  parentAnalysisId?: string
  consumed?: boolean
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"))
  }
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => {
      _dbPromise = null
      reject(request.error ?? new Error("IndexedDB open failed"))
    }
    request.onsuccess = () => {
      const db = request.result
      db.addEventListener("close", () => {
        _dbPromise = null
      })
      resolve(db)
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
  })
  return _dbPromise
}

async function persistToIdb(payload: PendingAnalysisPayload): Promise<void> {
  try {
    const db = await openDb()
    const record: StoredRecord = {
      blob: payload.file,
      fileName: payload.file.name,
      fileType: payload.file.type || "application/octet-stream",
      context: payload.context,
      parentAnalysisId: payload.parentAnalysisId,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"))
      tx.objectStore(STORE).put(record, KEY)
    })
  } catch (err) {
    captureException(err, { component: "pending-analysis", extra: { phase: "idb-persist" } })
  }
}

async function readFromIdb(): Promise<PendingAnalysisPayload | null> {
  try {
    const db = await openDb()
    const record = await new Promise<StoredRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB read failed"))
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result as StoredRecord | undefined)
      req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"))
    })
    if (!record?.blob) return null
    // Crash recovery: skip consumed records
    if (record.consumed === true) return null
    const file = new File([record.blob], record.fileName, {
      type: record.fileType || "application/octet-stream",
    })
    return {
      file,
      context: record.context ?? "",
      parentAnalysisId: record.parentAnalysisId,
    }
  } catch (err) {
    captureException(err, { component: "pending-analysis", extra: { phase: "idb-read" } })
    return null
  }
}

// Mark the in-memory record as consumed without deleting. Used for crash recovery.
// If a page crashes after take() but before clear(), the next page load can still
// recover the data, but won't re-process if marked consumed.
async function markIdbConsumed(): Promise<void> {
  try {
    const db = await openDb()
    // Read the current record, set consumed flag, and write back
    const record = await new Promise<StoredRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB read failed"))
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result as StoredRecord | undefined)
      req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"))
    })
    if (record && record.blob) {
      record.consumed = true
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite")
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"))
        tx.objectStore(STORE).put(record, KEY)
      })
    }
  } catch (err) {
    captureException(err, { component: "pending-analysis", extra: { phase: "idb-mark-consumed" } })
  }
}

// Returns true if IndexedDB was cleared. If false, stale data may remain for the next tab/page load — callers have already consumed the in-memory value so this is a best-effort cleanup.
async function clearIdb(): Promise<boolean> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"))
      tx.objectStore(STORE).delete(KEY)
    })
    return true
  } catch (err) {
    captureException(err, { component: "pending-analysis", extra: { phase: "idb-clear" } })
    return false
  }
}

export async function setPendingAnalysis(payload: PendingAnalysisPayload): Promise<void> {
  memory = payload
  await persistToIdb(payload)
}

/**
 * Mark the pending analysis as "consumed" without fully deleting it.
 * Returns the payload for immediate use. If the caller crashes after this
 * returns but before they actually submit to /api/analyze, the stale data
 * can be recovered on a fresh page load (graceful crash recovery) but will
 * be skipped because we mark it consumed in IndexedDB.
 *
 * The caller MUST call `clearPendingAnalysis()` after a successful submit.
 */
export async function takePendingAnalysis(): Promise<PendingAnalysisPayload | null> {
  // Return in-memory value without clearing — let clearPendingAnalysis handle cleanup
  if (memory) {
    // Mark IDB as consumed for crash recovery. If the page crashes after this
    // returns but before clearPendingAnalysis(). is called, the next page load
    // will see the consumed flag and return null instead of re-processing.
    void markIdbConsumed()
    return memory
  }
  // For IndexedDB fallback: read the data, then mark as consumed
  const fromIdb = await readFromIdb()
  if (fromIdb) {
    // Mark as consumed for crash recovery - idempotent
    void markIdbConsumed()
  }
  return fromIdb
}

export async function clearPendingAnalysis(): Promise<void> {
  memory = null
  await clearIdb()
}
