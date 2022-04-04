import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import * as path from 'path';

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

export class LangExtBase
{
	parser : Parser;
	Merlin6502 : Parser.Language;
	Merlin6502CaseSens : Parser.Language;
	config : vscode.WorkspaceConfiguration;
	caseSens: boolean;
	constructor(TSInitResult : [Parser,Parser.Language,Parser.Language,boolean])
	{
		this.parser = TSInitResult[0];
		this.Merlin6502 = TSInitResult[1];
		this.Merlin6502CaseSens = TSInitResult[2];
		this.caseSens = TSInitResult[3];
		this.config = vscode.workspace.getConfiguration('merlin6502');
	}
	curs_to_range(curs: Parser.TreeCursor): vscode.Range
	{
		const start_pos = new vscode.Position(curs.startPosition.row,curs.startPosition.column);
		const end_pos = new vscode.Position(curs.endPosition.row,curs.endPosition.column);
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
}
