import { execSync } from "node:child_process";

export function hasNasm(): boolean {
	try {
		execSync("which ndisasm", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}
