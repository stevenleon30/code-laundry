import { execSync } from "node:child_process";

export function commitsOn(branch: string): string {
  return execSync("git log --oneline " + branch).toString();
}
