/** Random bootstrap credential; never display or email this value to a user.
 * Supabase Auth's bcrypt input limit is 72 bytes. Both UUIDs are ASCII and
 * removing separators leaves 64 random hex characters plus the policy suffix.
 */
export function createTemporaryPassword(): string {
  return `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}Aa1!`;
}
