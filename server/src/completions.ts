import * as vsserv from 'vscode-languageserver';
import * as vsdoc from 'vscode-languageserver-textdocument';
import * as Parser from 'web-tree-sitter';
import * as a2map from 'a2-memory-map';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';
import * as lxbase from './langExtBase';
import * as labels from './labels';
import { merlin6502Settings } from './settings';

export class AddressCompletionProvider
{
	items : Array<vsserv.CompletionItem>;
	config: merlin6502Settings;
	constructor(settings: merlin6502Settings)
	{
		this.items = new Array<vsserv.CompletionItem>();
		this.config = settings;
		this.rebuild();
	}
	configure(settings: merlin6502Settings) {
		this.config = settings;
		this.rebuild();
	}
	rebuild()
	{
		this.items = new Array<vsserv.CompletionItem>();
		for (const [key,obj] of a2map.get_all())
		{
			if (!this.config.completions.ibas && obj.ctx=="Integer BASIC")
				continue;
			if (!this.config.completions.abas && obj.ctx=="Applesoft")
				continue;
			if (obj.type)
				this.items.push(this.get_completion_item(key,obj,'',''));
		}
	}
	get_completion_item(addr: string,addr_entry: a2map.AddressInfo,prefix: string,postfix: string) : vsserv.CompletionItem
	{
		let num_addr = parseInt(addr);
		num_addr = num_addr<0 ? num_addr+2**16 : num_addr;
		let addr_str = num_addr.toString(16);
		if (this.config.case.caseSensitive || !this.config.case.lowerCaseCompletions)
			addr_str = addr_str.toUpperCase();
		const it = vsserv.CompletionItem.create(prefix + addr_str + postfix);
		it.kind = vsserv.CompletionItemKind.Constant;
		it.documentation = addr_entry.desc;
		if (addr_entry.brief)
			it.detail = addr_entry.brief;
		else {
			const temp = addr_entry.desc as string;
			const temp2 = temp.lastIndexOf('.') == temp.length - 1 ? temp.substring(0, temp.length - 1) : temp;
			it.detail = temp2;
		}
		if (addr_entry.label) {
			it.insertText = it.label;
			it.insertTextFormat = vsserv.InsertTextFormat.PlainText;
			it.label += ' '.repeat(8-it.label.length) + addr_entry.label;
		}
		return it;
	}
	provideCompletionItems(document: vsdoc.TextDocument | undefined, position: vsdoc.Position) : vsserv.CompletionItem[]
	{
		if (!document)
			return [];
		
		let ans = new Array<vsserv.CompletionItem>();

		let linePrefix = document.getText(vsserv.Range.create(position.line,0,position.line,position.character));
		if (!this.config.case.caseSensitive)
			linePrefix = linePrefix.toUpperCase();
		if (linePrefix.search(/(EQU|=)\s+\$$/)>-1)
			ans = ans.concat(this.items);
		return ans;
	}
}

export class codeCompletionProvider extends lxbase.LangExtBase
{
	labelSentry: labels.LabelSentry;
	formatOnType = true; // TODO: get this from editor.formatOnType
	complMap = Object({
		'imm': '#${0:imm}',
		'abs': '${0:abs}',
		'zp': '${0:zp}',
		'rel': '${0:rel}',
		'rell': '${0:rell}',
		'absl': '${0:absl}',
		'(zp,x)': '(${1:zp},x)$0',
		'(abs,x)': '(${1:abs},x)$0',
		'(zp),y': '(${1:zp}),y$0',
		'zp,x': '${1:zp},x$0',
		'abs,x': '${1:abs},x$0',
		'absl,x': '${1:absl},x$0',
		'zp,y': '${1:zp},y$0',
		'abs,y': '${1:abs},y$0',
		'(abs)': '(${1:abs})$0',
		'(zp)': '(${1:zp})$0',
		'[d]': '[${1:d}]$0',
		'[d],y': '[${1:d}],y$0',
		'd,s': '${1:d},s$0',
		'(d,s),y': '(${1:d},s),y$0',
		'xyc': '${1:dstbnk},${0:srcbnk}',
		'impl': '',
		'accum': '',
		's': ''
	});
	constructor(TSInitResult : [Parser,Parser.Language], settings: merlin6502Settings, sentry: labels.LabelSentry)
	{
		super(TSInitResult,settings);
		this.labelSentry = sentry;
	}
	modify(s:string,padreq:number)
	{
		const pad = this.formatOnType ? padreq : 0;
		if (this.config.case.lowerCaseCompletions && !this.config.case.caseSensitive)
			return ' '.repeat(pad) + s.toLowerCase();
		else
			return ' '.repeat(pad) + s.toUpperCase();
	}
	add_label(ans: Array<vsserv.CompletionItem>,a2tok: Set<string>)
	{
		a2tok.forEach(s =>
		{
			if (s[0] == ':') {
				ans.push(vsserv.CompletionItem.create(s.substring(1)));
				ans[ans.length - 1].detail = "local";
				ans[ans.length - 1].kind = vsserv.CompletionItemKind.Constant;
			} else if (s[0] == ']') {
				ans.push(vsserv.CompletionItem.create(s.substring(1)));
				ans[ans.length - 1].detail = "variable";
				ans[ans.length - 1].kind = vsserv.CompletionItemKind.Variable;
			} else {
				ans.push(vsserv.CompletionItem.create(s));
				ans[ans.length - 1].detail = "global";
				ans[ans.length - 1].kind = vsserv.CompletionItemKind.Constant;
			}
		});
	}
	add_simple(ans: Array<vsserv.CompletionItem>,a2tok: string[])
	{
		a2tok.forEach(s =>
		{
			ans.push(vsserv.CompletionItem.create(this.modify(s, 0)));
			if (Object(opcodes)[s])
				ans[ans.length-1].detail = Object(opcodes)[s].brief;
			if (Object(pseudo)[s])
				ans[ans.length - 1].detail = Object(pseudo)[s].brief;
			ans[ans.length - 1].kind = vsserv.CompletionItemKind.Keyword;
		});
	}
	add_indirect_arg(ans: Array<vsserv.CompletionItem>, op: string, trig: string) {
		const req = ['6502','65c02','65c816'][this.xcCount];
		const opInfo = Object(opcodes)[op.toLowerCase()];
		if (opInfo)
		{
			const modeList = opInfo.modes;
			for (const mode of modeList)
			{
				const snip = this.complMap[mode.addr_mnemonic];
				if (mode.processors.includes(req) && snip && snip.length>0 && snip[0]==trig)
				{
					ans.push(vsserv.CompletionItem.create(this.modify(mode.addr_mnemonic, 0)));
					ans[ans.length - 1].detail = this.modify(op, 0) + " args";
					ans[ans.length - 1].kind = vsserv.CompletionItemKind.Value;
					ans[ans.length - 1].insertText = this.modify(snip.substring(1), 0);
					ans[ans.length - 1].insertTextFormat = vsserv.InsertTextFormat.Snippet;
				}
			}
		}
	}
	add_direct_index(ans: Array<vsserv.CompletionItem>, op: string) {
		const req = ['6502','65c02','65c816'][this.xcCount];
		const opInfo = Object(opcodes)[op.toLowerCase()];
		if (opInfo)
		{
			const modeList = opInfo.modes;
			const results = new Set<string>();
			for (const mode of modeList)
			{
				const snip = this.complMap[mode.addr_mnemonic];
				if (mode.processors.includes(req) && snip && snip.length > 0 &&
					mode.addr_mnemonic.slice(-2,-1) == ',' &&
					mode.addr_mnemonic[0] != '(' &&
					mode.addr_mnemonic[0] != '[' ) {
					results.add(this.modify(mode.addr_mnemonic.slice(-1), 0));
				}
			}
			for (const res of results) {
				ans.push(vsserv.CompletionItem.create(res));
				ans[ans.length - 1].detail = this.modify(op, 0) + " args";
				ans[ans.length - 1].kind = vsserv.CompletionItemKind.Value;
			}
		}
	}
	add_psop_args(ans: Array<vsserv.CompletionItem>,psop: string): number
	{
		const startingLength = ans.length;
		const psopInfo = Object(pseudo)[psop.toLowerCase()];
		if (psopInfo)
		{
			const args : string[] = psopInfo.enum;
			let v8x : string = psopInfo.v8x;
			let v16x : string = psopInfo.v16x;
			v8x = v8x?.substring(1,v8x.length-1);
			v16x = v16x?.substring(1,v16x.length-1);
			if (args)
			{
				args.forEach(s => {
					if (s.length>0)
					{
						const unsupported = (v8x && this.merlinVersion=='v8' && s.match(RegExp(v8x,'i'))) ||
							(v16x && this.merlinVersion=='v16' && s.match(RegExp(v16x,'i')));
						if (!unsupported)
						{
							ans.push(vsserv.CompletionItem.create(this.modify(s, 0)));
							ans[ans.length - 1].detail = this.modify(psop, 0) + " args";
							ans[ans.length - 1].kind = vsserv.CompletionItemKind.EnumMember;
							ans[ans.length - 1].insertText = this.modify(s, 0);
							ans[ans.length - 1].insertTextFormat = vsserv.InsertTextFormat.Snippet;
						}
					}
				});
			}
		}
		return ans.length - startingLength;
	}
	instructionHasArguments(lst:Array<{addr_mnemonic:string,code:number,cycles:number,processors:string[]}>) : boolean
	{
		if (lst==undefined)
			return false;
		for (const it of lst)
		{
			if (['accum','impl','s'].includes(it.addr_mnemonic))
				return false;
		}
		return true;
	}
	instructionEnabled(lst:Array<string>) : boolean
	{
		if (!lst)
			return false;
		if (lst.includes('6502'))
			return true;
		else if (lst.includes('65c02') && this.xcCount>0)
			return true;
		else if (lst.includes('65c816') && this.xcCount>1)
			return true;
		return false;
	}
	pseudoOpEnabled(lst:Array<string>) : boolean
	{
		if (lst && lst.includes(this.merlinVersion))
			return true;
		return false;
	}
	provideCompletionItems(document: vsdoc.TextDocument | undefined, position: vsserv.Position, trig: string | undefined): Array<vsserv.CompletionItem>
	{
		if (!document)
			return [];
		const shared = this.labelSentry.shared.get(document.uri);
		if (!shared)
			return [];
		const ans = new Array<vsserv.CompletionItem>();
		const simple = new Array<string>();
		const label = new Set<string>();
		let psop_args = 0;
		const linePrefix = document.getText(vsserv.Range.create(position.line,0,position.line,position.character));
		if (linePrefix.charAt(0)=='*')
			return [];
		this.GetProperties(document.getText().split(/\r?\n/));
		if (linePrefix.search(/^\S*\s+[A-Za-z]$/)>-1) // start of opcode column?
		{
			for (const k of Object.keys(opcodes))
				if (this.instructionEnabled(Object(opcodes)[k].processors))
					simple.push(k);
			for (const k of Object.keys(pseudo))
				if (this.pseudoOpEnabled(Object(pseudo)[k].version))
					simple.push(k);
			for (const k of shared.macros.keys())
				label.add(k);
		}
		if (linePrefix.search(/^:$/)>-1 || linePrefix.search(/^\S*\s+\S+\s+:$/)>-1) // pressed `:` in first or third column
		{
			for (const k of shared.locals.keys())
				label.add(k.substring(k.indexOf('\u0100')+1));
		}
		if (linePrefix.search(/^]$/)>-1 || linePrefix.search(/^\S*\s+\S+\s+]$/)>-1) // pressed `]` in first or third column
		{
			for (const k of shared.vars.keys())
				label.add(k);
		}
		if (linePrefix.search(/^[a-zA-Z]$/)>-1) // pressed alpha in first column
		{
			for (const k of shared.globals.keys())
				label.add(k);
		}
		if (linePrefix.search(/^\S*\s+\S+\s+[a-zA-Z]$/)>-1) // alpha in third column as pseudo-op arguments
		{
			const instruction_match = linePrefix.match(/^\S*\s+(\S+)/);
			if (instruction_match)
				psop_args = this.add_psop_args(ans,instruction_match[1]);
		}
		if (psop_args==0 && linePrefix.search(/^\S*\s+\S+\s+[#([<>|^]?[a-zA-Z]$/)>-1) // label in third column
		{
			const instruction_match = linePrefix.match(/^\S*\s+[pP][mM][cC]/);
			if (instruction_match) {
				for (const k of shared.macros.keys())
					label.add(k)
			} else {
				for (const k of shared.globals.keys())
					label.add(k);
			}
		}
		if (linePrefix.search(/^\S*\s+\S+\s+[([]$/)>-1) // started an indirect indexed addressing mode
		{
			const instruction_match = linePrefix.match(/^\S*\s+(\S+)/);
			if (instruction_match && trig)
			{
				this.add_indirect_arg(ans,instruction_match[1],trig);
			}
		}
		if (linePrefix.search(/^\S*\s+\S+\s+\S+,$/)>-1) // completing a direct indexed addressing mode
		{
			const instruction_match = linePrefix.match(/^\S*\s+(\S+)/);
			if (instruction_match && trig)
			{
				this.add_direct_index(ans,instruction_match[1]);
			}
		}
		this.add_simple(ans,simple);
		this.add_label(ans,label);

		return ans;
	}
}
