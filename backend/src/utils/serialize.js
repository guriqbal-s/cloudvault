// Prisma returns BigInt for sizes/quotas and JSON.stringify throws on BigInt.
// Used as Express's "json replacer": safe integers become numbers, larger ones strings.

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') {
    return value <= MAX_SAFE && value >= -MAX_SAFE ? Number(value) : value.toString();
  }
  return value;
}
