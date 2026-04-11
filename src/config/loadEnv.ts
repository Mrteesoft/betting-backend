import { existsSync, readFileSync } from "fs";
import path from "path";

const stripInlineComment = (value: string) => {
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];

    if ((current === '"' || current === "'") && value[index - 1] !== "\\") {
      quote = quote === current ? null : current;
      continue;
    }

    if (current === "#" && quote === null) {
      return value.slice(0, index).trim();
    }
  }

  return value.trim();
};

const parseEnvValue = (rawValue: string) => {
  const value = stripInlineComment(rawValue);

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

const loadEnvFile = (filepath: string) => {
  if (!existsSync(filepath)) {
    return;
  }

  const content = readFileSync(filepath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = parseEnvValue(rawValue);
  }
};

export const loadLocalEnv = () => {
  const cwd = process.cwd();

  const candidates = [
    path.resolve(cwd, ".env.local"),
    path.resolve(cwd, ".env"),
    path.resolve(cwd, "backend/.env.local"),
    path.resolve(cwd, "backend/.env")
  ];

  candidates.forEach(loadEnvFile);
};
