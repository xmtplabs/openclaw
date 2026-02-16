import { describe, expect, it } from "vitest";
import { extractEnsNames, extractEthAddresses, isEnsName, isEthAddress } from "./ens-resolver.js";

describe("isEnsName", () => {
  it("returns true for simple .eth name", () => {
    expect(isEnsName("nick.eth")).toBe(true);
  });

  it("returns true for subdomain .eth name", () => {
    expect(isEnsName("pay.nick.eth")).toBe(true);
  });

  it("returns false for bare string", () => {
    expect(isEnsName("nick")).toBe(false);
  });

  it("returns false for ethereum address", () => {
    expect(isEnsName("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEnsName("")).toBe(false);
  });
});

describe("isEthAddress", () => {
  it("returns true for valid checksum address", () => {
    expect(isEthAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
  });

  it("returns true for lowercase address", () => {
    expect(isEthAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(true);
  });

  it("returns false for short hex", () => {
    expect(isEthAddress("0xd8da6b")).toBe(false);
  });

  it("returns false for ENS name", () => {
    expect(isEthAddress("vitalik.eth")).toBe(false);
  });
});

describe("extractEnsNames", () => {
  it("extracts .eth names from text", () => {
    expect(extractEnsNames("send 1 ETH to nick.eth please")).toEqual(["nick.eth"]);
  });

  it("extracts multiple names", () => {
    const result = extractEnsNames("nick.eth and vitalik.eth are friends");
    expect(result).toEqual(["nick.eth", "vitalik.eth"]);
  });

  it("extracts subdomain names", () => {
    expect(extractEnsNames("check pay.nick.eth")).toEqual(["pay.nick.eth"]);
  });

  it("deduplicates", () => {
    expect(extractEnsNames("nick.eth sent to nick.eth")).toEqual(["nick.eth"]);
  });

  it("returns empty array for no matches", () => {
    expect(extractEnsNames("no names here")).toEqual([]);
  });

  it("filters parent when subdomain present", () => {
    const result = extractEnsNames("pay.nick.eth and nick.eth");
    expect(result).toEqual(["pay.nick.eth"]);
  });

  it("extracts case-insensitive .eth names", () => {
    expect(extractEnsNames("send to NICK.ETH please")).toEqual(["NICK.ETH"]);
  });
});

describe("extractEthAddresses", () => {
  it("extracts addresses from text", () => {
    const addr = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    expect(extractEthAddresses(`send to ${addr}`)).toEqual([addr]);
  });

  it("extracts multiple addresses", () => {
    const a1 = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const a2 = "0x1234567890abcdef1234567890abcdef12345678";
    expect(extractEthAddresses(`${a1} and ${a2}`)).toEqual([a1, a2]);
  });

  it("deduplicates", () => {
    const addr = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    expect(extractEthAddresses(`${addr} ${addr}`)).toEqual([addr]);
  });

  it("returns empty for no matches", () => {
    expect(extractEthAddresses("no addresses")).toEqual([]);
  });
});
