"use client";
import { adToBsParts, bsMonths, bsToAd } from "../lib/nepali-date";

export default function BsDateInput({value,onChange,min,max,includeTime=false,disabled=false}:{value:string;onChange:(value:string)=>void;min?:string;max?:string;includeTime?:boolean;disabled?:boolean}){
  const ad=value?.slice(0,10)||new Date().toLocaleDateString("en-CA");
  const parts=adToBsParts(ad);const time=value?.slice(11,16)||"09:00";
  function change(next:Partial<typeof parts>){const p={...parts,...next};let result=bsToAd(p.year,p.month,p.day);if(min&&result<min)result=min;if(max&&result>max)result=max;onChange(includeTime?`${result}T${time}`:result)}
  return <div className="bs-date-input">
    <select disabled={disabled} aria-label="Nepali year" value={parts.year} onChange={e=>change({year:Number(e.target.value)})}>{Array.from({length:12},(_,i)=>parts.year-5+i).map(y=><option key={y}>{y}</option>)}</select>
    <select disabled={disabled} aria-label="Nepali month" value={parts.month} onChange={e=>change({month:Number(e.target.value)})}>{bsMonths.map((m,i)=><option value={i+1} key={m}>{m}</option>)}</select>
    <select disabled={disabled} aria-label="Nepali day" value={parts.day} onChange={e=>change({day:Number(e.target.value)})}>{Array.from({length:32},(_,i)=>i+1).map(d=><option key={d}>{d}</option>)}</select>
    {includeTime&&<input disabled={disabled} aria-label="Time" type="time" value={time} onChange={e=>onChange(`${ad}T${e.target.value}`)}/>}<small>वि.सं.</small>
  </div>
}
