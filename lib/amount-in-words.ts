const ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function wholeWords(value: number): string {
  if (value < 20) return ones[value];
  if (value < 100) return tens[Math.floor(value / 10)] + (value % 10 ? `-${ones[value % 10]}` : "");
  for (const [scale, label] of [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [100, "Hundred"]] as const) {
    if (value >= scale) return `${wholeWords(Math.floor(value / scale))} ${label}${value % scale ? ` ${wholeWords(value % scale)}` : ""}`;
  }
  return "";
}

/** Indian/Nepali grouping; round once to the same two decimals printed on a bill. */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100) return "";
  const rounded = new Intl.NumberFormat("en-US", { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(amount));
  const [rupees, paisa] = rounded.split(".").map(Number);
  return `${amount < 0 && (rupees || paisa) ? "Minus " : ""}Rupees ${wholeWords(rupees)}${paisa ? ` and ${wholeWords(paisa)} Paisa` : ""} Only`;
}
