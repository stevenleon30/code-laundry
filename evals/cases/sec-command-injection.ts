import { exec } from "node:child_process";

export function convert(file: string): void {
  exec(`convert ${file} output.png`, (err) => {
    if (err) throw err;
  });
}
