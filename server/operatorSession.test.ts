import { describe, expect, it } from "vitest";
import { parseOperatorSession, serializeOperatorSession } from "../shared/operatorSession";

describe("operator session persistence", () => {
  it("round-trips a valid hub session without changing its credentials", () => {
    const session = { url: " https://omega-hub-canonical.onrender.com/ ", key: " 12345678 " };
    expect(parseOperatorSession(serializeOperatorSession(session))).toEqual({
      url: "https://omega-hub-canonical.onrender.com/",
      key: "12345678",
    });
  });

  it("rejects malformed or unsafe stored sessions", () => {
    expect(parseOperatorSession(null)).toBeNull();
    expect(parseOperatorSession("not-json")).toBeNull();
    expect(parseOperatorSession(JSON.stringify({ url: "javascript:alert(1)", key: "12345678" }))).toBeNull();
    expect(parseOperatorSession(JSON.stringify({ url: "https://example.com", key: "short" }))).toBeNull();
  });
});
