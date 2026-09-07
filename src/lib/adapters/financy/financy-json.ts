/**
 * JSON.parse converts every JSON number through IEEE-754 first. Financy's live
 * financial-data API returns money in both string and number form, so number
 * lexemes are quoted before parsing and remain exact decimal strings.
 */
export function parseJsonPreservingNumbers(text: string): unknown {
  let output = "";
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < text.length) {
    const character = text[index];
    if (character === undefined) break;

    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      index += 1;
      continue;
    }

    if (character === "-" || /[0-9]/.test(character)) {
      const start = index;
      if (character === "-") index += 1;
      if (text[index] === "0") index += 1;
      else {
        while (index < text.length && /[0-9]/.test(text[index] ?? "")) index += 1;
      }
      if (text[index] === ".") {
        index += 1;
        while (index < text.length && /[0-9]/.test(text[index] ?? "")) index += 1;
      }
      if (text[index] === "e" || text[index] === "E") {
        index += 1;
        if (text[index] === "+" || text[index] === "-") index += 1;
        while (index < text.length && /[0-9]/.test(text[index] ?? "")) index += 1;
      }
      const numberLexeme = text.slice(start, index);
      output += JSON.stringify(numberLexeme);
      continue;
    }

    output += character;
    index += 1;
  }

  return JSON.parse(output) as unknown;
}
