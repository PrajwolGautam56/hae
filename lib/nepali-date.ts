import NepaliDate from "nepali-date-converter";

const parseAd = (value: string) => new Date(`${value.slice(0,10)}T12:00:00`);
const pad = (n: number) => String(n).padStart(2,"0");

export function adToBsParts(value: string) {
  const d = new NepaliDate(parseAd(value));
  return { year:d.getYear(), month:d.getMonth()+1, day:d.getDate() };
}
export function bsToAd(year:number,month:number,day:number) {
  const d = new NepaliDate(year,month-1,day).toJsDate();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
export function formatBs(value?: string, withTime=false) {
  if(!value)return "—";
  const text=new NepaliDate(parseAd(value)).format("DD MMMM YYYY","np");
  if(!withTime||!value.includes("T"))return text;
  const d=new Date(value);return `${text} · ${d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`;
}

export const bsMonths=["बैशाख","जेठ","असार","श्रावण","भाद्र","आश्विन","कार्तिक","मंसिर","पौष","माघ","फाल्गुण","चैत्र"];
