import * as vsserv from 'vscode-languageserver';
import * as lxbase from './langExtBase';
import * as opcodes from './opcodes.json';
import * as Parser from 'web-tree-sitter';
import * as labels from './labels';
import { merlin6502Settings } from './settings';

type OpData =
{
	// This is the value in a map with opcodes as the key.
	// operand is a template such as (1),y, where the decimal
	// digit is the bytes of binary data, as well as a placeholder.
	// xc is the number of XC pseudo-ops needed to enable.
	mnemonic : string,
	operand : string,
	xc : number,
	relative : boolean,
	immediate : boolean
}

export type DisassemblyParams = {
	getWhat: string,
	imgOffset: number,
	addrRange: [number, number],
	xc: number,
	label: string
}

/**
 * Format line of code, assuming a unique token has been put in for the separators
 * @param line line to format
 * @param sep the column separator token, assumed to be unique
 * @param widths the widths of columns 1,2,3
 */
function formatTokens(line: string, sep: string, widths: number[]): string {
	const cols = line.split(sep);
	let formattedLine = '';
	for (let i=0;i<cols.length;i++)
	{
		let prepadding = 0;
		if (cols[i].charAt(0)==';')
			for (let j=i;j<3;j++)
				prepadding += widths[j];
		const padding = widths[i] - cols[i].length;
		formattedLine += ' '.repeat(prepadding) + cols[i];
		if (i+1 < cols.length)
			formattedLine += (padding > 0 ? ' '.repeat(padding) : ' ');
	}
	return formattedLine;
}

export class FormattingTool extends lxbase.LangExtBase
{
	labelSentry: labels.LabelSentry;
	formattedLine = "";
	formattedCode = "";
	callToken = '\u0100';
	persistentSpace = '\u0100';
	widths = [9, 6, 11];
	doNotFormat = ['dstring', 'txt', 'literal'];
	// following taken from completions and has extra info.
	// here we only need to know if the value is empty or not.
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
	constructor(TSInitResult : [Parser,Parser.Language], logger: lxbase.Logger, settings: merlin6502Settings, sentry: labels.LabelSentry)
	{
		super(TSInitResult,logger,settings);
		this.labelSentry = sentry;
		this.set_widths();
	}
	set_widths()
	{
		this.widths = [
			this.config.columns.c1,
			this.config.columns.c2,
			this.config.columns.c3
		]
	}

	replace_curs(newNodeText: string, curs: Parser.TreeCursor) : string
	{
		const preNode = this.formattedLine.substring(0,curs.startPosition.column);
		const postNode = this.formattedLine.substring(curs.endPosition.column);
		return preNode + newNodeText + ' '.repeat(curs.nodeText.length-newNodeText.length) + postNode;
	}
	format_node(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		// Persistent spaces
		if (curs.nodeType.slice(0, 4) == "arg_" || curs.nodeType == "comment" || curs.nodeType == "heading") {
			this.formattedLine = this.replace_curs(curs.nodeText.replace(/ /g, this.persistentSpace), curs);
			return lxbase.WalkerOptions.gotoSibling;
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	formatForPaste(lines: string[], macros: Map<string,Array<labels.LabelNode>>) : string
	{
		this.GetProperties(lines);
		this.formattedCode = '';
		for (this.row=0;this.row<lines.length;this.row++)
		{
			this.formattedLine = this.AdjustLine(lines,macros);
			const tree = this.parse(this.formattedLine,"\n");
			this.walk(tree,this.format_node.bind(this),undefined);
			this.formattedCode += this.formattedLine.
				replace(RegExp('^'+this.callToken),'').
				replace(/\s+/g,' ').
				replace(RegExp(this.persistentSpace,'g'),' ');
			this.formattedCode += '\n';
		}
		return this.formattedCode;
	}
	formatRange(lines: string[], range: vsserv.Range, macros: Map<string,Array<labels.LabelNode>>): vsserv.TextEdit[]
	{
		this.GetProperties(lines);
		const sel = range;
		let formattedDoc = ''
		for (this.row=0;this.row<lines.length;this.row++)
		{
			if (sel.start==sel.end || (this.row>=sel.start.line && this.row<=sel.end.line))
			{
				this.formattedLine = this.AdjustLine(lines,macros);
				const tree = this.parse(this.formattedLine,"\n");
				this.walk(tree,this.format_node.bind(this),undefined);
				this.formattedLine = this.formattedLine.replace(RegExp('^' + this.callToken), '').replace(/\s+/g, ' ');
				this.formattedLine = formatTokens(this.formattedLine, ' ', this.widths);
				this.formattedLine = this.formattedLine.trimEnd().replace(RegExp(this.persistentSpace,'g'),' ');
				formattedDoc += this.formattedLine;
			}
			else
				formattedDoc += lines[this.row];
			if (this.row<lines.length-1)
				formattedDoc += '\n'
		}
		const start = vsserv.Position.create(0,0);
		const end = vsserv.Position.create(lines.length, 0);
		return [vsserv.TextEdit.replace(vsserv.Range.create(start, end), formattedDoc)];
	}
	formatTyping(lines: string[], position: vsserv.Position, ch: string, macros: Map<string,Array<labels.LabelNode>>): vsserv.TextEdit[]
	{
		this.GetProperties(lines);
		const stop1 = this.widths[0];
		const stop2 = this.widths[0] + this.widths[1];
		const stop3 = this.widths[0] + this.widths[1] + this.widths[2];
		const node = ch == ';' ?
			this.GetNodeAtPosition(lines, lxbase.translatePos(position, 0, -1), macros) :
			this.GetNodeAtPosition(lines,position,macros);
		if (node)
		{
			const parent = node.parent;
			if (this.doNotFormat.includes(node.type))
				return [];
			if (parent && this.doNotFormat.includes(parent.type))
				return [];
		}
		if (ch == ';' && (position.character<2 || lines[position.line].charAt(position.character-2)==' '))
		{
			if (position.character <= stop3)
				return [vsserv.TextEdit.replace(vsserv.Range.create(lxbase.translatePos(position,0,-1), position), ' '.repeat(stop3 - position.character + 1) + ';')];
		}
		this.row = position.line;
		this.formattedLine = this.AdjustLine(lines, macros);
		const tree = this.parse(this.formattedLine, "\n");
		this.walk(tree, this.format_node.bind(this),undefined);
		// Now that persistent spaces are in place we can safely use regex
		if (ch==' ')
		{
			const txt = this.formattedLine.substring(0,position.character);
			const c2 = txt.match(/^\S*\s+$/);
			const c3 = txt.match(/^\S*\s+\S+\s*$/);
			const c4 = txt.match(/^\S*\s+\S+\s+\S+\s*$/);
			if (c2 && position.character < stop1)
				return [vsserv.TextEdit.replace(vsserv.Range.create(position, position), ' '.repeat(stop1 - position.character))];
			if (c3 && position.character < stop2)
				return [vsserv.TextEdit.replace(vsserv.Range.create(position, position), ' '.repeat(stop2 - position.character))];
			if (c4 && position.character < stop3)
				return [vsserv.TextEdit.replace(vsserv.Range.create(position, position), ' '.repeat(stop3 - position.character))];
		}
		return [];
	}
}

export class Tokenizer extends lxbase.LangExtBase
{
	labelSentry: labels.LabelSentry;
	line = "";
	tokenizedLine: Array<number> | undefined = new Array<number>();
	tokenizedProgram = new Array<number>();
	columns = 0;
	widths = [9, 6, 11];
	constructor(TSInitResult : [Parser,Parser.Language], logger: lxbase.Logger, settings: merlin6502Settings, sentry: labels.LabelSentry)
	{
		super(TSInitResult,logger,settings);
		this.labelSentry = sentry;
		this.set_widths();
	}
	set_widths()
	{
		this.widths = [
			this.config.columns.c1,
			this.config.columns.c2,
			this.config.columns.c3
		]
	}
	visit(curs: Parser.TreeCursor): lxbase.WalkerChoice {
		if (!this.tokenizedLine)
			return lxbase.WalkerOptions.abort;
		// Two tasks here:
		// 1. convert string to ASCII bytes (to be inverted later)
		// 2. insert column separators

		const parent = curs.currentNode().parent;

		// root level comment needs no separator, Merlin will indent it automatically
		if (curs.nodeType == "comment" && parent?.type == "source_file") {
			for (const c of curs.nodeText)
				this.tokenizedLine.push(c.charCodeAt(0));
			return lxbase.WalkerOptions.gotoSibling;
		}

		if (parent?.parent?.type == "source_file") {
			if (curs.nodeType.length > 3) {
				if (curs.nodeType.substring(0, 3) == "op_") {
					this.tokenizedLine.push(0xa0);
					this.columns = 2;
				}
			}
			if (curs.nodeType.length > 5) {
				if (curs.nodeType.substring(0, 5) == "psop_") {
					this.tokenizedLine.push(0xa0);
					this.columns = 2;
				}
			}
			if (curs.nodeType == "macro_ref") {
				this.tokenizedLine.push(0xa0);
				this.columns = 2;
			}
			if (curs.nodeType.length > 4) {
				if (curs.nodeType.substring(0, 4) == "arg_") {
					this.tokenizedLine.push(0xa0);
					this.columns = 3;
				}
			}
			if (curs.nodeType == "comment") {
				for (let rep = this.columns; rep < 4; rep++) {
					this.tokenizedLine.push(0xa0);
				}
			}
		}

		// append terminal nodes
		if (curs.currentNode().namedChildCount == 0) {
			for (const c of curs.nodeText)
				if (c.charCodeAt(0)<128)
					this.tokenizedLine.push(c.charCodeAt(0));
			return lxbase.WalkerOptions.gotoSibling;
		}

		return lxbase.WalkerOptions.gotoChild;
	}
	tokenizeLine() {
		this.columns = 1;
		this.tokenizedLine = new Array<number>();
		const tree = this.parse(this.line, '\n');
		this.walk(tree, this.visit.bind(this),undefined);
		if (this.tokenizeLine.length > 126)
			this.tokenizedLine = undefined;
		if (this.tokenizedLine == undefined)
			return;
		for (let i = 0; i < this.tokenizedLine.length; i++) {
			if (this.tokenizedLine[i] < 128 && this.tokenizedLine[i] != 32)
				this.tokenizedLine[i] += 128;
		}
		this.tokenizedLine.push(0x8d);
	}
	tokenize(lines: string[], macros: Map<string, Array<labels.LabelNode>>): Array<number> | undefined {
		this.GetProperties(lines);
		this.tokenizedProgram = new Array<number>();
		for (this.row=0;this.row<lines.length;this.row++)
		{
			if (lines[this.row].length == 0) {
				this.tokenizedProgram.push(0x8d);
				continue;
			}
			this.line = this.AdjustLine(lines, macros);
			this.tokenizeLine();
			if (!this.tokenizedLine)
				return undefined;
			this.tokenizedProgram = this.tokenizedProgram.concat(this.tokenizedLine);
		}
		return this.tokenizedProgram;
	}
	detokenize(img: number[]): string | undefined {
		let addr = 0;
		let line = "";
		let code = "";
		while (addr < img.length) {
			if (img[addr] == 0x8d) {
				line = formatTokens(line, "\u0100", this.widths);
				code += line + "\n";
				addr += 1;
				line = "";
			} else if (img[addr]==0xa0) {
				line += "\u0100";
				addr += 1;
			} else if (img[addr]==32 || img[addr]==9) {
				line += String.fromCharCode(img[addr]);
				addr += 1;
			} else if (img[addr] < 128) {
				return undefined;
			} else {
				line += String.fromCharCode(img[addr]-128);
				addr += 1;
			}
		}
		if (line.length > 0) {
			line = formatTokens(line, "\u0100", this.widths);
			code += line + "\n";
		}
		return code;
	}
}

export class DisassemblyTool extends lxbase.LangExtBase
{
	widths = [9, 6, 11];
	disassemblyMap : Map<number,OpData>;
	constructor(TSInitResult : [Parser,Parser.Language], logger: lxbase.Logger, settings: merlin6502Settings)
	{
		super(TSInitResult,logger,settings);
		// This map creates a string where we can simply search for a number,
		// and the number is the length of the binary data.  Furthermore,
		// the value of the data replaces the number.
		const modeMap = new Map<string,string>([
			['imm', '#1'], // 2 if 16 bit mode on 65816
			['abs', '2'],
			['zp', '1'],
			['rel', '1'],
			['rell', '2'],
			['absl', '3'],
			['(zp,x)', '(1,x)'],
			['(abs,x)', '(2,x)'],
			['(zp),y', '(1),y'],
			['zp,x', '1,x'],
			['abs,x', '2,x'],
			['absl,x', '3,x'],
			['zp,y', '1,y'],
			['abs,y', '2,y'],
			['(abs)', '(2)'],
			['(zp)', '(1)'],
			['[d]', '[1]'],
			['[d],y', '[1],y'],
			['d,s', '1,s'],
			['(d,s),y', '(1,s),y'],
			['xyc', '11']
		]);
		this.disassemblyMap = new Map<number,OpData>();
		for (const key in opcodes)
		{
			const modes = Object(opcodes)[key].modes;
			if (!modes)
				continue;
			for (const mode of modes)
			{
				const operandStr = modeMap.get(mode.addr_mnemonic);
				const processors = mode.processors;
				const rel = mode.addr_mnemonic.substring(0,3)=='rel';
				const imm = mode.addr_mnemonic=='imm';
				if (processors && processors.includes('6502'))
					this.disassemblyMap.set(mode.code,{mnemonic:key,operand:operandStr ? operandStr:'0',xc:0,relative:rel,immediate:imm});
				else if (processors && processors.includes('65c02'))
					this.disassemblyMap.set(mode.code,{mnemonic:key,operand:operandStr ? operandStr:'0',xc:1,relative:rel,immediate:imm});
				else
					this.disassemblyMap.set(mode.code,{mnemonic:key,operand:operandStr ? operandStr:'0',xc:2,relative:rel,immediate:imm});
			}
		}
		this.set_widths();
	}
	set_widths()
	{
		this.widths = [
			this.config.columns.c1,
			this.config.columns.c2,
			this.config.columns.c3
		]
	}
	encode_int16(int16: number) : string
	{
		const hiByte = Math.floor(int16/256);
		const loByte = int16 - hiByte*256;
		return String.fromCharCode(loByte) + String.fromCharCode(hiByte);
	}
	to_negative_ascii(raw_str: string) : string
	{
		let negString = '';
		for (let i=0;i<raw_str.length;i++)
			negString += String.fromCharCode(raw_str.charCodeAt(i) + 128);
		return negString;
	}
	buffer_from_raw_str(raw_str: string) : Buffer
	{
		const rawBinary = new Uint8Array(raw_str.length);
		for (let i=0;i<raw_str.length;i++)
			rawBinary[i] = raw_str.charCodeAt(i);
		return Buffer.from(rawBinary);
	}
	hex_from_raw_str(raw_str: string) : string
	{
		const rawBinary = new Uint8Array(this.buffer_from_raw_str(raw_str));
		return [...rawBinary].map(b => b.toString(16).toUpperCase().padStart(2,"0")).join("");
	}
	dos33_bload_range(img: number[]): [number, number] | undefined
	{
		const start = img[0xaa72] + img[0xaa73] * 0x100;
		const length = img[0xaa60] + img[0xaa61] * 0x100;
		const end = start + length;
		if (end > img.length)
			return undefined;
		return [start, end];
	}
	prodos_bload_range(img: number[]): [number, number] | undefined
	{
		const start = img[0xbeb9] + img[0xbeba] * 0x100;
		const length = img[0xbec8] + img[0xbec9] * 0x100;
		const end = start + length;
		if (end > img.length)
			return undefined;
		return [start, end];
	}
	disassemble(img: number[], params: DisassemblyParams) : string
	{
		let addrRange: [number,number] | undefined = params.addrRange;
		if (params.getWhat.includes('BLOAD') && params.getWhat.includes('3.3'))
			addrRange = this.dos33_bload_range(img);
		if (params.getWhat.includes('BLOAD') && params.getWhat.includes('ProDOS'))
			addrRange = this.prodos_bload_range(img);
		if (!addrRange)
			return 'ERROR bad range passed to disassembler';
		const accept_brk = this.config.disassembly.brk;
		const off = params.imgOffset;
		let addr = addrRange[0];
		let code = '';
		const addresses = new Array<number>();
		const references = new Set<number>();
		const labels = new Set<number>();
		const instructions = new Array<string>();
		const operands = new Array<string>();
		const operand_vals = new Array<number>();
		while (addr<addrRange[1])
		{
			addresses.push(addr);
			const op = this.disassemblyMap.get(img[addr-off]);
			if (op && params.xc>=op.xc && (img[addr-off]!=0 || accept_brk))
			{
				instructions.push(op.mnemonic.toUpperCase());
				addr += 1;
				const moveOpMatch = op.operand.match(/[0-9][0-9]/);
				const ordinaryMatch = op.operand.match(/[0-9]/);
				if (ordinaryMatch && !moveOpMatch)
				{
					const bytes = parseInt(ordinaryMatch[0]);
					if (bytes>0 && addr+bytes<=addrRange[1])
					{
						let val = 0;
						for (let i=0;i<bytes;i++)
							val += img[addr-off+i]*(256**i);
						if (op.relative)
							val = addr + bytes + (val<128 ? val : val-256);
						if (!op.immediate)
							references.add(val);
						if (op.relative)
							operands.push(op.operand.replace(bytes.toString(),'$'+val.toString(16).padStart(2+bytes*2,'0')).toUpperCase());
						else
							operands.push(op.operand.replace(bytes.toString(),'$'+val.toString(16).padStart(bytes*2,'0')).toUpperCase());
						operand_vals.push(val);
					}
					else
					{
						operands.push('');
						operand_vals.push(-1);
					}
					addr += bytes;
				}
				if (moveOpMatch && addr+1<addrRange[1])
				{
					const hex1 = '$' + img[addr-off].toString(16).padStart(2,'0').toUpperCase();
					const hex2 = '$' + img[addr-off+1].toString(16).padStart(2,'0').toUpperCase();
					operands.push(op.operand.replace('11',hex1+','+hex2));
					operand_vals.push(-1);
					addr += 2;
				}
			}
			else
			{
				instructions.push('DFB');
				operands.push('$' + img[addr-off].toString(16).padStart(2,'0').toUpperCase());
				operand_vals.push(-1);
				addr += 1;
			}
		}
		// first pass determine labels
		for (let i=0;i<addresses.length;i++)
		{
			if (params.label.includes('every'))
				labels.add(addresses[i]);
			else if (params.label.includes('some') && references.has(addresses[i]))
				labels.add(addresses[i]);
		}
		for (let i=0;i<addresses.length;i++)
		{
			let line = '';
			if (labels.has(addresses[i]))
				line += '_'+addresses[i].toString(16).padStart(4,'0').toUpperCase();
			line += '\t' + instructions[i];
			if (labels.has(operand_vals[i]))
				line += '\t' + operands[i].replace('$','_');
			else if (operands[i].length>0)
				line += '\t' + operands[i];
			line = formatTokens(line, '\t', this.widths);
			code += line + '\n';
		}
		return code;
	}
}
