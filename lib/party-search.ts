export function matchingParties<T extends { name: string }>(parties: T[], search: string, limit = 20): T[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return parties.slice(0, limit);
  const matches = parties.filter(party => party.name.toLocaleLowerCase().startsWith(query));
  if (matches.length >= limit) return matches.slice(0, limit);
  const remaining = parties.filter(party => !party.name.toLocaleLowerCase().startsWith(query) && party.name.toLocaleLowerCase().split(/\s+/).some(word => word.startsWith(query)));
  return [...matches, ...remaining].slice(0, limit);
}
