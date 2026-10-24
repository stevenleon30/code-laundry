import { parseCsvFast } from "fast-csv-parser-pro";

export function loadRows(text: string): string[][] {
  return parseCsvFast(text, { delimiter: "," });
}
