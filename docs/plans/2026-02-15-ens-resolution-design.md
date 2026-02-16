# ENS Resolution for XMTP Extension

## Overview

Add ENS (Ethereum Name Service) resolution to the XMTP extension so that:

1. ENS names in inbound messages are resolved and included as context for the agent
2. Ethereum addresses in inbound messages are reverse-resolved to ENS names
3. Configuration fields (`ownerAddress`, `allowFrom`) accept ENS names
4. Conversation participants are resolved to ENS names and provided as context
5. The agent is instructed to refer to addresses by ENS name when available

Uses the [web3.bio API](https://api.web3.bio/) for resolution. Free tier with optional API key for higher rate limits.

## Section 1: Resolver Module (`lib/ens-resolver.ts`)

A standalone module wrapping the web3.bio API with caching.

### Functions

- `createEnsResolver(apiKey?: string)` — returns a resolver instance with:
  - `resolveEnsName(name: string): Promise<string | null>` — forward: `nick.eth` → `0x123...`
  - `resolveAddress(address: string): Promise<string | null>` — reverse: `0x123...` → `nick.eth`
  - `resolveAll(identifiers: string[]): Promise<Map<string, string | null>>` — batch resolve mixed names/addresses via `Promise.all`

### Caching

- `Map<string, { value: string | null; expiresAt: number }>` with 5-minute TTL
- Both forward and reverse lookups populate the cache bidirectionally (resolving `nick.eth` → `0x123` also caches the reverse)

### API Integration

- Uses `https://api.web3.bio/ns/ens/{identity}` for resolution
- Passes `X-API-KEY: Bearer {key}` header when API key is configured
- Graceful error handling: resolution failure returns `null`, never throws

### Extraction Helpers (pure, no API)

- `extractEnsNames(text: string): string[]` — regex for `*.eth` patterns in message text
- `extractEthAddresses(text: string): string[]` — regex for `0x[0-9a-fA-F]{40}` patterns
- `isEnsName(s: string): boolean` — checks if a string looks like an ENS name
- `isEthAddress(s: string): boolean` — checks if a string is a valid Ethereum address

## Section 2: Resolver Lifecycle & Configuration

### Config Addition (`config-types.ts`)

- Add `web3BioApiKey?: string` to `XMTPAccountConfig`

### Resolver Instance Management (in `lib/ens-resolver.ts`)

- One resolver instance per account, created at `startAccount` time
- Module-level map keyed by `accountId` (same pattern as `outbound.ts` for agent clients)
- `getResolverForAccount(accountId: string): EnsResolver | null`
- `setResolverForAccount(accountId: string, resolver: EnsResolver | null): void`

### Startup (`gateway-lifecycle.ts` `startAccount`)

- After `createAgentFromAccount`, create the ENS resolver using the account's `web3BioApiKey`
- If `ownerAddress` is an ENS name, resolve it to an address before `createDmWithAddress`
- Store the resolver via `setResolverForAccount`

### Shutdown (`gateway-lifecycle.ts` `stopAgent`)

- Clear the resolver instance for the account (garbage-collects the cache)

### DM Policy (`dm-policy.ts` `evaluateDmAccess`)

- Resolve ENS names in `allowFrom` entries to addresses before comparison
- Resolve `ownerAddress` if it's an ENS name (for the owner bypass check)
- Resolver passed in or fetched via `getResolverForAccount`

### Onboarding (`onboarding.ts`)

- Update `ownerAddress` validator to accept both `0x...` addresses and `*.eth` names
- No live resolution during onboarding — name stored as-is, resolved at runtime

## Section 3: Inbound Message Enrichment

### ENS Context for Message Text (`inbound-pipeline.ts`)

- Extract ENS names and Ethereum addresses from message `content`
- Batch-resolve: names → addresses, addresses → names
- If any resolve, prepend `[ENS Context: nick.eth = 0x1234...abcd, vitalik.eth = 0x5678...ef01]` to the `Body` field
- `RawBody` and `CommandBody` remain unchanged

### Sender Name Resolution

- In gateway-lifecycle handlers, resolve sender's address to ENS name
- Pass as `SenderName` in `finalizeInboundContext` (currently `undefined`)

### Group Participant Resolution

- For group conversations, call `conversation.members()` to get member list
- Extract Ethereum addresses from `accountIdentifiers`
- Batch-resolve all member addresses to ENS names
- Format as `GroupMembers` string: `nick.eth (0x1234…abcd), 0x5678…ef01, vitalik.eth (0x9abc…de23)`
- Pass as `GroupMembers` field in `finalizeInboundContext`

### Pipeline Parameter Changes

- `runInboundPipeline` gains optional: `senderName?: string`, `groupMembers?: string`, `ensContext?: string`
- Handlers do resolution work and pass results down
- Pipeline wires them into the context payload

## Section 4: Agent Prompt Instructions

### Agent Prompt (`channel.ts` `agentPrompt.messageToolHints`)

- Add hint: "When ENS names are available for Ethereum addresses, always refer to users by their ENS name rather than raw addresses."
- Reference ENS context in `[ENS Context: ...]` blocks and `GroupMembers`/`SenderName` fields

### Messaging Target Resolution (`channel.ts`)

- `looksLikeId` accepts ENS names (`*.eth`) as valid targets
- `normalizeXmtpMessagingTarget` resolves ENS names to addresses for outbound delivery

### Outbound Resolution (`outbound.ts`)

- Resolve ENS name targets to addresses before sending

## Section 5: Testing Strategy

### Resolver Module (`lib/ens-resolver.test.ts`)

- Pure function tests for extraction helpers (no mocking)
- Cache behavior: TTL expiry, bidirectional population
- API error handling: `null` return on failure, no throws
- Mock `fetch` for forward and reverse resolution

### DM Policy (`dm-policy.test.ts`)

- Cases where `ownerAddress` is an ENS name
- Cases where `allowFrom` contains ENS names
- Mock resolver with controlled values

### Inbound Pipeline (`inbound-pipeline.test.ts`)

- `[ENS Context: ...]` block prepended when addresses/names found
- No context block when message has no addresses or names
- `SenderName` and `GroupMembers` passed through correctly

### Gateway Lifecycle (`gateway-lifecycle.test.ts`)

- `ownerAddress` ENS resolution before `createDmWithAddress`
- Resolver created/stored at startup, cleaned up at shutdown
- Group member address resolution and formatting

### Onboarding

- Accepts `*.eth` names for `ownerAddress`
