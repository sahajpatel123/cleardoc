/**
 * Pending upload handoff: in-memory for fast SPA navigation + IndexedDB
 * so refresh/login redirects do not lose the file.
 */
export type PendingAnalysisPayload = {
  file: File
  context: string
}

const DB_NAME = "cleardoc-pending"
const STORE = "pending"
const KEY = "current"

let memory: PendingAnalysisPayload | null = null

type StoredRecord = {
  blob: Blob
  fileName: string
  fileType: string
  context: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
  })
}

async function persistToIdb(payload: PendingAnalysisPayload): Promise<void> {
  try {
    const db = await openDb()
    const record: StoredRecord = {
      blob: payload.file,
      fileName: payload.file.name,
      fileType: payload.file.type || "application/octet-stream",
      context: payload.context,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"))
      tx.objectStore(STORE).put(record, KEY)
    })
    db.close()
  } catch (err) {
    console.warn("[pending-analysis] IndexedDB persist failed:", err)
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
    db.close()
    if (!record?.blob) return null
    const file = new File([record.blob], record.fileName, {
      type: record.fileType || "application/octet-stream",
    })
    return { file, context: record.context ?? "" }
  } catch (err) {
    console.warn("[pending-analysis] IndexedDB read failed:", err)
    return null
  }
}

async function clearIdb(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"))
      tx.objectStore(STORE).delete(KEY)
    })
    db.close()
  } catch {
    // ignore
  }
}

export async function setPendingAnalysis(payload: PendingAnalysisPayload): Promise<void> {
  memory = payload
  await persistToIdb(payload)
}

export async function takePendingAnalysis(): Promise<PendingAnalysisPayload | null> {
  if (memory) {
    const value = memory
    memory = null
    await clearIdb()
    return value
  }
  const fromIdb = await readFromIdb()
  if (fromIdb) await clearIdb()
  return fromIdb
}

export async function clearPendingAnalysis(): Promise<void> {
  memory = null
  await clearIdb()
}
