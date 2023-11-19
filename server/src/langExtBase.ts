import * as vsserv from 'vscode-languageserver/node';
import Parser from 'web-tree-sitter';
import * as path from 'path';
import { defaultSettings, merlin6502Settings } from './settings';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';
import { LabelNode } from './labels';

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

export function translatePos(pos: vsserv.Position,dl: number,dc: number): vsserv.Position {
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

export type Logger = vsserv.RemoteConsole & vsserv._ | Console;

export const WalkerOptions = {
	gotoChild: 0,
	gotoSibling: 1,
	gotoParentSibling: 2,
	exit: 3,
	abort: 4,
	gotoInclude: 5
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
	logger: Logger;
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
	searchPos = vsserv.Position.create(0, 0);
	searchTypes = new Array<string>();
	searchText = new Array<string>();
	replaceText = new Array<string>();
	matches = new Set<number>();
	buildString = '';
	delta = 0;
	constructor(TSInitResult : [Parser,Parser.Language], connection: Logger, settings: merlin6502Settings)
	{
		this.logger = connection;
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
	/**
	 * Walk a syntax tree with provision for includes, usually applied line by line
	 * @param syntaxTree result of Tree-sitter parser's analysis of the code
	 * @param visit visitor to take some action given the current `TreeCursor`, returns `WalkerChoice` to guide the next visit
	 * @param descend Function to call if the visitor wants to go inside an include, argument is the cursor position that induced the descent.
	 *   Can be undefined, in which case a request to go inside is translated into a request to go to the next sibling.
	 * @returns `WalkerChoice` enum, should be either `WalkerOptions.exit` or `WalkerOptions.abort`
	 */
	walk(syntaxTree: Parser.Tree,visit: (node: Parser.TreeCursor) => WalkerChoice, descend: undefined | ((node: Parser.TreeCursor) => WalkerChoice)) : WalkerChoice
	{
		const curs = syntaxTree.walk();
		let choice : WalkerChoice = WalkerOptions.gotoChild;
		do
		{
			if (choice == WalkerOptions.gotoInclude && descend)
				choice = descend(curs);
			else if (choice == WalkerOptions.gotoInclude && !descend)
				choice = WalkerOptions.gotoSibling;
			else if (choice==WalkerOptions.gotoChild && curs.gotoFirstChild())
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
			this.walk(tree,this.visit_properties.bind(this),undefined);
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
		this.walk(tree,this.visit_find.bind(this),undefined);
		return this.foundNode;
	}
	visit_replace(curs: Parser.TreeCursor): WalkerChoice {
		const spaces = curs.startPosition.column + this.delta - this.buildString.length;
		if (spaces>0)
			this.buildString = this.buildString.padEnd(spaces + this.buildString.length);
		for (let i = 0; i < this.searchText.length; i++) {
			if (curs.nodeType == this.searchTypes[i] && curs.nodeText == this.searchText[i]) {
				this.matches.add(i);
				this.buildString += this.replaceText[i];
				this.delta += this.replaceText[i].length - this.searchText[i].length;
				return WalkerOptions.gotoSibling;
			}
		}
		// append terminal nodes
		if (curs.currentNode().namedChildCount == 0) {
			this.buildString += curs.nodeText;
			return WalkerOptions.gotoSibling;
		}

		return WalkerOptions.gotoChild;
	}
	/**
	 * save state, make substitutions in line, then restore state
	 * @param line 
	 * @param macros 
	 * @param find 
	 * @param types 
	 * @param repl 
	 * @returns [updated line, set that was actually replaced]
	 */
	Substitute(line: string, macros: Set<string>, find: string[], types: string[], repl: string[]): [string, Set<number>] {
		const oldRow = this.row;
		const oldCol = this.col;
		this.buildString = '';
		this.delta = 0;
		this.searchText = find;
		this.searchTypes = types;
		this.replaceText = repl;
		this.matches = new Set<number>();
		const tree = this.parse(this.adjust_line(line, macros), "\n");
		this.walk(tree, this.visit_replace.bind(this), undefined);
		this.row = oldRow;
		this.col = oldCol;
		if (this.buildString[0] == "\u0100")
			this.buildString = this.buildString.substring(1);
		return [this.buildString,this.matches];
	}
	/**
	 * Look for match to a previously defined macro in column 2.
	 * If there is a match insert unicode 0x100 at start of line.  This forces intepretation as an implicit macro call.
	 * This is needed to emulate Merlin's contextual parsing rules.
	 * @param line text of the line to adjust
	 * @param macros map from macro names to arrays of label nodes, this can be from a running accumulation
	*/
	adjust_line(programLine: string, macros: Set<string> | Map<string,LabelNode[]>) : string
	{
		// Doing this with regex only - have to be careful
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
	/**
	 * convenience function calling `adjust_line` based on `this.row`
	*/
	AdjustLine(lines: string[], macros: Set<string> | Map<string, LabelNode[]>): string {
		return this.adjust_line(lines[this.row], macros);
	}
}
