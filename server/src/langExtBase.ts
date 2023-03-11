import * as vsserv from 'vscode-languageserver/node';
import Parser from 'web-tree-sitter';
import * as path from 'path';
import { defaultSettings, merlin6502Settings } from './settings';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';
import { LabelNode } from './labels';

export function relativeToWorkspace(dirs: vsserv.WorkspaceFolder[], uri: string) : string {
	const base = dirs.length > 0 ? dirs[0].uri : undefined;
	return base ? uri.replace(base, '').substring(1) : uri;
}

export function curs_to_range(curs: Parser.TreeCursor, rowOffset: number, colOffset: number): vsserv.Range
{
	const coff1 = curs.startPosition.column + colOffset < 0 ? 0 : colOffset;
	const coff2 = curs.endPosition.column + colOffset < 0 ? 0 : colOffset;
	return vsserv.Range.create(
		curs.startPosition.row + rowOffset,
		curs.startPosition.column + coff1,
		curs.endPosition.row + rowOffset,
		curs.endPosition.column + coff2
	);
}
export function node_to_range(node: Parser.SyntaxNode, rowOffset: number, colOffset: number): vsserv.Range
{
	const coff1 = node.startPosition.column + colOffset < 0 ? 0 : colOffset;
	const coff2 = node.endPosition.column + colOffset < 0 ? 0 : colOffset;
	return vsserv.Range.create(
		node.startPosition.row + rowOffset,
		node.startPosition.column + coff1,
		node.endPosition.row + rowOffset,
		node.endPosition.column + coff2
	);
}

export function rangeContainsPos(rng: vsserv.Range, pos: vsserv.Position) : boolean // is this built in somewhere?
{
	if (pos.line < rng.start.line || pos.line > rng.end.line)
		return false;
	if (pos.line == rng.start.line && pos.character < rng.start.character)
		return false;
	if (pos.line == rng.end.line && pos.character > rng.end.character)
		return false;
	return true;
}

export function rangeContainsRange(outer: vsserv.Range, inner: vsserv.Range) : boolean // is this built in somewhere?
{
	if (inner.start.line < outer.start.line || inner.end.line > outer.end.line)
		return false;
	if (inner.start.line == outer.start.line && inner.start.character < outer.start.character)
		return false;
	if (inner.end.line == outer.end.line && inner.end.character > outer.end.character)
		return false;
	return true;
}

export function translatePos(pos: vsserv.Position,dl: number,dc: number) {
	return vsserv.Position.create(
		pos.line + dl < 0 ? 0 : pos.line + dl,
		pos.character + dc < 0 ? 0 : pos.character + dc
	)
}

export function rangeUnion(r1: vsserv.Range, r2: vsserv.Range): vsserv.Range {
	return vsserv.Range.create(
		r1.start.line < r2.start.line ? r1.start.line : r2.start.line,
		r1.start.line < r2.start.line || r1.start.line == r2.start.line && r1.start.character < r2.start.character ? r1.start.character : r2.start.character,
		r2.end.line > r1.end.line ? r2.end.line : r1.end.line,
		r2.end.line > r1.end.line || r2.end.line == r1.end.line && r2.end.character > r1.end.character ? r2.end.character : r1.end.character
	)
}

export const WalkerOptions = {
	gotoChild: 0,
	gotoSibling: 1,
	gotoParentSibling: 2,
	exit: 3,
	abort: 4
} as const;

export type WalkerChoice = typeof WalkerOptions[keyof typeof WalkerOptions];

export const SourceOptions = {
	master: 0,
	use: 1,
	put: 2
} as const;

export type SourceType = typeof SourceOptions[keyof typeof SourceOptions];

/// Returns a parser and language.  The language is redundant at present,
/// but someday we may want to return a linker command parser, or separate
/// out Merlin versions as distinct parsers.
export async function TreeSitterInit(): Promise<[Parser,Parser.Language]>
{
	await Parser.init();
	const parser = new Parser();
	const Merlin6502 = await Parser.Language.load(path.join(__dirname,'tree-sitter-merlin6502.wasm'));
	parser.setLanguage(Merlin6502);
	return [parser,Merlin6502];
}

export class LangExtBase
{
	parser : Parser;
	Merlin6502 : Parser.Language;
	config = defaultSettings;
	opExactPattern : RegExp;
	psopExactPattern : RegExp;
	opPrefixPattern : RegExp;
	psopPrefixPattern : RegExp;
	row = 0;
	col = 0;
	xcCount = 0;
	merlinVersion = 'v8';
	linkerCount = 0;
	interpretation = 'source';
	foundNode : Parser.SyntaxNode | null = null;
	searchPos = vsserv.Position.create(0,0);
	constructor(TSInitResult : [Parser,Parser.Language], settings: merlin6502Settings)
	{
		this.parser = TSInitResult[0];
		this.Merlin6502 = TSInitResult[1];
		this.opExactPattern = /ADC/;
		this.psopExactPattern = /MAC/;
		this.opPrefixPattern = /ADC/;
		this.psopPrefixPattern = /MAC/;
		this.configure(settings);
		this.reset();
	}
	configure(settings: merlin6502Settings)
	{
		this.config = settings;
	}
	reset()
	{
		const v = this.config.version;
		if (v)
			this.merlinVersion = 'v' + v.substring(v.indexOf(' ')+1);
		if (this.merlinVersion=='v8')
			this.xcCount = 0;
		else
			this.xcCount = 2;
		this.linkerCount = 0;
	}
	set_reserved_words()
	{
		const flags = this.config.case.caseSensitive ? '' : 'i';
		let patt = '';
		for (const op in opcodes)
		{
			if (op=='default')
				continue;
			const proc = Object(opcodes)[op]['processors'];
			if (this.xcCount==0 && !proc.includes('6502'))
				continue;
			if (this.xcCount==1 && !proc.includes('65c02'))
				continue;
			if (patt=='')
				patt += '^('
			else
				patt += '|'
			patt += op.toUpperCase();
			const alt = Object(opcodes)[op]['alt'];
			for (let i=0;i<alt.length;i++)
			{
				patt += '|' + alt[i].toUpperCase();
			}
		}
		this.opExactPattern = RegExp(patt+')$','i');
		this.opPrefixPattern = RegExp(patt+')\\S*$',flags);
		patt = '^(POPD|DEND';
		for (const psop in pseudo)
		{
			if (psop=='default')
				continue;
			if (!Object(pseudo)[psop]['version'].includes(this.merlinVersion))
				continue;
			patt += '|' + psop.toUpperCase().replace('^','\\^');
			const alt = Object(pseudo)[psop]['alt'];
			for (let i=0;i<alt.length;i++)
			{
				patt += '|' + alt[i].toUpperCase().replace('^','\\^');
			}
		}
		this.psopExactPattern = RegExp(patt+')$','i');
		this.psopPrefixPattern = RegExp(patt+')\\S*$',flags);
	}
	parse(txt: string,append: string) : Parser.Tree
	{
		return this.parser.parse(txt+append);
	}
	walk(syntaxTree: Parser.Tree,visit: (node: Parser.TreeCursor) => WalkerChoice) : WalkerChoice
	{
		const curs = syntaxTree.walk();
		let choice : WalkerChoice = WalkerOptions.gotoChild;
		do
		{
			if (choice==WalkerOptions.gotoChild && curs.gotoFirstChild())
				choice = visit(curs);
			else if (choice==WalkerOptions.gotoParentSibling && curs.gotoParent() && curs.gotoNextSibling())
				choice = visit(curs);
			else if (choice==WalkerOptions.gotoSibling && curs.gotoNextSibling())
				choice = visit(curs);
			else if (curs.gotoNextSibling())
				choice = visit(curs);
			else if (curs.gotoParent())
				choice = WalkerOptions.gotoSibling;
			else
				choice = WalkerOptions.exit;
		} while (choice!=WalkerOptions.exit && choice!=WalkerOptions.abort);
		return choice;
	}
	visit_properties(curs: Parser.TreeCursor) : WalkerChoice
	{
		const curr = curs.currentNode();
		if (curr.type=='psop_xc')
		{
			if (curr.nextSibling && curr.nextSibling.text.toUpperCase()=='OFF')
				this.xcCount = 0;
			else
				this.xcCount += 1;
			if (this.xcCount>2)
				this.xcCount = 2;
			return WalkerOptions.exit;
		}
		if (curr.type=='macro_ref' && ['LNK','LKV','ASM'].includes(curr.text.toUpperCase()))
		{
			this.linkerCount += 1;
			return WalkerOptions.exit;
		}
		return WalkerOptions.gotoChild;
	}
	GetProperties(lines: string[])
	{
		this.reset();
		for (let row=0;row<lines.length;row++)
		{
			const programLine = lines[row];
			const tree = this.parse(programLine,"\n");
			this.walk(tree,this.visit_properties.bind(this));
			if (row>50)
				break; // don't waste time in large files
		}
		this.set_reserved_words();
		const threshold = this.config.linker.detect;
		if (this.linkerCount/lines.length > threshold)
			this.interpretation = 'linker';
		else
			this.interpretation = 'source';
	}
	visit_find(curs: Parser.TreeCursor) : WalkerChoice
	{
		// go as deep as possible to find the smallest element
		const rng = curs_to_range(curs,this.row,this.col);
		if (rangeContainsPos(rng,this.searchPos))
			this.foundNode = curs.currentNode();
		return WalkerOptions.gotoChild;
	}
	GetNodeAtPosition(lines: string[],position: vsserv.Position,macros: Map<string,LabelNode[]>) : Parser.SyntaxNode | null
	{
		this.row = position.line;
		this.col = 0;
		this.foundNode = null;
		this.searchPos = position;
		const tree = this.parse(this.AdjustLine(lines,macros),"\n");
		this.walk(tree,this.visit_find.bind(this));
		return this.foundNode;
	}
	/// AdjustLine is used to let the parser know when an item
	/// in the operator column is a previously defined macro name.
	/// The signal is unicode 0x100 at the start of the line.
	/// GetLabels must be called before the first line is processed.
	AdjustLine(lines: string[], macros: Map<string,LabelNode[]>) : string
	{
		// Doing this with regex only - have to be careful
		const programLine = lines[this.row];
		if (programLine.charAt(0)=='*' || programLine.charAt(0)==';')
			return programLine;
		const match = programLine.match(/\s+\S+/);
		let prefix = '';
		if (match)
		{
			const mnemonic = match[0].trim();
			const anyExactMatch = mnemonic.match(this.opExactPattern) || mnemonic.match(this.psopExactPattern);
			const anyMatch = anyExactMatch || mnemonic.match(this.opPrefixPattern) || mnemonic.match(this.psopPrefixPattern)
			if (macros.has(mnemonic) && !anyExactMatch)
				prefix = '\u0100';
			if (!anyMatch && mnemonic[0]!=';')
				prefix = '\u0100';
		}
		this.col = -prefix.length;
		return prefix + programLine;
	}
}
