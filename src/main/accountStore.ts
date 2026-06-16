import { randomUUID } from 'crypto'
import ElectronStore, { type Schema } from 'electron-store'

export type AccountService = 'x' | 'bluesky' | 'threads'

export interface Account {
  id: string
  service: AccountService
  displayName: string
  username: string | null
  avatarUrl: string | null
  order: number
  isVisible: boolean
  createdAt: string
}

type AccountStoreSchema = {
  accounts: Account[]
}

const accountJsonSchema = {
  type: 'object',
  required: [
    'id',
    'service',
    'displayName',
    'username',
    'avatarUrl',
    'order',
    'isVisible',
    'createdAt',
  ],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    service: { type: 'string', enum: ['x', 'bluesky', 'threads'] },
    displayName: { type: 'string' },
    username: { type: ['string', 'null'] },
    avatarUrl: { type: ['string', 'null'] },
    order: { type: 'number', minimum: 0 },
    isVisible: { type: 'boolean' },
    createdAt: { type: 'string' },
  },
}

const schema: Schema<AccountStoreSchema> = {
  accounts: {
    type: 'array',
    default: [],
    items: accountJsonSchema,
  },
}

const store = new ElectronStore<AccountStoreSchema>({
  name: 'accounts',
  defaults: {
    accounts: [],
  },
  schema,
})

export function getAccounts(): Account[] {
  return store.get('accounts')
}

export function getAccountById(id: string): Account | undefined {
  return getAccounts().find((account) => account.id === id)
}

export function addAccount(data: Omit<Account, 'id' | 'createdAt'>): Account {
  const account: Account = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }

  store.set('accounts', [...getAccounts(), account])

  return account
}

export function updateAccount(id: string, patch: Partial<Account>): void {
  store.set(
    'accounts',
    getAccounts().map((account) => (account.id === id ? { ...account, ...patch, id } : account))
  )
}

export function removeAccount(id: string): void {
  store.set(
    'accounts',
    getAccounts().filter((account) => account.id !== id)
  )
}
