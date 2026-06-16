import { session } from 'electron'

export type ServiceName = 'x' | 'bluesky' | 'threads'

export interface AccountKey {
  service: ServiceName
  accountId: string
}

export function getPartitionKey({ service, accountId }: AccountKey): string {
  return `persist:${service}-${accountId}`
}

export function getOrCreateSession({ service, accountId }: AccountKey): Electron.Session {
  return session.fromPartition(getPartitionKey({ service, accountId }))
}

export function buildChromeUA(): string {
  const chromeVersion = process.versions.chrome
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
}

export function applyUAToSession(ses: Electron.Session): void {
  const ua = buildChromeUA()
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = ua
    callback({ requestHeaders: details.requestHeaders })
  })
}
