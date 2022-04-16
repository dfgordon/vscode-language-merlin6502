import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import * as path from 'path';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';

export const WalkerOptions = {
	gotoChild: 0,
	gotoSibling: 1,
	gotoParentSibling: 2,
	exit: 3
} as const;

export type WalkerChoice = typeof WalkerOptions[keyof typeof WalkerOptions];

function get_lang_path(caseSens: boolean|undefined) : string
{
	let lang = 'tree-sitter-merlin6502';
	if (caseSens)
		lang += 'casesens';
	return path.join(__dirname,lang+'.wasm');
}

export async function TreeSitterInit(): Promise<[Parser,Parser.Language,Parser.Language,boolean]>
{
	const config = vscode.workspace.getConfiguration('merlin6502');
	const caseSens = (c => c==undefined?false:c)(config.get('case.caseSensitive')); 
	await Parser.init();
	const parser = new Parser();
	const Merlin6502 = await Parser.Language.load(get_lang_path(false));
	const Merlin6502CaseSens = await Parser.Language.load(get_lang_path(true));
	if (caseSens)
		parser.setLanguage(Merlin6502CaseSens);
	else
		parser.setLanguage(Merlin6502);
	return [parser,Merlin6502,Merlin6502CaseSens,caseSens];
}

export class LabelSet
{
	globals : Set<string>;
	locals : Set<string>;
	vars : Set<string>;
	macros : Set<string>;
	runningVars : Set<string>;
	runningMacros : Set<string>;
	constructor()
	{
		this.globals = new Set<string>();
		this.locals = new Set<string>();
		this.vars = new Set<string>();
		this.macros = new Set<string>();
		this.runningVars = new Set<string>();
		this.runningMacros = new Set<string>();
	}
	add(labels:LabelSet)
	{
		this.globals = new Set([...this.globals,...labels.globals]);
		this.locals = new Set([...this.locals,...labels.locals]);
		this.vars = new Set([...this.vars,...labels.vars]);
		this.macros = new Set([...this.macros,...labels.macros]);
	}
	add_running(labels:LabelSet)
	{
		this.runningVars = new Set([...this.runningVars,...labels.runningVars]);
		this.runningMacros = new Set([...this.runningMacros,...labels.runningMacros]);
	}
}

export class LangExtBase
{
	parser : Parser;
	Merlin6502 : Parser.Language;
	Merlin6502CaseSens : Parser.Language;
	config : vscode.WorkspaceConfiguration;
	caseSens: boolean;
	labels: LabelSet;
	opExactPattern : RegExp;
	psopExactPattern : RegExp;
	opPrefixPattern : RegExp;
	psopPrefixPattern : RegExp;
	currScope = '';
	row = 0;
	col = 0;
	xcCount = 0;
	constructor(TSInitResult : [Parser,Parser.Language,Parser.Language,boolean])
	{
		this.parser = TSInitResult[0];
		this.Merlin6502 = TSInitResult[1];
		this.Merlin6502CaseSens = TSInitResult[2];
		this.caseSens = TSInitResult[3];
		this.config = vscode.workspace.getConfiguration('merlin6502');
		this.labels = new LabelSet;
		this.opExactPattern = /ADC/;
		this.psopExactPattern = /MAC/;
		this.opPrefixPattern = /ADC/;
		this.psopPrefixPattern = /MAC/;
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
		this.opExactPattern = RegExp(patt+')$',flags);
		this.opPrefixPattern = RegExp(patt+')\\S*$',flags);
		patt = '^(POPD|DEND';
		for (const psop in pseudo)
		{
			if (psop=='default')
				continue;
			patt += '|' + psop.toUpperCase().replace('^','\\^');
			const alt = Object(pseudo)[psop]['alt'];
			for (let i=0;i<alt.length;i++)
			{
				patt += '|' + alt[i].toUpperCase().replace('^','\\^');
			}
		}
		this.psopExactPattern = RegExp(patt+')$',flags);
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
		const caseSens = (c => c==undefined?false:c)(this.config.get('case.caseSensitive')); 
		if (caseSens!=this.caseSens)
		{
			this.caseSens = caseSens;
			if (caseSens)
				this.parser.setLanguage(this.Merlin6502CaseSens);
			else
				this.parser.setLanguage(this.Merlin6502);
		}
		return this.parser.parse(txt+append);
	}
	walk(syntaxTree: Parser.Tree,visit: (node: Parser.TreeCursor) => WalkerChoice)
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
		} while (choice!=WalkerOptions.exit);
	}
	visitLabelDefs(curs: Parser.TreeCursor) : WalkerChoice
	{
		const curr = curs.currentNode();
		const child = curr.firstNamedChild;
		const next = curr.nextNamedSibling;
		if (child && curr.type=='label_def')
		{
			if (child.type=='global_label')
			{
				if (next && next.type=='psop_mac')
				{
					this.labels.macros.add(child.text);
				}
				else
				{
					this.labels.globals.add(child.text);
					this.currScope = child.text;
				}
			}
			if (child.type=='local_label')
			{
				this.labels.locals.add(this.currScope+'\u0100'+child.text);
			}
			if (child.type=='var_label')
			{
				this.labels.vars.add(child.text);
			}
			return WalkerOptions.gotoParentSibling;
		}
		if (curr.type=='psop_xc')
			this.xcCount += 1;
		return WalkerOptions.gotoChild;
	}
	GetLabels(document: vscode.TextDocument)
	{
		this.labels = new LabelSet;
		this.currScope = '';
		this.xcCount = 0;
		for (let row=0;row<document.lineCount;row++)
		{
			const programLine = document.lineAt(row).text;
			const tree = this.parse(programLine,"\n");
			this.walk(tree,this.visitLabelDefs.bind(this));
		}
		this.set_reserved_words();
		this.currScope = ''; // avoid debugging confusion
	}
	/// AdjustLine is used to let the parser know when an item
	/// in the operator column is a previously defined macro name.
	/// The signal is unicode 0x100 at the start of the line.
	/// GetLabels must be called before the first line is processed.
	AdjustLine(document: vscode.TextDocument) : string
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
			if (this.labels.macros.has(mnemonic) && mnemonic.match(this.opExactPattern)==null && mnemonic.match(this.psopExactPattern)==null)
				prefix = '\u0100';
			if (mnemonic.match(this.opPrefixPattern)==null && mnemonic.match(this.psopPrefixPattern)==null)
				prefix = '\u0100';
		}
		this.col = -prefix.length;
		return prefix + programLine;
	}
}
