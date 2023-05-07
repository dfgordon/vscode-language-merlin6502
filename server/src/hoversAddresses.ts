import { assert } from 'console';
import * as vsserv from 'vscode-languageserver/node';
import * as a2map from 'a2-memory-map';

function MarkdownString(s: string): vsserv.MarkupContent
{
	return { kind: 'markdown', value: s };
}

export class AddressHovers
{
	/** Maps address to list of hovers, the hovers are in turn arrays of markup content.
	 *  The outer list corresponds to multi-context addresses. 
	 */
	amap: Map<number,Array<Array<vsserv.MarkupContent>>>;

	get(addr:number) : Array<Array<vsserv.MarkupContent>> | undefined
	{
		return this.amap.get(addr);
	}
	form_one_hover(addr_base: number,offset: number,obj: a2map.AddressInfo) : [number,Array<vsserv.MarkupContent>]
	{
		const hov = new Array<vsserv.MarkupContent>();
		const offset_names = Object({
			"word" : ["low byte","high byte"] , "vector" : ["opcode","low addr","high addr"],
			"float32" : [..."1234"], "float" : [..."12345"], "unpacked float": [..."123456"]
		});
		const addr = addr_base + offset;
		const addr_unsigned = addr < 0 ? addr + 2**16 : addr;
		const addr_signed = addr_unsigned - 2**16;
		const addr_hex = addr_unsigned.toString(16).toUpperCase();
		if (obj.label)
			hov.push(MarkdownString('`'+obj.label+'`'));
		let addr_type = obj.type;
		if (offset_names[addr_type])
			addr_type += ", " + offset_names[addr_type][offset];
		if (addr_unsigned>=2**15)
			hov.push(MarkdownString('Special address: **'+addr_type+'** ('+addr_unsigned+' | '+addr_signed+' | $'+addr_hex+')'));
		else
			hov.push(MarkdownString('Special address: **'+addr_type+'** ('+addr_unsigned+' | $'+addr_hex+')'));
		hov.push(MarkdownString(obj.desc));
		if (obj.ctx)
			hov.push(MarkdownString('Context limitation: ' + obj.ctx));
		if (obj.note)
			hov.push(MarkdownString('Note: ' + obj.note));
		return [addr_unsigned,hov];
	}
	add(addr_base: number, offset: number, obj: a2map.AddressInfo) {
		const [addr, hov] = this.form_one_hover(addr_base, offset, obj);
		if (!this.amap.has(addr))
			this.amap.set(addr, new Array<Array<vsserv.MarkupContent>>());
		this.amap.get(addr)?.push(hov);
	}
	constructor()
	{
		this.amap = new Map<number,Array<Array<vsserv.MarkupContent>>>();
		
		for (const [key,obj] of a2map.get_all())
		{
			let addr = parseInt(key);
			if (!isNaN(addr))
			{
				const contexts = a2map.get_one_and_split(addr);
				if (contexts) {
					for (const obj of contexts) {
						this.add(addr, 0, obj);
						const typ = obj.type;
						if (typ=="word")
							this.add(addr,1,obj);
						if (typ=="vector")
							[1,2].forEach( n => this.add(addr,n,obj) );
						if (typ=="float32")
							[1,2,3].forEach( n => this.add(addr,n,obj) );
						if (typ=="float")
							[1,2,3,4].forEach( n => this.add(addr,n,obj) );
						if (typ=="unpacked float")
							[1,2,3,4,5].forEach( n => this.add(addr,n,obj) );
					}
				}
			}
		}
	}
}