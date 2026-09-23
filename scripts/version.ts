import { execSync } from "node:child_process";

export function getVersion(): string {
  try {
    // Get the latest commit date
    const commitDate = execSync("git log -1 --format=%ci", {
      encoding: "utf-8",
    })
      .trim()
      .split(" ")[0]; // Extract YYYY-MM-DD

    if (!commitDate) {
      throw new Error("Could not get commit date");
    }

    const [year, month, day] = commitDate.split("-");
    const baseVersion = `${year}.${month}.${day}`;

    // Get all tags with their commit dates
    const tagsOutput = execSync("git tag -l --format='%(refname:short) %(creatordate:short)'", {
      encoding: "utf-8",
    });

    const tags: { tag: string; date: string }[] = tagsOutput
      .split("\n")
      .filter((line: string) => line.trim())
      .map((line: string) => {
        const parts = line.split(" ");
        return { tag: parts[0], date: parts[1] };
      });

    // Count tags that match today's date and start with the base version
    const tagsOnSameDay = tags
      .filter((t: { tag: string; date: string }) => t.date === commitDate && t.tag.startsWith(baseVersion))
      .sort();

    // Determine the letter (a, b, c, etc.)
    let letter = "a";
    if (tagsOnSameDay.length > 0) {
      const lastTag = tagsOnSameDay[tagsOnSameDay.length - 1].tag;
      const match = lastTag.match(/([a-z])$/);
      if (match) {
        const lastLetter = match[1];
        letter = String.fromCharCode(lastLetter.charCodeAt(0) + 1);
      }
    }

    return `${baseVersion}${letter}`;
  } catch {
    // Fallback for repos without git history
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}a`;
  }
}

// Print version if run directly via `bun run version`
if (process.argv[1]?.endsWith("version.ts")) {
  console.log(getVersion());
}
