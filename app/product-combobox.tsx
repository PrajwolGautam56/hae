"use client";
import{useId,useState}from"react";
import{matchingProducts,type SearchProduct}from"../lib/product-search";
import"./product-combobox.css";
export default function ProductCombobox({products,value,selectedId,label,inputRef,onInput,onSelect}:{products:SearchProduct[];value:string;selectedId:string;label:string;inputRef?:(element:HTMLInputElement|null)=>void;onInput:(text:string)=>void;onSelect:(product:SearchProduct)=>void}){
  const id=useId(),[open,setOpen]=useState(false),[active,setActive]=useState(0);
  const matches=matchingProducts(products,value),count=matches.length+1;
  function choose(index:number){if(index<matches.length)onSelect(matches[index]);else onInput(value);setOpen(false);}
  return <div className="product-combobox"><input ref={inputRef} role="combobox" aria-label={label} autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open?`${id}-option-${Math.min(active,count-1)}`:undefined} value={value} placeholder="Type product name or SKU" onFocus={()=>{setOpen(true);setActive(0);}} onBlur={()=>setOpen(false)} onChange={event=>{onInput(event.target.value);setActive(0);setOpen(true);}} onKeyDown={event=>{if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setOpen(true);setActive(index=>(index+(event.key==="ArrowDown"?1:-1)+count)%count);}else if(event.key==="Enter"&&open){event.preventDefault();choose(Math.min(active,count-1));}else if(event.key==="Escape"){event.preventDefault();setOpen(false);}}}/>
    {open&&<div id={`${id}-options`} role="listbox" aria-label={`${label} suggestions`} className="product-combobox-options">{matches.map((product,index)=><button type="button" tabIndex={-1} role="option" id={`${id}-option-${index}`} key={product.id} aria-selected={active===index} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(index)}><strong>{product.name}</strong><small>{product.sku?`${product.sku} · `:""}Stock {product.stock_qty??0} {product.unit||"pcs"}</small></button>)}{!matches.length&&<p>No matching saved product.</p>}<button type="button" tabIndex={-1} role="option" id={`${id}-option-${matches.length}`} aria-selected={active===matches.length} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(matches.length)}>Use typed name as custom / non-inventory item</button></div>}
    <small className="product-combobox-hint">{selectedId?"Saved product selected · stock is linked to this invoice":"Custom / non-inventory until you select a saved product · stock will not change"}</small>
  </div>;
}
