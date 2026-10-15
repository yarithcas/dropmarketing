import { describe, expect, it } from "vitest";
import { csvCell, csvRow, neutralizeFormula } from "@/lib/csv";

describe("csv", () => {
  it("neutralises text a spreadsheet would evaluate", () => {
    for (const s of ["=SUM(A1:A2)", "+cmd", "-cmd|' /C calc'!A0", "@SUM(1)", "\tcmd", "\r=1+1", "-", "+", "-12.5abc"]) {
      expect(neutralizeFormula(s)).toBe(`'${s}`);
    }
  });
  it("leaves ordinary and numeric text untouched", () => {
    for (const s of ["Smart jump rope", "a=b", "email@example.com", "-12.5", "+3", "1e-4", "-0.5", ".5", ""]) {
      expect(neutralizeFormula(s)).toBe(s);
    }
  });
  it("keeps real numbers numeric and unquoted, including negatives", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe("");
  });
  it("writes unknown values as empty fields, never as zero", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("quotes text and escapes embedded quotes, commas and line breaks", () => {
    expect(csvCell('Say "hi", then\nleave')).toBe('"Say ""hi"", then\nleave"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell(true)).toBe("true");
  });
  it("serialises a row", () => {
    expect(csvRow(["opportunity", "=cmd", -3.2, null, "\tx", "-7"])).toBe('"opportunity","\'=cmd",-3.2,,"\'\tx","-7"');
  });
});
