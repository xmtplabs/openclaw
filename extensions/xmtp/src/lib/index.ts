/**
 * Barrel file for lib/ — re-exports public API from sub-modules.
 */

export { enforceInboundAccessControl } from "./access-control.js";

export {
  isEnsName,
  isEthAddress,
  extractEnsNames,
  extractEthAddresses,
  createEnsResolver,
  getResolverForAccount,
  setResolverForAccount,
  resolveOwnerAddress,
  formatEnsContext,
  formatGroupMembersWithEns,
  type EnsResolver,
} from "./ens-resolver.js";

export {
  generateEncryptionKeyHex,
  generatePrivateKey,
  walletAddressFromPrivateKey,
  generateXmtpIdentity,
} from "./identity.js";

export {
  runTemporaryXmtpClient,
  createAgentFromAccount,
  getOrCreateConversation,
  ensureHexPrefix,
} from "./xmtp-client.js";
