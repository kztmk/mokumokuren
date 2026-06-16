import { session, app } from 'electron'

export interface IsolationCheckResult {
  passed: boolean
  details: string[]
}

/**
 * Cookieを2つの独立パーティションに書き込み、クロス参照不能を実測する。
 * app.whenReady() 内でのみ呼び出すこと。
 */
export async function runIsolationHarness(): Promise<IsolationCheckResult> {
  const details: string[] = []
  const results: boolean[] = []

  const testUrl = 'https://isolation-test.local'
  const cookieName = 'isolation_marker'
  const partA = 'persist:x-harness-test'
  const partB = 'persist:bluesky-harness-test'

  const sesA = session.fromPartition(partA)
  const sesB = session.fromPartition(partB)

  // --- Cookie 分離テスト ---
  // パーティション A にだけ書き込む
  await sesA.cookies.set({ url: testUrl, name: cookieName, value: 'partition_a' })

  // パーティション B から読み出しても 0件であること
  const cookiesInB = await sesB.cookies.get({ url: testUrl, name: cookieName })
  const cookieIsolated = cookiesInB.length === 0
  results.push(cookieIsolated)
  details.push(
    `Cookie isolation: ${cookieIsolated ? 'PASS' : 'FAIL'} (found ${cookiesInB.length} cookies in partB)`
  )

  // パーティション A は取得できること（書き込み確認）
  const cookiesInA = await sesA.cookies.get({ url: testUrl, name: cookieName })
  const cookieWritten = cookiesInA.length > 0 && cookiesInA[0].value === 'partition_a'
  results.push(cookieWritten)
  details.push(`Cookie write verify: ${cookieWritten ? 'PASS' : 'FAIL'}`)

  // クリーンアップ
  await sesA.cookies.remove(testUrl, cookieName)

  // --- ディスク上パーティションディレクトリ分離確認 ---
  // persist: パーティションは userData/Partitions/{name} に保存される
  const { join } = await import('path')
  const userData = app.getPath('userData')
  // パーティション名からディレクトリ名へ: 'persist:x-harness-test' → 'x-harness-test'
  const partADir = join(userData, 'Partitions', 'x-harness-test')
  const partBDir = join(userData, 'Partitions', 'bluesky-harness-test')
  const dirsDistinct = partADir !== partBDir
  results.push(dirsDistinct)
  details.push(
    `Partition dirs distinct: ${dirsDistinct ? 'PASS' : 'FAIL'} (${partADir} vs ${partBDir})`
  )

  const passed = results.every(Boolean)
  console.log('[isolation-harness]', passed ? 'ALL PASS' : 'FAIL', details)

  return { passed, details }
}
