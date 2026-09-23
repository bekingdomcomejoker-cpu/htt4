const DENY = [
  /rm\s+-rf\s+\/(\s|$)/i,
  /rm\s+-rf\s+--no-preserve-root/i,
  /mkfs\./i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  /dd\s+if=.*of=\s*\/dev\//i,
  /chmod\s+-R\s+777\s+\//,
  />\s*\/dev\/[sh]d/,
];

export function assertSafeCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command is empty.");
  }
  for (const pattern of DENY) {
    if (pattern.test(trimmed)) {
      throw new Error("That command is blocked by the console sandbox.");
    }
  }
  return trimmed;
}
