import { test, describe } from "node:test"
import assert from "node:assert"
import { Semaphore } from "./semaphore"

describe("Semaphore", () => {
  test("acquires and releases correctly", async () => {
    const sem = new Semaphore(2)
    await sem.acquire()
    await sem.acquire()
    
    let acquired3 = false
    sem.acquire().then(() => { acquired3 = true })
    
    // allow microtasks to run
    await new Promise(r => setTimeout(r, 0))
    assert.strictEqual(acquired3, false)
    
    sem.release()
    await new Promise(r => setTimeout(r, 0))
    assert.strictEqual(acquired3, true)
  })

  test("removes from queue on timeout", async () => {
    const sem = new Semaphore(1)
    await sem.acquire()
    
    // Timeout acquire
    try {
      await sem.acquire(undefined, 10)
      assert.fail("Should have timed out")
    } catch (err: any) {
      assert.match(err.message, /timed out/)
    }
    
    // Now release the original
    sem.release()
    
    // Should be able to acquire again immediately because permits should be 1
    let acquired = false
    await sem.acquire(undefined, 10).then(() => { acquired = true })
    assert.strictEqual(acquired, true)
  })

  test("removes from queue on abort", async () => {
    const sem = new Semaphore(1)
    await sem.acquire()
    
    const ac = new AbortController()
    
    const p = sem.acquire(ac.signal, 1000)
    ac.abort()
    
    try {
      await p
      assert.fail("Should have aborted")
    } catch (err: any) {
      assert.match(err.message, /aborted/)
    }
    
    sem.release()
    
    let acquired = false
    await sem.acquire(undefined, 10).then(() => { acquired = true })
    assert.strictEqual(acquired, true)
  })
  
  test("handles multiple timeouts and aborts without corrupting queue", async () => {
    const sem = new Semaphore(1)
    await sem.acquire()
    
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    
    const p1 = sem.acquire(ac1.signal, 100).catch(() => {}) // will timeout
    const p2 = sem.acquire(undefined, 10).catch(() => {}) // will timeout first
    const p3 = sem.acquire(ac2.signal, 100).catch(() => {}) // will abort
    
    ac2.abort()
    
    await p2
    await p3
    await p1
    
    // all waiting tasks should be cleared
    sem.release()
    
    let acquired = false
    await sem.acquire(undefined, 10).then(() => { acquired = true })
    assert.strictEqual(acquired, true)
  })
})
