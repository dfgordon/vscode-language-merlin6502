import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import * as path from 'path';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';

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

function get_lang_path() : string
{
	const lang = 'tree-sitter-merlin6502';
	return path.join(__dirname,lang+'.wasm');
}

export async function LoadSources(doc: vscode.TextDocument): Promise<Array<vscode.Uri>>
{
	const workroot = vscode.workspace.getWorkspaceFolder(doc.uri);
	if (workroot)
	{
		const patt = new vscode.RelativePattern(workroot,"**/*.S");
		const excl = new vscode.RelativePattern(workroot,"**/node_modules/**");
		const files = await vscode.workspace.findFiles(patt,excl);
		return files;
	}
	return [];
}

/// Returns a parser and language.  The language is redundant at present,
/// but someday we may want to return a linker command parser, or separate
/// out Merlin versions as distinct parsers.
export async function TreeSitterInit(): Promise<[Parser,Parser.Language]>
{
	await Parser.init();
	const parser = new Parser();
	const Merlin6502 = await Parser.Language.load(get_lang_path());
	parser.setLanguage(Merlin6502);
	return [parser,Merlin6502];
}

export class LangExtBase
{
	parser : Parser;
	Merlin6502 : Parser.Language;
	config : vscode.WorkspaceConfiguration;
	opExactPattern : RegExp;
	psopExactPattern : RegExp;
	opPrefixPattern : RegExp;
	psopPrefixPattern : RegExp;
	row = 0;
	col = 0;
	xcCount = 0;
	merlinVersion = 'v8';
	linkerCount = 0;
	caseSens = false;
	foundNode : Parser.SyntaxNode | null = null;
	searchPos : vscode.Position = new vscode.Position(0,0);
	constructor(TSInitResult : [Parser,Parser.Language])
	{
		this.parser = TSInitResult[0];
		this.Merlin6502 = TSInitResult[1];
		this.opExactPattern = /ADC/;
		this.psopExactPattern = /MAC/;
		this.opPrefixPattern = /ADC/;
		this.psopPrefixPattern = /MAC/;
		this.config = vscode.workspace.getConfiguration('merlin6502');
		this.reset();
	}
	reset()
	{
		this.config = vscode.workspace.getConfiguration('merlin6502');
		const v = this.config.get('version') as string;
		if (v)
			this.merlinVersion = 'v' + v.substring(v.indexOf(' ')+1);
		if (this.merlinVersion=='v8')
			this.xcCount = 0;
		else
			this.xcCount = 2;
		this.linkerCount = 0;
	}
	get_interpretation(doc: vscode.TextDocument) : string
	{
		const threshold = this.config.get('linker.detect') as number;
		if (this.linkerCount/doc.lineCount > threshold)
			return 'linker';
		else
			return 'source';
	}
	set_reserved_words()
	{
		const flags = this.caseSens ? '' : 'i';
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
	curs_to_range(curs: Parser.TreeCursor, rowOffset: number, colOffset: number): vscode.Range
	{
		const coff = curs.startPosition.column+colOffset<0 ? 0 : colOffset;
		const start_pos = new vscode.Position(curs.startPosition.row + rowOffset,curs.startPosition.column + coff);
		const end_pos = new vscode.Position(curs.endPosition.row + rowOffset,curs.endPosition.column + coff);
		return new vscode.Range(start_pos,end_pos);
	}
	node_to_range(node: Parser.SyntaxNode, rowOffset: number, colOffset: number): vscode.Range
	{
		const coff = node.startPosition.column+colOffset<0 ? 0 : colOffset;
		const start_pos = new vscode.Position(node.startPosition.row + rowOffset,node.startPosition.column + coff);
		const end_pos = new vscode.Position(node.endPosition.row + rowOffset,node.endPosition.column + coff);
		return new vscode.Range(start_pos,end_pos);
	}
	verify_document() : {ed:vscode.TextEditor,doc:vscode.TextDocument} | undefined
	{
		const textEditor = vscode.window.activeTextEditor;
		if (!textEditor)
			return undefined;
		const document = textEditor.document;
		if (!document || document.languageId!='merlin6502')
			return undefined;
		return {ed:textEditor,doc:document};
	}
	parse(txt: string,append: string) : Parser.Tree
	{
		this.config = vscode.workspace.getConfiguration('merlin6502');
		this.caseSens = (c => c==undefined?false:c)(this.config.get('case.caseSensitive'));
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
		if (curr.type=='label_ref' && curs.currentFieldName()=='mac' && ['LNK','LKV','ASM'].includes(curr.text.toUpperCase()))
		{
			this.linkerCount += 1;
			return WalkerOptions.exit;
		}
		return WalkerOptions.gotoChild;
	}
	GetProperties(document: vscode.TextDocument)
	{
		this.reset();
		for (let row=0;row<document.lineCount;row++)
		{
			const programLine = document.lineAt(row).text;
			const tree = this.parse(programLine,"\n");
			this.walk(tree,this.visit_properties.bind(this));
			if (row>50)
				break; // don't waste time in large files
		}
		this.set_reserved_words();
	}
	visit_find(curs: Parser.TreeCursor) : WalkerChoice
	{
		// go as deep as possible to find the smallest element
		const rng = this.curs_to_range(curs,this.row,this.col);
		if (rng.contains(this.searchPos))
			this.foundNode = curs.currentNode();
		return WalkerOptions.gotoChild;
	}
	GetNodeAtPosition(document: vscode.TextDocument,position: vscode.Position,macros: Map<string,any>) : Parser.SyntaxNode | null
	{
		this.row = position.line;
		this.col = 0;
		this.foundNode = null;
		this.searchPos = position;
		const tree = this.parse(this.AdjustLine(document,macros),"\n");
		this.walk(tree,this.visit_find.bind(this));
		return this.foundNode;
	}
	/// AdjustLine is used to let the parser know when an item
	/// in the operator column is a previously defined macro name.
	/// The signal is unicode 0x100 at the start of the line.
	/// GetLabels must be called before the first line is processed.
	AdjustLine(document: vscode.TextDocument, macros: Map<string,any>) : string
	{
		// Doing this with regex only - have to be careful
		const programLine = document.lineAt(this.row).text;
		if (programLine.charAt(0)=='*')
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
